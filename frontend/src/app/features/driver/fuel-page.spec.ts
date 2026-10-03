import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FuelRequest } from '../../core/api/fuel-requests-api';
import { DirectoryPump } from '../../core/api/pumps-api';
import { Quota } from '../../core/api/quota-api';
import { MyVehicles, Vehicle } from '../../core/api/vehicles-api';
import { makeFuelRequest, makeVehicle } from '../../core/test-data';
import { CONFIRM_GUARD_MS } from '../../ui/confirm-button';
import { ToastService } from '../../ui/toast';
import { FuelPage } from './fuel-page';

const REQUESTS_URL = '/api/fuel/requests/';
const pastGuard = () => new Promise((resolve) => setTimeout(resolve, CONFIRM_GUARD_MS + 50));
const inAnHour = () => new Date(Date.now() + 60 * 60_000).toISOString();

const quota = (overrides: Partial<Quota> = {}): Quota => ({
  month: '2026-10',
  base_litres: '60.00',
  additional_litres: '0.00',
  limit_litres: '60.00',
  used_litres: '17.50',
  remaining_litres: '42.50',
  emergency_used_litres: '0.00',
  emergency_remaining_litres: '10.00',
  additional_balance_litres: '0.00',
  ...overrides,
});

const mine = (vehicles: Vehicle[] = [makeVehicle()]): MyVehicles => ({
  vehicles,
  mto: { unit_name: 'MTO Nellore', full_name: 'Ravi Kumar', mobile: '9876543210' },
});

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

/** The request the driver just raised, with its PIN. */
const issued = (overrides: Partial<FuelRequest> = {}) =>
  makeFuelRequest({
    id: 21,
    status: 'ISSUED',
    status_label: 'Issued',
    litres_requested: '20.00',
    issued_at: '2026-10-03T10:00:00+05:30',
    expires_at: inAnHour(),
    pin: '482917',
    pump: null,
    pump_name: null,
    pump_kind: null,
    filled_at: null,
    litres_filled: null,
    duty_due_at: null,
    ...overrides,
  });

/** Filled on 2 Oct; its duty particulars are due by 4 Oct. */
const OWED = makeFuelRequest();
const DONE = makeFuelRequest({
  id: 9,
  litres_requested: '30.00',
  litres_filled: '30.00',
  issued_at: '2026-09-20T08:00:00+05:30',
  filled_at: '2026-09-20T09:15:00+05:30',
  pump_name: 'Kavali Bunk',
  pump_kind: 'TIE_UP',
  duty_particulars: 'VIP bandobast, Kavali',
  duty_submitted_at: '2026-09-20T18:00:00+05:30',
});
const CANCELLED = makeFuelRequest({
  id: 6,
  status: 'CANCELLED',
  status_label: 'Cancelled',
  litres_requested: '15.00',
  issued_at: '2026-09-15T08:00:00+05:30',
  pump: null,
  pump_name: null,
  pump_kind: null,
  filled_at: null,
  litres_filled: null,
  duty_due_at: null,
});

type Setup = {
  vehicles?: MyVehicles;
  requests?: FuelRequest[];
  quota?: Quota;
  pump?: string;
  duty?: string;
  /** Pick the Nellore police pump in the form, as a driver would before asking (default: yes, unless `pump`). */
  pick?: boolean;
};

/** The pumps that sell the vehicle's diesel, as the directory lists them. */
const PUMPS = [
  pump(),
  pump({
    id: 4,
    name: 'Kavali Bunk',
    kind: 'TIE_UP',
    kind_label: 'Tie-up bunk',
    district_name: 'Nellore',
  }),
  pump({ id: 5, name: 'Guntur Police Pump', district_name: 'Guntur', diesel_available: false }),
];

describe('FuelPage', () => {
  // jsdom does not scroll; each test puts a stub here that notes what was scrolled to.
  const realScrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = realScrollIntoView;
    TestBed.inject(HttpTestingController).verify();
  });

  async function setup(options: Setup = {}) {
    const http = TestBed.inject(HttpTestingController);
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    const fixture = TestBed.createComponent(FuelPage);
    if (options.pump !== undefined) {
      fixture.componentRef.setInput('pump', options.pump);
    }
    if (options.duty !== undefined) {
      fixture.componentRef.setInput('duty', options.duty);
    }
    await fixture.whenStable();
    const vehicles = options.vehicles ?? mine();
    http.expectOne('/api/me/vehicles/').flush(vehicles);
    http.expectOne(REQUESTS_URL).flush(options.requests ?? [OWED, DONE, CANCELLED]);
    await fixture.whenStable();
    if (vehicles.vehicles.length) {
      http
        .expectOne(`/api/fuel/vehicles/${vehicles.vehicles[0].id}/quota/`)
        .flush(options.quota ?? quota());
      http.expectOne(`/api/pump-directory/?fuel=${vehicles.vehicles[0].fuel_type}`).flush(PUMPS);
      await fixture.whenStable();
    }
    const el = fixture.nativeElement as HTMLElement;
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const button = (label: string, root: Element = el) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => text(b) === label);
    const field = <T extends HTMLElement = HTMLInputElement>(selector: string) =>
      el.querySelector<T>(selector);
    const fill = async (selector: string, value: string) => {
      const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const tick = async (selector: string, checked: boolean) => {
      const box = el.querySelector<HTMLInputElement>(selector)!;
      box.checked = checked;
      box.dispatchEvent(new Event('change'));
      await fixture.whenStable();
    };
    const submit = async () => {
      button('Get PIN')!.click();
      await fixture.whenStable();
    };
    const choosePump = async (id: string) => {
      const select = el.querySelector<HTMLSelectElement>('#fuel-pump')!;
      select.value = id;
      select.dispatchEvent(new Event('change'));
      await fixture.whenStable();
    };
    if ((options.pick ?? options.pump === undefined) && el.querySelector('#fuel-pump')) {
      await choosePump('3');
    }
    const rows = () => Array.from(el.querySelectorAll<HTMLElement>('#requests-card li.request'));
    const toasts = () => TestBed.inject(ToastService).messages();
    return {
      fixture,
      el,
      http,
      text,
      button,
      field,
      fill,
      tick,
      submit,
      choosePump,
      rows,
      toasts,
      scrolled,
    };
  }

  describe('the request form', () => {
    it('shows what is left this month above the form', async () => {
      const { el, text } = await setup();
      const card = el.querySelector('app-fuel-left-card')!;
      expect(text(card.querySelector('.remaining'))).toBe('42.5 L');
      expect(text(card.querySelector('.emergency'))).toBe('Emergency: 10 L left');
      expect(el.querySelector('#request-form')).not.toBeNull();
      expect(el.querySelector('app-pin-card')).toBeNull();
    });

    it('fills the litres from the quick chips; a full tank is what fits and is left', async () => {
      const { el, field, fixture } = await setup({
        vehicles: mine([makeVehicle({ tank_capacity_litres: '35.00' })]),
      });
      const chip = (label: string) =>
        Array.from(el.querySelectorAll<HTMLButtonElement>('.litre-chips .chip')).find((c) =>
          c.textContent?.includes(label),
        )!;
      chip('10 L').click();
      await fixture.whenStable();
      expect(field('#fuel-litres')!.value).toBe('10');
      expect(chip('10 L').classList).toContain('active');
      chip('20 L').click();
      await fixture.whenStable();
      expect(field('#fuel-litres')!.value).toBe('20');
      // The tank holds 35 L and 42.5 L is left: a full tank is 35 L.
      chip('Full tank').click();
      await fixture.whenStable();
      expect(field('#fuel-litres')!.value).toBe('35');
    });

    it('caps a full tank at what is left this month', async () => {
      const { el, field, fixture } = await setup();
      Array.from(el.querySelectorAll<HTMLButtonElement>('.litre-chips .chip'))
        .find((c) => c.textContent?.includes('Full tank'))!
        .click();
      await fixture.whenStable();
      expect(field('#fuel-litres')!.value).toBe('42.5');
    });

    it('posts the litres as a normal request and shows the PIN card', async () => {
      const { el, http, text, fill, submit, toasts, rows, fixture } = await setup();
      expect(el.querySelector('#emergency')).toBeNull();
      await fill('#fuel-litres', '20');
      await submit();
      const req = http.expectOne(REQUESTS_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ pump: 3, litres: 20, is_emergency: false });
      req.flush(issued());
      await fixture.whenStable();
      expect(text(el.querySelector('app-pin-card .pin'))).toBe('482917');
      expect(el.querySelector('#request-form')).toBeNull();
      expect(toasts().map((t) => t.text)).toContain('Your PIN is ready. Show it at the pump.');
      expect(rows().map((row) => row.id)).toEqual([
        'request-21',
        'request-14',
        'request-9',
        'request-6',
      ]);
    });

    it('asks for the litres before sending', async () => {
      const { el, text, submit } = await setup();
      await submit();
      expect(text(el.querySelector('.form-error'))).toBe('Enter the litres you need.');
    });

    it('opens an emergency section past what is left, and will not send it without a reason', async () => {
      const { el, http, text, fill, tick, submit } = await setup();
      await fill('#fuel-litres', '45');
      const section = el.querySelector('#emergency')!;
      expect(text(section)).toContain('That is more than the 42.5 L left this month.');
      expect(text(section)).toContain('Up to 10 L extra this month');
      expect(section.querySelector('label[for="fuel-emergency"]')).not.toBeNull();
      expect(section.querySelector('label[for="fuel-reason"]')).not.toBeNull();

      await submit();
      expect(text(el.querySelector('.form-error'))).toBe(
        'Tick “This is an emergency” to ask for more than what is left.',
      );

      await tick('#fuel-emergency', true);
      await fill('#fuel-reason', '   ');
      await submit();
      expect(text(el.querySelector('.form-error'))).toBe('Give the reason for the emergency.');
      http.expectNone(REQUESTS_URL);

      await fill('#fuel-reason', 'Night patrol on NH16');
      await submit();
      const req = http.expectOne(REQUESTS_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        pump: 3,
        litres: 45,
        is_emergency: true,
        emergency_reason: 'Night patrol on NH16',
      });
      req.flush(
        issued({
          litres_requested: '45.00',
          is_emergency: true,
          emergency_reason: 'Night patrol on NH16',
        }),
      );
    });

    it('treats every litre as an emergency once nothing is left', async () => {
      const { el, text, fill, field } = await setup({
        quota: quota({
          used_litres: '62.00',
          remaining_litres: '-2.00',
          emergency_remaining_litres: '8.00',
        }),
      });
      await fill('#fuel-litres', '5');
      expect(text(el.querySelector('#emergency'))).toContain('Up to 8 L extra this month');
      expect(text(el.querySelector('#emergency'))).toContain('Nothing is left this month.');
      const fullTank = Array.from(
        el.querySelectorAll<HTMLButtonElement>('.litre-chips .chip'),
      ).find((c) => c.textContent?.includes('Full tank'))!;
      expect(fullTank.disabled).toBe(true);
      expect(field('#fuel-litres')!.value).toBe('5');
    });

    it('sends a normal request when the litres come back within what is left', async () => {
      const { el, http, fill, tick, submit } = await setup();
      await fill('#fuel-litres', '45');
      await tick('#fuel-emergency', true);
      await fill('#fuel-reason', 'Night patrol');
      await fill('#fuel-litres', '40');
      expect(el.querySelector('#emergency')).toBeNull();
      await submit();
      const req = http.expectOne(REQUESTS_URL);
      expect(req.request.body).toEqual({ pump: 3, litres: 40, is_emergency: false });
      req.flush(issued({ litres_requested: '40.00' }));
    });

    it('shows the server’s refusal and keeps the form', async () => {
      const { el, http, text, fill, submit, fixture } = await setup();
      await fill('#fuel-litres', '20');
      await submit();
      http
        .expectOne(REQUESTS_URL)
        .flush(
          { detail: 'This vehicle already has an open request. Use its PIN or cancel it first.' },
          { status: 400, statusText: 'Bad Request' },
        );
      await fixture.whenStable();
      expect(text(el.querySelector('.form-error'))).toBe(
        'This vehicle already has an open request. Use its PIN or cancel it first.',
      );
      expect(el.querySelector('#request-form')).not.toBeNull();
      expect(el.querySelector('app-pin-card')).toBeNull();
    });

    it('offers the pumps that sell the vehicle’s fuel, police pumps and tie-up bunks apart', async () => {
      const { el, text } = await setup({ pick: false });
      const groups = Array.from(el.querySelectorAll('#fuel-pump optgroup'));
      expect(groups.map((group) => group.getAttribute('label'))).toEqual([
        'Police pumps',
        'Tie-up bunks',
      ]);
      expect(Array.from(groups[0].querySelectorAll('option')).map(text)).toEqual([
        'Nellore Police Pump, Nellore',
        'Guntur Police Pump, Guntur (out of stock)',
      ]);
      expect(groups[0].querySelectorAll('option')[1].disabled).toBe(true);
      expect(Array.from(groups[1].querySelectorAll('option')).map(text)).toEqual([
        'Kavali Bunk, Nellore',
      ]);
    });

    it('asks for the pump before sending', async () => {
      const { el, text, fill, submit } = await setup({ pick: false });
      await fill('#fuel-litres', '20');
      await submit();
      expect(text(el.querySelector('.form-error'))).toBe('Pick the pump you will fill at.');
    });

    it('starts on the pump the driver came from', async () => {
      const { field, fill, submit, http } = await setup({ pump: '4' });
      expect(field<HTMLSelectElement>('#fuel-pump')!.value).toBe('4');
      await fill('#fuel-litres', '20');
      await submit();
      const req = http.expectOne(REQUESTS_URL);
      expect(req.request.body.pump).toBe(4);
      req.flush(issued());
    });

    it('leaves the pump to pick when the one in the link is not offered', async () => {
      const { field } = await setup({ pump: '99' });
      expect(field<HTMLSelectElement>('#fuel-pump')!.value).toBe('');
    });
  });

  describe('an open request', () => {
    it('shows its PIN card instead of the form', async () => {
      const { el, text } = await setup({ requests: [issued(), OWED] });
      expect(text(el.querySelector('app-pin-card .pin'))).toBe('482917');
      expect(el.querySelector('#request-form')).toBeNull();
    });

    it('cancels it and brings the form back', async () => {
      const { el, http, fixture, toasts } = await setup({ requests: [issued(), OWED] });
      const cancel = () =>
        el.querySelector<HTMLButtonElement>('app-pin-card app-confirm-button button')!;
      cancel().click();
      await pastGuard();
      cancel().click();
      await fixture.whenStable();
      const req = http.expectOne('/api/fuel/requests/21/cancel/');
      expect(req.request.method).toBe('POST');
      req.flush(issued({ status: 'CANCELLED', status_label: 'Cancelled', pin: null }));
      await fixture.whenStable();
      expect(toasts().map((t) => t.text)).toContain('Request cancelled.');
      expect(el.querySelector('app-pin-card')).toBeNull();
      expect(el.querySelector('#request-form')).not.toBeNull();
    });

    it('reads the requests again when its PIN runs out', async () => {
      const { el, http, fixture } = await setup({
        requests: [issued({ expires_at: new Date(Date.now() - 1000).toISOString() })],
      });
      http
        .expectOne(REQUESTS_URL)
        .flush([issued({ status: 'EXPIRED', status_label: 'Expired', pin: null })]);
      await fixture.whenStable();
      expect(el.querySelector('app-pin-card')).toBeNull();
      expect(el.querySelector('#request-form')).not.toBeNull();
    });
  });

  describe('my requests', () => {
    it('lists each request with its status, litres, pump and time', async () => {
      const { rows, text } = await setup();
      const [owed, done, cancelled] = rows();
      expect(text(owed.querySelector('app-status-badge'))).toBe('Filled');
      expect(text(owed)).toContain('20 L');
      expect(text(owed)).toContain('Nellore Police Pump');
      expect(text(owed)).toContain('Filled 02 Oct 2026, 2:05 pm');
      expect(text(done)).toContain('30 L');
      expect(text(done)).toContain('Kavali Bunk');
      expect(text(done.querySelector('.duty-text'))).toBe('VIP bandobast, Kavali');
      expect(text(cancelled.querySelector('app-status-badge'))).toBe('Cancelled');
      expect(text(cancelled)).toContain('15 L');
      expect(text(cancelled)).toContain('Requested 15 Sep 2026, 8:00 am');
    });

    it('marks an emergency request', async () => {
      const { rows, text } = await setup({
        requests: [makeFuelRequest({ is_emergency: true, emergency_status: 'PENDING' })],
      });
      expect(text(rows()[0])).toContain('Emergency');
    });

    it('asks for the duty particulars of a fill that has none, with a Due or Overdue badge', async () => {
      const late = makeFuelRequest({ id: 12, duty_overdue: true });
      const { rows, text } = await setup({ requests: [OWED, late, DONE] });
      const [owed, overdue, done] = rows();
      expect(owed.querySelector('label[for="duty-14"]')).not.toBeNull();
      expect(text(owed.querySelector('.duty-badge'))).toBe('Due');
      expect(owed.querySelector('.duty-badge')!.classList).toContain('badge-warning');
      expect(text(owed)).toContain('Due by 04 Oct 2026, 2:05 pm');
      expect(text(overdue.querySelector('.duty-badge'))).toBe('Overdue');
      expect(overdue.querySelector('.duty-badge')!.classList).toContain('badge-danger');
      expect(done.querySelector('textarea')).toBeNull();
    });

    it('submits the duty particulars and shows them in place', async () => {
      const { http, fill, rows, text, button, fixture, toasts } = await setup();
      await fill('#duty-14', 'Bandobast at RTC bus stand');
      button('Submit', rows()[0])!.click();
      await fixture.whenStable();
      const req = http.expectOne('/api/fuel/requests/14/duty/');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ duty_particulars: 'Bandobast at RTC bus stand' });
      req.flush(
        makeFuelRequest({
          duty_particulars: 'Bandobast at RTC bus stand',
          duty_submitted_at: '2026-10-03T11:00:00+05:30',
        }),
      );
      await fixture.whenStable();
      expect(rows()[0].querySelector('textarea')).toBeNull();
      expect(text(rows()[0].querySelector('.duty-text'))).toBe('Bandobast at RTC bus stand');
      expect(toasts().map((t) => t.text)).toContain('Duty particulars saved.');
    });

    it('will not send empty duty particulars, and shows the server’s refusal', async () => {
      const { http, fill, rows, text, button, fixture } = await setup();
      await fill('#duty-14', '   ');
      button('Submit', rows()[0])!.click();
      await fixture.whenStable();
      http.expectNone('/api/fuel/requests/14/duty/');
      expect(text(rows()[0].querySelector('.field-error'))).toBe('Enter the duty particulars.');

      await fill('#duty-14', 'Bandobast');
      button('Submit', rows()[0])!.click();
      await fixture.whenStable();
      http
        .expectOne('/api/fuel/requests/14/duty/')
        .flush(
          { detail: 'Duty particulars were already submitted.' },
          { status: 400, statusText: 'Bad Request' },
        );
      await fixture.whenStable();
      expect(text(rows()[0].querySelector('.field-error'))).toBe(
        'Duty particulars were already submitted.',
      );
    });

    it('scrolls to and highlights the request of ?duty=<id>', async () => {
      const { rows, scrolled } = await setup({ duty: '14' });
      expect(rows()[0].classList).toContain('highlight');
      expect(rows()[1].classList).not.toContain('highlight');
      expect(scrolled).toContain('request-14');
    });

    it('says so when there are no requests yet', async () => {
      const { el, text } = await setup({ requests: [] });
      expect(text(el.querySelector('#requests-card'))).toContain('No requests yet.');
    });
  });

  it('says so when the driver is not on a vehicle, and still lists the requests', async () => {
    const { el, text, rows } = await setup({ vehicles: mine([]) });
    const empty = el.querySelector('app-empty-state')!;
    expect(text(empty.querySelector('h3'))).toBe('You are not linked to a vehicle yet.');
    expect(text(empty.querySelector('p'))).toBe('Contact your MTO.');
    expect(el.querySelector('#request-form')).toBeNull();
    expect(el.querySelector('app-fuel-left-card')).toBeNull();
    expect(rows()).toHaveLength(3);
  });
});
