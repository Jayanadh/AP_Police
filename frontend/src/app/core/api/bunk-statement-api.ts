import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';
import { PumpKind } from './pumps-api';
import { FuelType } from './vehicles-api';

/** One fill at the bunk. Litres arrive as strings such as "40.00". */
export type BunkStatementRow = {
  id: number;
  filled_at: string;
  registration_number: string;
  unit_name: string;
  driver_name: string;
  fuel_type: FuelType;
  litres: string;
};

/** Every fill made at one pump in a period, in the order they were made, with the totals. */
export type BunkStatement = {
  from: string;
  to: string;
  /** How the period is said, e.g. "September 2026" or "28 Sep – 04 Oct 2026". */
  label: string;
  pump: { id: number; name: string; kind: PumpKind; kind_label: string; unit_name: string };
  fills: number;
  litres: string;
  petrol_litres: string;
  diesel_litres: string;
  rows: BunkStatementRow[];
};

/** A pump a statement can be drawn up for: the MTO's office's (closed ones too) or, for the PTO, any. */
export type StatementPump = {
  id: number;
  name: string;
  kind: PumpKind;
  kind_label: string;
  unit: number;
  unit_name: string;
  is_active: boolean;
};

/** The same statement as an Excel file. */
export const BUNK_STATEMENT_EXPORT = '/api/fuel/bunk-statement/export/';

/** Bunk statements: the record of what a police pump or tie-up bunk filled. Nothing is submitted or disputed. */
@Service()
export class BunkStatementApi {
  private readonly http = inject(HttpClient);

  /** For the MTO and PTO, `pump` is the one picked; pump staff leave it out and get their own. */
  get(period: { from: string; to: string }, pump?: number): Observable<BunkStatement> {
    let params = new HttpParams().set('from', period.from).set('to', period.to);
    if (pump !== undefined) {
      params = params.set('pump', String(pump));
    }
    return this.http.get<BunkStatement>('/api/fuel/bunk-statement/', { params });
  }

  /** The pumps to pick from; `unit` narrows the PTO's to one office. */
  pumps(unit?: number): Observable<StatementPump[]> {
    const params = unit === undefined ? undefined : new HttpParams().set('unit', String(unit));
    return this.http.get<StatementPump[]>('/api/fuel/bunk-statement/pumps/', { params });
  }
}
