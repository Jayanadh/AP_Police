import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';

export type VehicleStatus = 'ACTIVE' | 'PAUSED' | 'TERMINATION_PENDING' | 'TERMINATED';

export type VehicleType = 'CAR' | 'JEEP' | 'MOTORCYCLE' | 'VAN' | 'BUS' | 'TRUCK' | 'OTHER';

export type FuelType = 'PETROL' | 'DIESEL';

type Option<T> = { value: T; label: string };

/** The vehicle types, as they are offered and shown. */
export const VEHICLE_TYPES: readonly Option<VehicleType>[] = [
  { value: 'CAR', label: 'Car' },
  { value: 'JEEP', label: 'Jeep' },
  { value: 'MOTORCYCLE', label: 'Motorcycle' },
  { value: 'VAN', label: 'Van' },
  { value: 'BUS', label: 'Bus' },
  { value: 'TRUCK', label: 'Truck' },
  { value: 'OTHER', label: 'Other' },
];

export const FUEL_TYPES: readonly Option<FuelType>[] = [
  { value: 'PETROL', label: 'Petrol' },
  { value: 'DIESEL', label: 'Diesel' },
];

export function vehicleTypeLabel(type: VehicleType): string {
  return VEHICLE_TYPES.find((option) => option.value === type)?.label ?? type;
}

export function fuelLabel(fuel: FuelType): string {
  return FUEL_TYPES.find((option) => option.value === fuel)?.label ?? fuel;
}

/** Who is linked to a vehicle now, with the id of the link (to end it). */
export type LinkedPerson = {
  assignment_id: number;
  id: number;
  full_name: string;
  emp_id: string | null;
  mobile: string;
};

/** A vehicle. Litres arrive as strings such as "60.00". */
export type Vehicle = {
  id: number;
  registration_number: string;
  vehicle_type: VehicleType;
  make: string;
  model: string;
  year_of_manufacture: number | null;
  fuel_type: FuelType;
  tank_capacity_litres: string;
  chassis_number: string;
  engine_number: string;
  odometer_at_onboarding_km: number;
  monthly_fuel_limit_litres: string;
  service_interval_km: number | null;
  service_interval_days: number | null;
  status: VehicleStatus;
  status_label: string;
  current_officer: LinkedPerson | null;
  current_driver: LinkedPerson | null;
  created_at: string;
};

/** What is sent to add or change a vehicle. The server normalizes the registration number. */
export type VehiclePayload = {
  registration_number: string;
  vehicle_type: VehicleType;
  make: string;
  model: string;
  year_of_manufacture: number | null;
  fuel_type: FuelType;
  tank_capacity_litres: number;
  chassis_number: string;
  engine_number: string;
  odometer_at_onboarding_km: number;
  monthly_fuel_limit_litres: number;
  service_interval_km: number | null;
  service_interval_days: number | null;
};

/** Narrows the list. Empty values are left out of the request. */
export type VehicleFilters = {
  /** Part of a registration number. */
  search?: string;
  status?: VehicleStatus;
};

/** A link between a vehicle and an officer or driver, current (no `ended_at`) or ended. */
export type Assignment = {
  id: number;
  vehicle: number;
  person: number;
  person_name: string;
  person_emp_id: string | null;
  kind: 'OFFICER' | 'DRIVER';
  started_at: string;
  ended_at: string | null;
  assigned_by_name: string;
  ended_by_name: string | null;
};

/** A vehicle as its officer or driver sees it. */
export type MyVehicle = Vehicle & {
  /** The lowest odometer reading it may take next: the highest on record. */
  latest_odometer_km: number;
};

/** The vehicles of a signed-in officer or driver, and who to call at their MTO office. */
export type MyVehicles = {
  vehicles: MyVehicle[];
  mto: { unit_name: string; full_name: string | null; mobile: string | null };
};

/** The MTO's vehicles, and the links between them and officers and drivers. */
/** A vehicle's link history as an Excel file: drivers and officers on their own sheets. */
export function linkHistoryExport(id: number): string {
  return `/api/vehicles/${id}/assignments/export/`;
}

@Service()
export class VehiclesApi {
  private readonly http = inject(HttpClient);

  list(filters: VehicleFilters = {}): Observable<Vehicle[]> {
    let params = new HttpParams();
    if (filters.search) {
      params = params.set('search', filters.search);
    }
    if (filters.status) {
      params = params.set('status', filters.status);
    }
    return this.http.get<Vehicle[]>('/api/vehicles/', { params });
  }

  get(id: number): Observable<Vehicle> {
    return this.http.get<Vehicle>(`/api/vehicles/${id}/`);
  }

  create(payload: VehiclePayload): Observable<Vehicle> {
    return this.http.post<Vehicle>('/api/vehicles/', payload);
  }

  update(id: number, payload: Partial<VehiclePayload>): Observable<Vehicle> {
    return this.http.patch<Vehicle>(`/api/vehicles/${id}/`, payload);
  }

  pause(id: number): Observable<Vehicle> {
    return this.http.post<Vehicle>(`/api/vehicles/${id}/pause/`, {});
  }

  resume(id: number): Observable<Vehicle> {
    return this.http.post<Vehicle>(`/api/vehicles/${id}/resume/`, {});
  }

  /** Sends the vehicle to the PTO for termination; it shows as "Termination pending" meanwhile. */
  requestTermination(id: number, note: string): Observable<Vehicle> {
    return this.http.post<Vehicle>(`/api/vehicles/${id}/request-termination/`, { note });
  }

  /** Every link of the vehicle, current and ended, newest first. See `linkHistoryExport` for the Excel file. */
  assignments(id: number): Observable<Assignment[]> {
    return this.http.get<Assignment[]>(`/api/vehicles/${id}/assignments/`);
  }

  /** Links an officer or driver of the same office to the vehicle. */
  assign(id: number, personId: number): Observable<Assignment> {
    return this.http.post<Assignment>(`/api/vehicles/${id}/assignments/`, { person: personId });
  }

  endAssignment(assignmentId: number): Observable<Assignment> {
    return this.http.post<Assignment>(`/api/assignments/${assignmentId}/end/`, {});
  }

  /** For officers and drivers: the vehicles they are linked to now. */
  myVehicles(): Observable<MyVehicles> {
    return this.http.get<MyVehicles>('/api/me/vehicles/');
  }
}
