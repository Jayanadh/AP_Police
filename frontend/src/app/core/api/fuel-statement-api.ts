import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';
import { FuelType } from './vehicles-api';

/** One office's fills in the period (PTO only). Litres arrive as strings such as "210.00". */
export type StatementUnitRow = {
  unit: number;
  unit_name: string;
  fills: number;
  litres: string;
  petrol_litres: string;
  diesel_litres: string;
  emergency_litres: string;
};

export type StatementVehicleRow = {
  vehicle: number;
  registration_number: string;
  fuel_type: FuelType;
  unit_name: string;
  fills: number;
  litres: string;
  emergency_litres: string;
};

export type StatementPumpRow = {
  pump: number;
  pump_name: string;
  pump_kind: 'POLICE' | 'TIE_UP';
  fills: number;
  litres: string;
};

/** How a police pump's tank moved: opening + received − dispensed + measured change = closing. */
export type StatementStockRow = {
  fuel_type: FuelType;
  opening_litres: string;
  received_litres: string;
  dispensed_litres: string;
  measured_change_litres: string;
  closing_litres: string;
};

/**
 * What was filled in a period, as the signed-in person sees it. A section the role does not get is null: offices
 * for the PTO only, vehicles for the PTO only once an office is picked, pumps for everyone but pump staff, and the
 * stock for police pump staff only.
 */
export type FuelStatement = {
  from: string;
  to: string;
  label: string;
  litres: string;
  fills: number;
  petrol_litres: string;
  diesel_litres: string;
  emergency_litres: string;
  by_unit: StatementUnitRow[] | null;
  by_vehicle: StatementVehicleRow[] | null;
  by_pump: StatementPumpRow[] | null;
  stock: StatementStockRow[] | null;
};

/** The same statement as an Excel file, every fill included. */
export const FUEL_STATEMENT_EXPORT = '/api/fuel/statement/export/';

/** Fuel statements of any period, for every role. */
@Service()
export class FuelStatementApi {
  private readonly http = inject(HttpClient);

  /** The statement of the period ("YYYY-MM-DD", both days included); `unit` narrows the PTO's to one office. */
  get(period: { from: string; to: string }, unit?: number): Observable<FuelStatement> {
    let params = new HttpParams().set('from', period.from).set('to', period.to);
    if (unit !== undefined) {
      params = params.set('unit', String(unit));
    }
    return this.http.get<FuelStatement>('/api/fuel/statement/', { params });
  }
}
