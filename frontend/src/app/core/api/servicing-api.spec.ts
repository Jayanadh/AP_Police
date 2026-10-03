import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  nextDueLabel,
  ServiceDue,
  ServiceRecord,
  ServicingApi,
  ServiceStatus,
} from './servicing-api';

const STATUS: ServiceStatus = {
  due: false,
  last_service_date: '2026-08-01',
  last_service_km: 10000,
  km_since: 2480,
  days_since: 62,
  next_due_km: 15000,
  next_due_date: '2027-01-28',
};

describe('ServicingApi', () => {
  let api: ServicingApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ServicingApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the service records of a vehicle', () => {
    let rows: ServiceRecord[] = [];
    api.records(5).subscribe((result) => (rows = result));
    const req = http.expectOne('/api/vehicles/5/services/');
    expect(req.request.method).toBe('GET');
    req.flush([
      {
        id: 2,
        vehicle: 5,
        service_date: '2026-08-01',
        odometer_km: 10000,
        notes: 'Oil change',
        recorded_by_name: 'MTO Nellore',
        created_at: '2026-08-01T11:00:00+05:30',
      },
    ]);
    expect(rows[0].notes).toBe('Oil change');
  });

  it('adds a service record', () => {
    const payload = { service_date: '2026-10-01', odometer_km: 12500, notes: 'Brake pads' };
    api.add(5, payload).subscribe();
    const req = http.expectOne('/api/vehicles/5/services/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush({});
  });

  it('reads the service status of a vehicle', () => {
    let result: ServiceStatus | undefined;
    api.status(5).subscribe((row) => (result = row));
    const req = http.expectOne('/api/vehicles/5/service-status/');
    expect(req.request.method).toBe('GET');
    req.flush(STATUS);
    expect(result?.next_due_km).toBe(15000);
  });

  it('lists the vehicles that are due for a service', () => {
    let rows: ServiceDue[] = [];
    api.due().subscribe((result) => (rows = result));
    const req = http.expectOne('/api/service-due/');
    expect(req.request.method).toBe('GET');
    req.flush([{ vehicle: 5, registration_number: 'AP39PA1234', ...STATUS, due: true }]);
    expect(rows[0].registration_number).toBe('AP39PA1234');
    expect(rows[0].due).toBe(true);
  });
});

describe('nextDueLabel', () => {
  it('names whichever of the two limits the vehicle has', () => {
    expect(nextDueLabel(STATUS)).toBe('15,000 km or 28 Jan 2027');
    expect(nextDueLabel({ ...STATUS, next_due_date: null })).toBe('15,000 km');
    expect(nextDueLabel({ ...STATUS, next_due_km: null })).toBe('28 Jan 2027');
  });

  it('is empty for a vehicle with no interval', () => {
    expect(nextDueLabel({ ...STATUS, next_due_km: null, next_due_date: null })).toBe('');
  });
});
