import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FuelRequest } from '../../core/api/fuel-requests-api';
import { ToastService } from '../../ui/toast';
import { EmergenciesPage } from './emergencies-page';

const PENDING_URL = '/api/fuel/requests/?emergency=pending';
const ALLOWED_URL = '/api/fuel/requests/?emergency=allowed';

const fill = (overrides: Partial<FuelRequest> = {}): FuelRequest => ({
  id: 14,
  vehicle: 5,
  registration_number: 'AP39PA1234',
  driver: 31,
  driver_name: 'Ramesh Babu',
  fuel_type: 'DIESEL',
  litres_requested: '50.00',
  is_emergency: true,
  emergency_reason: 'Stuck on the highway at night',
  status: 'FILLED',
  status_label: 'Filled',
  issued_at: '2026-10-02T09:00:00+05:30',
  expires_at: '2026-10-03T09:00:00+05:30',
  pin: null,
  failed_pin_attempts: 0,
  cancel_reason: '',
  pump: 3,
  pump_name: 'Kavali Bunk',
  pump_kind: 'TIE_UP',
  filled_at: '2026-10-02T14:05:00+05:30',
  litres_filled: '50.00',
  emergency_litres: '8.00',
  emergency_status: 'PENDING',
  emergency_status_label: 'Waiting for MTO',
  duty_particulars: '',
  duty_submitted_at: null,
  duty_due_at: '2026-10-04T14:05:00+05:30',
  duty_overdue: false,
  ...overrides,
});

const FIRST = fill();
const SECOND = fill({
  id: 15,
  registration_number: 'AP39PB5678',
  driver_name: 'Anil Kumar',
  pump_name: 'Nellore Police Pump',
  emergency_litres: '3.50',
  emergency_reason: 'Flood diversion',
});
const ALLOWED = fill({
  id: 16,
  registration_number: 'AP39PC1111',
  emergency_status: 'ALLOWED',
  emergency_status_label: 'Allowed',
});

describe('EmergenciesPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(rows: FuelRequest[] | 'fail' = [FIRST, SECOND]) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(EmergenciesPage);
    const el = fixture.nativeElement as HTMLElement;
    const answer = async (url: string, body: FuelRequest[] | 'fail') => {
      const req = http.expectOne(url);
      expect(req.request.method).toBe('GET');
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
    };
    await answer(PENDING_URL, rows);
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const cards = () => Array.from(el.querySelectorAll<HTMLElement>('.emergency'));
    const button = (label: string, scope: ParentNode = el) =>
      Array.from(scope.querySelectorAll('button')).find((b) => text(b) === label) as
        HTMLButtonElement | undefined;
    const toasts = () => TestBed.inject(ToastService).messages();
    return { fixture, el, http, text, cards, button, answer, toasts };
  }

  it('shows the Pending and Allowed chips, Pending first', async () => {
    const { el, text } = await setup();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Emergencies');
    const chips = Array.from(el.querySelectorAll('.chips .chip'));
    expect(chips.map((c) => text(c))).toEqual(['Pending', 'Allowed']);
    expect(chips[0].classList.contains('active')).toBe(true);
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('shows each pending fill with its vehicle, driver, pump, time, litres, emergency litres and reason', async () => {
    const { cards, text } = await setup();
    expect(cards()).toHaveLength(2);
    const first = cards()[0];
    expect(text(first)).toContain('AP39PA1234');
    expect(text(first)).toContain('Ramesh Babu');
    expect(text(first)).toContain('Kavali Bunk');
    expect(text(first)).toContain('02 Oct 2026, 2:05 pm');
    expect(text(first)).toContain('50 L');
    expect(text(first)).toContain('Stuck on the highway at night');
    expect(text(first.querySelector('.badge-danger'))).toBe('8 L emergency');
    expect(text(cards()[1].querySelector('.badge-danger'))).toBe('3.5 L emergency');
  });

  it('offers the Allow button on pending fills', async () => {
    const { cards, button } = await setup();
    for (const card of cards()) {
      expect(button('Allow (count against additional quota)', card)).toBeDefined();
    }
  });

  it('says so when no emergency fill is waiting', async () => {
    const { el, text } = await setup([]);
    expect(text(el.querySelector('app-empty-state'))).toContain('No emergency fills waiting.');
  });

  it('allows a pending fill, then toasts and reads the list again', async () => {
    const { fixture, http, cards, button, answer, toasts, el } = await setup();
    button('Allow (count against additional quota)', cards()[0])!.click();
    const req = http.expectOne('/api/fuel/requests/14/allow-emergency/');
    expect(req.request.method).toBe('POST');
    req.flush({ ...FIRST, emergency_status: 'ALLOWED' });
    await fixture.whenStable();
    expect(toasts()[0]).toMatchObject({
      text: 'Emergency fill of AP39PA1234 allowed.',
      tone: 'success',
    });
    await answer(PENDING_URL, [SECOND]);
    expect(cards()).toHaveLength(1);
    expect(el.textContent).not.toContain('AP39PA1234');
  });

  it('shows the reason in a toast when the fill cannot be allowed', async () => {
    const { fixture, http, cards, button, toasts } = await setup();
    button('Allow (count against additional quota)', cards()[0])!.click();
    http
      .expectOne('/api/fuel/requests/14/allow-emergency/')
      .flush(
        { detail: 'This emergency fill has already been reviewed.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(toasts()[0]).toMatchObject({
      text: 'This emergency fill has already been reviewed.',
      tone: 'danger',
    });
    http.expectNone((r) => r.method === 'GET');
    expect(button('Allow (count against additional quota)', cards()[0])!.disabled).toBe(false);
  });

  it('reads the allowed fills when Allowed is chosen, without Allow buttons', async () => {
    const { fixture, el, cards, button, answer, text } = await setup();
    button('Allowed')!.click();
    await fixture.whenStable();
    await answer(ALLOWED_URL, [ALLOWED]);
    expect(cards()).toHaveLength(1);
    expect(text(cards()[0])).toContain('AP39PC1111');
    expect(text(cards()[0].querySelector('app-status-badge'))).toBe('Allowed');
    expect(button('Allow (count against additional quota)')).toBeUndefined();
    expect(el.querySelector('.chips .chip.active')?.textContent?.trim()).toBe('Allowed');
  });

  it('says so when no emergency fill has been allowed yet', async () => {
    const { fixture, el, button, answer, text } = await setup();
    button('Allowed')!.click();
    await fixture.whenStable();
    await answer(ALLOWED_URL, []);
    expect(text(el.querySelector('app-empty-state'))).toContain('No allowed emergency fills yet.');
  });

  it('shows a load error with a retry', async () => {
    const { fixture, el, answer, button, cards, text } = await setup('fail');
    expect(text(el.querySelector('.error'))).toBe('Not available.');
    button('Try again')!.click();
    await fixture.whenStable();
    await answer(PENDING_URL, [FIRST]);
    expect(el.querySelector('.error')).toBeNull();
    expect(cards()).toHaveLength(1);
  });
});
