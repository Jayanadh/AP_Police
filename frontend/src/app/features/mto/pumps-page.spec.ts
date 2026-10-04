import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { Pump, PumpTank } from '../../core/api/pumps-api';
import { MapView } from '../../ui/map-view';
import { NEVER_LOADING_LEAFLET } from '../../ui/testing/leaflet-stub';
import { ToastService } from '../../ui/toast';
import { PumpsPage } from './pumps-page';

const tank = (overrides: Partial<PumpTank> = {}): PumpTank => ({
  id: 31,
  fuel_type: 'PETROL',
  current_stock_litres: '450.00',
  low_stock_threshold_litres: '100.00',
  capacity_litres: '1000.00',
  is_low: false,
  opening_set: true,
  ...overrides,
});

const pump = (overrides: Partial<Pump> = {}): Pump => ({
  id: 3,
  name: 'Nellore Police Pump',
  kind: 'POLICE',
  kind_label: 'Police pump',
  address: 'Police Lines, Nellore',
  district: 7,
  district_name: 'Nellore',
  latitude: '14.442600',
  longitude: '79.986500',
  opening_hours: '24/7',
  sells_petrol: true,
  sells_diesel: true,
  is_active: true,
  tanks: [
    tank(),
    tank({
      id: 32,
      fuel_type: 'DIESEL',
      current_stock_litres: '60.00',
      is_low: true,
    }),
  ],
  staff_count: 2,
  ...overrides,
});

const POLICE = pump();
const BUNK = pump({
  id: 4,
  name: 'Kavali Bunk',
  kind: 'TIE_UP',
  kind_label: 'Tie-up bunk',
  address: 'NH16, Kavali',
  district_name: 'Prakasam',
  latitude: '14.915000',
  longitude: '79.992000',
  opening_hours: '6am-10pm',
  sells_diesel: false,
  tanks: [],
  staff_count: 1,
});
const CLOSED = pump({
  id: 5,
  name: 'Sullurpeta Pump',
  latitude: '13.700000',
  longitude: '80.020000',
  is_active: false,
  tanks: [],
  staff_count: 0,
});

describe('PumpsPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        NEVER_LOADING_LEAFLET,
      ],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(rows: Pump[] | 'fail' = [POLICE, BUNK, CLOSED]) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PumpsPage);
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const reply = async (body: Pump[] | 'fail') => {
      const req = http.expectOne('/api/pumps/');
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
    };
    await reply(rows);
    const cards = () => Array.from(el.querySelectorAll<HTMLElement>('a.pump'));
    const button = (label: string) =>
      Array.from(el.querySelectorAll('button')).find((b) => text(b) === label) as
        HTMLButtonElement | undefined;
    const map = () =>
      fixture.debugElement.query(By.directive(MapView))?.componentInstance as MapView | undefined;
    const toasts = () => TestBed.inject(ToastService).messages();
    return { fixture, el, http, text, reply, cards, button, map, toasts };
  }

  it('lists the pumps with their details', async () => {
    const { el, cards, text } = await setup();
    expect(text(el.querySelector('h1'))).toBe('Pumps');
    expect(cards()).toHaveLength(3);
    const police = cards()[0];
    expect(text(police.querySelector('.name'))).toBe('Nellore Police Pump');
    expect(text(police.querySelector('.kind'))).toBe('Police pump');
    expect(text(police)).toContain('Police Lines, Nellore');
    expect(text(police)).toContain('24/7');
    expect(Array.from(police.querySelectorAll('.fuel')).map((c) => text(c))).toEqual([
      'Petrol',
      'Diesel',
    ]);
    expect(text(police.querySelector('app-status-badge'))).toBe('Active');
    expect(police.getAttribute('href')).toBe('/mto/pumps/3');
  });

  it('shows the tie-up bunk as such, with only the fuel it sells and no tanks', async () => {
    const { cards, text } = await setup();
    const bunk = cards()[1];
    expect(text(bunk.querySelector('.kind'))).toBe('Tie-up bunk');
    expect(text(bunk)).toContain('6am-10pm');
    expect(Array.from(bunk.querySelectorAll('.fuel')).map((c) => text(c))).toEqual(['Petrol']);
    expect(bunk.querySelector('.progress')).toBeNull();
    expect(bunk.getAttribute('href')).toBe('/mto/pumps/4');
  });

  it('shows a level bar for each tank of a police pump, with a red Low badge for a low one', async () => {
    const { cards, text } = await setup();
    const tanks = Array.from(cards()[0].querySelectorAll<HTMLElement>('.tank'));
    expect(tanks).toHaveLength(2);
    expect(text(tanks[0])).toContain('Petrol');
    expect(text(tanks[0])).toContain('450 L');
    expect(text(tanks[1])).toContain('Diesel');
    expect(text(tanks[1])).toContain('60 L');

    const petrolBar = tanks[0].querySelector<HTMLElement>('.progress')!;
    expect(petrolBar.querySelector<HTMLElement>('span')!.style.width).toBe('45%');
    expect(petrolBar.classList.contains('danger')).toBe(false);
    expect(tanks[0].querySelector('.badge-danger')).toBeNull();

    const dieselBar = tanks[1].querySelector<HTMLElement>('.progress')!;
    expect(dieselBar.querySelector<HTMLElement>('span')!.style.width).toBe('6%');
    expect(dieselBar.classList.contains('danger')).toBe(true);
    expect(text(tanks[1].querySelector('.badge-danger'))).toBe('Low');
  });

  it('says "No capacity set" next to the bar of a tank with no capacity, and only then', async () => {
    const withoutCapacity = pump({
      id: 6,
      name: 'Gudur Pump',
      tanks: [
        tank({ id: 61, capacity_litres: null }),
        tank({ id: 62, fuel_type: 'DIESEL', capacity_litres: '800.00' }),
      ],
    });
    const { cards, text } = await setup([withoutCapacity, BUNK]);
    const tanks = Array.from(cards()[0].querySelectorAll<HTMLElement>('.tank'));
    expect(text(tanks[0].querySelector('.hint'))).toBe('No capacity set');
    expect(tanks[1].querySelector('.hint')).toBeNull();
  });

  it('marks a pump that is switched off as inactive', async () => {
    const { cards, text } = await setup();
    expect(text(cards()[2].querySelector('app-status-badge'))).toBe('Inactive');
  });

  it('says how many staff logins each pump has', async () => {
    const { cards, text } = await setup();
    expect(text(cards()[0])).toContain('2 staff logins');
    expect(text(cards()[1])).toContain('1 staff login');
    expect(text(cards()[2])).toContain('No staff logins yet');
  });

  it('puts every pump on the map, red for police pumps and amber for tie-up bunks', async () => {
    const { map } = await setup();
    expect(map()!.markers()).toEqual([
      { id: 3, lat: 14.4426, lng: 79.9865, label: 'Nellore Police Pump', tone: 'police' },
      { id: 4, lat: 14.915, lng: 79.992, label: 'Kavali Bunk', tone: 'tieup' },
      { id: 5, lat: 13.7, lng: 80.02, label: 'Sullurpeta Pump (inactive)', tone: 'police' },
    ]);
    expect(map()!.center()).toBeNull();
    expect(map()!.pickable()).toBe(false);
  });

  it('highlights the card and the pin of the pump whose marker was clicked', async () => {
    const { fixture, cards, map } = await setup();
    map()!.markerClick.emit(4);
    await fixture.whenStable();
    expect(cards().map((c) => c.classList.contains('selected'))).toEqual([false, true, false]);
    expect(
      map()!
        .markers()
        .map((m) => m.tone),
    ).toEqual(['police', 'selected', 'police']);

    map()!.markerClick.emit(3);
    await fixture.whenStable();
    expect(cards().map((c) => c.classList.contains('selected'))).toEqual([true, false, false]);
  });

  it('opens the add form, and adds the pump to the list when it is saved', async () => {
    const s = await setup();
    expect(s.el.querySelector('app-pump-form')).toBeNull();
    s.button('Add pump')!.click();
    await s.fixture.whenStable();
    expect(s.el.querySelector('app-pump-form')).toBeTruthy();
    await s.fixture.whenStable();

    s.fixture.debugElement
      .query(By.css('app-pump-form'))
      .componentInstance.saved.emit(pump({ id: 9, name: 'New Pump' }));
    await s.fixture.whenStable();
    expect(s.el.querySelector('app-pump-form')).toBeNull();
    expect(s.toasts()[0]).toMatchObject({ text: 'Pump added.', tone: 'success' });
    await s.reply([POLICE, BUNK, CLOSED, pump({ id: 9, name: 'New Pump' })]);
    expect(s.cards()).toHaveLength(4);
  });

  it('closes the add form when it is cancelled', async () => {
    const s = await setup();
    s.button('Add pump')!.click();
    await s.fixture.whenStable();
    await s.fixture.whenStable();
    s.button('Cancel')!.click();
    await s.fixture.whenStable();
    expect(s.el.querySelector('app-pump-form')).toBeNull();
  });

  it('shows an empty state, without a map, when there are no pumps', async () => {
    const { el, text, map } = await setup([]);
    expect(text(el.querySelector('app-empty-state'))).toContain('No pumps yet');
    expect(map()).toBeUndefined();
  });

  it('shows the error with a way to try again', async () => {
    const s = await setup('fail');
    expect(s.text(s.el.querySelector('[role="alert"]'))).toBe('Not available.');
    expect(s.map()).toBeUndefined();
    s.button('Try again')!.click();
    await s.reply([POLICE]);
    expect(s.cards()).toHaveLength(1);
  });
});
