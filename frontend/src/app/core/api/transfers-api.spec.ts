import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { OfficerLookup, Transfer, TransfersApi } from './transfers-api';

const transfer = (overrides: Partial<Transfer> = {}): Transfer => ({
  id: 8,
  officer: 21,
  officer_name: 'Suresh Reddy',
  officer_emp_id: 'AP3001',
  from_unit: 1,
  from_unit_name: 'MTO Nellore',
  to_unit: 2,
  to_unit_name: 'MTO Guntur',
  note: 'Needed for the new range.',
  status: 'PENDING',
  requested_at: '2026-10-01T09:30:00+05:30',
  decided_at: null,
  ...overrides,
});

describe('TransfersApi', () => {
  let api: TransfersApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(TransfersApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('looks an officer up by Emp ID, encoding it', () => {
    let result: OfficerLookup | undefined;
    api.lookup('AP 30&1').subscribe((row) => (result = row));
    const req = http.expectOne((r) => r.url === '/api/officers/lookup/');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('emp_id')).toBe('AP 30&1');
    expect(req.request.urlWithParams).toBe('/api/officers/lookup/?emp_id=AP%2030%261');
    req.flush({
      id: 21,
      full_name: 'Suresh Reddy',
      emp_id: 'AP3001',
      designation_name: 'Inspector',
      unit: 1,
      unit_name: 'MTO Nellore',
    });
    expect(result?.unit_name).toBe('MTO Nellore');
  });

  it.each(['incoming', 'outgoing'] as const)('lists %s transfers', (direction) => {
    let result: Transfer[] = [];
    api.list(direction).subscribe((rows) => (result = rows));
    const req = http.expectOne(`/api/transfers/?direction=${direction}`);
    expect(req.request.method).toBe('GET');
    req.flush([transfer()]);
    expect(result).toHaveLength(1);
  });

  it('asks for an officer with the officer id and a note', () => {
    let result: Transfer | undefined;
    api.request(21, 'Needed for the new range.').subscribe((row) => (result = row));
    const req = http.expectOne('/api/transfers/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ officer: 21, note: 'Needed for the new range.' });
    req.flush(transfer(), { status: 201, statusText: 'Created' });
    expect(result?.status).toBe('PENDING');
  });

  it.each(['accept', 'reject', 'cancel'] as const)('posts %s to the transfer', (action) => {
    let result: Transfer | undefined;
    api[action](8).subscribe((row) => (result = row));
    const req = http.expectOne(`/api/transfers/8/${action}/`);
    expect(req.request.method).toBe('POST');
    req.flush(transfer({ status: 'ACCEPTED' }));
    expect(result?.status).toBe('ACCEPTED');
  });
});
