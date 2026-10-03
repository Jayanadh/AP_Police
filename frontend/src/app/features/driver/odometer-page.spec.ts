import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { OdometerReading, weekOf } from '../../core/api/odometer-api';
import { MyVehicles, Vehicle } from '../../core/api/vehicles-api';
import { formatDate } from '../../core/format';
import { makeVehicle } from '../../core/test-data';
import { ToastService } from '../../ui/toast';
import { OdometerPage } from './odometer-page';

const ODOMETER_URL = '/api/odometer/';

/** "YYYY-MM-DD" a number of weeks before this week's Sunday. */
function weeksAgo(weeks: number): string {
  const [year, month, day] = weekOf().split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 7 * weeks)).toISOString().slice(0, 10);
}

const reading = (overrides: Partial<OdometerReading> = {}): OdometerReading => ({
  id: 3,
  vehicle: 5,
  registration_number: 'AP39PA1234',
  week_of: weeksAgo(1),
  reading_km: 12300,
  km_since_previous: 180,
  recorded_by_name: 'Ramesh Babu',
  created_at: '2026-09-28T09:00:00+05:30',
  ...overrides,
});

const LAST_WEEK = reading();
const FIRST = reading({ id: 2, week_of: weeksAgo(2), reading_km: 12120, km_since_previous: null });

const mine = (vehicles: Vehicle[] = [makeVehicle()]): MyVehicles => ({
  vehicles,
  mto: { unit_name: 'MTO Nellore', full_name: 'Ravi Kumar', mobile: '9876543210' },
});

describe('OdometerPage (driver)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(readings: OdometerReading[] = [LAST_WEEK, FIRST], vehicles = mine()) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(OdometerPage);
    await fixture.whenStable();
    http.expectOne('/api/me/vehicles/').flush(vehicles);
    http.expectOne(ODOMETER_URL).flush(readings);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const input = () => el.querySelector<HTMLInputElement>('#odometer-km');
    const fill = async (value: string) => {
      input()!.value = value;
      input()!.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const save = async () => {
      Array.from(el.querySelectorAll('button'))
        .find((b) => text(b) === 'Save reading')!
        .click();
      await fixture.whenStable();
    };
    const card = () => el.querySelector<HTMLElement>('#week-card')!;
    const rows = () => Array.from(el.querySelectorAll<HTMLElement>('#readings-card .reading'));
    const toasts = () => TestBed.inject(ToastService).messages();
    return { fixture, el, http, text, input, fill, save, card, rows, toasts };
  }

  it('asks for this week’s Sunday reading, with the last one as a guide', async () => {
    const { el, text, card, input } = await setup();
    expect(text(el.querySelector('h1'))).toBe('Odometer');
    expect(text(card().querySelector('h2'))).toBe(`Week of ${formatDate(weekOf())}`);
    expect(text(card().querySelector('label[for="odometer-km"]'))).toBe('Reading (km)');
    expect(input()!.getAttribute('inputmode')).toBe('numeric');
    expect(text(card())).toContain('Last reading: 12,300 km');
  });

  it('posts the reading and shows it as recorded', async () => {
    const { http, fill, save, card, text, rows, toasts, fixture } = await setup();
    await fill('12480');
    await save();
    const req = http.expectOne(ODOMETER_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reading_km: 12480 });
    req.flush(reading({ id: 4, week_of: weekOf(), reading_km: 12480, km_since_previous: 180 }));
    await fixture.whenStable();
    expect(card().querySelector('form')).toBeNull();
    expect(text(card())).toContain('Recorded');
    expect(text(card())).toContain('12,480 km');
    expect(rows()).toHaveLength(3);
    expect(text(rows()[0])).toContain('12,480 km');
    expect(toasts().map((t) => t.text)).toContain('Reading saved.');
  });

  it('asks for a whole number of kilometres before sending', async () => {
    const { el, http, fill, save, text } = await setup();
    await save();
    expect(text(el.querySelector('.field-error'))).toBe('Enter the reading in whole kilometres.');
    await fill('12480.5');
    await save();
    expect(text(el.querySelector('.field-error'))).toBe('Enter the reading in whole kilometres.');
    http.expectNone(ODOMETER_URL);
  });

  it('shows the server’s refusal', async () => {
    const { el, http, fill, save, text, fixture } = await setup();
    await fill('100');
    await save();
    http
      .expectOne(ODOMETER_URL)
      .flush(
        { detail: "The reading can't be lower than the last reading (12300 km)." },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(text(el.querySelector('[role="alert"]'))).toBe(
      "The reading can't be lower than the last reading (12300 km).",
    );
  });

  it('shows the reading as recorded when this week’s is already in', async () => {
    const { card, text } = await setup([
      reading({ id: 4, week_of: weekOf(), reading_km: 12480 }),
      LAST_WEEK,
    ]);
    expect(card().querySelector('form')).toBeNull();
    expect(text(card())).toContain('Recorded');
    expect(text(card())).toContain('12,480 km');
  });

  it('lists the previous readings with the distance since the week before', async () => {
    const { rows, text } = await setup();
    expect(rows()).toHaveLength(2);
    expect(text(rows()[0])).toContain(`Week of ${formatDate(weeksAgo(1))}`);
    expect(text(rows()[0])).toContain('12,300 km');
    expect(text(rows()[0])).toContain('+180 km');
    expect(text(rows()[1])).toContain('12,120 km');
    expect(text(rows()[1])).toContain('First reading');
  });

  it('says so when there are no readings yet, and guides with the onboarding reading', async () => {
    const { el, text, card } = await setup(
      [],
      mine([makeVehicle({ odometer_at_onboarding_km: 1200 })]),
    );
    expect(text(el.querySelector('#readings-card'))).toContain('No readings yet.');
    expect(text(card())).toContain('At onboarding: 1,200 km');
  });

  it('says so when the driver is not on a vehicle', async () => {
    const { el, text } = await setup([], mine([]));
    const empty = el.querySelector('app-empty-state')!;
    expect(text(empty.querySelector('h3'))).toBe('You are not linked to a vehicle yet.');
    expect(text(empty.querySelector('p'))).toBe('Contact your MTO.');
    expect(el.querySelector('#week-card')).toBeNull();
  });
});
