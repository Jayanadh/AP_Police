import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';
import { LatLng } from '../geo';
import { FuelType } from './vehicles-api';

export type PumpKind = 'POLICE' | 'TIE_UP';

/** The stock of one fuel at a police pump, as the pump lists it. */
export type PumpTank = {
  id: number;
  fuel_type: FuelType;
  current_stock_litres: string;
  low_stock_threshold_litres: string;
  /** Null until the MTO sets the tank's size. */
  capacity_litres: string | null;
  is_low: boolean;
  /** Whether anything was recorded for the tank yet. Until then the MTO may set its opening stock, once. */
  opening_set: boolean;
};

/** A pump of the MTO's own office. Latitude and longitude arrive as strings. */
export type Pump = {
  id: number;
  name: string;
  kind: PumpKind;
  kind_label: string;
  address: string;
  district: number;
  district_name: string;
  latitude: string;
  longitude: string;
  opening_hours: string;
  sells_petrol: boolean;
  sells_diesel: boolean;
  is_active: boolean;
  /** Police pumps only; a tie-up bunk keeps no stock. */
  tanks: PumpTank[];
  /** Staff who are still on the team (not terminated or rejected). */
  staff_count: number;
};

/**
 * What the MTO sends to add or change a pump. Its district is the MTO office's, set by the server; whether it is
 * active is changed with activate/deactivate.
 */
export type PumpPayload = {
  name: string;
  kind: PumpKind;
  address: string;
  latitude: number;
  longitude: number;
  opening_hours: string;
  sells_petrol: boolean;
  sells_diesel: boolean;
};

/** A pump as anyone signed in sees it when looking for somewhere to fill up. */
export type DirectoryPump = {
  id: number;
  name: string;
  kind: PumpKind;
  kind_label: string;
  address: string;
  district_name: string;
  unit_name: string;
  latitude: string;
  longitude: string;
  opening_hours: string;
  sells_petrol: boolean;
  sells_diesel: boolean;
  /** Sold here and, at a police pump, in stock. */
  petrol_available: boolean;
  diesel_available: boolean;
};

export type DirectoryFilters = {
  search?: string;
  fuel?: FuelType;
};

/** Where a pump is, as numbers a map can use. A pump of the office and one from the directory both fit. */
export function pumpToPoint(pump: Pick<Pump, 'latitude' | 'longitude'>): LatLng {
  return { lat: Number(pump.latitude), lng: Number(pump.longitude) };
}

/** The fuels a pump sells, petrol first. A pump of the office and one from the directory both fit. */
export function pumpFuels(pump: Pick<Pump, 'sells_petrol' | 'sells_diesel'>): FuelType[] {
  const fuels: FuelType[] = [];
  if (pump.sells_petrol) {
    fuels.push('PETROL');
  }
  if (pump.sells_diesel) {
    fuels.push('DIESEL');
  }
  return fuels;
}

/** "Police Lines, Nellore": the address, with the district added when the address does not name it. */
export function pumpWhere(pump: Pick<DirectoryPump, 'address' | 'district_name'>): string {
  const address = pump.address.trim();
  const district = pump.district_name.trim();
  if (!address) {
    return district;
  }
  return !district || address.toLowerCase().includes(district.toLowerCase())
    ? address
    : `${address}, ${district}`;
}

/** How a pump is drawn on a map: a police pump in red, a tie-up bunk in amber. */
export function pumpTone(kind: PumpKind): 'police' | 'tieup' {
  return kind === 'TIE_UP' ? 'tieup' : 'police';
}

/** The pumps of the MTO's office, and the directory of every active pump in AP. */
@Service()
export class PumpsApi {
  private readonly http = inject(HttpClient);

  list(): Observable<Pump[]> {
    return this.http.get<Pump[]>('/api/pumps/');
  }

  get(id: number): Observable<Pump> {
    return this.http.get<Pump>(`/api/pumps/${id}/`);
  }

  create(payload: PumpPayload): Observable<Pump> {
    return this.http.post<Pump>('/api/pumps/', payload);
  }

  update(id: number, payload: Partial<PumpPayload>): Observable<Pump> {
    return this.http.patch<Pump>(`/api/pumps/${id}/`, payload);
  }

  /** Answers with the pump as it is now. */
  activate(id: number): Observable<Pump> {
    return this.http.post<Pump>(`/api/pumps/${id}/activate/`, {});
  }

  deactivate(id: number): Observable<Pump> {
    return this.http.post<Pump>(`/api/pumps/${id}/deactivate/`, {});
  }

  /** Every active pump in AP. Empty filters are left out of the request. */
  directory(filters: DirectoryFilters = {}): Observable<DirectoryPump[]> {
    let params = new HttpParams();
    if (filters.search) {
      params = params.set('search', filters.search);
    }
    if (filters.fuel) {
      params = params.set('fuel', filters.fuel);
    }
    return this.http.get<DirectoryPump[]>('/api/pump-directory/', { params });
  }
}
