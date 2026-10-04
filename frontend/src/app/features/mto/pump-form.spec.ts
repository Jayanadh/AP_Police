import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Pump } from '../../core/api/pumps-api';
import { LatLng } from '../../core/geo';
import { MapView } from '../../ui/map-view';
import { NEVER_LOADING_LEAFLET } from '../../ui/testing/leaflet-stub';
import { PumpForm } from './pump-form';

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
  tanks: [],
  staff_count: 0,
  ...overrides,
});

describe('PumpForm', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), NEVER_LOADING_LEAFLET],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(existing: Pump | null = null) {
    const http = TestBed.inject(HttpTestingController);
    const fixture: ComponentFixture<PumpForm> = TestBed.createComponent(PumpForm);
    if (existing) {
      fixture.componentRef.setInput('pump', existing);
    }
    const saved: Pump[] = [];
    let cancelled = 0;
    fixture.componentInstance.saved.subscribe((row) => saved.push(row));
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const field = (id: string) => el.querySelector(`#${id}`) as HTMLInputElement | null;
    const fill = (id: string, value: string) => {
      const input = field(id)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const button = (name: string) =>
      Array.from(el.querySelectorAll('button')).find((b) => text(b) === name) as
        HTMLButtonElement | undefined;
    const kind = (label: string) =>
      Array.from(el.querySelectorAll<HTMLLabelElement>('label.kind-card'))
        .find((l) => text(l)?.startsWith(label))!
        .querySelector('input') as HTMLInputElement;
    const map = () =>
      fixture.debugElement.query(By.directive(MapView)).componentInstance as MapView;
    const pick = async (point: LatLng) => {
      map().mapClick.emit(point);
      await fixture.whenStable();
    };
    const submit = () => (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    /** The checkbox of a fuel, found through its label. */
    const fuel = (label: 'Petrol' | 'Diesel') => {
      const found = Array.from(el.querySelectorAll<HTMLLabelElement>('.fuel-checks label')).find(
        (l) => text(l) === label,
      )!;
      return el.querySelector(`#${found.htmlFor}`) as HTMLInputElement;
    };
    /** Fills in everything a new pump needs, ticking the given fuels. */
    const fillAll = async (fuels: ('Petrol' | 'Diesel')[] = ['Petrol', 'Diesel']) => {
      fill('pump-name', ' Kavali Bunk ');
      kind('Tie-up bunk').click();
      fill('pump-address', ' NH16, Kavali ');
      for (const name of fuels) {
        fuel(name).click();
      }
      await pick({ lat: 14.9, lng: 80.0 });
    };
    return {
      fixture,
      el,
      http,
      saved,
      cancelled: () => cancelled,
      text,
      field,
      fill,
      button,
      kind,
      fuel,
      map,
      pick,
      submit,
      fillAll,
    };
  }

  it('asks for the name, address, opening hours, fuels and location', async () => {
    const { el, text } = await setup();
    const label = (id: string) => text(el.querySelector(`label[for="${id}"]`));
    expect(text(el.querySelector('h2'))).toBe('Add pump');
    expect(label('pump-name')).toBe('Name');
    expect(label('pump-address')).toBe('Address');
    expect(label('pump-hours')).toBe('Opening hours');
    expect(label('pump-latitude')).toBe('Latitude');
    expect(label('pump-longitude')).toBe('Longitude');
    expect(text(el.querySelector('#pump-fuel-label'))).toBe('Fuels sold');
    expect(text(el.querySelector('#pump-kind-label'))).toBe('Kind');
    expect(text(el.querySelector('button[type="submit"]'))).toBe('Add pump');
  });

  it('offers the kinds as two big selectable cards, police pump first', async () => {
    const { el, text, kind } = await setup();
    const cards = Array.from(el.querySelectorAll('label.kind-card'));
    expect(cards.map((c) => text(c.querySelector('strong')))).toEqual([
      'Police pump',
      'Tie-up bunk',
    ]);
    expect(kind('Police pump').checked).toBe(true);
    kind('Tie-up bunk').click();
    expect(kind('Tie-up bunk').checked).toBe(true);
    expect(kind('Police pump').checked).toBe(false);
  });

  it("asks for no district: a pump is in the district of the MTO's office", async () => {
    const { el } = await setup();
    expect(el.querySelector('#pump-district')).toBeNull();
    TestBed.inject(HttpTestingController).expectNone(() => true);
  });

  it('starts with 24/7 opening hours and no fuel ticked, so the MTO chooses', async () => {
    const { field, fuel } = await setup();
    expect(field('pump-hours')!.value).toBe('24/7');
    expect(fuel('Petrol').type).toBe('checkbox');
    expect(fuel('Petrol').checked).toBe(false);
    expect(fuel('Diesel').type).toBe('checkbox');
    expect(fuel('Diesel').checked).toBe(false);
  });

  it('offers the fuels as two labelled checkboxes in a group named Fuels sold', async () => {
    const { el, text } = await setup();
    const group = el.querySelector('.fuel-checks') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-labelledby')).toBe('pump-fuel-label');
    expect(Array.from(group.querySelectorAll('label')).map((l) => text(l))).toEqual([
      'Petrol',
      'Diesel',
    ]);
    expect(group.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it('ticks and unticks a fuel', async () => {
    const { fuel, fixture } = await setup();
    fuel('Diesel').click();
    await fixture.whenStable();
    expect(fuel('Diesel').checked).toBe(true);
    fuel('Diesel').click();
    await fixture.whenStable();
    expect(fuel('Diesel').checked).toBe(false);
  });

  it('opens the map on Nellore, ready to be picked from', async () => {
    const { map } = await setup();
    expect(map().center()).toEqual({ lat: 14.4426, lng: 79.9865 });
    expect(map().pickable()).toBe(true);
    expect(map().markers()).toEqual([]);
  });

  it('sets the latitude and longitude from a click on the map, and shows the pin', async () => {
    const { field, map, pick } = await setup();
    await pick({ lat: 14.9, lng: 80.0123 });
    expect(field('pump-latitude')!.value).toBe('14.9');
    expect(field('pump-longitude')!.value).toBe('80.0123');
    expect(map().markers()).toMatchObject([{ lat: 14.9, lng: 80.0123, tone: 'police' }]);
  });

  it('takes the pin’s colour from the kind, and its label from the name', async () => {
    const { fill, kind, map, pick, fixture } = await setup();
    await pick({ lat: 14.9, lng: 80.0 });
    kind('Tie-up bunk').click();
    fill('pump-name', 'Kavali Bunk');
    await fixture.whenStable();
    expect(map().markers()).toMatchObject([{ label: 'Kavali Bunk', tone: 'tieup' }]);
  });

  it('moves the pin and the map when the numbers are typed', async () => {
    const { fill, map, fixture } = await setup();
    fill('pump-latitude', '15.5');
    fill('pump-longitude', '80.05');
    await fixture.whenStable();
    expect(map().markers()).toMatchObject([{ lat: 15.5, lng: 80.05 }]);
    expect(map().center()).toEqual({ lat: 15.5, lng: 80.05 });
  });

  it('keeps the map where it is when the location is picked on it', async () => {
    const { map, pick } = await setup();
    await pick({ lat: 16.5, lng: 81.0 });
    expect(map().center()).toEqual({ lat: 14.4426, lng: 79.9865 });
  });

  it('refuses to add a pump with no fuel chosen, and says why', async () => {
    const s = await setup();
    await s.fillAll([]);
    s.submit();
    await s.fixture.whenStable();
    s.http.expectNone('/api/pumps/');
    expect(s.text(s.el.querySelector('[role="alert"]'))).toBe('Choose at least one fuel.');
  });

  it('accepts one fuel', async () => {
    const s = await setup();
    await s.fillAll(['Diesel']);
    s.submit();
    const req = s.http.expectOne('/api/pumps/');
    expect(req.request.body).toMatchObject({ sells_petrol: false, sells_diesel: true });
    req.flush(pump());
  });

  it('asks for what is missing before sending anything', async () => {
    const s = await setup();
    s.submit();
    await s.fixture.whenStable();
    s.http.expectNone('/api/pumps/');
    expect(s.text(s.el.querySelector('[role="alert"]'))).toBe(
      'Fill in the name, address and location.',
    );
  });

  it('refuses a location outside Andhra Pradesh', async () => {
    const s = await setup();
    await s.fillAll();
    await s.pick({ lat: 28.6, lng: 77.2 });
    s.submit();
    await s.fixture.whenStable();
    s.http.expectNone('/api/pumps/');
    expect(s.text(s.el.querySelector('[role="alert"]'))).toBe(
      'Pick a location inside Andhra Pradesh.',
    );
  });

  it('adds a pump with the chosen kind, trimmed text and the picked location', async () => {
    const s = await setup();
    await s.fillAll();
    s.submit();
    const req = s.http.expectOne('/api/pumps/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      name: 'Kavali Bunk',
      kind: 'TIE_UP',
      address: 'NH16, Kavali',
      latitude: 14.9,
      longitude: 80,
      opening_hours: '24/7',
      sells_petrol: true,
      sells_diesel: true,
    });
    const created = pump({ id: 9, name: 'Kavali Bunk', kind: 'TIE_UP' });
    req.flush(created);
    await s.fixture.whenStable();
    expect(s.saved).toEqual([created]);
  });

  it('sends 24/7 when the opening hours are cleared', async () => {
    const s = await setup();
    await s.fillAll();
    s.fill('pump-hours', '  ');
    s.submit();
    const req = s.http.expectOne('/api/pumps/');
    expect(req.request.body.opening_hours).toBe('24/7');
    req.flush(pump());
  });

  it('shows what the server says and lets the user try again', async () => {
    const s = await setup();
    await s.fillAll();
    s.submit();
    s.http
      .expectOne('/api/pumps/')
      .flush(
        { name: ['You already have a pump with this name.'] },
        { status: 400, statusText: 'Bad Request' },
      );
    await s.fixture.whenStable();
    expect(s.text(s.el.querySelector('[role="alert"]'))).toBe(
      'name: You already have a pump with this name.',
    );
    expect((s.el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
    expect(s.saved).toEqual([]);
  });

  it('sends only one request however often it is submitted while waiting', async () => {
    const s = await setup();
    await s.fillAll();
    s.submit();
    s.submit();
    const req = s.http.expectOne('/api/pumps/');
    req.flush(pump());
  });

  it('tells the page when it is cancelled', async () => {
    const s = await setup();
    s.button('Cancel')!.click();
    expect(s.cancelled()).toBe(1);
  });

  it('fills in an existing pump, opens the map on it, and saves changes with a PATCH', async () => {
    const s = await setup(pump({ kind: 'TIE_UP', sells_diesel: false, opening_hours: '6am-10pm' }));
    expect(s.text(s.el.querySelector('h2'))).toBe('Edit Nellore Police Pump');
    expect(s.field('pump-name')!.value).toBe('Nellore Police Pump');
    expect(s.kind('Tie-up bunk').checked).toBe(true);
    expect(s.field('pump-address')!.value).toBe('Police Lines, Nellore');
    expect(s.field('pump-hours')!.value).toBe('6am-10pm');
    expect(s.field('pump-latitude')!.value).toBe('14.4426');
    expect(s.field('pump-longitude')!.value).toBe('79.9865');
    expect(s.fuel('Petrol').checked).toBe(true);
    expect(s.fuel('Diesel').checked).toBe(false);
    expect(s.map().center()).toEqual({ lat: 14.4426, lng: 79.9865 });
    expect(s.map().markers()).toMatchObject([{ lat: 14.4426, lng: 79.9865, tone: 'tieup' }]);

    s.fill('pump-name', 'Nellore Main Bunk');
    s.submit();
    const req = s.http.expectOne('/api/pumps/3/');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      name: 'Nellore Main Bunk',
      kind: 'TIE_UP',
      address: 'Police Lines, Nellore',
      latitude: 14.4426,
      longitude: 79.9865,
      opening_hours: '6am-10pm',
      sells_petrol: true,
      sells_diesel: false,
    });
    const changed = pump({ name: 'Nellore Main Bunk' });
    req.flush(changed);
    await s.fixture.whenStable();
    expect(s.saved).toEqual([changed]);
    expect(s.text(s.el.querySelector('button[type="submit"]'))).toBe('Save changes');
  });
});
