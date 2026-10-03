import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  Assignment,
  fuelLabel,
  MyVehicles,
  Vehicle,
  VehiclePayload,
  VehiclesApi,
  vehicleTypeLabel,
} from './vehicles-api';

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
  current_officer: null,
  current_driver: null,
  created_at: '2026-09-01T10:00:00+05:30',
  ...overrides,
});

const PAYLOAD: VehiclePayload = {
  registration_number: 'AP39PA1234',
  vehicle_type: 'JEEP',
  make: 'Mahindra',
  model: 'Bolero',
  year_of_manufacture: 2022,
  fuel_type: 'DIESEL',
  tank_capacity_litres: 60,
  chassis_number: 'CH123',
  engine_number: 'EN456',
  odometer_at_onboarding_km: 1200,
  monthly_fuel_limit_litres: 120,
  service_interval_km: 5000,
  service_interval_days: 180,
};

describe('VehiclesApi', () => {
  let api: VehiclesApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(VehiclesApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the vehicles with no filters', () => {
    let result: Vehicle[] = [];
    api.list().subscribe((rows) => (result = rows));
    const req = http.expectOne('/api/vehicles/');
    expect(req.request.method).toBe('GET');
    req.flush([vehicle()]);
    expect(result.map((row) => row.registration_number)).toEqual(['AP39PA1234']);
  });

  it('sends the search and status filters as query parameters', () => {
    api.list({ search: 'pa12', status: 'PAUSED' }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/vehicles/');
    expect(req.request.params.get('search')).toBe('pa12');
    expect(req.request.params.get('status')).toBe('PAUSED');
    req.flush([]);
  });

  it('leaves out filters that are empty', () => {
    api.list({ search: '', status: undefined }).subscribe();
    const req = http.expectOne('/api/vehicles/');
    expect(req.request.params.keys()).toEqual([]);
    req.flush([]);
  });

  it('reads one vehicle', () => {
    api.get(5).subscribe();
    const req = http.expectOne('/api/vehicles/5/');
    expect(req.request.method).toBe('GET');
    req.flush(vehicle());
  });

  it('creates a vehicle with a POST', () => {
    let created: Vehicle | undefined;
    api.create(PAYLOAD).subscribe((row) => (created = row));
    const req = http.expectOne('/api/vehicles/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(PAYLOAD);
    req.flush(vehicle());
    expect(created?.id).toBe(5);
  });

  it('changes a vehicle with a PATCH', () => {
    api.update(5, { make: 'Tata' }).subscribe();
    const req = http.expectOne('/api/vehicles/5/');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ make: 'Tata' });
    req.flush(vehicle({ make: 'Tata' }));
  });

  it('pauses and resumes a vehicle', () => {
    api.pause(5).subscribe();
    const pause = http.expectOne('/api/vehicles/5/pause/');
    expect(pause.request.method).toBe('POST');
    expect(pause.request.body).toEqual({});
    pause.flush(vehicle({ status: 'PAUSED' }));

    api.resume(5).subscribe();
    const resume = http.expectOne('/api/vehicles/5/resume/');
    expect(resume.request.method).toBe('POST');
    resume.flush(vehicle());
  });

  it('asks the PTO to terminate a vehicle, with a note', () => {
    api.requestTermination(5, 'Beyond repair').subscribe();
    const req = http.expectOne('/api/vehicles/5/request-termination/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ note: 'Beyond repair' });
    req.flush(vehicle({ status: 'TERMINATION_PENDING' }));
  });

  it('lists the links of a vehicle', () => {
    api.assignments(5).subscribe();
    const req = http.expectOne('/api/vehicles/5/assignments/');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('links a person to a vehicle', () => {
    let link: Assignment | undefined;
    api.assign(5, 31).subscribe((row) => (link = row));
    const req = http.expectOne('/api/vehicles/5/assignments/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ person: 31 });
    req.flush({
      id: 9,
      vehicle: 5,
      person: 31,
      person_name: 'Ramesh Babu',
      person_emp_id: 'AP4001',
      kind: 'DRIVER',
      started_at: '2026-10-02T10:00:00+05:30',
      ended_at: null,
      assigned_by_name: 'MTO Nellore',
      ended_by_name: null,
    });
    expect(link?.person_name).toBe('Ramesh Babu');
  });

  it('ends a link', () => {
    api.endAssignment(9).subscribe();
    const req = http.expectOne('/api/assignments/9/end/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({});
  });

  it('reads the vehicles of the signed-in officer or driver, and who to call', () => {
    let mine: MyVehicles | undefined;
    api.myVehicles().subscribe((body) => (mine = body));
    const req = http.expectOne('/api/me/vehicles/');
    expect(req.request.method).toBe('GET');
    req.flush({
      vehicles: [vehicle()],
      mto: { unit_name: 'MTO Nellore', full_name: 'Chair', mobile: '9000000001' },
    });
    expect(mine?.vehicles).toHaveLength(1);
    expect(mine?.mto.unit_name).toBe('MTO Nellore');
  });
});

describe('vehicle labels', () => {
  it('names the fuel types', () => {
    expect(fuelLabel('PETROL')).toBe('Petrol');
    expect(fuelLabel('DIESEL')).toBe('Diesel');
  });

  it('names the vehicle types', () => {
    expect(vehicleTypeLabel('MOTORCYCLE')).toBe('Motorcycle');
    expect(vehicleTypeLabel('JEEP')).toBe('Jeep');
  });
});
