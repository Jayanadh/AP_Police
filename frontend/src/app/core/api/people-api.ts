import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';

/** The groups of people an MTO looks after. Each has its own endpoint under /api/. */
export type PersonKind = 'drivers' | 'officers' | 'pump-staff';

export type PersonStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'PAUSED' | 'TERMINATED' | 'REJECTED';

export type PersonAction = 'pause' | 'resume' | 'terminate';

/** A vehicle the person is linked to right now. */
export type PersonVehicle = {
  id: number;
  registration_number: string;
};

/**
 * A driver, officer or member of pump staff. The *_name fields and the licence fields are sent for
 * drivers and officers only; `pump` and `pump_name` for pump staff only.
 */
export type Person = {
  id: number;
  username: string;
  full_name: string;
  emp_id: string | null;
  designation: number | null;
  designation_name?: string;
  district: number | null;
  district_name?: string;
  cadre: number | null;
  cadre_name?: string;
  mobile: string;
  status: PersonStatus;
  status_label: string;
  licence_number?: string;
  /** "YYYY-MM-DD", or null when no date is held. */
  licence_valid_till?: string | null;
  pump?: number | null;
  pump_name?: string;
  current_vehicles: PersonVehicle[];
};

/**
 * What may be sent to create or change a person. `password` and `username` count on create only;
 * the server picks the login ID of a driver or officer from their Emp ID.
 */
export type PersonPayload = Partial<
  Pick<
    Person,
    | 'full_name'
    | 'emp_id'
    | 'designation'
    | 'district'
    | 'cadre'
    | 'mobile'
    | 'licence_number'
    | 'licence_valid_till'
    | 'pump'
  >
> & {
  username?: string;
  password?: string;
};

/** Narrows a list. Empty values are left out of the request. */
export type PersonFilters = {
  search?: string;
  status?: PersonStatus;
  /** Only people with no current vehicle. */
  unassigned?: boolean;
};

/** The MTO's drivers, officers and pump staff. Another office's people are invisible to the server. */
@Service()
export class PeopleApi {
  private readonly http = inject(HttpClient);

  list(kind: PersonKind, filters: PersonFilters = {}): Observable<Person[]> {
    let params = new HttpParams();
    if (filters.search) {
      params = params.set('search', filters.search);
    }
    if (filters.status) {
      params = params.set('status', filters.status);
    }
    if (filters.unassigned) {
      params = params.set('unassigned', '1');
    }
    return this.http.get<Person[]>(`/api/${kind}/`, { params });
  }

  /** A new officer starts as "Waiting for PTO approval"; drivers and pump staff start active. */
  create(kind: PersonKind, payload: PersonPayload): Observable<Person> {
    return this.http.post<Person>(`/api/${kind}/`, payload);
  }

  update(kind: PersonKind, id: number, payload: PersonPayload): Observable<Person> {
    return this.http.patch<Person>(`/api/${kind}/${id}/`, payload);
  }

  /** Answers with the person as they are now. */
  act(kind: PersonKind, id: number, action: PersonAction): Observable<Person> {
    return this.http.post<Person>(`/api/${kind}/${id}/${action}/`, {});
  }

  /** Sets a new password; the person must change it at their next login. */
  resetPassword(kind: PersonKind, id: number, password: string): Observable<void> {
    return this.http.post<void>(`/api/${kind}/${id}/reset-password/`, { password });
  }
}
