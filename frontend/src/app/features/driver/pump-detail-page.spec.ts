import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DirectoryPump } from '../../core/api/pumps-api';
import { MyVehicles } from '../../core/api/vehicles-api';
import { GeoService, LatLng } from '../../core/geo';
import { makeMyVehicle } from '../../core/test-data';
import { PumpDetailPage } from './pump-detail-page';

const HERE: LatLng = { lat: 14.4426, lng: 79.9865 };

const pump = (overrides: Partial<DirectoryPump> = {}): DirectoryPump => ({
  id: 3,
  name: 'Nellore Police Pump',
  kind: 'POLICE',
  kind_label: 'Police pump',
  address: 'Police Lines, Nellore',
  district_name: 'Nellore',
  unit_name: 'MTO Nellore',
  latitude: '14.450000',
  longitude: '79.990000',
  opening_hours: '24/7',
  sells_petrol: true,
  sells_diesel: true,
  petrol_available: true,
  diesel_available: true,
  ...overrides,
});

const NELLORE = pump();
// A police pump that sells diesel but has run out of it.
const DRY = pump({
  id: 8,
  name: 'Ongole Police Pump',
  address: 'Kurnool Road, Ongole',
  district_name: 'Prakasam',
  latitude: '15.505700',
  longitude: '80.049900',
  opening_hours: '6 am – 10 pm',
  diesel_available: false,
});

// A tie-up bunk that sells petrol only. A bunk keeps no stock: it either sells a fuel or it does not.
const KAVALI = pump({
  id: 9,
  name: 'Kavali Bunk',
  kind: 'TIE_UP',
  kind_label: 'Tie-up bunk',
  sells_diesel: false,
  diesel_available: false,
});

const MINE = (vehicles = [makeMyVehicle({ fuel_type: 'DIESEL' })]): MyVehicles => ({
  vehicles,
  mto: { unit_name: 'MTO Nellore', full_name: 'Ravi Kumar', mobile: '9876543210' },
});

describe('PumpDetailPage', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(
    id = '3',
    rows: DirectoryPump[] | 'fail' = [NELLORE, DRY, KAVALI],
    mine: MyVehicles = MINE(),
    here: LatLng | null = HERE,
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: GeoService, useValue: { current: () => Promise.resolve(here) } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PumpDetailPage);
    fixture.componentRef.setInput('id', id);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const reply = async (body: DirectoryPump[] | 'fail') => {
      const req = http.expectOne('/api/pump-directory/');
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
    };
    http.expectOne('/api/me/vehicles/').flush(mine);
    await reply(rows);
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const link = (label: string) =>
      Array.from(el.querySelectorAll<HTMLAnchorElement>('a')).find(
        (a) => text(a) === label || a.getAttribute('aria-label') === label,
      );
    const stat = (label: string) =>
      Array.from(el.querySelectorAll('.stat')).find(
        (s) => text(s.querySelector('.stat-label')) === label,
      );
    const chips = () => Array.from(el.querySelectorAll<HTMLElement>('.fuel-chips .chip'));
    return { fixture, el, http, text, link, stat, chips, reply };
  }

  it('shows the pump’s name, kind and address, with a way back to the finder', async () => {
    const { el, text, link } = await setup();
    expect(text(el.querySelector('h1'))).toBe('Nellore Police Pump');
    expect(text(el.querySelector('.kind'))).toBe('Police pump');
    expect(text(el.querySelector('.location'))).toContain('Police Lines, Nellore');
    expect(text(el.querySelector('.location'))).toContain('Nellore');
    expect(link('Back to pumps')!.getAttribute('href')).toBe('/driver/pumps');
    expect(el.querySelector('.hero app-fuel-flow-scene')).not.toBeNull();
  });

  it('opens Google Maps directions to the pump in a new tab', async () => {
    const { link } = await setup();
    const directions = link('Directions in Google Maps')!;
    expect(directions.getAttribute('href')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=14.45,79.99',
    );
    expect(directions.getAttribute('target')).toBe('_blank');
    expect(directions.getAttribute('rel')).toContain('noopener');
  });

  it('shows the distance from the driver and the opening hours as tiles', async () => {
    const { text, stat } = await setup();
    expect(text(stat('Distance')!.querySelector('.stat-value'))).toBe('0.9 km');
    expect(text(stat('Opening')!.querySelector('.stat-value'))).toBe('24/7');
  });

  it('shows a dash for the distance when the location is unknown', async () => {
    const { text, stat } = await setup('3', [NELLORE], MINE(), null);
    expect(text(stat('Distance')!.querySelector('.stat-value'))).toBe('—');
  });

  it('shows which fuels a police pump has in stock', async () => {
    const { el, text, chips } = await setup('8');
    expect(text(el.querySelector('h1'))).toBe('Ongole Police Pump');
    expect(text(el.querySelector('.fuels-title'))).toBe('Fuel in stock');
    const [petrol, diesel] = chips();
    expect(text(petrol)).toBe('Petrol in stock');
    expect(petrol.classList).toContain('active');
    expect(text(diesel)).toBe('Diesel out of stock');
    expect(diesel.classList).not.toContain('active');
    expect(diesel.classList).toContain('unavailable');
  });

  it('shows only the fuels a tie-up bunk sells, with no talk of stock', async () => {
    const { el, text, chips } = await setup('9');
    expect(text(el.querySelector('.fuels-title'))).toBe('Fuels sold');
    expect(chips().map((chip) => text(chip))).toEqual(['Petrol']);
    expect(el.textContent).not.toContain('available');
    expect(el.textContent).not.toContain('stock');
  });

  it('says why a police pump cannot fill the vehicle now, and offers no Fill Up', async () => {
    const { el, text, link } = await setup('8');
    expect(text(el.querySelector('.fuel-warning'))).toBe(
      'Ongole Police Pump has no diesel in stock now.',
    );
    expect(link('Fill Up')).toBeUndefined();
    expect(link('Other pumps')!.getAttribute('href')).toBe('/driver/pumps');
  });

  it('says a tie-up bunk does not sell the vehicle’s fuel, and offers no Fill Up', async () => {
    const { el, text, link } = await setup('9');
    expect(text(el.querySelector('.fuel-warning'))).toBe('Kavali Bunk does not sell diesel.');
    expect(link('Fill Up')).toBeUndefined();
  });

  it('has no warning when the pump can fill the vehicle', async () => {
    const { el } = await setup();
    expect(el.querySelector('.fuel-warning')).toBeNull();
  });

  it('says which fuel the vehicle uses and fills up through the fuel page with the pump', async () => {
    const { el, text, link } = await setup();
    expect(text(el.querySelector('.fill-bar .label'))).toBe('Your vehicle uses');
    expect(text(el.querySelector('.fill-bar strong'))).toBe('Diesel');
    const fillUp = link('Fill Up')!;
    expect(fillUp.getAttribute('href')).toBe('/driver/fuel?pump=3');
    expect(fillUp.classList).toContain('btn-primary');
  });

  it('keeps the Fill Up bar stuck to the bottom of the screen above the bottom navigation on phones', async () => {
    const { el } = await setup();
    const bar = getComputedStyle(el.querySelector('.fill-bar')!);
    expect(bar.position).toBe('sticky');
    // Clear of the floating bottom bar: its height and the phone's home-indicator inset.
    expect(bar.bottom).toContain('var(--nav-height)');
    expect(bar.bottom).toContain('safe-area-inset-bottom');
  });

  it('offers no Fill Up when the driver is not on a vehicle', async () => {
    const { el, text, link } = await setup('3', [NELLORE], MINE([]));
    expect(link('Fill Up')).toBeUndefined();
    expect(text(el.querySelector('.fill-bar'))).toContain('You are not linked to a vehicle yet.');
  });

  it('says so when the pump is not in the directory', async () => {
    const { el, text, link } = await setup('99');
    expect(text(el.querySelector('app-empty-state'))).toContain('Pump not found');
    expect(link('Back to pumps')!.getAttribute('href')).toBe('/driver/pumps');
    expect(link('Fill Up')).toBeUndefined();
  });

  it('shows the error with a retry when the pumps cannot be read', async () => {
    const { el, text, reply, fixture } = await setup('3', 'fail');
    expect(text(el.querySelector('[role="alert"]'))).toBe('Not available.');
    Array.from(el.querySelectorAll('button'))
      .find((b) => text(b) === 'Try again')!
      .click();
    await fixture.whenStable();
    await reply([NELLORE]);
    expect(text(el.querySelector('h1'))).toBe('Nellore Police Pump');
  });
});
