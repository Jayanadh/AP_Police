import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';
import { PumpKind } from './pumps-api';
import { FuelType } from './vehicles-api';

export type FuelRequestStatus = 'ISSUED' | 'FILLED' | 'CANCELLED' | 'EXPIRED';

/** `PENDING` waits for the MTO to allow it. `NONE` is a normal fill. */
export type EmergencyStatus = 'NONE' | 'PENDING' | 'ALLOWED';

/** A driver's request for fuel, as the driver, officer, MTO and pump staff see it. Litres arrive as strings. */
export type FuelRequest = {
  id: number;
  vehicle: number;
  registration_number: string;
  driver: number;
  driver_name: string;
  fuel_type: FuelType;
  litres_requested: string;
  is_emergency: boolean;
  emergency_reason: string;
  status: FuelRequestStatus;
  status_label: string;
  issued_at: string;
  expires_at: string;
  /** Shown only to the driver who raised the request, and only while it is open. */
  pin: string | null;
  failed_pin_attempts: number;
  cancel_reason: string;
  pump: number | null;
  pump_name: string | null;
  pump_kind: PumpKind | null;
  filled_at: string | null;
  litres_filled: string | null;
  /** The litres of the fill beyond what was left of the month's quota. */
  emergency_litres: string;
  emergency_status: EmergencyStatus;
  emergency_status_label: string;
  duty_particulars: string;
  duty_submitted_at: string | null;
  /** 48 hours after the fill; null until it is filled. */
  duty_due_at: string | null;
  duty_overdue: boolean;
};

/** Narrows the list. Empty values are left out of the request. */
export type FuelRequestFilters = {
  /**
   * With `to` ("YYYY-MM-DD", both days included): a filled request is listed on the day it was filled, any other
   * on the day it was raised.
   */
  from?: string;
  to?: string;
  /** For the PTO: one office's vehicles. */
  unit?: number;
  status?: FuelRequestStatus;
  vehicle?: number;
  emergency?: 'pending' | 'allowed';
};

/**
 * What a driver sends to raise a request: the pump that will fill it and the litres. The reason is needed when the
 * litres go beyond what is left.
 */
export type FuelRequestPayload = {
  pump: number;
  litres: number | string;
  is_emergency?: boolean;
  emergency_reason?: string;
};

/** A request waiting at the operator's pump: who is coming, but not the litres, which the PIN reveals. */
export type IncomingRequest = {
  id: number;
  vehicle: number;
  registration_number: string;
  /** Make and model, e.g. "Mahindra Bolero". */
  vehicle_name: string;
  driver_name: string;
  driver_mobile: string;
  fuel_type: FuelType;
  is_emergency: boolean;
  issued_at: string;
  expires_at: string;
};

/** The same request once the driver's PIN was right: the litres to fill. */
export type CheckedRequest = IncomingRequest & {
  litres_requested: string;
  emergency_reason: string;
};

/** Fuel requests, from raising one at a pump to filling it there, the duty particulars and allowing an emergency. */
@Service()
export class FuelRequestsApi {
  private readonly http = inject(HttpClient);

  list(filters: FuelRequestFilters = {}): Observable<FuelRequest[]> {
    let params = new HttpParams();
    if (filters.from && filters.to) {
      params = params.set('from', filters.from).set('to', filters.to);
    }
    if (filters.unit !== undefined) {
      params = params.set('unit', String(filters.unit));
    }
    if (filters.status) {
      params = params.set('status', filters.status);
    }
    if (filters.vehicle !== undefined) {
      params = params.set('vehicle', String(filters.vehicle));
    }
    if (filters.emergency) {
      params = params.set('emergency', filters.emergency);
    }
    return this.http.get<FuelRequest[]>('/api/fuel/requests/', { params });
  }

  /** For drivers: raises a request for their vehicle. The server answers 400 with a message when it is refused. */
  create(payload: FuelRequestPayload): Observable<FuelRequest> {
    return this.http.post<FuelRequest>('/api/fuel/requests/', payload);
  }

  /** For drivers: cancels their open request. */
  cancel(id: number): Observable<FuelRequest> {
    return this.http.post<FuelRequest>(`/api/fuel/requests/${id}/cancel/`, {});
  }

  /** For drivers: writes the duty particulars of a fill (within 48 hours of it). */
  submitDuty(id: number, text: string): Observable<FuelRequest> {
    return this.http.post<FuelRequest>(`/api/fuel/requests/${id}/duty/`, {
      duty_particulars: text,
    });
  }

  /** For the MTO: allows an emergency fill, which then counts against the month's additional quota. */
  allowEmergency(id: number): Observable<FuelRequest> {
    return this.http.post<FuelRequest>(`/api/fuel/requests/${id}/allow-emergency/`, {});
  }

  /** For pump staff: the requests drivers raised for their pump, oldest first. */
  incoming(): Observable<IncomingRequest[]> {
    return this.http.get<IncomingRequest[]>('/api/fuel/incoming/');
  }

  /** For pump staff: checks the driver's PIN and, when it is right, shows the litres. A wrong PIN counts. */
  checkPin(id: number, pin: string): Observable<CheckedRequest> {
    return this.http.post<CheckedRequest>(`/api/fuel/incoming/${id}/check-pin/`, { pin });
  }

  /** For pump staff: fills exactly the litres asked for. The PIN is checked again. */
  fill(id: number, pin: string): Observable<FuelRequest> {
    return this.http.post<FuelRequest>(`/api/fuel/incoming/${id}/fill/`, { pin });
  }

  /** For pump staff: the fills made at their pump in a period ("YYYY-MM-DD"; this month when none), newest first. */
  pumpFills(period?: { from: string; to: string }): Observable<FuelRequest[]> {
    let params = new HttpParams();
    if (period) {
      params = params.set('from', period.from).set('to', period.to);
    }
    return this.http.get<FuelRequest[]>('/api/fuel/pump-fills/', { params });
  }
}
