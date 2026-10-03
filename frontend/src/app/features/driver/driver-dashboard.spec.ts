import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DriverDashboard as DriverSummary } from '../../core/api/dashboard-api';
import { makeFuelRequest, makeMe, signInAs } from '../../core/test-data';
import { CONFIRM_GUARD_MS } from '../../ui/confirm-button';
import { ToastService } from '../../ui/toast';
import { DriverDashboard } from './driver-dashboard';

const DASHBOARD_URL = '/api/dashboard/';
const pastGuard = () => new Promise((resolve) => setTimeout(resolve, CONFIRM_GUARD_MS + 50));
const inAnHour = () => new Date(Date.now() + 60 * 60_000).toISOString();

const summary = (overrides: Partial<DriverSummary> = {}): DriverSummary => ({
  role: 'DRIVER',
  month: '2026-10',
  vehicle: {
    id: 5,
    registration_number: 'AP39PA1234',
    make: 'Mahindra',
    model: 'Bolero',
    fuel_type: 'DIESEL',
  },
  quota: {
    limit_litres: '60.00',
    used_litres: '17.50',
    remaining_litres: '42.50',
    emergency_remaining_litres: '10.00',
  },
  open_request: { id: 21, pin: '482917', litres_requested: '20.00', expires_at: inAnHour() },
  duty_due: [
    {
      id: 12,
      registration_number: 'AP39PA1234',
      filled_at: '2026-09-29T10:00:00+05:30',
      litres_filled: '25.00',
      duty_due_at: '2026-10-01T10:00:00+05:30',
      duty_overdue: true,
    },
    {
      id: 14,
      registration_number: 'AP39PA1234',
      filled_at: '2026-10-02T14:05:00+05:30',
      litres_filled: '20.00',
      duty_due_at: '2026-10-04T14:05:00+05:30',
      duty_overdue: false,
    },
  ],
  odometer: { week_of: '2026-09-27', recorded: false, reading_km: null },
  ...overrides,
});

describe('DriverDashboard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(body: DriverSummary | 'fail' = summary()) {
    await signInAs(makeMe({ role: 'DRIVER', full_name: 'Ramesh Babu', unit_name: 'MTO Nellore' }));
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(DriverDashboard);
    const el = fixture.nativeElement as HTMLElement;
    const answer = async (response: DriverSummary | 'fail') => {
      const req = http.expectOne(DASHBOARD_URL);
      expect(req.request.method).toBe('GET');
      if (response === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(response);
      }
      await fixture.whenStable();
    };
    await answer(body);
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const link = (label: string) =>
      Array.from(el.querySelectorAll<HTMLAnchorElement>('a')).find((a) => text(a) === label);
    const toasts = () => TestBed.inject(ToastService).messages();
    return { fixture, el, http, text, link, answer, toasts };
  }

  it('greets the driver by name', async () => {
    const { el, text } = await setup();
    expect(text(el.querySelector('h1'))).toBe('Hello, Ramesh Babu');
    expect(text(el.querySelector('app-page-header'))).toContain('October 2026');
  });

  it('shows the vehicle with its make, model and fuel', async () => {
    const { el, text } = await setup();
    const card = el.querySelector('#vehicle-card')!;
    expect(text(card.querySelector('.registration'))).toBe('AP39PA1234');
    expect(text(card)).toContain('Mahindra Bolero');
    expect(text(card.querySelector('.chip'))).toBe('Diesel');
  });

  it('shows the fuel left this month large, with the emergency litres', async () => {
    const { el, text } = await setup();
    const card = el.querySelector('app-fuel-left-card')!;
    expect(text(card.querySelector('.remaining'))).toBe('42.5 L');
    expect(text(card.querySelector('.used'))).toBe('Used 17.5 L of 60 L');
    expect(text(card.querySelector('.emergency'))).toBe('Emergency: 10 L left');
  });

  it('shows the open PIN', async () => {
    const { el, text } = await setup();
    const card = el.querySelector('app-pin-card')!;
    expect(text(card.querySelector('.pin'))).toBe('482917');
    expect(text(card)).toContain('20 L');
    expect(text(card)).toContain('AP39PA1234');
  });

  it('cancels the open request from its PIN card and reads the dashboard again', async () => {
    const { el, fixture, http, answer, toasts } = await setup();
    const cancel = () =>
      el.querySelector<HTMLButtonElement>('app-pin-card app-confirm-button button')!;
    cancel().click();
    await pastGuard();
    cancel().click();
    await fixture.whenStable();
    const req = http.expectOne('/api/fuel/requests/21/cancel/');
    expect(req.request.method).toBe('POST');
    req.flush(makeFuelRequest({ id: 21, status: 'CANCELLED', status_label: 'Cancelled' }));
    await fixture.whenStable();
    expect(toasts().map((t) => t.text)).toContain('Request cancelled.');
    await answer(summary({ open_request: null }));
    expect(el.querySelector('app-pin-card')).toBeNull();
  });

  it('shows the cancel error in a toast and keeps the PIN', async () => {
    const { el, fixture, http, toasts } = await setup();
    const cancel = () =>
      el.querySelector<HTMLButtonElement>('app-pin-card app-confirm-button button')!;
    cancel().click();
    await pastGuard();
    cancel().click();
    await fixture.whenStable();
    http
      .expectOne('/api/fuel/requests/21/cancel/')
      .flush(
        { detail: 'Only an open request can be cancelled.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(toasts().at(-1)).toEqual(
      expect.objectContaining({ text: 'Only an open request can be cancelled.', tone: 'danger' }),
    );
    expect(el.querySelector('app-pin-card')).not.toBeNull();
  });

  it('lists the duty particulars due, each with its badge and a link to fill them in', async () => {
    const { el, text } = await setup();
    const rows = Array.from(el.querySelectorAll<HTMLElement>('#duty-card .duty-row'));
    expect(rows).toHaveLength(2);
    expect(text(rows[0])).toContain('AP39PA1234');
    expect(text(rows[0])).toContain('25 L');
    expect(text(rows[0])).toContain('29 Sep 2026, 10:00 am');
    expect(text(rows[0].querySelector('.badge'))).toBe('Overdue');
    expect(rows[0].querySelector('.badge')!.classList).toContain('badge-danger');
    expect(text(rows[1].querySelector('.badge'))).toBe('Due');
    expect(rows[1].querySelector('.badge')!.classList).toContain('badge-warning');
    const fillIn = rows[0].querySelector<HTMLAnchorElement>('a')!;
    expect(text(fillIn)).toBe('Fill in');
    expect(fillIn.getAttribute('href')).toBe('/driver/fuel?duty=12');
    expect(rows[1].querySelector('a')!.getAttribute('href')).toBe('/driver/fuel?duty=14');
  });

  it('leaves out the duty card when nothing is due', async () => {
    const { el } = await setup(summary({ duty_due: [] }));
    expect(el.querySelector('#duty-card')).toBeNull();
  });

  it('asks for this week’s Sunday reading when it is missing', async () => {
    const { el, text } = await setup();
    const card = el.querySelector('#odometer-card')!;
    expect(text(card)).toContain('Week of 27 Sep 2026');
    const enter = card.querySelector<HTMLAnchorElement>('a')!;
    expect(text(enter)).toBe('Enter Sunday reading');
    expect(enter.getAttribute('href')).toBe('/driver/odometer');
  });

  it('shows this week’s reading once it is recorded', async () => {
    const { el, text } = await setup(
      summary({ odometer: { week_of: '2026-09-27', recorded: true, reading_km: 12480 } }),
    );
    const card = el.querySelector('#odometer-card')!;
    expect(text(card)).toContain('Recorded');
    expect(text(card)).toContain('12,480 km');
    expect(card.querySelector('a')).toBeNull();
  });

  it('has a prominent link to the pump finder', async () => {
    const { link } = await setup();
    const find = link('Find a pump')!;
    expect(find.getAttribute('href')).toBe('/driver/pumps');
    expect(find.classList).toContain('btn-primary');
  });

  it('offers to request fuel when there is no open PIN', async () => {
    const { el, link } = await setup(summary({ open_request: null }));
    expect(el.querySelector('app-pin-card')).toBeNull();
    expect(link('Request fuel')!.getAttribute('href')).toBe('/driver/fuel');
  });

  it('does not offer to request fuel while a PIN is open', async () => {
    const { link } = await setup();
    expect(link('Request fuel')).toBeUndefined();
  });

  it('says so when the driver is not on a vehicle, and still lists duty owed', async () => {
    const { el, text } = await setup(
      summary({
        vehicle: null,
        quota: null,
        open_request: null,
        odometer: { week_of: '2026-09-27', recorded: false, reading_km: null },
      }),
    );
    const empty = el.querySelector('app-empty-state')!;
    expect(text(empty.querySelector('h3'))).toBe('You are not linked to a vehicle yet.');
    expect(text(empty.querySelector('p'))).toBe('Contact your MTO.');
    expect(el.querySelector('#vehicle-card')).toBeNull();
    expect(el.querySelector('app-fuel-left-card')).toBeNull();
    expect(el.querySelector('#odometer-card')).toBeNull();
    expect(el.querySelectorAll('#duty-card .duty-row')).toHaveLength(2);
  });

  it('shows the error with a retry when the dashboard cannot be read', async () => {
    const { el, text, link, answer, fixture } = await setup('fail');
    expect(text(el.querySelector('[role="alert"]'))).toBe('Not available.');
    // The pump finder does not depend on the dashboard, so the way there stays.
    expect(link('Find a pump')).toBeDefined();
    Array.from(el.querySelectorAll('button'))
      .find((b) => text(b) === 'Try again')!
      .click();
    await fixture.whenStable();
    await answer(summary());
    expect(el.querySelector('app-fuel-left-card')).not.toBeNull();
  });
});
