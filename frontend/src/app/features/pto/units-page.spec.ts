import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MasterItem } from '../../core/api/masters-api';
import { Unit } from '../../core/api/units-api';
import { ToastService } from '../../ui/toast';
import { UnitsPage } from './units-page';

const UNITS = '/api/units/';
const DISTRICTS = '/api/masters/districts/?active=1';
const DESIGNATIONS = '/api/masters/designations/?active=1';
const CADRES = '/api/masters/cadres/?active=1';

const unit = (overrides: Partial<Unit> = {}): Unit => ({
  id: 3,
  name: 'MTO Vijayawada',
  code: 'VJA',
  district: 1,
  district_name: 'NTR',
  address: 'Benz Circle',
  phone: '0866 2470000',
  mto: {
    id: 7,
    username: 'mto.vijayawada',
    full_name: 'Ravi Kumar',
    emp_id: 'AP1001',
    mobile: '9876543210',
  },
  ...overrides,
});

const master = (id: number, name: string): MasterItem => ({ id, name, is_active: true });

const DISTRICT_ROWS = [master(1, 'NTR'), master(5, 'Nellore')];
const DESIGNATION_ROWS = [master(2, 'Inspector'), master(6, 'Sub-Inspector')];
const CADRE_ROWS = [master(3, 'Civil'), master(8, 'Armed Reserve')];

describe('UnitsPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(
    units: Unit[] | 'fail' = [
      unit(),
      unit({
        id: 4,
        name: 'MTO Guntur',
        code: 'GNT',
        district: 7,
        district_name: 'Guntur',
        mto: null,
      }),
    ],
  ) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(UnitsPage);
    const el = fixture.nativeElement as HTMLElement;
    const load = async (rows: Unit[] | 'fail') => {
      if (rows === 'fail') {
        http
          .expectOne(UNITS)
          .flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        http.expectOne(UNITS).flush(rows);
      }
      await fixture.whenStable();
    };
    http.expectOne(DISTRICTS).flush(DISTRICT_ROWS);
    http.expectOne(DESIGNATIONS).flush(DESIGNATION_ROWS);
    http.expectOne(CADRES).flush(CADRE_ROWS);
    await load(units);

    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const cards = () => Array.from(el.querySelectorAll<HTMLElement>('.office-card'));
    const button = (label: string, scope: ParentNode = el) =>
      Array.from(scope.querySelectorAll('button')).find((b) => text(b) === label) as
        HTMLButtonElement | undefined;
    const fill = (id: string, value: string) => {
      const input = el.querySelector(`#${id}`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const choose = (id: string, label: string) => {
      const select = el.querySelector(`#${id}`) as HTMLSelectElement;
      const option = Array.from(select.options).find((o) => text(o) === label)!;
      select.value = option.value;
      select.dispatchEvent(new Event('change'));
    };
    const fillAddForm = () => {
      fill('unit-name', ' MTO Nellore ');
      fill('unit-code', 'NLR');
      choose('unit-district', 'Nellore');
      fill('unit-address', 'Stonehousepet');
      fill('unit-phone', '');
      fill('mto-username', 'mto.nellore');
      fill('mto-password', 'First-pass-2026');
      fill('mto-name', 'Suresh Reddy');
      fill('mto-emp', 'AP2001');
      choose('mto-designation', 'Inspector');
      choose('mto-cadre', 'Civil');
      fill('mto-mobile', '9000000001');
    };
    const fillHandover = () => {
      fill('ho-name', 'Anil Kumar');
      fill('ho-emp', 'AP3003');
      choose('ho-designation', 'Sub-Inspector');
      choose('ho-cadre', 'Armed Reserve');
      fill('ho-mobile', '9000000002');
      fill('ho-password', 'Second-pass-2026');
    };
    const submit = (form: string) =>
      (el.querySelector(`${form} button[type="submit"]`) as HTMLButtonElement).click();
    return {
      fixture,
      el,
      http,
      load,
      text,
      cards,
      button,
      fill,
      choose,
      fillAddForm,
      fillHandover,
      submit,
    };
  }

  it('lists each office with its district and MTO holder', async () => {
    const { el, cards, text } = await setup();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('MTO offices');
    expect(cards()).toHaveLength(2);
    const first = cards()[0];
    expect(text(first.querySelector('h2'))).toBe('MTO Vijayawada');
    expect(text(first)).toContain('VJA');
    expect(text(first)).toContain('NTR');
    expect(text(first)).toContain('Ravi Kumar');
    expect(text(first)).toContain('mto.vijayawada');
    expect(text(first)).toContain('9876543210');
  });

  it('says when an office has no MTO chair and offers no handover for it', async () => {
    const { cards, text, button } = await setup();
    const second = cards()[1];
    expect(text(second)).toContain('No MTO chair');
    expect(button('Hand over chair', second)).toBeUndefined();
    expect(button('Hand over chair', cards()[0])).toBeDefined();
  });

  it('shows an empty state when there are no offices', async () => {
    const { el, cards } = await setup([]);
    expect(el.querySelector('app-empty-state')?.textContent).toContain('No MTO offices yet');
    expect(cards()).toHaveLength(0);
  });

  it('shows the error and retries on request', async () => {
    const { fixture, el, http, load, cards } = await setup('fail');
    expect(el.querySelector('.error')?.textContent?.trim()).toBe('Not available.');
    (el.querySelector('button.retry') as HTMLButtonElement).click();
    http.expectOne(DISTRICTS).flush(DISTRICT_ROWS);
    http.expectOne(DESIGNATIONS).flush(DESIGNATION_ROWS);
    http.expectOne(CADRES).flush(CADRE_ROWS);
    await load([unit()]);
    await fixture.whenStable();
    expect(el.querySelector('.error')).toBeNull();
    expect(cards()).toHaveLength(1);
  });

  it('keeps the add form hidden until "Add MTO office" is pressed, and hides it again on Cancel', async () => {
    const { fixture, el, button } = await setup();
    expect(el.querySelector('#add-form')).toBeNull();
    button('Add MTO office')!.click();
    await fixture.whenStable();
    expect(el.querySelector('#add-form')).not.toBeNull();
    const label = (id: string) => el.querySelector(`label[for="${id}"]`)?.textContent?.trim();
    expect(label('unit-name')).toBe('Office name');
    expect(label('unit-code')).toBe('Office code');
    expect(label('unit-district')).toBe('District');
    expect(label('unit-address')).toBe('Address');
    expect(label('unit-phone')).toBe('Phone');
    expect(label('mto-username')).toBe('Login ID');
    expect(label('mto-password')).toBe('First password');
    expect(label('mto-name')).toBe('Holder name');
    expect(label('mto-emp')).toBe('Emp ID');
    expect(label('mto-designation')).toBe('Designation');
    expect(label('mto-cadre')).toBe('Cadre');
    expect(label('mto-mobile')).toBe('Mobile');
    const districts = Array.from(el.querySelectorAll('#unit-district option')).map((o) =>
      o.textContent?.trim(),
    );
    expect(districts).toEqual(['Select district', 'NTR', 'Nellore']);
    button('Cancel')!.click();
    await fixture.whenStable();
    expect(el.querySelector('#add-form')).toBeNull();
  });

  it('posts the office with a nested mto_account, then toasts and reloads', async () => {
    const { fixture, el, http, load, button, fillAddForm, submit, cards } = await setup();
    button('Add MTO office')!.click();
    await fixture.whenStable();
    fillAddForm();
    submit('#add-form');
    const req = http.expectOne(UNITS);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      name: 'MTO Nellore',
      code: 'NLR',
      district: 5,
      address: 'Stonehousepet',
      phone: '',
      mto_account: {
        username: 'mto.nellore',
        password: 'First-pass-2026',
        full_name: 'Suresh Reddy',
        emp_id: 'AP2001',
        designation: 2,
        cadre: 3,
        mobile: '9000000001',
      },
    });
    req.flush(unit({ id: 9, name: 'MTO Nellore' }), { status: 201, statusText: 'Created' });
    await fixture.whenStable();
    expect(TestBed.inject(ToastService).messages()[0]).toMatchObject({
      text: 'MTO office added.',
      tone: 'success',
    });
    await load([unit(), unit({ id: 9, name: 'MTO Nellore', code: 'NLR' })]);
    expect(cards()).toHaveLength(2);
    expect(el.querySelector('#add-form')).toBeNull();
  });

  it('shows the API error inside the form and keeps what was typed', async () => {
    const { fixture, el, http, button, fillAddForm, submit } = await setup();
    button('Add MTO office')!.click();
    await fixture.whenStable();
    fillAddForm();
    submit('#add-form');
    http
      .expectOne(UNITS)
      .flush(
        { mto_account: { username: ['This login ID is already taken.'] } },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(el.querySelector('#add-form .error')?.textContent?.trim()).toBe(
      'username: This login ID is already taken.',
    );
    expect((el.querySelector('#unit-code') as HTMLInputElement).value).toBe('NLR');
    http.expectNone(UNITS);
    expect(TestBed.inject(ToastService).messages()).toHaveLength(0);
  });

  it('sends nothing while a required field is empty', async () => {
    const { fixture, el, http, button, fill, submit } = await setup();
    button('Add MTO office')!.click();
    await fixture.whenStable();
    fill('unit-name', 'MTO Nellore');
    submit('#add-form');
    await fixture.whenStable();
    http.expectNone(UNITS);
    expect(el.querySelector('#add-form .error')?.textContent?.trim()).toBe(
      'Fill in the office details and the MTO login details.',
    );
  });

  it('opens the handover form for one office at a time', async () => {
    const { fixture, el, button, cards } = await setup([
      unit(),
      unit({ id: 4, name: 'MTO Guntur', code: 'GNT' }),
    ]);
    expect(el.querySelector('#handover-form')).toBeNull();
    button('Hand over chair', cards()[0])!.click();
    await fixture.whenStable();
    expect(cards()[0].querySelector('#handover-form')).not.toBeNull();
    const label = (id: string) => el.querySelector(`label[for="${id}"]`)?.textContent?.trim();
    expect(label('ho-name')).toBe('Holder name');
    expect(label('ho-emp')).toBe('Emp ID');
    expect(label('ho-designation')).toBe('Designation');
    expect(label('ho-cadre')).toBe('Cadre');
    expect(label('ho-mobile')).toBe('Mobile');
    expect(label('ho-password')).toBe('New password');
    button('Hand over chair', cards()[1])!.click();
    await fixture.whenStable();
    expect(cards()[0].querySelector('#handover-form')).toBeNull();
    expect(cards()[1].querySelector('#handover-form')).not.toBeNull();
    button('Cancel', cards()[1])!.click();
    await fixture.whenStable();
    expect(el.querySelector('#handover-form')).toBeNull();
  });

  it('posts the handover, then toasts and reloads', async () => {
    const { fixture, el, http, load, button, cards, fillHandover, submit } = await setup();
    button('Hand over chair', cards()[0])!.click();
    await fixture.whenStable();
    fillHandover();
    submit('#handover-form');
    const req = http.expectOne('/api/units/3/handover/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      full_name: 'Anil Kumar',
      emp_id: 'AP3003',
      designation: 6,
      cadre: 8,
      mobile: '9000000002',
      password: 'Second-pass-2026',
    });
    req.flush(unit());
    await fixture.whenStable();
    expect(TestBed.inject(ToastService).messages()[0]).toMatchObject({
      text: 'MTO chair handed over to Anil Kumar.',
      tone: 'success',
    });
    await load([
      unit({
        mto: {
          id: 7,
          username: 'mto.vijayawada',
          full_name: 'Anil Kumar',
          emp_id: 'AP3003',
          mobile: '9000000002',
        },
      }),
    ]);
    expect(el.querySelector('#handover-form')).toBeNull();
    expect(cards()[0].textContent).toContain('Anil Kumar');
  });

  it('shows a handover error inside the form', async () => {
    const { fixture, el, http, button, cards, fillHandover, submit } = await setup();
    button('Hand over chair', cards()[0])!.click();
    await fixture.whenStable();
    fillHandover();
    submit('#handover-form');
    http
      .expectOne('/api/units/3/handover/')
      .flush(
        { emp_id: ['This Emp ID already has a login.'] },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(el.querySelector('#handover-form .error')?.textContent?.trim()).toBe(
      'emp id: This Emp ID already has a login.',
    );
  });

  it('sends nothing while a handover field is empty', async () => {
    const { fixture, el, http, button, cards, fill, submit } = await setup();
    button('Hand over chair', cards()[0])!.click();
    await fixture.whenStable();
    fill('ho-name', 'Anil Kumar');
    submit('#handover-form');
    await fixture.whenStable();
    http.expectNone('/api/units/3/handover/');
    expect(el.querySelector('#handover-form .error')?.textContent?.trim()).toBe(
      'Fill in the new holder details and a new password.',
    );
  });
});
