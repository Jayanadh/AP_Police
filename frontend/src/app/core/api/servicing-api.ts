import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';
import { formatDate, km } from '../format';

export type ServiceRecord = {
  id: number;
  vehicle: number;
  /** "YYYY-MM-DD". */
  service_date: string;
  odometer_km: number;
  notes: string;
  recorded_by_name: string;
  created_at: string;
};

/** What the MTO writes down for a service. */
export type ServicePayload = {
  service_date: string;
  odometer_km: number;
  notes: string;
};

/** Whether a vehicle is due for a service, with the figures behind it. A vehicle with no interval is never due. */
export type ServiceStatus = {
  due: boolean;
  /** "YYYY-MM-DD": the last service, or the day the vehicle was added. */
  last_service_date: string;
  last_service_km: number;
  km_since: number;
  days_since: number;
  next_due_km: number | null;
  next_due_date: string | null;
};

/** A row of the due list: the status of a vehicle that is due now. */
export type ServiceDue = ServiceStatus & {
  vehicle: number;
  registration_number: string;
};

/** "15,000 km or 28 Jan 2027": whichever of the two limits the vehicle has; empty when it has neither. */
export function nextDueLabel(status: Pick<ServiceStatus, 'next_due_km' | 'next_due_date'>): string {
  const parts = [
    status.next_due_km === null ? '' : km(status.next_due_km),
    status.next_due_date === null ? '' : formatDate(status.next_due_date),
  ];
  return parts.filter(Boolean).join(' or ');
}

@Service()
export class ServicingApi {
  private readonly http = inject(HttpClient);

  /** The services of a vehicle, newest first. */
  records(vehicleId: number): Observable<ServiceRecord[]> {
    return this.http.get<ServiceRecord[]>(`/api/vehicles/${vehicleId}/services/`);
  }

  add(vehicleId: number, payload: ServicePayload): Observable<ServiceRecord> {
    return this.http.post<ServiceRecord>(`/api/vehicles/${vehicleId}/services/`, payload);
  }

  status(vehicleId: number): Observable<ServiceStatus> {
    return this.http.get<ServiceStatus>(`/api/vehicles/${vehicleId}/service-status/`);
  }

  /** The vehicles of the MTO's office that are due for a service now. */
  due(): Observable<ServiceDue[]> {
    return this.http.get<ServiceDue[]>('/api/service-due/');
  }
}
