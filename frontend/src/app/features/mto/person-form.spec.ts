import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MasterItem } from '../../core/api/masters-api';
import { Person } from '../../core/api/people-api';
import { PersonForm } from './person-form';

const DISTRICTS = '/api/masters/districts/?active=1';
const DESIGNATIONS = '/api/masters/designations/?active=1';
const CADRES = '/api/masters/cadres/?active=1';

const master = (id: number, name: string): MasterItem => ({ id, name, is_active: true });

const DISTRICT_ROWS = [master(1, 'NTR'), master(5, 'Nellore')];
const DESIGNATION_ROWS = [master(2, 'Constable'), master(6, 'Inspector')];
const CADRE_ROWS = [master(3, 'Civil'), master(8, 'Armed Reserve')];

const person = (overrides: Partial<Person> = {}): Person => ({
  id: 11,
  username: 'ap4001',
  full_name: 'Ramesh Babu',
  emp_id: 'AP4001',
  designation: 2,
  designation_name: 'Constable',
  district: 5,
  district_name: 'Nellore',
  cadre: 3,
  cadre_name: 'Civil',
  mobile: '9876543210',
  status: 'ACTIVE',
  status_label: 'Active',
  licence_number: 'AP0420200012345',
  licence_valid_till: '2030-01-31',
  current_vehicles: [],
  ...overrides,
});

describe('PersonForm', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(kind: 'drivers' | 'officers', existing: Person | null = null) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PersonForm);
    fixture.componentRef.setInput('kind', kind);
    if (existing) {
      fixture.componentRef.setInput('person', existing);
    }
    const saved: Person[] = [];
    let cancelled = 0;
    fixture.componentInstance.saved.subscribe((row) => saved.push(row));
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    fixture.detectChanges();
    http.expectOne(DISTRICTS).flush(DISTRICT_ROWS);
    http.expectOne(DESIGNATIONS).flush(DESIGNATION_ROWS);
    http.expectOne(CADRES).flush(CADRE_ROWS);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const field = (id: string) => el.querySelector(`#${id}`) as HTMLInputElement | null;
    const label = (id: string) => text(el.querySelector(`label[for="${id}"]`));
    const fill = (id: string, value: string) => {
      const input = field(id)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const choose = (id: string, optionLabel: string) => {
      const select = el.querySelector(`#${id}`) as HTMLSelectElement;
      const option = Array.from(select.options).find((o) => text(o) === optionLabel)!;
      select.value = option.value;
      select.dispatchEvent(new Event('change'));
    };
    const options = (id: string) =>
      Array.from(el.querySelectorAll(`#${id} option`)).map((o) => text(o));
    const selected = (id: string) => {
      const select = el.querySelector(`#${id}`) as HTMLSelectElement;
      return text(select.selectedOptions[0]);
    };
    const fillAll = () => {
      fill('person-name', ' Ramesh Babu ');
      fill('person-emp', ' AP4001 ');
      choose('person-designation', 'Constable');
      choose('person-district', 'Nellore');
      choose('person-cadre', 'Civil');
      fill('person-mobile', '9876543210');
    };
    const submit = () => (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    const button = (name: string) =>
      Array.from(el.querySelectorAll('button')).find((b) => text(b) === name) as
        HTMLButtonElement | undefined;
    return {
      fixture,
      el,
      http,
      saved,
      cancelled: () => cancelled,
      text,
      field,
      label,
      fill,
      choose,
      options,
      selected,
      fillAll,
      submit,
      button,
    };
  }

  it('asks a new driver for the five police details, the licence and a first password', async () => {
    const { label, options, field, button } = await setup('drivers');
    expect(label('person-name')).toBe('Name');
    expect(label('person-emp')).toBe('Emp ID');
    expect(label('person-designation')).toBe('Designation');
    expect(label('person-district')).toBe('District');
    expect(label('person-cadre')).toBe('Cadre');
    expect(label('person-mobile')).toBe('Mobile');
    expect(label('person-licence')).toBe('Licence number');
    expect(label('person-licence-till')).toBe('Licence valid till');
    expect(field('person-licence-till')?.type).toBe('date');
    expect(label('person-password')).toBe('First password');
    expect(field('person-password')?.type).toBe('password');
    expect(options('person-designation')).toEqual(['Select designation', 'Constable', 'Inspector']);
    expect(options('person-district')).toEqual(['Select district', 'NTR', 'Nellore']);
    expect(options('person-cadre')).toEqual(['Select cadre', 'Civil', 'Armed Reserve']);
    expect(button('Add driver')).toBeDefined();
  });

  it('does not ask an officer for licence details', async () => {
    const { field, button } = await setup('officers');
    expect(field('person-licence')).toBeNull();
    expect(field('person-licence-till')).toBeNull();
    expect(field('person-password')).not.toBeNull();
    expect(button('Add officer')).toBeDefined();
  });

  it('posts a new driver and sends an empty licence date as null', async () => {
    const { fixture, http, saved, fillAll, fill, submit } = await setup('drivers');
    fillAll();
    fill('person-licence', 'AP0420200012345');
    fill('person-password', 'First-pass-2026');
    submit();
    const req = http.expectOne('/api/drivers/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      full_name: 'Ramesh Babu',
      emp_id: 'AP4001',
      designation: 2,
      district: 5,
      cadre: 3,
      mobile: '9876543210',
      licence_number: 'AP0420200012345',
      licence_valid_till: null,
      password: 'First-pass-2026',
    });
    req.flush(person(), { status: 201, statusText: 'Created' });
    await fixture.whenStable();
    expect(saved.map((row) => row.id)).toEqual([11]);
  });

  it('sends the licence date when one is entered', async () => {
    const { http, fillAll, fill, submit } = await setup('drivers');
    fillAll();
    fill('person-licence-till', '2030-01-31');
    fill('person-password', 'First-pass-2026');
    submit();
    const req = http.expectOne('/api/drivers/');
    expect(req.request.body.licence_valid_till).toBe('2030-01-31');
    req.flush(person(), { status: 201, statusText: 'Created' });
  });

  it('posts a new officer without any licence fields', async () => {
    const { http, fillAll, fill, submit } = await setup('officers');
    fillAll();
    fill('person-password', 'First-pass-2026');
    submit();
    const req = http.expectOne('/api/officers/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      full_name: 'Ramesh Babu',
      emp_id: 'AP4001',
      designation: 2,
      district: 5,
      cadre: 3,
      mobile: '9876543210',
      password: 'First-pass-2026',
    });
    req.flush(person({ status: 'PENDING_APPROVAL' }), { status: 201, statusText: 'Created' });
  });

  it('shows the API error inside the form and keeps what was typed', async () => {
    const { fixture, el, http, saved, fillAll, fill, submit, field } = await setup('drivers');
    fillAll();
    fill('person-password', 'First-pass-2026');
    submit();
    http
      .expectOne('/api/drivers/')
      .flush(
        { emp_id: ['This Emp ID is already registered.'] },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(el.querySelector('.error')?.textContent?.trim()).toBe(
      'emp id: This Emp ID is already registered.',
    );
    expect(field('person-name')?.value).toBe(' Ramesh Babu ');
    expect(saved).toHaveLength(0);
    expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends nothing while a required field is empty', async () => {
    const { fixture, el, http, fill, submit, text } = await setup('drivers');
    fill('person-name', 'Ramesh Babu');
    submit();
    await fixture.whenStable();
    http.expectNone('/api/drivers/');
    expect(text(el.querySelector('.error'))).toBe(
      'Fill in the name, Emp ID, designation, district, cadre and a first password.',
    );
  });

  it('asks for a password only when adding', async () => {
    const { fixture, el, http, fillAll, submit, text } = await setup('officers');
    fillAll();
    submit();
    await fixture.whenStable();
    http.expectNone('/api/officers/');
    expect(text(el.querySelector('.error'))).toContain('first password');
  });

  it('fills the form from the person being edited and has no password field', async () => {
    const { field, label, selected, button } = await setup('drivers', person());
    expect(field('person-name')?.value).toBe('Ramesh Babu');
    expect(field('person-emp')?.value).toBe('AP4001');
    expect(selected('person-designation')).toBe('Constable');
    expect(selected('person-district')).toBe('Nellore');
    expect(selected('person-cadre')).toBe('Civil');
    expect(field('person-mobile')?.value).toBe('9876543210');
    expect(field('person-licence')?.value).toBe('AP0420200012345');
    expect(field('person-licence-till')?.value).toBe('2030-01-31');
    expect(field('person-password')).toBeNull();
    expect(label('person-password')).toBeUndefined();
    expect(button('Save changes')).toBeDefined();
  });

  it('patches only the editable details and never sends a password', async () => {
    const { fixture, http, saved, fill, submit } = await setup('drivers', person());
    fill('person-mobile', '9000000001');
    fill('person-licence-till', '');
    submit();
    const req = http.expectOne('/api/drivers/11/');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      full_name: 'Ramesh Babu',
      emp_id: 'AP4001',
      designation: 2,
      district: 5,
      cadre: 3,
      mobile: '9000000001',
      licence_number: 'AP0420200012345',
      licence_valid_till: null,
    });
    expect('password' in req.request.body).toBe(false);
    req.flush(person({ mobile: '9000000001' }));
    await fixture.whenStable();
    expect(saved.map((row) => row.mobile)).toEqual(['9000000001']);
  });

  it('patches an officer without licence fields', async () => {
    const { http, submit } = await setup('officers', person({ licence_number: undefined }));
    submit();
    const req = http.expectOne('/api/officers/11/');
    expect(req.request.method).toBe('PATCH');
    expect('licence_number' in req.request.body).toBe(false);
    expect('licence_valid_till' in req.request.body).toBe(false);
    expect('password' in req.request.body).toBe(false);
    req.flush(person());
  });

  it('keeps a value that has since been switched off in the master list', async () => {
    const { options, selected } = await setup(
      'drivers',
      person({ designation: 9, designation_name: 'Head Constable' }),
    );
    expect(options('person-designation')).toContain('Head Constable');
    expect(selected('person-designation')).toBe('Head Constable');
  });

  it('refills the form when another person is chosen for editing', async () => {
    const { fixture, field } = await setup('drivers', person());
    fixture.componentRef.setInput(
      'person',
      person({ id: 12, full_name: 'Anil Kumar', emp_id: 'AP4002', licence_valid_till: null }),
    );
    await fixture.whenStable();
    expect(field('person-name')?.value).toBe('Anil Kumar');
    expect(field('person-emp')?.value).toBe('AP4002');
    expect(field('person-licence-till')?.value).toBe('');
  });

  it('tells the page when the form is cancelled', async () => {
    const { button, cancelled } = await setup('drivers');
    button('Cancel')!.click();
    expect(cancelled()).toBe(1);
  });

  it('shows an error and retries when the master lists cannot be read', async () => {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PersonForm);
    fixture.componentRef.setInput('kind', 'drivers');
    fixture.detectChanges();
    http.expectOne(DISTRICTS).flush(DISTRICT_ROWS);
    http.expectOne(CADRES).flush(CADRE_ROWS);
    http
      .expectOne(DESIGNATIONS)
      .flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.error')?.textContent?.trim()).toBe('Not available.');
    (el.querySelector('button.retry') as HTMLButtonElement).click();
    http.expectOne(DISTRICTS).flush(DISTRICT_ROWS);
    http.expectOne(DESIGNATIONS).flush(DESIGNATION_ROWS);
    http.expectOne(CADRES).flush(CADRE_ROWS);
    await fixture.whenStable();
    expect(el.querySelector('.error')).toBeNull();
    expect(el.querySelectorAll('#person-designation option')).toHaveLength(3);
  });
});
