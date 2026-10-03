import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MasterItem } from '../../core/api/masters-api';
import { Person } from '../../core/api/people-api';
import { CONFIRM_GUARD_MS } from '../../ui/confirm-button';
import { ToastService } from '../../ui/toast';
import { PeoplePage } from './people-page';

const DISTRICTS = '/api/masters/districts/?active=1';
const DESIGNATIONS = '/api/masters/designations/?active=1';
const CADRES = '/api/masters/cadres/?active=1';

const master = (id: number, name: string): MasterItem => ({ id, name, is_active: true });

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
  current_vehicles: [{ id: 4, registration_number: 'AP39AB1234' }],
  ...overrides,
});

const RAMESH = person();
const ANIL = person({
  id: 12,
  username: 'ap4002',
  full_name: 'Anil Kumar',
  emp_id: 'AP4002',
  mobile: '9000000002',
  status: 'PAUSED',
  status_label: 'Paused',
  current_vehicles: [],
});

const pastGuard = () => new Promise((resolve) => setTimeout(resolve, CONFIRM_GUARD_MS + 50));

describe('PeoplePage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(
    kind: 'drivers' | 'officers' = 'drivers',
    rows: Person[] | 'fail' = [RAMESH, ANIL],
  ) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PeoplePage);
    fixture.componentRef.setInput('kind', kind);
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();

    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const reply = async (url: string, body: Person[] | 'fail') => {
      const req = http.expectOne(url);
      expect(req.request.method).toBe('GET');
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
    };
    /** Answers the next list request whatever its filters, and returns its parameters. */
    const replyList = async (body: Person[] | 'fail') => {
      const req = http.expectOne((r) => r.url === `/api/${kind}/`);
      expect(req.request.method).toBe('GET');
      const params = Object.fromEntries(
        req.request.params.keys().map((k) => [k, req.request.params.get(k)]),
      );
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
      return params;
    };
    await reply(`/api/${kind}/`, rows);

    const people = () => Array.from(el.querySelectorAll<HTMLElement>('tbody tr.person'));
    const button = (label: string, scope: ParentNode = el) =>
      Array.from(scope.querySelectorAll('button')).find((b) => text(b) === label) as
        HTMLButtonElement | undefined;
    const fill = (selector: string, value: string) => {
      const input = el.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const flushMasters = async () => {
      http.expectOne(DISTRICTS).flush([master(1, 'NTR'), master(5, 'Nellore')]);
      http.expectOne(DESIGNATIONS).flush([master(2, 'Constable'), master(6, 'Inspector')]);
      http.expectOne(CADRES).flush([master(3, 'Civil'), master(8, 'Armed Reserve')]);
      await fixture.whenStable();
    };
    const choose = (id: string, label: string) => {
      const select = el.querySelector(`#${id}`) as HTMLSelectElement;
      const option = Array.from(select.options).find((o) => text(o) === label)!;
      select.value = option.value;
      select.dispatchEvent(new Event('change'));
    };
    const toasts = () => TestBed.inject(ToastService).messages();
    return {
      fixture,
      el,
      http,
      text,
      reply,
      replyList,
      people,
      button,
      fill,
      flushMasters,
      choose,
      toasts,
    };
  }

  it('loads the drivers and lists them with their details', async () => {
    const { el, people, text } = await setup();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Drivers');
    expect(people()).toHaveLength(2);
    const first = text(people()[0]);
    expect(first).toContain('Ramesh Babu');
    expect(first).toContain('AP4001');
    expect(first).toContain('9876543210');
    expect(first).toContain('AP39AB1234');
    expect(first).toContain('Active');
    const second = people()[1];
    expect(text(second.querySelector('[data-label="Current vehicle"]'))).toContain('None');
    expect(text(second.querySelector('app-status-badge'))).toBe('Paused');
  });

  it('labels every cell, so the phone layout can name each value', async () => {
    const { people } = await setup();
    const labels = Array.from(people()[0].querySelectorAll('td[data-label]')).map((td) =>
      td.getAttribute('data-label'),
    );
    expect(labels).toEqual(['Name', 'Emp ID', 'Mobile', 'Current vehicle', 'Status', 'Actions']);
  });

  it('is the officers page when the route says so, with the "Waiting for PTO" chip', async () => {
    const { el, text } = await setup('officers', [
      person({ status: 'PENDING_APPROVAL', status_label: 'Waiting for PTO approval' }),
    ]);
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Officers');
    const chips = Array.from(el.querySelectorAll('.chip')).map((c) => text(c));
    expect(chips).toEqual(['All', 'Active', 'Paused', 'Waiting for PTO', 'Terminated']);
    expect(text(el.querySelector('tbody'))).toContain('Waiting for PTO approval');
  });

  it('has no "Waiting for PTO" chip for drivers', async () => {
    const { el, text } = await setup('drivers');
    const chips = Array.from(el.querySelectorAll('.chip')).map((c) => text(c));
    expect(chips).toEqual(['All', 'Active', 'Paused', 'Terminated']);
  });

  it('searches by name or Emp ID when the search is submitted', async () => {
    const { fixture, el, fill, replyList, people } = await setup();
    fill('input[type="search"]', 'anil');
    await fixture.whenStable();
    (el.querySelector('form[role="search"] button[type="submit"]') as HTMLButtonElement).click();
    const params = await replyList([ANIL]);
    expect(params).toEqual({ search: 'anil' });
    expect(people()).toHaveLength(1);
  });

  it('shows everyone again when the search is cleared', async () => {
    const { fixture, el, fill, replyList, people } = await setup();
    fill('input[type="search"]', 'anil');
    (el.querySelector('form[role="search"] button[type="submit"]') as HTMLButtonElement).click();
    await replyList([ANIL]);
    fill('input[type="search"]', '');
    await fixture.whenStable();
    const params = await replyList([RAMESH, ANIL]);
    expect(params).toEqual({});
    expect(people()).toHaveLength(2);
  });

  it('filters by status with the chips and keeps the search', async () => {
    const { fixture, el, fill, button, replyList, people } = await setup();
    fill('input[type="search"]', 'an');
    (el.querySelector('form[role="search"] button[type="submit"]') as HTMLButtonElement).click();
    await replyList([ANIL]);
    button('Paused')!.click();
    await fixture.whenStable();
    expect(await replyList([ANIL])).toEqual({ search: 'an', status: 'PAUSED' });
    expect(people()).toHaveLength(1);
    expect(button('Paused')!.classList.contains('active')).toBe(true);
    button('All')!.click();
    await fixture.whenStable();
    expect(await replyList([RAMESH, ANIL])).toEqual({ search: 'an' });
    expect(button('All')!.classList.contains('active')).toBe(true);
  });

  it('uses the status code the API expects for the officers waiting for PTO', async () => {
    const { fixture, button, replyList } = await setup('officers', []);
    button('Waiting for PTO')!.click();
    await fixture.whenStable();
    expect(await replyList([])).toEqual({ status: 'PENDING_APPROVAL' });
  });

  it('ignores a slow answer for a filter the user has already left', async () => {
    const { fixture, http, el, button, people } = await setup();
    button('Paused')!.click();
    await fixture.whenStable();
    const slow = http.expectOne((r) => r.params.get('status') === 'PAUSED');
    button('Terminated')!.click();
    await fixture.whenStable();
    const current = http.expectOne((r) => r.params.get('status') === 'TERMINATED');
    current.flush([]);
    slow.flush([ANIL]);
    await fixture.whenStable();
    expect(people()).toHaveLength(0);
    expect(el.querySelector('app-empty-state')).not.toBeNull();
  });

  it('shows an empty state, and says when a filter matched nobody', async () => {
    const { fixture, el, button, replyList, text } = await setup('drivers', []);
    expect(text(el.querySelector('app-empty-state'))).toContain('No drivers yet');
    button('Active')!.click();
    await fixture.whenStable();
    await replyList([]);
    expect(text(el.querySelector('app-empty-state'))).toContain('No drivers match');
  });

  it('shows the error and retries on request', async () => {
    const { fixture, el, replyList, people } = await setup('drivers', 'fail');
    expect(el.querySelector('.error')?.textContent?.trim()).toBe('Not available.');
    (el.querySelector('button.retry') as HTMLButtonElement).click();
    await fixture.whenStable();
    await replyList([RAMESH]);
    expect(el.querySelector('.error')).toBeNull();
    expect(people()).toHaveLength(1);
  });

  it('keeps the add form hidden until "Add driver" is pressed, and hides it on Cancel', async () => {
    const { fixture, el, button, flushMasters } = await setup();
    expect(el.querySelector('app-person-form')).toBeNull();
    button('Add driver')!.click();
    await fixture.whenStable();
    await flushMasters();
    expect(el.querySelector('app-person-form')).not.toBeNull();
    button('Cancel')!.click();
    await fixture.whenStable();
    expect(el.querySelector('app-person-form')).toBeNull();
  });

  it('offers "Add officer" on the officers page', async () => {
    const { button } = await setup('officers', []);
    expect(button('Add officer')).toBeDefined();
    expect(button('Add driver')).toBeUndefined();
  });

  async function addDriver(s: Awaited<ReturnType<typeof setup>>) {
    s.button('Add driver')!.click();
    await s.fixture.whenStable();
    await s.flushMasters();
    s.fill('#person-name', 'Suresh Reddy');
    s.fill('#person-emp', 'AP4003');
    s.choose('person-designation', 'Constable');
    s.choose('person-district', 'Nellore');
    s.choose('person-cadre', 'Civil');
    s.fill('#person-mobile', '9000000003');
    s.fill('#person-password', 'First-pass-2026');
    (s.el.querySelector('app-person-form button[type="submit"]') as HTMLButtonElement).click();
  }

  it('posts a new driver (empty licence date as null), then toasts, closes the form and reloads', async () => {
    const s = await setup();
    await addDriver(s);
    const req = s.http.expectOne('/api/drivers/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      full_name: 'Suresh Reddy',
      emp_id: 'AP4003',
      designation: 2,
      district: 5,
      cadre: 3,
      mobile: '9000000003',
      licence_number: '',
      licence_valid_till: null,
      password: 'First-pass-2026',
    });
    req.flush(person({ id: 13, full_name: 'Suresh Reddy' }), {
      status: 201,
      statusText: 'Created',
    });
    await s.fixture.whenStable();
    expect(s.toasts()[0]).toMatchObject({ text: 'Driver added.', tone: 'success' });
    expect(s.el.querySelector('app-person-form')).toBeNull();
    await s.replyList([RAMESH, ANIL, person({ id: 13, full_name: 'Suresh Reddy' })]);
    expect(s.people()).toHaveLength(3);
  });

  it('shows the API error inside the form and keeps the form open', async () => {
    const s = await setup();
    await addDriver(s);
    s.http
      .expectOne('/api/drivers/')
      .flush(
        { emp_id: ['This Emp ID is already registered.'] },
        { status: 400, statusText: 'Bad Request' },
      );
    await s.fixture.whenStable();
    expect(s.el.querySelector('app-person-form .error')?.textContent?.trim()).toBe(
      'emp id: This Emp ID is already registered.',
    );
    expect(s.toasts()).toHaveLength(0);
  });

  it('tells the MTO that a new officer went to the PTO, and shows the waiting badge', async () => {
    const s = await setup('officers', []);
    s.button('Add officer')!.click();
    await s.fixture.whenStable();
    await s.flushMasters();
    s.fill('#person-name', 'Suresh Reddy');
    s.fill('#person-emp', 'AP3005');
    s.choose('person-designation', 'Inspector');
    s.choose('person-district', 'Nellore');
    s.choose('person-cadre', 'Civil');
    s.fill('#person-password', 'First-pass-2026');
    (s.el.querySelector('app-person-form button[type="submit"]') as HTMLButtonElement).click();
    const req = s.http.expectOne('/api/officers/');
    const created = person({
      id: 30,
      full_name: 'Suresh Reddy',
      emp_id: 'AP3005',
      status: 'PENDING_APPROVAL',
      status_label: 'Waiting for PTO approval',
      current_vehicles: [],
    });
    req.flush(created, { status: 201, statusText: 'Created' });
    await s.fixture.whenStable();
    expect(s.toasts()[0]).toMatchObject({
      text: 'Officer sent to PTO for approval.',
      tone: 'success',
    });
    await s.replyList([created]);
    expect(s.text(s.people()[0].querySelector('app-status-badge'))).toBe(
      'Waiting for PTO approval',
    );
    expect(s.people()[0].querySelector('app-status-badge .badge-warning')).not.toBeNull();
  });

  it('edits a person in the form and patches them', async () => {
    const s = await setup();
    s.button('Edit', s.people()[0])!.click();
    await s.fixture.whenStable();
    await s.flushMasters();
    expect((s.el.querySelector('#person-name') as HTMLInputElement).value).toBe('Ramesh Babu');
    expect(s.el.querySelector('#person-password')).toBeNull();
    s.fill('#person-mobile', '9000000009');
    (s.el.querySelector('app-person-form button[type="submit"]') as HTMLButtonElement).click();
    const req = s.http.expectOne('/api/drivers/11/');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.mobile).toBe('9000000009');
    expect('password' in req.request.body).toBe(false);
    req.flush(person({ mobile: '9000000009' }));
    await s.fixture.whenStable();
    expect(s.toasts()[0]).toMatchObject({ text: 'Driver updated.', tone: 'success' });
    expect(s.el.querySelector('app-person-form')).toBeNull();
    await s.replyList([person({ mobile: '9000000009' }), ANIL]);
  });

  it('pauses an active person with a POST to /pause/, then reloads', async () => {
    const s = await setup();
    s.button('Pause', s.people()[0])!.click();
    const req = s.http.expectOne('/api/drivers/11/pause/');
    expect(req.request.method).toBe('POST');
    req.flush(person({ status: 'PAUSED', status_label: 'Paused' }));
    await s.fixture.whenStable();
    expect(s.toasts()[0]).toMatchObject({ text: 'Ramesh Babu paused.', tone: 'success' });
    await s.replyList([person({ status: 'PAUSED', status_label: 'Paused' }), ANIL]);
    expect(s.text(s.people()[0].querySelector('app-status-badge'))).toBe('Paused');
  });

  it('resumes a paused person with a POST to /resume/', async () => {
    const s = await setup();
    expect(s.button('Pause', s.people()[1])).toBeUndefined();
    s.button('Resume', s.people()[1])!.click();
    const req = s.http.expectOne('/api/drivers/12/resume/');
    expect(req.request.method).toBe('POST');
    req.flush(person({ ...ANIL, status: 'ACTIVE', status_label: 'Active' }));
    await s.fixture.whenStable();
    expect(s.toasts()[0]).toMatchObject({ text: 'Anil Kumar resumed.', tone: 'success' });
    await s.replyList([RAMESH, person({ ...ANIL, status: 'ACTIVE', status_label: 'Active' })]);
  });

  it('shows the reason in a toast when the server refuses a pause', async () => {
    const s = await setup();
    s.button('Pause', s.people()[0])!.click();
    s.http
      .expectOne('/api/drivers/11/pause/')
      .flush(
        { detail: 'Only active people can be paused.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await s.fixture.whenStable();
    expect(s.toasts()[0]).toMatchObject({
      text: 'Only active people can be paused.',
      tone: 'danger',
    });
    s.http.expectNone((r) => r.method === 'GET');
  });

  it('terminates only after two clicks', async () => {
    const s = await setup();
    const terminate = () =>
      Array.from(s.people()[0].querySelectorAll('app-confirm-button button')).find(
        (b) => s.text(b) === 'Terminate' || s.text(b) === 'Confirm',
      ) as HTMLButtonElement;
    terminate().click();
    await s.fixture.whenStable();
    s.http.expectNone('/api/drivers/11/terminate/');
    expect(s.text(terminate())).toBe('Confirm');
    await pastGuard();
    terminate().click();
    const req = s.http.expectOne('/api/drivers/11/terminate/');
    expect(req.request.method).toBe('POST');
    req.flush(person({ status: 'TERMINATED', status_label: 'Terminated' }));
    await s.fixture.whenStable();
    expect(s.toasts()[0]).toMatchObject({ text: 'Ramesh Babu terminated.', tone: 'success' });
    await s.replyList([person({ status: 'TERMINATED', status_label: 'Terminated' }), ANIL]);
  });

  it('offers only what the server allows for each status', async () => {
    const s = await setup('officers', [
      person({ id: 1, status: 'PENDING_APPROVAL', status_label: 'Waiting for PTO approval' }),
      person({ id: 2, status: 'TERMINATED', status_label: 'Terminated' }),
      person({ id: 3, status: 'REJECTED', status_label: 'Rejected' }),
      person({ id: 4 }),
    ]);
    const names = (row: HTMLElement) =>
      Array.from(row.querySelectorAll('td[data-label="Actions"] button')).map((b) => s.text(b));
    const [pending, terminated, rejected, active] = s.people();
    expect(names(pending)).toEqual(['Edit']);
    expect(names(terminated)).toEqual([]);
    expect(names(rejected)).toEqual([]);
    expect(names(active)).toEqual(['Edit', 'Pause', 'Terminate', 'Reset password']);
  });

  it('resets a password from an inline field and toasts', async () => {
    const s = await setup();
    expect(s.el.querySelector('input[type="password"]')).toBeNull();
    s.button('Reset password', s.people()[0])!.click();
    await s.fixture.whenStable();
    const input = s.people()[0].querySelector('input[type="password"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(s.text(s.people()[0].querySelector(`label[for="${input.id}"]`))).toBe(
      'New password for Ramesh Babu',
    );
    s.fill(`#${input.id}`, 'New-pass-2026');
    s.button('Set password', s.people()[0])!.click();
    const req = s.http.expectOne('/api/drivers/11/reset-password/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ password: 'New-pass-2026' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await s.fixture.whenStable();
    expect(s.toasts()[0]).toMatchObject({
      text: 'Password reset for Ramesh Babu. They must change it at next login.',
      tone: 'success',
    });
    expect(s.el.querySelector('input[type="password"]')).toBeNull();
  });

  it('shows the password error beside the field and keeps it open', async () => {
    const s = await setup();
    s.button('Reset password', s.people()[0])!.click();
    await s.fixture.whenStable();
    const input = s.people()[0].querySelector('input[type="password"]') as HTMLInputElement;
    s.fill(`#${input.id}`, 'password');
    s.button('Set password', s.people()[0])!.click();
    s.http
      .expectOne('/api/drivers/11/reset-password/')
      .flush(
        { password: ['This password is too common.'] },
        { status: 400, statusText: 'Bad Request' },
      );
    await s.fixture.whenStable();
    expect(s.text(s.people()[0].querySelector('.error'))).toBe(
      'password: This password is too common.',
    );
    expect(s.people()[0].querySelector('input[type="password"]')).not.toBeNull();
  });

  it('sends nothing for an empty password and opens one reset field at a time', async () => {
    const s = await setup();
    s.button('Reset password', s.people()[0])!.click();
    await s.fixture.whenStable();
    s.button('Set password', s.people()[0])!.click();
    await s.fixture.whenStable();
    s.http.expectNone('/api/drivers/11/reset-password/');
    expect(s.text(s.people()[0].querySelector('.error'))).toBe('Type a new password.');
    s.button('Reset password', s.people()[1])!.click();
    await s.fixture.whenStable();
    expect(s.people()[0].querySelector('input[type="password"]')).toBeNull();
    expect(s.people()[1].querySelector('input[type="password"]')).not.toBeNull();
    s.button('Cancel', s.people()[1])!.click();
    await s.fixture.whenStable();
    expect(s.el.querySelector('tbody input[type="password"]')).toBeNull();
  });
});
