import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { Person } from '../../core/api/people-api';
import { Pump, PumpTank } from '../../core/api/pumps-api';
import { StockEntry, Tank } from '../../core/api/tanks-api';
import { addMonths, currentMonth, monthLabel } from '../../core/format';
import { CONFIRM_GUARD_MS } from '../../ui/confirm-button';
import { MapView } from '../../ui/map-view';
import { NEVER_LOADING_LEAFLET } from '../../ui/testing/leaflet-stub';
import { ToastService } from '../../ui/toast';
import { PumpDetailPage } from './pump-detail-page';

const MONTH = currentMonth();
const LAST_MONTH = addMonths(MONTH, -1);

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

const PETROL = tank();
const DIESEL = tank({ id: 32, fuel_type: 'DIESEL', current_stock_litres: '60.00', is_low: true });

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
  tanks: [PETROL, DIESEL],
  staff_count: 3,
  ...overrides,
});

const BUNK = pump({
  id: 4,
  name: 'Kavali Bunk',
  kind: 'TIE_UP',
  kind_label: 'Tie-up bunk',
  sells_diesel: false,
  tanks: [],
});

const person = (overrides: Partial<Person> = {}): Person => ({
  id: 41,
  username: 'pump.nlr.1',
  full_name: 'Lakshmi Devi',
  emp_id: null,
  designation: null,
  district: null,
  cadre: null,
  mobile: '9000000041',
  status: 'ACTIVE',
  status_label: 'Active',
  pump: 3,
  pump_name: 'Nellore Police Pump',
  current_vehicles: [],
  ...overrides,
});

const LAKSHMI = person();
const RAVI = person({
  id: 42,
  username: 'pump.nlr.2',
  full_name: 'Ravi Teja',
  status: 'PAUSED',
  status_label: 'Paused',
});
const OLD = person({
  id: 43,
  username: 'pump.nlr.old',
  full_name: 'Old Hand',
  status: 'TERMINATED',
  status_label: 'Terminated',
});
const ELSEWHERE = person({ id: 44, username: 'pump.kvl.1', full_name: 'Kavali Staff', pump: 4 });

const entry = (overrides: Partial<StockEntry> = {}): StockEntry => ({
  id: 1,
  kind: 'OPENING',
  kind_label: 'Opening stock',
  litres: '500.00',
  stock_before: '480.00',
  stock_after: '500.00',
  note: '',
  recorded_by_name: 'Lakshmi Devi',
  recorded_at: '2026-10-02T06:30:00+05:30',
  ...overrides,
});

const pastGuard = () => new Promise((resolve) => setTimeout(resolve, CONFIRM_GUARD_MS + 50));

describe('PumpDetailPage', () => {
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

  type Options = {
    pump?: Pump | 'fail';
    staff?: Person[] | 'fail';
    /** The entries each tank answers with this month. */
    entries?: StockEntry[];
  };

  async function setup({
    pump: pumpReply = pump(),
    staff = [LAKSHMI, RAVI, OLD, ELSEWHERE],
    entries = [entry()],
  }: Options = {}) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PumpDetailPage);
    const id = pumpReply === 'fail' ? 3 : pumpReply.id;
    fixture.componentRef.setInput('id', String(id));
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();

    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const fail = { detail: 'Not available.' };
    const bad = { status: 500, statusText: 'Server' };
    const replyPump = async (body: Pump | 'fail') => {
      const req = http.expectOne(`/api/pumps/${id}/`);
      if (body === 'fail') {
        req.flush(fail, bad);
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
    };
    const replyStaff = async (body: Person[] | 'fail') => {
      const req = http.expectOne('/api/pump-staff/');
      if (body === 'fail') {
        req.flush(fail, bad);
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
    };
    const replyEntries = async (tankId: number, body: StockEntry[] | 'fail', month = MONTH) => {
      const req = http.expectOne(`/api/tanks/${tankId}/entries/?month=${month}`);
      if (body === 'fail') {
        req.flush(fail, bad);
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
    };
    await replyPump(pumpReply);
    await replyStaff(staff);
    if (pumpReply !== 'fail') {
      for (const t of pumpReply.tanks) {
        await replyEntries(t.id, entries);
      }
    }

    const button = (label: string, within: ParentNode = el) =>
      Array.from(within.querySelectorAll('button')).find((b) => text(b) === label) as
        HTMLButtonElement | undefined;
    const fill = (selector: string, value: string) => {
      const input = el.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const rows = () => Array.from(el.querySelectorAll<HTMLElement>('.staff-row'));
    const tanks = () => Array.from(el.querySelectorAll<HTMLElement>('app-pump-tank-card'));
    const map = () =>
      fixture.debugElement.query(By.directive(MapView))?.componentInstance as MapView | undefined;
    const toasts = () => TestBed.inject(ToastService).messages();
    /** The value shown on a tank card's stat tile, such as "150 L" for "Alert below". */
    const stat = (card: HTMLElement, label: string) =>
      text(
        Array.from(card.querySelectorAll('.stat'))
          .find((tile) => text(tile.querySelector('.stat-label')) === label)
          ?.querySelector('.stat-value'),
      );
    return {
      stat,
      fixture,
      el,
      http,
      text,
      button,
      fill,
      rows,
      tanks,
      map,
      toasts,
      replyPump,
      replyStaff,
      replyEntries,
    };
  }

  describe('the pump', () => {
    it('shows its name, kind and state in the header', async () => {
      const { el, text } = await setup();
      expect(text(el.querySelector('h1'))).toBe('Nellore Police Pump');
      expect(text(el.querySelector('.page-header .kind'))).toBe('Police pump');
      expect(text(el.querySelector('.page-header app-status-badge'))).toBe('Active');
      expect(el.querySelector('a[aria-label="Back"]')?.getAttribute('href')).toBe('/mto/pumps');
    });

    it('shows the address, opening hours and the fuels it sells', async () => {
      const { el, text } = await setup();
      const details = el.querySelector('#details')!;
      expect(text(details)).toContain('Police Lines, Nellore');
      expect(text(details)).toContain('Nellore');
      expect(text(details)).toContain('24/7');
      expect(Array.from(details.querySelectorAll('.fuel')).map((c) => text(c))).toEqual([
        'Petrol',
        'Diesel',
      ]);
    });

    it('shows where it is on a map', async () => {
      const { map } = await setup();
      expect(map()!.markers()).toEqual([
        { id: 3, lat: 14.4426, lng: 79.9865, label: 'Nellore Police Pump', tone: 'police' },
      ]);
      expect(map()!.center()).toEqual({ lat: 14.4426, lng: 79.9865 });
      expect(map()!.pickable()).toBe(false);
    });

    it('shows a tie-up bunk in amber, with no tanks', async () => {
      const { el, map, text, tanks } = await setup({ pump: BUNK });
      expect(text(el.querySelector('.page-header .kind'))).toBe('Tie-up bunk');
      expect(map()!.markers()[0].tone).toBe('tieup');
      expect(el.querySelector('#tanks')).toBeNull();
      expect(tanks()).toHaveLength(0);
    });

    it('deactivates an active pump', async () => {
      const s = await setup();
      expect(s.button('Activate')).toBeUndefined();
      s.button('Deactivate')!.click();
      const req = s.http.expectOne('/api/pumps/3/deactivate/');
      expect(req.request.method).toBe('POST');
      req.flush(pump({ is_active: false }));
      await s.fixture.whenStable();
      expect(s.toasts()[0]).toMatchObject({ text: 'Pump deactivated.', tone: 'success' });
      expect(s.text(s.el.querySelector('.page-header app-status-badge'))).toBe('Inactive');
      expect(s.button('Deactivate')).toBeUndefined();
      expect(s.button('Activate')).toBeTruthy();
    });

    it('activates an inactive pump', async () => {
      const s = await setup({ pump: pump({ is_active: false }) });
      s.button('Activate')!.click();
      const req = s.http.expectOne('/api/pumps/3/activate/');
      expect(req.request.method).toBe('POST');
      req.flush(pump());
      await s.fixture.whenStable();
      expect(s.toasts()[0]).toMatchObject({ text: 'Pump activated.', tone: 'success' });
      expect(s.text(s.el.querySelector('.page-header app-status-badge'))).toBe('Active');
    });

    it('shows the reason in a toast when the server refuses', async () => {
      const s = await setup();
      s.button('Deactivate')!.click();
      s.http
        .expectOne('/api/pumps/3/deactivate/')
        .flush({ detail: 'Not allowed.' }, { status: 400, statusText: 'Bad Request' });
      await s.fixture.whenStable();
      expect(s.toasts()[0]).toMatchObject({ text: 'Not allowed.', tone: 'danger' });
      expect(s.text(s.el.querySelector('.page-header app-status-badge'))).toBe('Active');
    });

    it('opens the edit form with the pump in it, and shows the saved changes', async () => {
      const s = await setup();
      expect(s.el.querySelector('app-pump-form')).toBeNull();
      s.button('Edit')!.click();
      await s.fixture.whenStable();
      await s.fixture.whenStable();
      const form = s.fixture.debugElement.query(By.css('app-pump-form'));
      expect(form.componentInstance.pump()).toMatchObject({ id: 3 });

      form.componentInstance.saved.emit(
        pump({ name: 'Nellore Main Pump', opening_hours: '6am-10pm' }),
      );
      await s.fixture.whenStable();
      expect(s.el.querySelector('app-pump-form')).toBeNull();
      expect(s.toasts()[0]).toMatchObject({ text: 'Pump updated.', tone: 'success' });
      expect(s.text(s.el.querySelector('h1'))).toBe('Nellore Main Pump');
      expect(s.text(s.el.querySelector('#details'))).toContain('6am-10pm');
    });

    it('closes the edit form when it is cancelled', async () => {
      const s = await setup();
      s.button('Edit')!.click();
      await s.fixture.whenStable();
      await s.fixture.whenStable();
      s.button('Cancel')!.click();
      await s.fixture.whenStable();
      expect(s.el.querySelector('app-pump-form')).toBeNull();
    });

    it('shows an error with a way to try again when the pump cannot be read', async () => {
      const s = await setup({ pump: 'fail', staff: [] });
      expect(s.text(s.el.querySelector('[role="alert"]'))).toBe('Not available.');
      expect(s.el.querySelector('#staff')).toBeNull();
      s.button('Try again')!.click();
      await s.fixture.whenStable();
      await s.replyPump(pump());
      await s.replyStaff([]);
      await s.replyEntries(31, []);
      await s.replyEntries(32, []);
      expect(s.text(s.el.querySelector('h1'))).toBe('Nellore Police Pump');
    });

    it('reads the other pump when the route changes', async () => {
      const s = await setup();
      s.fixture.componentRef.setInput('id', '4');
      await s.fixture.whenStable();
      expect(s.el.querySelector('#tanks')).toBeNull();
      s.http.expectOne('/api/pumps/4/').flush(BUNK);
      s.http.expectOne('/api/pump-staff/').flush([ELSEWHERE]);
      await s.fixture.whenStable();
      expect(s.text(s.el.querySelector('h1'))).toBe('Kavali Bunk');
      expect(s.rows().map((r) => s.text(r.querySelector('.staff-name')))).toEqual(['Kavali Staff']);
    });
  });

  describe('tanks', () => {
    it('shows a card for each tank, with its stock, level and Low badge', async () => {
      const { tanks, text } = await setup();
      expect(tanks()).toHaveLength(2);
      expect(text(tanks()[0].querySelector('h3'))).toBe('Petrol');
      expect(text(tanks()[0])).toContain('450 L');
      expect(tanks()[0].querySelector('.badge-danger')).toBeNull();
      expect(text(tanks()[1].querySelector('h3'))).toBe('Diesel');
      expect(text(tanks()[1].querySelector('.badge-danger'))).toBe('Low');
      expect(tanks()[1].querySelector('.progress')!.classList.contains('danger')).toBe(true);
    });

    it('reads the stock entries of this month for each tank and lists them', async () => {
      const { tanks, text } = await setup({ entries: [entry({ litres: '500.00' })] });
      for (const card of tanks()) {
        expect(text(card.querySelector('tbody tr'))).toContain('Opening stock');
        expect(text(card.querySelector('tbody tr'))).toContain('Lakshmi Devi');
      }
    });

    it('goes back a month, and forward again but never past this month', async () => {
      const s = await setup();
      const label = () => s.text(s.el.querySelector('.month-label'));
      const previous = () =>
        s.el.querySelector('button[aria-label="Previous month"]') as HTMLButtonElement;
      const next = () => s.el.querySelector('button[aria-label="Next month"]') as HTMLButtonElement;
      expect(next().disabled).toBe(true);
      expect(label()).toBe(monthLabel(MONTH));

      previous().click();
      await s.fixture.whenStable();
      await s.replyEntries(31, [entry({ id: 7, litres: '70.00' })], LAST_MONTH);
      await s.replyEntries(32, [], LAST_MONTH);
      expect(label()).toBe(monthLabel(LAST_MONTH));
      expect(next().disabled).toBe(false);
      expect(s.text(s.tanks()[0].querySelector('tbody td:nth-child(2)'))).toBe('70 L');
      expect(s.text(s.tanks()[1].querySelector('.no-entries'))).toBe(
        'No stock entries this month.',
      );

      next().click();
      await s.fixture.whenStable();
      await s.replyEntries(31, [entry()]);
      await s.replyEntries(32, [entry()]);
      expect(label()).toBe(monthLabel(MONTH));
      expect(next().disabled).toBe(true);
    });

    it('saves a new alert level through the tank, and shows it on the card', async () => {
      const s = await setup();
      s.fill('#tank-31-threshold', '150');
      (s.tanks()[0].querySelector('button[type="submit"]') as HTMLButtonElement).click();
      const req = s.http.expectOne('/api/tanks/31/');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ low_stock_threshold_litres: 150, capacity_litres: 1000 });
      const saved: Tank = {
        ...PETROL,
        pump: 3,
        pump_name: 'Nellore Police Pump',
        low_stock_threshold_litres: '150.00',
      };
      req.flush(saved);
      await s.fixture.whenStable();
      expect(s.toasts()[0]).toMatchObject({ text: 'Petrol levels saved.', tone: 'success' });
      expect(s.stat(s.tanks()[0], 'Alert below')).toBe('150 L');
      expect(s.stat(s.tanks()[1], 'Alert below')).toBe('100 L');
    });
  });

  describe('staff', () => {
    it('lists the staff of this pump only, with their login ID and status', async () => {
      const { rows, text } = await setup();
      expect(rows()).toHaveLength(3);
      expect(rows().map((r) => text(r.querySelector('.staff-name')))).toEqual([
        'Lakshmi Devi',
        'Ravi Teja',
        'Old Hand',
      ]);
      expect(text(rows()[0].querySelector('.staff-login'))).toBe('Login ID pump.nlr.1');
      expect(rows().map((r) => text(r.querySelector('app-status-badge')))).toEqual([
        'Active',
        'Paused',
        'Terminated',
      ]);
    });

    it('says so when the pump has no staff yet', async () => {
      const { el, text } = await setup({ staff: [ELSEWHERE] });
      expect(text(el.querySelector('#staff .no-staff'))).toBe('No staff logins yet.');
    });

    it('offers only what the server allows for each status', async () => {
      const { rows, text } = await setup();
      const actions = (row: HTMLElement) =>
        Array.from(row.querySelectorAll('.staff-actions button')).map((b) => text(b));
      expect(actions(rows()[0])).toEqual(['Pause', 'Terminate', 'Reset password']);
      expect(actions(rows()[1])).toEqual(['Resume', 'Terminate', 'Reset password']);
      expect(actions(rows()[2])).toEqual([]);
    });

    it('pauses a login, then lists the staff again', async () => {
      const s = await setup();
      s.button('Pause', s.rows()[0])!.click();
      const req = s.http.expectOne('/api/pump-staff/41/pause/');
      expect(req.request.method).toBe('POST');
      req.flush(person({ status: 'PAUSED', status_label: 'Paused' }));
      await s.fixture.whenStable();
      expect(s.toasts()[0]).toMatchObject({ text: 'Lakshmi Devi paused.', tone: 'success' });
      await s.replyStaff([person({ status: 'PAUSED', status_label: 'Paused' }), RAVI, OLD]);
      expect(s.text(s.rows()[0].querySelector('app-status-badge'))).toBe('Paused');
    });

    it('resumes a paused login', async () => {
      const s = await setup();
      s.button('Resume', s.rows()[1])!.click();
      s.http.expectOne('/api/pump-staff/42/resume/').flush(person({ id: 42 }));
      await s.fixture.whenStable();
      expect(s.toasts()[0]).toMatchObject({ text: 'Ravi Teja resumed.' });
      await s.replyStaff([LAKSHMI, person({ id: 42, full_name: 'Ravi Teja' }), OLD]);
    });

    it('terminates a login only after two clicks', async () => {
      const s = await setup();
      const terminate = () =>
        Array.from(s.rows()[0].querySelectorAll('app-confirm-button button')).find(
          (b) => s.text(b) === 'Terminate' || s.text(b) === 'Confirm',
        ) as HTMLButtonElement;
      terminate().click();
      await s.fixture.whenStable();
      s.http.expectNone('/api/pump-staff/41/terminate/');
      expect(s.text(terminate())).toBe('Confirm');
      await pastGuard();
      terminate().click();
      const req = s.http.expectOne('/api/pump-staff/41/terminate/');
      expect(req.request.method).toBe('POST');
      req.flush(person({ status: 'TERMINATED', status_label: 'Terminated' }));
      await s.fixture.whenStable();
      expect(s.toasts()[0]).toMatchObject({ text: 'Lakshmi Devi terminated.', tone: 'success' });
      await s.replyStaff([person({ status: 'TERMINATED', status_label: 'Terminated' }), RAVI, OLD]);
    });

    it('shows the reason in a toast when the server refuses an action', async () => {
      const s = await setup();
      s.button('Pause', s.rows()[0])!.click();
      s.http
        .expectOne('/api/pump-staff/41/pause/')
        .flush(
          { detail: 'Only active people can be paused.' },
          { status: 400, statusText: 'Bad Request' },
        );
      await s.fixture.whenStable();
      expect(s.toasts()[0]).toMatchObject({
        text: 'Only active people can be paused.',
        tone: 'danger',
      });
    });

    it('resets a password: asks for it, sends it, and says it must be changed at the next login', async () => {
      const s = await setup();
      s.button('Reset password', s.rows()[0])!.click();
      await s.fixture.whenStable();
      s.fill('#staff-reset-41', 'New-pass-2026');
      s.button('Set password')!.click();
      const req = s.http.expectOne('/api/pump-staff/41/reset-password/');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ password: 'New-pass-2026' });
      req.flush(null, { status: 204, statusText: 'No Content' });
      await s.fixture.whenStable();
      expect(s.toasts()[0]).toMatchObject({
        text: 'Password reset for Lakshmi Devi. They must change it at next login.',
      });
      expect(s.el.querySelector('#staff-reset-41')).toBeNull();
    });

    it('asks for a password before sending a reset, and can be cancelled', async () => {
      const s = await setup();
      s.button('Reset password', s.rows()[0])!.click();
      await s.fixture.whenStable();
      s.button('Set password')!.click();
      await s.fixture.whenStable();
      s.http.expectNone('/api/pump-staff/41/reset-password/');
      expect(s.text(s.rows()[0].querySelector('[role="alert"]'))).toBe('Type a new password.');
      s.button('Cancel', s.rows()[0])!.click();
      await s.fixture.whenStable();
      expect(s.el.querySelector('#staff-reset-41')).toBeNull();
    });

    it('keeps the rest of the page when the staff cannot be read, and offers to try again', async () => {
      const s = await setup({ staff: 'fail' });
      expect(s.text(s.el.querySelector('#staff [role="alert"]'))).toBe('Not available.');
      expect(s.text(s.el.querySelector('h1'))).toBe('Nellore Police Pump');
      expect(s.tanks()).toHaveLength(2);
      s.button('Try again')!.click();
      await s.fixture.whenStable();
      await s.replyStaff([LAKSHMI]);
      expect(s.rows()).toHaveLength(1);
    });

    describe('adding a login', () => {
      it('asks for the login ID, name, mobile, an optional Emp ID and the first password', async () => {
        const { el, text } = await setup();
        const label = (id: string) => text(el.querySelector(`label[for="${id}"]`));
        expect(label('staff-username')).toBe('Login ID');
        expect(label('staff-name')).toBe('Name');
        expect(label('staff-mobile')).toBe('Mobile');
        expect(label('staff-emp')).toBe('Emp ID (optional)');
        expect(label('staff-password')).toBe('First password');
        expect(text(el.querySelector('#staff .add-staff button[type="submit"]'))).toBe(
          'Add staff login',
        );
      });

      it('adds the login to this pump, then lists the staff again', async () => {
        const s = await setup();
        s.fill('#staff-username', ' pump.nlr.3 ');
        s.fill('#staff-name', ' Anil Kumar ');
        s.fill('#staff-mobile', '9000000045');
        s.fill('#staff-password', 'First-pass-2026');
        (
          s.el.querySelector('#staff .add-staff button[type="submit"]') as HTMLButtonElement
        ).click();
        const req = s.http.expectOne('/api/pump-staff/');
        expect(req.request.method).toBe('POST');
        expect(req.request.body).toEqual({
          username: 'pump.nlr.3',
          full_name: 'Anil Kumar',
          mobile: '9000000045',
          password: 'First-pass-2026',
          pump: 3,
        });
        const created = person({ id: 45, username: 'pump.nlr.3', full_name: 'Anil Kumar' });
        req.flush(created);
        await s.fixture.whenStable();
        expect(s.toasts()[0]).toMatchObject({ text: 'Staff login added.', tone: 'success' });
        expect((s.el.querySelector('#staff-username') as HTMLInputElement).value).toBe('');
        expect((s.el.querySelector('#staff-password') as HTMLInputElement).value).toBe('');
        await s.replyStaff([LAKSHMI, RAVI, OLD, created]);
        expect(s.rows()).toHaveLength(4);
      });

      it('sends the Emp ID when there is one', async () => {
        const s = await setup();
        s.fill('#staff-username', 'pump.nlr.3');
        s.fill('#staff-name', 'Anil Kumar');
        s.fill('#staff-emp', ' ap7001 ');
        s.fill('#staff-password', 'First-pass-2026');
        (
          s.el.querySelector('#staff .add-staff button[type="submit"]') as HTMLButtonElement
        ).click();
        const req = s.http.expectOne('/api/pump-staff/');
        expect(req.request.body).toMatchObject({ emp_id: 'AP7001', pump: 3 });
        req.flush(person({ id: 45 }));
        await s.fixture.whenStable();
        await s.replyStaff([LAKSHMI]);
      });

      it('asks for what is missing before sending anything', async () => {
        const s = await setup();
        s.fill('#staff-username', 'pump.nlr.3');
        (
          s.el.querySelector('#staff .add-staff button[type="submit"]') as HTMLButtonElement
        ).click();
        await s.fixture.whenStable();
        s.http.expectNone('/api/pump-staff/');
        expect(s.text(s.el.querySelector('#staff .add-staff [role="alert"]'))).toBe(
          'Fill in the login ID, name and first password.',
        );
      });

      it('shows what the server says and keeps what was typed', async () => {
        const s = await setup();
        s.fill('#staff-username', 'pump.nlr.1');
        s.fill('#staff-name', 'Anil Kumar');
        s.fill('#staff-password', 'First-pass-2026');
        (
          s.el.querySelector('#staff .add-staff button[type="submit"]') as HTMLButtonElement
        ).click();
        s.http
          .expectOne('/api/pump-staff/')
          .flush(
            { username: ['This login ID is already taken.'] },
            { status: 400, statusText: 'Bad Request' },
          );
        await s.fixture.whenStable();
        expect(s.text(s.el.querySelector('#staff .add-staff [role="alert"]'))).toBe(
          'username: This login ID is already taken.',
        );
        expect((s.el.querySelector('#staff-username') as HTMLInputElement).value).toBe(
          'pump.nlr.1',
        );
        expect(s.toasts()).toEqual([]);
      });
    });
  });
});
