import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';

export type TransferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';

/** `incoming`: requests my office sent. `outgoing`: officers leaving my office, which I decide on. */
export type TransferDirection = 'incoming' | 'outgoing';

/** An officer of another office, as the new MTO sees them before asking for them. */
export type OfficerLookup = {
  id: number;
  full_name: string;
  emp_id: string;
  designation_name: string | null;
  unit: number;
  unit_name: string;
};

/** A request to move an officer from one MTO office to another. */
export type Transfer = {
  id: number;
  officer: number;
  officer_name: string;
  officer_emp_id: string;
  from_unit: number;
  from_unit_name: string;
  to_unit: number;
  to_unit_name: string;
  note: string;
  status: TransferStatus;
  requested_at: string;
  decided_at: string | null;
};

/** Officer transfers. The new office asks; the officer's current office accepts or rejects. */
@Service()
export class TransfersApi {
  private readonly http = inject(HttpClient);

  /** Finds an active or paused officer of another office. The server answers 404 with a message when there is none. */
  lookup(empId: string): Observable<OfficerLookup> {
    const params = new HttpParams().set('emp_id', empId);
    return this.http.get<OfficerLookup>('/api/officers/lookup/', { params });
  }

  list(direction: TransferDirection): Observable<Transfer[]> {
    const params = new HttpParams().set('direction', direction);
    return this.http.get<Transfer[]>('/api/transfers/', { params });
  }

  request(officerId: number, note: string): Observable<Transfer> {
    return this.http.post<Transfer>('/api/transfers/', { officer: officerId, note });
  }

  /** The officer's current office agrees: the officer moves and their vehicle links end. */
  accept(id: number): Observable<Transfer> {
    return this.http.post<Transfer>(`/api/transfers/${id}/accept/`, {});
  }

  /** The officer's current office refuses. */
  reject(id: number): Observable<Transfer> {
    return this.http.post<Transfer>(`/api/transfers/${id}/reject/`, {});
  }

  /** The office that asked takes its request back. */
  cancel(id: number): Observable<Transfer> {
    return this.http.post<Transfer>(`/api/transfers/${id}/cancel/`, {});
  }
}
