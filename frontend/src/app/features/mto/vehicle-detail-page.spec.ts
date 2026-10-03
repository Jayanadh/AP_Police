import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OdometerReading } from '../../core/api/odometer-api';
import { Person } from '../../core/api/people-api';
import { Quota } from '../../core/api/quota-api';
import { ServiceRecord, ServiceStatus } from '../../core/api/servicing-api';
import { Assignment, Vehicle } from '../../core/api/vehicles-api';
import { stubFileSaving } from '../../core/test-data';
import { CONFIRM_GUARD_MS } from '../../ui/confirm-button';
import { ToastService } from '../../ui/toast';
import { VehicleDetailPage } from './vehicle-detail-page';

const URL = {
  vehicle: '/api/vehicles/5/',
  links: '/api/vehicles/5/assignments/',
  quota: '/api/fuel/vehicles/5/quota/',
  readings: '/api/odometer/?vehicle=5',
  status: '/api/vehicles/5/service-status/',
  records: '/api/vehicles/5/services/',
  officers: '/api/officers/?status=ACTIVE',
  drivers: '/api/drivers/?status=ACTIVE&unassigned=1',
};

const SURESH = {
  assignment_id: 11,
  id: 21,
  full_name: 'Suresh Reddy',
  emp_id: 'AP3001',
  mobile: '9000000021',
};
const RAMESH = {
  assignment_id: 12,
  id: 31,
  full_name: 'Ramesh Babu',
  emp_id: 'AP4001',
  mobile: '9000000031',
};

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
  current_officer: SURESH,
  current_driver: null,
  created_at: '2026-09-01T10:00:00+05:30',
  ...overrides,
});

const person = (id: number, name: string, empId: string): Person => ({
  id,
  username: empId.toLowerCase(),
  full_name: name,
  emp_id: empId,
  designation: 2,
  district: 5,
  cadre: 3,
  mobile: '9000000000',
  status: 'ACTIVE',
  status_label: 'Active',
  current_vehicles: [],
});

const assignment = (overrides: Partial<Assignment> = {}): Assignment => ({
  id: 12,
  vehicle: 5,
  person: 31,
  person_name: 'Ramesh Babu',
  person_emp_id: 'AP4001',
  kind: 'DRIVER',
  started_at: '2026-09-05T10:00:00+05:30',
  ended_at: null,
  assigned_by_name: 'MTO Nellore',
  ended_by_name: null,
  ...overrides,
});

const quota = (overrides: Partial<Quota> = {}): Quota => ({
  month: '2026-10',
  base_litres: '120.00',
  additional_litres: '30.00',
  limit_litres: '150.00',
  used_litres: '90.00',
  remaining_litres: '60.00',
  emergency_used_litres: '0.00',
  emergency_remaining_litres: '10.00',
  additional_balance_litres: '30.00',
  ...overrides,
});

const reading = (overrides: Partial<OdometerReading> = {}): OdometerReading => ({
  id: 3,
  vehicle: 5,
  registration_number: 'AP39PA1234',
  week_of: '2026-09-27',
  reading_km: 12480,
  km_since_previous: 180,
  recorded_by_name: 'Ramesh Babu',
  created_at: '2026-09-28T09:00:00+05:30',
  ...overrides,
});

const serviceStatus = (overrides: Partial<ServiceStatus> = {}): ServiceStatus => ({
  due: false,
  last_service_date: '2026-08-01',
  last_service_km: 10000,
  km_since: 2480,
  days_since: 62,
  next_due_km: 15000,
  next_due_date: '2027-01-28',
  ...overrides,
});

const record = (overrides: Partial<ServiceRecord> = {}): ServiceRecord => ({
  id: 2,
  vehicle: 5,
  service_date: '2026-08-01',
  odometer_km: 10000,
  notes: 'Oil change',
  recorded_by_name: 'MTO Nellore',
  created_at: '2026-08-01T11:00:00+05:30',
  ...overrides,
});

type Answers = {
  vehicle?: Vehicle | 'fail';
  links?: Assignment[];
  quota?: Quota | 'fail';
  readings?: OdometerReading[];
  status?: ServiceStatus;
  records?: ServiceRecord[];
  officers?: Person[];
  drivers?: Person[];
};

const DEFAULT_LINKS = [
  assignment(),
  assignment({
    id: 11,
    person: 21,
    person_name: 'Suresh Reddy',
    person_emp_id: 'AP3001',
    kind: 'OFFICER',
    started_at: '2026-09-01T09:00:00+05:30',
  }),
];

const pastGuard = () => new Promise((resolve) => setTimeout(resolve, CONFIRM_GUARD_MS + 50));

describe('VehicleDetailPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(answers: Answers = {}) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(VehicleDetailPage);
    fixture.componentRef.setInput('id', '5');
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();

    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const reply = async (url: string, body: object | 'fail', method = 'GET') => {
      const req = http.expectOne((r) => r.urlWithParams === url && r.method === method);
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
      return req.request;
    };
    const loadAll = async (given: Answers) => {
      const shown = given.vehicle ?? vehicle();
      await reply(URL.vehicle, shown);
      await reply(URL.links, given.links ?? DEFAULT_LINKS);
      await reply(URL.quota, given.quota ?? quota());
      await reply(
        URL.readings,
        given.readings ?? [
          reading(),
          reading({ id: 2, week_of: '2026-09-20', reading_km: 12300, km_since_previous: null }),
        ],
      );
      await reply(URL.status, given.status ?? serviceStatus());
      await reply(URL.records, given.records ?? [record()]);
      // Only a vehicle that can take new links asks who is free to link.
      if (shown !== 'fail' && ['ACTIVE', 'PAUSED'].includes(shown.status)) {
        if (!shown.current_officer) {
          await reply(URL.officers, given.officers ?? []);
        }
        if (!shown.current_driver) {
          await reply(URL.drivers, given.drivers ?? []);
        }
      }
    };
    await loadAll(answers);

    const section = (id: string) => el.querySelector(`#${id}`) as HTMLElement;
    const tile = (role: 'officer' | 'driver') =>
      el.querySelector(`.person-tile[data-role="${role}"]`) as HTMLElement;
    const button = (label: string, scope: ParentNode = el) =>
      Array.from(scope.querySelectorAll('button')).find((b) => text(b) === label) as
        HTMLButtonElement | undefined;
    const stat = (label: string) =>
      Array.from(el.querySelectorAll('#fuel .stat'))
        .find((s) => text(s.querySelector('.stat-label')) === label)
        ?.querySelector('.stat-value') as HTMLElement;
    const fill = (selector: string, value: string) => {
      const input = el.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const choose = (id: string, optionLabel: string) => {
      const select = el.querySelector(`#${id}`) as HTMLSelectElement;
      const option = Array.from(select.options).find((o) => text(o) === optionLabel)!;
      select.value = option.value;
      select.dispatchEvent(new Event('change'));
    };
    /** Presses a two-step button: arm it, wait out the double-tap guard, confirm. */
    const confirm = async (target: HTMLButtonElement) => {
      target.click();
      await fixture.whenStable();
      await pastGuard();
      target.click();
      await fixture.whenStable();
    };
    const toasts = () => TestBed.inject(ToastService).messages();
    return {
      fixture,
      el,
      http,
      text,
      reply,
      loadAll,
      section,
      tile,
      button,
      stat,
      fill,
      choose,
      confirm,
      toasts,
    };
  }

  describe('header', () => {
    it('shows the registration, make and model, and the status', async () => {
      const { el, text } = await setup();
      expect(text(el.querySelector('h1'))).toBe('AP39PA1234');
      expect(text(el.querySelector('app-page-header'))).toContain('Mahindra Bolero');
      expect(text(el.querySelector('app-page-header app-status-badge'))).toBe('Active');
      expect(el.querySelector('app-page-header a[aria-label="Back"]')?.getAttribute('href')).toBe(
        '/mto/vehicles',
      );
    });

    it('offers Edit, Pause and Request termination on an active vehicle', async () => {
      const { button } = await setup();
      expect(button('Edit')).toBeTruthy();
      expect(button('Pause')).toBeTruthy();
      expect(button('Resume')).toBeUndefined();
      expect(button('Request termination')).toBeTruthy();
    });

    it('pauses the vehicle, then offers to resume it', async () => {
      const { button, fixture, http, el, text, toasts } = await setup();
      button('Pause')!.click();
      const req = http.expectOne('/api/vehicles/5/pause/');
      expect(req.request.method).toBe('POST');
      req.flush(vehicle({ status: 'PAUSED', status_label: 'Paused' }));
      await fixture.whenStable();
      expect(text(el.querySelector('app-page-header app-status-badge'))).toBe('Paused');
      expect(button('Resume')).toBeTruthy();
      expect(button('Pause')).toBeUndefined();
      expect(toasts().map((t) => t.text)).toEqual(['Vehicle paused.']);
    });

    it('resumes a paused vehicle', async () => {
      const { button, http, fixture, el, text, toasts } = await setup({
        vehicle: vehicle({ status: 'PAUSED', status_label: 'Paused' }),
      });
      button('Resume')!.click();
      const req = http.expectOne('/api/vehicles/5/resume/');
      expect(req.request.method).toBe('POST');
      req.flush(vehicle());
      await fixture.whenStable();
      expect(text(el.querySelector('app-page-header app-status-badge'))).toBe('Active');
      expect(toasts().map((t) => t.text)).toEqual(['Vehicle resumed.']);
    });

    it('shows the refusal when the vehicle cannot be paused', async () => {
      const { button, http, fixture, toasts } = await setup();
      button('Pause')!.click();
      http
        .expectOne('/api/vehicles/5/pause/')
        .flush(
          { detail: 'Only active vehicles can be paused.' },
          { status: 400, statusText: 'Bad' },
        );
      await fixture.whenStable();
      expect(toasts().map((t) => [t.text, t.tone])).toEqual([
        ['Only active vehicles can be paused.', 'danger'],
      ]);
    });
  });

  describe('termination', () => {
    it('asks why, and sends the note after two presses', async () => {
      const { button, el, http, fixture, confirm, fill, text, toasts } = await setup();
      expect(el.querySelector('#termination-note')).toBeNull();
      button('Request termination')!.click();
      await fixture.whenStable();
      expect(text(el.querySelector('label[for="termination-note"]'))).toBe(
        'Why should this vehicle be terminated?',
      );
      fill('#termination-note', 'Beyond economical repair');
      await fixture.whenStable();
      await confirm(button('Send for PTO approval')!);

      const req = http.expectOne('/api/vehicles/5/request-termination/');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ note: 'Beyond economical repair' });
      req.flush(
        vehicle({ status: 'TERMINATION_PENDING', status_label: 'Termination waiting for PTO' }),
      );
      await fixture.whenStable();

      expect(text(el.querySelector('app-page-header app-status-badge'))).toBe(
        'Termination pending',
      );
      expect(el.querySelector('#termination-note')).toBeNull();
      expect(button('Pause')).toBeUndefined();
      expect(button('Request termination')).toBeUndefined();
      expect(toasts().map((t) => t.text)).toEqual(['Termination request sent to the PTO.']);
    });

    it('does not send without a note', async () => {
      const { button, el, fixture, confirm, text } = await setup();
      button('Request termination')!.click();
      await fixture.whenStable();
      await confirm(button('Send for PTO approval')!);
      expect(text(el.querySelector('#termination [role="alert"]'))).toBe(
        'Write why this vehicle should be terminated.',
      );
    });

    it('shows the refusal of the server and keeps the panel open', async () => {
      const { button, el, http, fixture, confirm, fill, text } = await setup();
      button('Request termination')!.click();
      await fixture.whenStable();
      fill('#termination-note', 'Old');
      await fixture.whenStable();
      await confirm(button('Send for PTO approval')!);
      http
        .expectOne('/api/vehicles/5/request-termination/')
        .flush(
          { detail: 'Only active or paused vehicles can be sent for termination.' },
          { status: 400, statusText: 'Bad' },
        );
      await fixture.whenStable();
      expect(text(el.querySelector('#termination [role="alert"]'))).toBe(
        'Only active or paused vehicles can be sent for termination.',
      );
    });

    it('closes the panel on Cancel', async () => {
      const { button, el, fixture } = await setup();
      button('Request termination')!.click();
      await fixture.whenStable();
      button('Cancel')!.click();
      await fixture.whenStable();
      expect(el.querySelector('#termination-note')).toBeNull();
    });
  });

  describe('edit', () => {
    it('changes the vehicle in a form and shows the new details', async () => {
      const { button, el, http, fixture, fill, reply, text, toasts } = await setup();
      expect(el.querySelector('app-vehicle-form')).toBeNull();
      button('Edit')!.click();
      await fixture.whenStable();
      expect(el.querySelector('app-vehicle-form')).not.toBeNull();
      expect((el.querySelector('#vehicle-make') as HTMLInputElement).value).toBe('Mahindra');

      fill('#vehicle-make', 'Tata');
      await fixture.whenStable();
      (el.querySelector('app-vehicle-form button[type="submit"]') as HTMLButtonElement).click();
      const patch = http.expectOne((r) => r.url === URL.vehicle && r.method === 'PATCH');
      expect(patch.request.body['make']).toBe('Tata');
      patch.flush(vehicle({ make: 'Tata' }));
      await fixture.whenStable();

      expect(el.querySelector('app-vehicle-form')).toBeNull();
      expect(text(el.querySelector('app-page-header'))).toContain('Tata Bolero');
      expect(toasts().map((t) => t.text)).toEqual(['Vehicle updated.']);
      // The limit and the service intervals may have changed: those cards read again.
      await reply(URL.quota, quota());
      await reply(URL.status, serviceStatus());
    });
  });

  describe('people', () => {
    it('shows the officer with Emp ID and a mobile link, and a place to link a driver', async () => {
      const { tile, text } = await setup({ drivers: [person(31, 'Ramesh Babu', 'AP4001')] });
      const officer = tile('officer');
      expect(text(officer)).toContain('Officer');
      expect(text(officer.querySelector('.person-name'))).toBe('Suresh Reddy');
      expect(text(officer)).toContain('AP3001');
      const call = officer.querySelector('a[href^="tel:"]') as HTMLAnchorElement;
      expect(call.getAttribute('href')).toBe('tel:9000000021');
      expect(text(call)).toBe('9000000021');
      expect(text(officer)).toContain('End link');

      const driver = tile('driver');
      expect(text(driver)).toContain('Driver');
      expect(driver.querySelector('.person-name')).toBeNull();
      expect(text(driver.querySelector('label[for="link-driver"]'))).toBe('Link a driver');
    });

    it('offers the active unassigned drivers in the select', async () => {
      const { el, text } = await setup({
        drivers: [person(31, 'Ramesh Babu', 'AP4001'), person(32, 'Anil Kumar', 'AP4002')],
      });
      const options = Array.from(el.querySelectorAll('#link-driver option')).map((o) => text(o));
      expect(options).toEqual(['Select a driver', 'Ramesh Babu (AP4001)', 'Anil Kumar (AP4002)']);
    });

    it('says so when there is nobody to link', async () => {
      const { tile, text } = await setup({ drivers: [] });
      expect(text(tile('driver'))).toContain('No unassigned drivers');
      expect(tile('driver').querySelector('select')).toBeNull();
    });

    it('offers the active officers when the vehicle has none', async () => {
      const { el, tile, text } = await setup({
        vehicle: vehicle({ current_officer: null, current_driver: RAMESH }),
        officers: [person(21, 'Suresh Reddy', 'AP3001')],
      });
      const options = Array.from(el.querySelectorAll('#link-officer option')).map((o) => text(o));
      expect(options).toEqual(['Select an officer', 'Suresh Reddy (AP3001)']);
      expect(text(tile('driver').querySelector('.person-name'))).toBe('Ramesh Babu');
    });

    it('links the chosen driver and then shows them', async () => {
      const { button, tile, http, fixture, choose, reply, el, text, toasts } = await setup({
        drivers: [person(31, 'Ramesh Babu', 'AP4001'), person(32, 'Anil Kumar', 'AP4002')],
      });
      expect(button('Link', tile('driver'))!.disabled).toBe(true);
      choose('link-driver', 'Ramesh Babu (AP4001)');
      await fixture.whenStable();
      expect(button('Link', tile('driver'))!.disabled).toBe(false);
      button('Link', tile('driver'))!.click();

      const post = http.expectOne(URL.links);
      expect(post.request.method).toBe('POST');
      expect(post.request.body).toEqual({ person: 31 });
      post.flush(assignment());
      await fixture.whenStable();

      // The vehicle and its link history are read again.
      await reply(URL.vehicle, vehicle({ current_driver: RAMESH }));
      await reply(URL.links, DEFAULT_LINKS);
      expect(text(tile('driver').querySelector('.person-name'))).toBe('Ramesh Babu');
      expect(el.querySelector('#link-driver')).toBeNull();
      expect(toasts().map((t) => t.text)).toEqual(['Ramesh Babu linked.']);
    });

    it('shows why a link was refused and leaves the choice alone', async () => {
      const { button, tile, http, fixture, choose, text } = await setup({
        drivers: [person(31, 'Ramesh Babu', 'AP4001')],
      });
      choose('link-driver', 'Ramesh Babu (AP4001)');
      await fixture.whenStable();
      button('Link', tile('driver'))!.click();
      http
        .expectOne(URL.links)
        .flush(
          { detail: 'This driver is already linked to another vehicle.' },
          { status: 400, statusText: 'Bad' },
        );
      await fixture.whenStable();
      expect(text(tile('driver').querySelector('[role="alert"]'))).toBe(
        'This driver is already linked to another vehicle.',
      );
      expect(button('Link', tile('driver'))!.disabled).toBe(false);
    });

    it('ends a link after two presses and offers the officers again', async () => {
      const { button, tile, http, fixture, confirm, reply, text, toasts } = await setup({
        vehicle: vehicle({ current_officer: SURESH, current_driver: RAMESH }),
      });
      await confirm(button('End link', tile('officer'))!);
      const post = http.expectOne('/api/assignments/11/end/');
      expect(post.request.method).toBe('POST');
      post.flush(assignment({ id: 11, kind: 'OFFICER', ended_at: '2026-10-02T12:00:00+05:30' }));
      await fixture.whenStable();

      await reply(URL.vehicle, vehicle({ current_officer: null, current_driver: RAMESH }));
      await reply(URL.links, DEFAULT_LINKS);
      await reply(URL.officers, [person(21, 'Suresh Reddy', 'AP3001')]);
      expect(tile('officer').querySelector('.person-name')).toBeNull();
      expect(text(tile('officer').querySelector('label[for="link-officer"]'))).toBe(
        'Link an officer',
      );
      expect(toasts().map((t) => t.text)).toEqual(['Link with Suresh Reddy ended.']);
    });

    it('does not end a link on the first press', async () => {
      const { button, tile, fixture } = await setup({
        vehicle: vehicle({ current_officer: SURESH, current_driver: RAMESH }),
      });
      button('End link', tile('officer'))!.click();
      await fixture.whenStable();
      expect(button('Confirm', tile('officer'))).toBeTruthy();
    });

    it('cannot link anybody to a vehicle that is waiting to be terminated', async () => {
      const { el, tile, text } = await setup({
        vehicle: vehicle({
          status: 'TERMINATION_PENDING',
          current_officer: null,
          current_driver: null,
        }),
      });
      expect(el.querySelector('select')).toBeNull();
      expect(text(tile('officer'))).toContain('Not linked');
      expect(text(tile('driver'))).toContain('Not linked');
    });
  });

  describe('fuel this month', () => {
    it('shows the limit, used, remaining, additional balance and emergency litres left', async () => {
      const { section, stat, text } = await setup();
      expect(text(section('fuel'))).toContain('Fuel this month');
      expect(text(section('fuel'))).toContain('October 2026');
      expect(text(stat('Limit'))).toBe('150 L');
      expect(text(stat('Used'))).toBe('90 L');
      expect(text(stat('Remaining'))).toBe('60 L');
      expect(text(stat('Additional quota balance'))).toBe('30 L');
      expect(text(stat('Emergency left'))).toBe('10 L');
      expect(text(section('fuel'))).toContain('120 L monthly + 30 L additional');
    });

    it('fills the bar by the share used', async () => {
      const { section } = await setup();
      const bar = section('fuel').querySelector('.progress') as HTMLElement;
      expect(bar.getAttribute('role')).toBe('progressbar');
      expect(bar.getAttribute('aria-valuenow')).toBe('60');
      expect((bar.firstElementChild as HTMLElement).style.width).toBe('60%');
      expect(bar.classList.contains('warning')).toBe(false);
      expect(bar.classList.contains('danger')).toBe(false);
    });

    it('turns the bar to a warning at 80 percent', async () => {
      const { section } = await setup({
        quota: quota({ used_litres: '120.00', remaining_litres: '30.00' }),
      });
      const bar = section('fuel').querySelector('.progress') as HTMLElement;
      expect(bar.classList.contains('warning')).toBe(true);
      expect(bar.classList.contains('danger')).toBe(false);
    });

    it('turns the bar red at 100 percent and shows a negative remaining in the danger style', async () => {
      const { section, stat, text } = await setup({
        quota: quota({
          used_litres: '155.00',
          remaining_litres: '-5.00',
          additional_balance_litres: '-5.00',
          emergency_used_litres: '5.00',
          emergency_remaining_litres: '5.00',
        }),
      });
      const bar = section('fuel').querySelector('.progress') as HTMLElement;
      expect(bar.classList.contains('danger')).toBe(true);
      expect((bar.firstElementChild as HTMLElement).style.width).toBe('100%');
      expect(stat('Remaining').classList.contains('negative')).toBe(true);
      expect(text(stat('Remaining'))).toBe('-5 L');
      expect(stat('Additional quota balance').classList.contains('negative')).toBe(true);
      expect(stat('Used').classList.contains('negative')).toBe(false);
    });

    it('does not paint a positive remaining as negative', async () => {
      const { stat } = await setup();
      expect(stat('Remaining').classList.contains('negative')).toBe(false);
    });

    it('treats any litres used against a limit of zero as full', async () => {
      const { section } = await setup({
        quota: quota({
          base_litres: '0.00',
          additional_litres: '0.00',
          limit_litres: '0.00',
          used_litres: '5.00',
          remaining_litres: '-5.00',
        }),
      });
      const bar = section('fuel').querySelector('.progress') as HTMLElement;
      expect(bar.classList.contains('danger')).toBe(true);
    });

    it('links to adding additional quota for this vehicle', async () => {
      const { section, text } = await setup();
      const link = section('fuel').querySelector('a[href^="/mto/additional-quota"]')!;
      expect(text(link)).toBe('Add additional quota');
      expect(link.getAttribute('href')).toBe('/mto/additional-quota?vehicle=5');
    });

    it('shows its own error and tries again, leaving the other cards on screen', async () => {
      const { section, button, reply, text } = await setup({ quota: 'fail' });
      expect(text(section('fuel').querySelector('[role="alert"]'))).toBe('Not available.');
      expect(text(section('odometer'))).toContain('12,480 km');
      button('Try again', section('fuel'))!.click();
      await reply(URL.quota, quota());
      expect(section('fuel').querySelector('[role="alert"]')).toBeNull();
      expect(text(section('fuel'))).toContain('150 L');
    });
  });

  describe('odometer', () => {
    it('lists the latest readings with the distance since the one before', async () => {
      const { section, text } = await setup();
      const rows = Array.from(section('odometer').querySelectorAll('tbody tr'));
      expect(
        rows.map((row) => Array.from(row.querySelectorAll('td')).map((td) => text(td))),
      ).toEqual([
        ['27 Sep 2026', '12,480 km', '180 km'],
        ['20 Sep 2026', '12,300 km', '—'],
      ]);
      const heads = Array.from(section('odometer').querySelectorAll('thead th')).map((th) =>
        text(th),
      );
      expect(heads).toEqual(['Week of', 'Reading', 'Since previous']);
    });

    it('keeps the table inside its card so the page never scrolls sideways', async () => {
      const { section } = await setup();
      expect(section('odometer').querySelector('.table-wrap .table')).not.toBeNull();
    });

    it('shows only the latest eight readings', async () => {
      const many = Array.from({ length: 10 }, (_, i) =>
        reading({
          id: 100 - i,
          week_of: `2026-09-${String(27 - i).padStart(2, '0')}`,
          reading_km: 12000 - i,
        }),
      );
      const { section, text } = await setup({ readings: many });
      expect(section('odometer').querySelectorAll('tbody tr')).toHaveLength(8);
      expect(text(section('odometer'))).toContain('Showing the latest 8 of 10 readings.');
    });

    it('says so when the driver has not entered a reading yet', async () => {
      const { section, text } = await setup({ readings: [] });
      expect(text(section('odometer'))).toContain('No readings yet.');
      expect(section('odometer').querySelector('table')).toBeNull();
    });
  });

  describe('service', () => {
    it('shows the status, the last service and when the next is due', async () => {
      const { section, text } = await setup();
      const card = section('service');
      expect(text(card.querySelector('.service-status .badge'))).toBe('Up to date');
      expect(text(card)).toContain('Last service');
      expect(text(card)).toContain('01 Aug 2026 at 10,000 km');
      expect(text(card)).toContain('Next due');
      expect(text(card)).toContain('15,000 km or 28 Jan 2027');
    });

    it('flags a service that is due', async () => {
      const { section, text } = await setup({ status: serviceStatus({ due: true }) });
      const badge = section('service').querySelector('.service-status .badge') as HTMLElement;
      expect(text(badge)).toBe('Service due');
      expect(badge.classList.contains('badge-warning')).toBe(true);
    });

    it('says when no service interval is set', async () => {
      const { section, text } = await setup({
        status: serviceStatus({ next_due_km: null, next_due_date: null }),
      });
      expect(text(section('service').querySelector('.service-status .badge'))).toBe(
        'No interval set',
      );
      expect(text(section('service'))).not.toContain('Next due');
    });

    it('lists the service records', async () => {
      const { section, text } = await setup({
        records: [
          record(),
          record({ id: 1, service_date: '2026-02-01', odometer_km: 5000, notes: '' }),
        ],
      });
      const items = Array.from(section('service').querySelectorAll('.records li')).map((li) =>
        text(li),
      );
      expect(items).toHaveLength(2);
      expect(items[0]).toContain('01 Aug 2026');
      expect(items[0]).toContain('10,000 km');
      expect(items[0]).toContain('Oil change');
      expect(items[0]).toContain('MTO Nellore');
      expect(items[1]).toContain('01 Feb 2026');
    });

    it('says so when nothing has been serviced yet', async () => {
      const { section, text } = await setup({ records: [] });
      expect(text(section('service'))).toContain('No services recorded yet.');
    });

    it('adds a service record, then reads the records and the status again', async () => {
      const { section, http, fixture, fill, reply, text, toasts, el } = await setup();
      expect(text(section('service').querySelector('form h3'))).toBe('Add service record');
      expect(text(section('service').querySelector('label[for="service-date"]'))).toBe('Date');
      expect(text(section('service').querySelector('label[for="service-km"]'))).toBe(
        'Odometer (km)',
      );
      expect(text(section('service').querySelector('label[for="service-notes"]'))).toBe('Notes');
      fill('#service-date', '2026-10-01');
      fill('#service-km', '12500');
      fill('#service-notes', 'Brake pads');
      await fixture.whenStable();
      (section('service').querySelector('form button[type="submit"]') as HTMLButtonElement).click();

      const post = http.expectOne((r) => r.url === URL.records && r.method === 'POST');
      expect(post.request.body).toEqual({
        service_date: '2026-10-01',
        odometer_km: 12500,
        notes: 'Brake pads',
      });
      post.flush(
        record({ id: 3, service_date: '2026-10-01', odometer_km: 12500, notes: 'Brake pads' }),
      );
      await fixture.whenStable();

      await reply(URL.records, [
        record({ id: 3, service_date: '2026-10-01', odometer_km: 12500, notes: 'Brake pads' }),
        record(),
      ]);
      await reply(
        URL.status,
        serviceStatus({ last_service_date: '2026-10-01', last_service_km: 12500 }),
      );
      expect(section('service').querySelectorAll('.records li')).toHaveLength(2);
      expect(text(section('service'))).toContain('01 Oct 2026 at 12,500 km');
      expect((el.querySelector('#service-date') as HTMLInputElement).value).toBe('');
      expect((el.querySelector('#service-km') as HTMLInputElement).value).toBe('');
      expect((el.querySelector('#service-notes') as HTMLTextAreaElement).value).toBe('');
      expect(toasts().map((t) => t.text)).toEqual(['Service recorded.']);
    });

    it('does not send a record without a date and an odometer reading', async () => {
      const { section, fixture, fill, text } = await setup();
      fill('#service-notes', 'Brake pads');
      await fixture.whenStable();
      (section('service').querySelector('form button[type="submit"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(text(section('service').querySelector('form [role="alert"]'))).toBe(
        'Enter the service date and the odometer reading.',
      );
    });

    it('shows what the server refuses and keeps what was typed', async () => {
      const { section, http, fixture, fill, text, el } = await setup();
      fill('#service-date', '2026-10-01');
      fill('#service-km', '12500');
      await fixture.whenStable();
      (section('service').querySelector('form button[type="submit"]') as HTMLButtonElement).click();
      http
        .expectOne((r) => r.url === URL.records && r.method === 'POST')
        .flush(
          { detail: "The service date can't be in the future." },
          { status: 400, statusText: 'Bad' },
        );
      await fixture.whenStable();
      expect(text(section('service').querySelector('form [role="alert"]'))).toBe(
        "The service date can't be in the future.",
      );
      expect((el.querySelector('#service-km') as HTMLInputElement).value).toBe('12500');
    });
  });

  describe('link history', () => {
    const OFFICER_LINK = assignment({
      id: 11,
      person: 21,
      person_name: 'Suresh Reddy',
      person_emp_id: 'AP3001',
      kind: 'OFFICER',
      started_at: '2026-09-01T09:00:00+05:30',
    });
    const tabs = (history: Element) =>
      Array.from(history.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

    it('shows drivers and officers on their own tabs, with their dates and who ended them', async () => {
      const { section, text, fixture } = await setup({
        links: [
          assignment({ ended_at: '2026-09-20T10:00:00+05:30', ended_by_name: 'MTO Nellore' }),
          OFFICER_LINK,
        ],
      });
      const history = section('history');
      expect(tabs(history).map((tab) => text(tab))).toEqual(['Drivers 1', 'Officers 1']);
      expect(tabs(history)[0].getAttribute('aria-selected')).toBe('true');
      let rows = Array.from(history.querySelectorAll('[role="tabpanel"] li')).map((li) => text(li));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain('Ramesh Babu');
      expect(rows[0]).toContain('AP4001');
      expect(rows[0]).toContain('05 Sep 2026');
      expect(rows[0]).toContain('20 Sep 2026');
      expect(rows[0]).toContain('Ended by MTO Nellore');

      tabs(history)[1].click();
      await fixture.whenStable();

      expect(tabs(history)[1].getAttribute('aria-selected')).toBe('true');
      rows = Array.from(history.querySelectorAll('[role="tabpanel"] li')).map((li) => text(li));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain('Suresh Reddy');
      expect(rows[0]).toContain('01 Sep 2026');
      expect(rows[0]).toContain('Current');
      expect(rows[0]).not.toContain('Ended by');
    });

    it('shows the latest four and the rest on Show more', async () => {
      const drivers = Array.from({ length: 6 }, (_, index) =>
        assignment({ id: 30 + index, person_name: `Driver ${index + 1}` }),
      );
      const { section, text, fixture, button } = await setup({ links: drivers });
      const rows = () => Array.from(section('history').querySelectorAll('[role="tabpanel"] li'));
      expect(rows().map((row) => text(row.querySelector('strong')))).toEqual([
        'Driver 1',
        'Driver 2',
        'Driver 3',
        'Driver 4',
      ]);

      button('Show 2 more')!.click();
      await fixture.whenStable();
      expect(rows()).toHaveLength(6);

      button('Show fewer')!.click();
      await fixture.whenStable();
      expect(rows()).toHaveLength(4);
    });

    it('says so when nobody has been linked', async () => {
      const { section, text, fixture } = await setup({ links: [] });
      expect(text(section('history'))).toContain('No driver has been linked yet.');
      tabs(section('history'))[1].click();
      await fixture.whenStable();
      expect(text(section('history'))).toContain('No officer has been linked yet.');
    });

    it('downloads the whole history as Excel', async () => {
      const { section, http, fixture } = await setup();
      stubFileSaving();

      section('history').querySelector<HTMLButtonElement>('app-download-button button')!.click();
      await fixture.whenStable();

      http.expectOne('/api/vehicles/5/assignments/export/').flush(new Blob(['x']));
    });
  });

  describe('loading', () => {
    it('shows an error and reads everything again when the vehicle cannot be read', async () => {
      const { el, button, loadAll, text, section } = await setup({
        vehicle: 'fail',
        quota: 'fail',
      });
      expect(text(el.querySelector('[role="alert"]'))).toBe('Not available.');
      expect(el.querySelector('#fuel')).toBeNull();
      button('Try again')!.click();
      await loadAll({});
      expect(text(el.querySelector('h1'))).toBe('AP39PA1234');
      expect(text(section('fuel'))).toContain('150 L');
    });

    it('reads another vehicle when the route changes', async () => {
      const { fixture, el, http, text } = await setup();
      fixture.componentRef.setInput('id', '6');
      await fixture.whenStable();
      const both = vehicle({ id: 6, registration_number: 'AP39PB5678', current_driver: RAMESH });
      http.expectOne('/api/vehicles/6/').flush(both);
      http.expectOne('/api/vehicles/6/assignments/').flush([]);
      http.expectOne('/api/fuel/vehicles/6/quota/').flush(quota());
      http.expectOne('/api/odometer/?vehicle=6').flush([]);
      http.expectOne('/api/vehicles/6/service-status/').flush(serviceStatus());
      http.expectOne('/api/vehicles/6/services/').flush([]);
      await fixture.whenStable();
      expect(text(el.querySelector('h1'))).toBe('AP39PB5678');
    });
  });
});
