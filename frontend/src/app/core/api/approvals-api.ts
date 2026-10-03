import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';

export type ApprovalKind = 'OFFICER_CREATE' | 'VEHICLE_TERMINATE';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type ApprovalOfficer = {
  id: number;
  full_name: string;
  emp_id: string | null;
  designation_name: string | null;
  mobile: string;
};

export type ApprovalVehicle = {
  id: number;
  registration_number: string;
  vehicle_type: string;
  make: string;
  model: string;
};

/** A request waiting for (or already given) a PTO decision. Exactly one of officer and vehicle is set. */
export type Approval = {
  id: number;
  kind: ApprovalKind;
  kind_label: string;
  unit: number;
  unit_name: string;
  status: ApprovalStatus;
  officer: ApprovalOfficer | null;
  vehicle: ApprovalVehicle | null;
  request_note: string;
  requested_by_name: string;
  requested_at: string;
  decision_note: string;
  decided_by_name: string | null;
  decided_at: string | null;
};

/** One status, or ALL for every request. */
export type ApprovalFilter = ApprovalStatus | 'ALL';

/** New-officer and vehicle-termination requests. The PTO decides; an MTO only reads their own. */
@Service()
export class ApprovalsApi {
  private readonly http = inject(HttpClient);

  list(status: ApprovalFilter = 'ALL'): Observable<Approval[]> {
    const params = status === 'ALL' ? new HttpParams() : new HttpParams().set('status', status);
    return this.http.get<Approval[]>('/api/approvals/', { params });
  }

  approve(id: number, note: string): Observable<Approval> {
    return this.http.post<Approval>(`/api/approvals/${id}/approve/`, { note });
  }

  /** The server refuses a rejection without a note. */
  reject(id: number, note: string): Observable<Approval> {
    return this.http.post<Approval>(`/api/approvals/${id}/reject/`, { note });
  }
}
