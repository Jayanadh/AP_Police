import { HttpTestingController } from '@angular/common/http/testing';
import { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { onTestFinished, vi } from 'vitest';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { BunkStatement } from './api/bunk-statement-api';
import { FuelRequest } from './api/fuel-requests-api';
import { FuelStatement } from './api/fuel-statement-api';
import { MonitorDriver, MonitorPage, MonitorPerson, MonitorVehicle } from './api/monitor-api';
import { Tank } from './api/tanks-api';
import { Trip } from './api/tracking-api';
import { MyVehicle, Vehicle } from './api/vehicles-api';
import { AuthStore, Me } from './auth-store';
import { NOW } from './clock';

/** A signed-in MTO chair by default; override only what a test cares about. */
export function makeMe(overrides: Partial<Me> = {}): Me {
  return {
    id: 7,
    username: 'mto.vijayawada',
    full_name: 'Ravi Kumar',
    emp_id: 'AP1001',
    role: 'MTO',
    status: 'ACTIVE',
    unit: 3,
    unit_name: 'MTO Vijayawada',
    designation_name: 'Inspector',
    district_name: 'NTR',
    cadre_name: 'Civil',
    mobile: '9876543210',
    must_change_password: false,
    pump: null,
    pump_name: null,
    pump_kind: null,
    ...overrides,
  };
}

/**
 * Puts `user` (or nobody) into AuthStore through its real session call. The TestBed needs
 * provideHttpClient() and provideHttpClientTesting().
 */
export async function signInAs(user: Me | null): Promise<void> {
  const loaded = TestBed.inject(AuthStore).loadSession();
  TestBed.inject(HttpTestingController).expectOne('/api/auth/session/').flush({ user });
  await loaded;
}

/** A vehicle as its driver or officer sees it, with the lowest odometer reading it may take next. */
export function makeMyVehicle(overrides: Partial<MyVehicle> = {}): MyVehicle {
  const vehicle = makeVehicle(overrides);
  return { latest_odometer_km: vehicle.odometer_at_onboarding_km, ...vehicle, ...overrides };
}

/** An active diesel jeep with no one linked; override only what a test cares about. */
export function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
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
  };
}

/** A normal (not emergency) fill whose duty particulars are still to come; override what a test cares about. */
export function makeFuelRequest(overrides: Partial<FuelRequest> = {}): FuelRequest {
  return {
    id: 14,
    vehicle: 5,
    registration_number: 'AP39PA1234',
    driver: 31,
    driver_name: 'Ramesh Babu',
    fuel_type: 'DIESEL',
    litres_requested: '20.00',
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
    filled_at: '2026-10-02T14:05:00+05:30',
    litres_filled: '20.00',
    emergency_litres: '0.00',
    emergency_status: 'NONE',
    emergency_status_label: 'Not an emergency',
    duty_particulars: '',
    duty_submitted_at: null,
    duty_due_at: '2026-10-04T14:05:00+05:30',
    duty_overdue: false,
    ...overrides,
  };
}

/** A diesel tank at the Nellore police pump with plenty in stock; override what a test cares about. */
export function makeTank(overrides: Partial<Tank> = {}): Tank {
  return {
    id: 2,
    pump: 3,
    pump_name: 'Nellore Police Pump',
    fuel_type: 'DIESEL',
    current_stock_litres: '640.00',
    low_stock_threshold_litres: '100.00',
    capacity_litres: '5000.00',
    is_low: false,
    opening_set: true,
    ...overrides,
  };
}

/** The Kavali tie-up bunk's statement of September 2026: two fills, 65.50 L. */
export function makeBunkStatement(overrides: Partial<BunkStatement> = {}): BunkStatement {
  return {
    from: '2026-09-01',
    to: '2026-09-30',
    label: 'September 2026',
    pump: {
      id: 4,
      name: 'Kavali Bunk',
      kind: 'TIE_UP',
      kind_label: 'Tie-up bunk',
      unit_name: 'MTO Nellore',
    },
    fills: 2,
    litres: '65.50',
    petrol_litres: '25.50',
    diesel_litres: '40.00',
    rows: [
      {
        id: 31,
        filled_at: '2026-09-03T10:00:00+05:30',
        registration_number: 'AP07PB2001',
        unit_name: 'Guntur MTO',
        driver_name: 'G. Prasad',
        fuel_type: 'PETROL',
        litres: '25.50',
      },
      {
        id: 32,
        filled_at: '2026-09-20T10:00:00+05:30',
        registration_number: 'AP39PA1001',
        unit_name: 'MTO Nellore',
        driver_name: 'Ravi Kumar',
        fuel_type: 'DIESEL',
        litres: '40.00',
      },
    ],
    ...overrides,
  };
}

/** An MTO's statement of the week of 28 Sep 2026: 60 L in three fills, two vehicles at two pumps. */
export function makeFuelStatement(overrides: Partial<FuelStatement> = {}): FuelStatement {
  return {
    from: '2026-09-28',
    to: '2026-10-04',
    label: '28 Sep – 04 Oct 2026',
    litres: '60.00',
    fills: 3,
    petrol_litres: '30.00',
    diesel_litres: '30.00',
    emergency_litres: '4.00',
    by_unit: null,
    by_vehicle: [
      {
        vehicle: 1,
        registration_number: 'AP39PA1001',
        fuel_type: 'PETROL',
        unit_name: 'MTO Nellore',
        fills: 2,
        litres: '30.00',
        emergency_litres: '4.00',
      },
      {
        vehicle: 2,
        registration_number: 'AP39PA1002',
        fuel_type: 'DIESEL',
        unit_name: 'MTO Nellore',
        fills: 1,
        litres: '30.00',
        emergency_litres: '0.00',
      },
    ],
    by_pump: [
      { pump: 5, pump_name: 'Trunk Road Bunk', pump_kind: 'TIE_UP', fills: 2, litres: '40.00' },
      { pump: 4, pump_name: 'Nellore Police Pump', pump_kind: 'POLICE', fills: 1, litres: '20.00' },
    ],
    stock: null,
    ...overrides,
  };
}

/** A Nellore Bolero as the PTO watches it: driver and officer linked, 40 of 180 L used, a reading, service due. */
export function makeMonitorVehicle(overrides: Partial<MonitorVehicle> = {}): MonitorVehicle {
  return {
    id: 1,
    registration_number: 'AP39PA1001',
    vehicle_type: 'JEEP',
    make: 'Mahindra',
    model: 'Bolero',
    fuel_type: 'DIESEL',
    unit: 3,
    unit_name: 'SPSR Nellore MTO',
    status: 'ACTIVE',
    status_label: 'Active',
    driver: { id: 5, full_name: 'Ravi Kumar', emp_id: 'AP4001', mobile: '9876543210' },
    officer: { id: 3, full_name: 'S. Venkata Rao', emp_id: 'AP3001', mobile: '' },
    limit_litres: '180.00',
    used_litres: '40.00',
    remaining_litres: '140.00',
    last_odometer_km: 12480,
    last_odometer_week: '2026-09-27',
    service_due: true,
    ...overrides,
  };
}

/** An active Nellore officer with one vehicle, as the PTO watches them. */
export function makeMonitorPerson(overrides: Partial<MonitorPerson> = {}): MonitorPerson {
  return {
    id: 3,
    full_name: 'S. Venkata Rao',
    emp_id: 'AP3001',
    designation_name: 'Inspector of Police',
    unit: 3,
    unit_name: 'SPSR Nellore MTO',
    status: 'ACTIVE',
    status_label: 'Active',
    mobile: '9876543210',
    current_vehicles: [{ id: 1, registration_number: 'AP39PA1001' }],
    ...overrides,
  };
}

/** An active Nellore driver with this month's fills and one overdue duty particulars. */
export function makeMonitorDriver(overrides: Partial<MonitorDriver> = {}): MonitorDriver {
  return {
    ...makeMonitorPerson({
      id: 5,
      full_name: 'Ravi Kumar',
      emp_id: 'AP4001',
      designation_name: 'Police Constable',
    }),
    licence_number: 'AP0420190012345',
    licence_valid_till: '2029-05-31',
    fills_this_month: 2,
    litres_this_month: '48.00',
    overdue_duty: 1,
    ...overrides,
  };
}

/** One page of a monitoring list holding `results`. */
export function monitorPage<T>(
  results: T[],
  overrides: Partial<MonitorPage<T>> = {},
): MonitorPage<T> {
  return { count: results.length, page: 1, pages: 1, page_size: 50, results, ...overrides };
}

/** A driver's open trip, last seen a minute ago; override only what a test cares about. */
export function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 41,
    driver: 12,
    driver_name: 'Ravi Kumar',
    vehicle: 5,
    registration_number: 'AP39PA1001',
    duty_particulars: 'Night patrol, Kavali highway',
    started_at: '2026-10-04T09:00:00+05:30',
    ended_at: null,
    end_reason: '',
    last_point_at: '2026-10-04T09:59:00+05:30',
    latitude: 14.4426,
    longitude: 79.9865,
    accuracy_m: 8,
    is_open: true,
    ...overrides,
  };
}

/**
 * Makes the components read `read()` as the current moment (an ISO string), so a spec does not depend on the hour it
 * runs at. The function is read on every use: a spec may move the moment before it sets up a page.
 */
export function fixedClock(read: () => string): Provider {
  return { provide: NOW, useValue: () => new Date(read()) };
}

/**
 * Lets a spec press a Download button: its question is answered yes, and the browser's file saving is stubbed out
 * for this test and put back after it, whether it passes or fails.
 */
export function stubFileSaving(): void {
  const ask = vi.spyOn(ConfirmDialog.prototype, 'ask').mockResolvedValue(true);
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:file',
    revokeObjectURL: () => undefined,
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  onTestFinished(() => {
    vi.unstubAllGlobals();
    click.mockRestore();
    ask.mockRestore();
  });
}
