import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';

/** The person holding an MTO office's chair login. */
export type UnitMto = {
  id: number;
  username: string;
  full_name: string;
  emp_id: string | null;
  mobile: string;
};

/** An MTO office. `mto` is null when the office has no chair login. */
export type Unit = {
  id: number;
  name: string;
  code: string;
  district: number;
  district_name: string;
  address: string;
  phone: string;
  mto: UnitMto | null;
};

/** The details of an office that the PTO may change. */
export type UnitChanges = Partial<Pick<Unit, 'name' | 'code' | 'district' | 'address' | 'phone'>>;

/** The person who holds an MTO chair; the password is the chair login's new password. */
export type HandoverPayload = {
  full_name: string;
  emp_id: string;
  designation: number;
  cadre: number;
  mobile: string;
  password: string;
};

/** A new MTO login: the holder's details plus the login ID. */
export type NewMtoAccount = HandoverPayload & { username: string };

export type UnitCreatePayload = {
  name: string;
  code: string;
  district: number;
  address?: string;
  phone?: string;
  mto_account: NewMtoAccount;
};

/** MTO offices. The PTO manages them; an MTO may read the list. */
@Service()
export class UnitsApi {
  private readonly http = inject(HttpClient);

  list(): Observable<Unit[]> {
    return this.http.get<Unit[]>('/api/units/');
  }

  /** Creates the office and its MTO login in one call. */
  create(payload: UnitCreatePayload): Observable<Unit> {
    return this.http.post<Unit>('/api/units/', payload);
  }

  update(id: number, changes: UnitChanges): Observable<Unit> {
    return this.http.patch<Unit>(`/api/units/${id}/`, changes);
  }

  /** Puts a new person in the office's MTO chair; the login ID stays, the password is reset. */
  handover(id: number, payload: HandoverPayload): Observable<Unit> {
    return this.http.post<Unit>(`/api/units/${id}/handover/`, payload);
  }
}
