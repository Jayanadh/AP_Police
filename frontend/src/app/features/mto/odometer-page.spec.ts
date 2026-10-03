import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MissingReading, OdometerReading } from '../../core/api/odometer-api';
import { Vehicle } from '../../core/api/vehicles-api';
import { OdometerPage } from './odometer-page';

const vehicle = (overrides: Partial<Vehicle> = {}): Vehicle => ({
  id: 5,
  registration_number: 'AP39PA1234',
  vehicle_type: 'JEEP',
  make: 'Mahindra',
  model: 'Bolero',
  year_of_manufacture: 2022,
  fuel_type: 'DIESEL',
  tank_capacity_litres: '60.00',
  chassis_number: 'CH123',
  engine_number: 'EN456',
  odometer_at_onboarding_km: 1200,
  monthly_fuel_limit_litres: '120.00',
  service_interval_km: 5000,
  service_interval_days: 180,
  status: 'ACTIVE',
  status_label: 'Active',
  current_officer: null,
  current_driver: null,
  created_at: '2026-09-01T10:00:00+05:30',
  ...overrides,
});

const BOLERO = vehicle();
const SWIFT = vehicle({ id: 6, registration_number: 'AP39PB5678', make: 'Maruti', model: 'Swift' });

const missing = (overrides: Partial<MissingReading> = {}): MissingReading => ({
  vehicle: 5,
  registration_number: 'AP39PA1234',
  driver_name: 'Ramesh Babu',
  week_of: '2026-09-27',
  ...overrides,
});

const MISSING_BOLERO = missing();
const MISSING_SWIFT = missing({
  vehicle: 6,
  registration_number: 'AP39PB5678',
  driver_name: 'Anil Kumar',
});

const reading = (overrides: Partial<OdometerReading> = {}): OdometerReading => ({
  id: 1,
  vehicle: 5,
  registration_number: 'AP39PA1234',
  week_of: '2026-09-27',
  reading_km: 12480,
  km_since_previous: 180,
  recorded_by_name: 'Ramesh Babu',
  created_at: '2026-09-28T09:00:00+05:30',
  ...overrides,
});

const BOLERO_READINGS = [
  reading(),
  reading({ id: 2, week_of: '2026-09-20', reading_km: 12300, km_since_previous: null }),
];
const SWIFT_READINGS = [
  reading({
    id: 3,
    vehicle: 6,
    registration_number: 'AP39PB5678',
    week_of: '2026-09-27',
    reading_km: 800,
    km_since_previous: 95,
  }),
];

describe('OdometerPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(
    rows: MissingReading[] | 'fail' = [MISSING_BOLERO, MISSING_SWIFT],
    vehicles: Vehicle[] | 'fail' = [BOLERO, SWIFT],
  ) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(OdometerPage);
    const el = fixture.nativeElement as HTMLElement;
    const answer = async (url: string, body: object[] | 'fail') => {
      const req = http.expectOne(url);
      expect(req.request.method).toBe('GET');
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
    };
    await answer('/api/vehicles/', vehicles);
    await answer('/api/odometer/missing/', rows);
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const select = () => el.querySelector<HTMLSelectElement>('#odometer-vehicle')!;
    const choose = async (value: string) => {
      select().value = value;
      select().dispatchEvent(new Event('change'));
      await fixture.whenStable();
    };
    const missingRows = () =>
      Array.from(el.querySelectorAll<HTMLElement>('#missing-card .missing-row'));
    const readingRows = () =>
      Array.from(el.querySelectorAll<HTMLElement>('#readings-card tbody tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) => text(td)),
      );
    return { fixture, el, http, text, select, choose, answer, missingRows, readingRows };
  }

  it('lists the vehicles with no reading this week: vehicle, driver and week of', async () => {
    const { el, text, missingRows } = await setup();
    expect(text(el.querySelector('h1'))).toBe('Odometer');
    expect(text(el.querySelector('#missing-card h2'))).toBe('Missing this week');
    expect(
      missingRows().map((row) => [
        text(row.querySelector('.registration')),
        text(row.querySelector('.who .muted')),
        text(row.querySelector(':scope > .muted')),
      ]),
    ).toEqual([
      ['AP39PA1234', 'Ramesh Babu', 'Week of 27 Sep 2026'],
      ['AP39PB5678', 'Anil Kumar', 'Week of 27 Sep 2026'],
    ]);
  });

  it('says so when every vehicle has its reading', async () => {
    const { el, text, missingRows } = await setup([]);
    expect(missingRows().length).toBe(0);
    expect(text(el.querySelector('#missing-card'))).toContain('No missing readings');
  });

  it('shows the error of the missing list and reads it again on Try again', async () => {
    const { el, text, answer, missingRows } = await setup('fail');
    expect(text(el.querySelector('#missing-card [role="alert"]'))).toBe('Not available.');
    const retry = Array.from(el.querySelectorAll('#missing-card button')).find(
      (b) => text(b) === 'Try again',
    ) as HTMLButtonElement;
    retry.click();
    await answer('/api/odometer/missing/', [MISSING_BOLERO]);
    expect(el.querySelector('#missing-card [role="alert"]')).toBeNull();
    expect(missingRows().length).toBe(1);
  });

  it('offers the office’s vehicles in a labelled select and asks to choose one first', async () => {
    const { el, text, select } = await setup();
    expect(text(el.querySelector('label[for="odometer-vehicle"]'))).toBe('Vehicle');
    expect(Array.from(select().options).map((o) => text(o))).toEqual([
      'Choose a vehicle',
      'AP39PA1234',
      'AP39PB5678',
    ]);
    expect(text(el.querySelector('#readings-card'))).toContain(
      'Choose a vehicle to see its readings.',
    );
  });

  it('shows the error of the vehicle list and reads it again on Try again', async () => {
    const { el, text, answer, select } = await setup([], 'fail');
    expect(text(el.querySelector('#readings-card [role="alert"]'))).toBe('Not available.');
    expect(el.querySelector('#odometer-vehicle')).toBeNull();
    const retry = Array.from(el.querySelectorAll('#readings-card button')).find(
      (b) => text(b) === 'Try again',
    ) as HTMLButtonElement;
    retry.click();
    await answer('/api/vehicles/', [BOLERO]);
    expect(el.querySelector('#readings-card [role="alert"]')).toBeNull();
    expect(select().options.length).toBe(2);
  });

  it('loads the readings of the chosen vehicle: week of, km and km since previous', async () => {
    const { choose, answer, readingRows, el, text } = await setup();
    await choose('5');
    await answer('/api/odometer/?vehicle=5', BOLERO_READINGS);
    expect(readingRows()).toEqual([
      ['27 Sep 2026', '12,480 km', '180 km'],
      ['20 Sep 2026', '12,300 km', '—'],
    ]);
    expect(
      Array.from(el.querySelectorAll('#readings-card thead th')).map((th) => text(th)),
    ).toEqual(['Week of', 'Reading', 'Since previous']);
  });

  it('switches to another vehicle’s readings', async () => {
    const { choose, answer, readingRows } = await setup();
    await choose('5');
    await answer('/api/odometer/?vehicle=5', BOLERO_READINGS);
    await choose('6');
    await answer('/api/odometer/?vehicle=6', SWIFT_READINGS);
    expect(readingRows()).toEqual([['27 Sep 2026', '800 km', '95 km']]);
  });

  it('ignores a slow answer for a vehicle that is no longer chosen', async () => {
    const { choose, http, fixture, readingRows } = await setup();
    await choose('5');
    const slow = http.expectOne('/api/odometer/?vehicle=5');
    await choose('6');
    http.expectOne('/api/odometer/?vehicle=6').flush(SWIFT_READINGS);
    await fixture.whenStable();
    slow.flush(BOLERO_READINGS);
    await fixture.whenStable();
    expect(readingRows()).toEqual([['27 Sep 2026', '800 km', '95 km']]);
  });

  it('says so when the vehicle has no readings yet', async () => {
    const { choose, answer, el, text } = await setup();
    await choose('5');
    await answer('/api/odometer/?vehicle=5', []);
    expect(text(el.querySelector('#readings-card'))).toContain('No readings yet for this vehicle.');
    expect(el.querySelector('#readings-card table')).toBeNull();
  });

  it('shows the error of the readings and reads them again on Try again', async () => {
    const { choose, answer, el, text, readingRows } = await setup();
    await choose('5');
    await answer('/api/odometer/?vehicle=5', 'fail');
    expect(text(el.querySelector('#readings-card [role="alert"]'))).toBe('Not available.');
    const retry = Array.from(el.querySelectorAll('#readings-card button')).find(
      (b) => text(b) === 'Try again',
    ) as HTMLButtonElement;
    retry.click();
    await answer('/api/odometer/?vehicle=5', BOLERO_READINGS);
    expect(readingRows().length).toBe(2);
  });

  it('goes back to the prompt when the choice is cleared, without another request', async () => {
    const { choose, answer, el, text } = await setup();
    await choose('5');
    await answer('/api/odometer/?vehicle=5', BOLERO_READINGS);
    await choose('');
    expect(el.querySelector('#readings-card table')).toBeNull();
    expect(text(el.querySelector('#readings-card'))).toContain(
      'Choose a vehicle to see its readings.',
    );
  });
});
