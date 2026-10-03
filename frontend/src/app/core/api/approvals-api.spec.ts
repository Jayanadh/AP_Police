import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Approval, ApprovalsApi } from './approvals-api';

const approval = (overrides: Partial<Approval> = {}): Approval => ({
  id: 11,
  kind: 'OFFICER_CREATE',
  kind_label: 'New officer',
  unit: 3,
  unit_name: 'MTO Vijayawada',
  status: 'PENDING',
  officer: {
    id: 21,
    full_name: 'Lakshmi Devi',
    emp_id: 'AP3001',
    designation_name: 'Inspector',
    mobile: '9000000003',
  },
  vehicle: null,
  request_note: 'Joined this month.',
  requested_by_name: 'Ravi Kumar',
  requested_at: '2026-10-02T08:30:00+05:30',
  decision_note: '',
  decided_by_name: null,
  decided_at: null,
  ...overrides,
});

describe('ApprovalsApi', () => {
  let api: ApprovalsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApprovalsApi);
    http = TestBed.inject(HttpTestingController);
  });

  it('lists the requests with one status', () => {
    let result: Approval[] = [];
    api.list('PENDING').subscribe((rows) => (result = rows));
    const req = http.expectOne('/api/approvals/?status=PENDING');
    expect(req.request.method).toBe('GET');
    req.flush([approval()]);
    expect(result.map((row) => row.id)).toEqual([11]);
    http.verify();
  });

  it('lists the requests of every status with ALL', () => {
    api.list('ALL').subscribe();
    const req = http.expectOne('/api/approvals/');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    req.flush([]);
    http.verify();
  });

  it('approves with a note', () => {
    let result: Approval | undefined;
    api.approve(11, 'Verified.').subscribe((row) => (result = row));
    const req = http.expectOne('/api/approvals/11/approve/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ note: 'Verified.' });
    req.flush(approval({ status: 'APPROVED', decision_note: 'Verified.' }));
    expect(result?.status).toBe('APPROVED');
    http.verify();
  });

  it('rejects with a note', () => {
    let result: Approval | undefined;
    api.reject(11, 'Wrong district.').subscribe((row) => (result = row));
    const req = http.expectOne('/api/approvals/11/reject/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ note: 'Wrong district.' });
    req.flush(approval({ status: 'REJECTED', decision_note: 'Wrong district.' }));
    expect(result?.status).toBe('REJECTED');
    http.verify();
  });
});
