import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Person, PeopleApi } from './people-api';

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

describe('PeopleApi', () => {
  let api: PeopleApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(PeopleApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists a kind of people with no filters', () => {
    let result: Person[] = [];
    api.list('drivers').subscribe((rows) => (result = rows));
    const req = http.expectOne('/api/drivers/');
    expect(req.request.method).toBe('GET');
    req.flush([person()]);
    expect(result.map((row) => row.full_name)).toEqual(['Ramesh Babu']);
  });

  it('sends the search, status and unassigned filters as query parameters', () => {
    api.list('officers', { search: 'ram', status: 'PAUSED', unassigned: true }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/officers/');
    expect(req.request.params.get('search')).toBe('ram');
    expect(req.request.params.get('status')).toBe('PAUSED');
    expect(req.request.params.get('unassigned')).toBe('1');
    req.flush([]);
  });

  it('leaves out filters that are empty', () => {
    api.list('drivers', { search: '', status: undefined, unassigned: false }).subscribe();
    const req = http.expectOne('/api/drivers/');
    expect(req.request.params.keys()).toEqual([]);
    req.flush([]);
  });

  it('reads the pump staff list from its own endpoint', () => {
    api.list('pump-staff', { search: 'nlr' }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/pump-staff/');
    expect(req.request.params.get('search')).toBe('nlr');
    req.flush([]);
  });

  it('creates a driver with a POST', () => {
    const payload = {
      full_name: 'Ramesh Babu',
      emp_id: 'AP4001',
      designation: 2,
      district: 5,
      cadre: 3,
      mobile: '9876543210',
      licence_number: 'AP0420200012345',
      licence_valid_till: null,
      password: 'First-pass-2026',
    };
    let result: Person | undefined;
    api.create('drivers', payload).subscribe((row) => (result = row));
    const req = http.expectOne('/api/drivers/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush(person(), { status: 201, statusText: 'Created' });
    expect(result?.id).toBe(11);
  });

  it('creates pump staff with a login ID and a pump', () => {
    const payload = {
      username: 'pump.nlr.ravi',
      full_name: 'Ravi',
      mobile: '',
      pump: 9,
      password: 'First-pass-2026',
    };
    api.create('pump-staff', payload).subscribe();
    const req = http.expectOne('/api/pump-staff/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush(person({ username: 'pump.nlr.ravi', pump: 9, pump_name: 'Nellore Police Pump' }), {
      status: 201,
      statusText: 'Created',
    });
  });

  it('changes a person with a PATCH', () => {
    let result: Person | undefined;
    api.update('officers', 11, { mobile: '9000000001' }).subscribe((row) => (result = row));
    const req = http.expectOne('/api/officers/11/');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ mobile: '9000000001' });
    req.flush(person({ mobile: '9000000001' }));
    expect(result?.mobile).toBe('9000000001');
  });

  it.each(['pause', 'resume', 'terminate'] as const)('posts %s to its own endpoint', (action) => {
    let result: Person | undefined;
    api.act('drivers', 11, action).subscribe((row) => (result = row));
    const req = http.expectOne(`/api/drivers/11/${action}/`);
    expect(req.request.method).toBe('POST');
    req.flush(person({ status: 'PAUSED', status_label: 'Paused' }));
    expect(result?.status).toBe('PAUSED');
  });

  it('resets a password and completes on 204', () => {
    let done = false;
    api.resetPassword('pump-staff', 11, 'New-pass-2026').subscribe(() => (done = true));
    const req = http.expectOne('/api/pump-staff/11/reset-password/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ password: 'New-pass-2026' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(done).toBe(true);
  });
});
