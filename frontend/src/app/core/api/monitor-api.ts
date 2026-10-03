import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';
import { FuelType, VehicleStatus } from './vehicles-api';
import { PersonStatus } from './people-api';

/** One page of a monitoring list: fifty rows at most. */
export type MonitorPage<T> = {
  count: number;
  page: number;
  pages: number;
  page_size: number;
  results: T[];
};

/** Someone linked to a vehicle now. */
export type MonitorLinkedPerson = {
  id: number;
  full_name: string;
  emp_id: string | null;
  mobile: string;
};

/** A vehicle as the PTO watches it. Litres arrive as strings such as "150.00". */
export type MonitorVehicle = {
  id: number;
  registration_number: string;
  vehicle_type: string;
  make: string;
  model: string;
  fuel_type: FuelType;
  unit: number;
  unit_name: string;
  status: VehicleStatus;
  status_label: string;
  driver: MonitorLinkedPerson | null;
  officer: MonitorLinkedPerson | null;
  /** This month: the limit with any additional quota, what was drawn and what is left (negative after emergencies). */
  limit_litres: string;
  used_litres: string;
  remaining_litres: string;
  /** The newest Sunday reading, if any. */
  last_odometer_km: number | null;
  last_odometer_week: string | null;
  service_due: boolean;
};

/** An officer or a driver as the PTO watches them. */
export type MonitorPerson = {
  id: number;
  full_name: string;
  emp_id: string | null;
  designation_name: string | null;
  unit: number | null;
  unit_name: string | null;
  status: PersonStatus;
  status_label: string;
  mobile: string;
  current_vehicles: { id: number; registration_number: string }[];
};

/** A driver also shows this month's fills and the duty particulars overdue past 48 hours. */
export type MonitorDriver = MonitorPerson & {
  licence_number: string;
  licence_valid_till: string | null;
  fills_this_month: number;
  litres_this_month: string;
  overdue_duty: number;
};

/** Narrows a list. Empty values and the first page are left out of the request. */
export type MonitorFilters = {
  unit?: number;
  status?: string;
  /** Part of the registration (vehicles), or of the name or Emp ID (people). */
  search?: string;
  page?: number;
};

export type MonitorPeopleKind = 'officers' | 'drivers';

function filterParams(filters: MonitorFilters): HttpParams {
  let params = new HttpParams();
  if (filters.unit !== undefined) {
    params = params.set('unit', String(filters.unit));
  }
  if (filters.status) {
    params = params.set('status', filters.status);
  }
  if (filters.search?.trim()) {
    params = params.set('search', filters.search.trim());
  }
  if (filters.page && filters.page > 1) {
    params = params.set('page', String(filters.page));
  }
  return params;
}

/** A list as an Excel file: everything its filters find, not one page. */
export function monitorExport(kind: 'vehicles' | MonitorPeopleKind): string {
  return `/api/monitor/${kind}/export/`;
}

/** The PTO's read-only lists of every office's vehicles, officers and drivers. */
@Service()
export class MonitorApi {
  private readonly http = inject(HttpClient);

  vehicles(filters: MonitorFilters = {}): Observable<MonitorPage<MonitorVehicle>> {
    return this.http.get<MonitorPage<MonitorVehicle>>('/api/monitor/vehicles/', {
      params: filterParams(filters),
    });
  }

  people(kind: 'drivers', filters?: MonitorFilters): Observable<MonitorPage<MonitorDriver>>;
  people(kind: MonitorPeopleKind, filters?: MonitorFilters): Observable<MonitorPage<MonitorPerson>>;
  people(
    kind: MonitorPeopleKind,
    filters: MonitorFilters = {},
  ): Observable<MonitorPage<MonitorPerson>> {
    return this.http.get<MonitorPage<MonitorPerson>>(`/api/monitor/${kind}/`, {
      params: filterParams(filters),
    });
  }
}
