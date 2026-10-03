import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FuelRequest, FuelRequestsApi } from './fuel-requests-api';

const REQUEST: FuelRequest = {
  id: 14,
  vehicle: 5,
  registration_number: 'AP39PA1234',
  driver: 31,
  driver_name: 'Ramesh Babu',
  fuel_type: 'DIESEL',
  litres_requested: '40.00',
  is_emergency: false,
  emergency_reason: '',
  status: 'FILLED',
  status_label: 'Filled',
  issued_at: '2026-10-02T09:00:00+05:30',
  expires_at: '2026-10-03T09:00:00+05:30',
  pin: null,
  failed_pin_attempts: 0,
  cancel_reason: '',
  pump: 3,
  pump_name: 'Nellore Police Pump',
  pump_kind: 'POLICE',
  filled_at: '2026-10-02T09:30:00+05:30',
  litres_filled: '40.00',
  emergency_litres: '0.00',
  emergency_status: 'NONE',
  emergency_status_label: 'Not an emergency',
  duty_particulars: '',
  duty_submitted_at: null,
  duty_due_at: '2026-10-04T09:30:00+05:30',
  duty_overdue: false,
};

describe('FuelRequestsApi', () => {
  let api: FuelRequestsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(FuelRequestsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists requests without filters', () => {
    let result: FuelRequest[] | undefined;
    api.list().subscribe((rows) => (result = rows));
    const req = http.expectOne('/api/fuel/requests/');
    expect(req.request.method).toBe('GET');
    req.flush([REQUEST]);
    expect(result?.[0].driver_name).toBe('Ramesh Babu');
  });

  it('sends every filter it is given and leaves empty ones out', () => {
    api.list({ status: 'FILLED', vehicle: 5, emergency: 'pending' }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/fuel/requests/');
    expect(req.request.params.get('status')).toBe('FILLED');
    expect(req.request.params.get('vehicle')).toBe('5');
    expect(req.request.params.get('emergency')).toBe('pending');
    req.flush([]);

    api.list({ from: '', to: '', status: undefined, vehicle: undefined }).subscribe();
    const bare = http.expectOne((r) => r.url === '/api/fuel/requests/');
    expect(bare.request.params.keys()).toEqual([]);
    bare.flush([]);
  });

  it('narrows the list to a period and, for the PTO, an office', () => {
    api.list({ from: '2026-09-28', to: '2026-10-04', unit: 2, status: 'FILLED' }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/fuel/requests/');
    expect(req.request.params.get('from')).toBe('2026-09-28');
    expect(req.request.params.get('to')).toBe('2026-10-04');
    expect(req.request.params.get('unit')).toBe('2');
    req.flush([]);
  });

  it('raises a request at the chosen pump with the litres and the emergency details', () => {
    api
      .create({
        pump: 7,
        litres: 12.5,
        is_emergency: true,
        emergency_reason: 'Stuck on the highway',
      })
      .subscribe();
    const req = http.expectOne('/api/fuel/requests/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      pump: 7,
      litres: 12.5,
      is_emergency: true,
      emergency_reason: 'Stuck on the highway',
    });
    req.flush({ ...REQUEST, status: 'ISSUED' }, { status: 201, statusText: 'Created' });
  });

  it('cancels a request', () => {
    api.cancel(14).subscribe();
    const req = http.expectOne('/api/fuel/requests/14/cancel/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ ...REQUEST, status: 'CANCELLED' });
  });

  it('submits the duty particulars under duty_particulars', () => {
    api.submitDuty(14, 'Escort duty, Nellore to Kavali').subscribe();
    const req = http.expectOne('/api/fuel/requests/14/duty/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ duty_particulars: 'Escort duty, Nellore to Kavali' });
    req.flush(REQUEST);
  });

  it('allows an emergency fill without a body', () => {
    api.allowEmergency(14).subscribe();
    const req = http.expectOne('/api/fuel/requests/14/allow-emergency/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ ...REQUEST, emergency_status: 'ALLOWED' });
  });

  it("reads the requests waiting at the operator's pump", () => {
    api.incoming().subscribe();
    const req = http.expectOne('/api/fuel/incoming/');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('checks the PIN of a waiting request, then fills it with the same PIN', () => {
    api.checkPin(14, '123456').subscribe();
    const check = http.expectOne('/api/fuel/incoming/14/check-pin/');
    expect(check.request.method).toBe('POST');
    expect(check.request.body).toEqual({ pin: '123456' });
    check.flush({});

    api.fill(14, '123456').subscribe();
    const fill = http.expectOne('/api/fuel/incoming/14/fill/');
    expect(fill.request.method).toBe('POST');
    expect(fill.request.body).toEqual({ pin: '123456' });
    fill.flush(REQUEST);
  });

  it('reads the fills of the operator’s pump, this month unless a period is given', () => {
    api.pumpFills().subscribe();
    const now = http.expectOne((r) => r.url === '/api/fuel/pump-fills/');
    expect(now.request.method).toBe('GET');
    expect(now.request.params.keys()).toEqual([]);
    now.flush([REQUEST]);

    api.pumpFills({ from: '2026-09-28', to: '2026-10-04' }).subscribe();
    const week = http.expectOne((r) => r.url === '/api/fuel/pump-fills/');
    expect(week.request.params.get('from')).toBe('2026-09-28');
    expect(week.request.params.get('to')).toBe('2026-10-04');
    week.flush([]);
  });
});
