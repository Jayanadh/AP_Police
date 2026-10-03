import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';
import { FuelType } from './vehicles-api';

/** A police pump tank on its own. Litres arrive as strings such as "450.00". */
export type Tank = {
  id: number;
  pump: number;
  pump_name: string;
  fuel_type: FuelType;
  current_stock_litres: string;
  low_stock_threshold_litres: string;
  /** Null until the MTO sets the tank's size. */
  capacity_litres: string | null;
  is_low: boolean;
  /** When the stock was last set by a morning measurement; null before the first one. */
  last_measured_at: string | null;
};

export type StockEntryKind = 'MEASUREMENT' | 'TANKER_RECEIPT' | 'DISPENSE';

/** One line of a tank's stock ledger. */
export type StockEntry = {
  id: number;
  kind: StockEntryKind;
  kind_label: string;
  litres: string;
  stock_before: string;
  stock_after: string;
  note: string;
  recorded_by_name: string;
  recorded_at: string;
};

/** The only things the MTO may change on a tank. */
export type TankChanges = Partial<{
  low_stock_threshold_litres: number;
  capacity_litres: number | null;
}>;

/** What a level bar needs to know about a tank. */
export type TankLevels = Pick<
  Tank,
  'current_stock_litres' | 'low_stock_threshold_litres' | 'capacity_litres'
>;

/** How many times the alert level the bar spans for a tank whose size is not set. */
const ALERT_LEVELS_PER_BAR = 10;

/**
 * How full a tank is, 0 to 100, for a level bar: the stock as a share of the capacity. A tank with no
 * capacity set is measured against ten times its alert level instead, so its bar still moves.
 */
export function tankLevelPercent(tank: TankLevels): number {
  const stock = Number(tank.current_stock_litres);
  const capacity = Number(tank.capacity_litres);
  const threshold = Number(tank.low_stock_threshold_litres);
  let whole: number;
  if (tank.capacity_litres !== null && capacity > 0) {
    whole = capacity;
  } else if (threshold > 0) {
    whole = threshold * ALERT_LEVELS_PER_BAR;
  } else {
    return stock > 0 ? 100 : 0;
  }
  return Math.min(100, Math.max(0, (stock / whole) * 100));
}

/**
 * The tanks of police pumps and their stock ledger. The MTO reads them and sets their alert level;
 * measuring and receiving stock is the pump staff's job.
 */
@Service()
export class TanksApi {
  private readonly http = inject(HttpClient);

  list(): Observable<Tank[]> {
    return this.http.get<Tank[]>('/api/tanks/');
  }

  get(id: number): Observable<Tank> {
    return this.http.get<Tank>(`/api/tanks/${id}/`);
  }

  update(id: number, changes: TankChanges): Observable<Tank> {
    return this.http.patch<Tank>(`/api/tanks/${id}/`, changes);
  }

  /** The morning measurement: sets the stock. */
  measure(id: number, litres: number, note: string): Observable<Tank> {
    return this.http.post<Tank>(`/api/tanks/${id}/measure/`, { litres, note });
  }

  /** A tanker delivery: adds to the stock. */
  receive(id: number, litres: number, note: string): Observable<Tank> {
    return this.http.post<Tank>(`/api/tanks/${id}/receive/`, { litres, note });
  }

  /** The stock entries of one month, "YYYY-MM", newest first. */
  entries(id: number, month: string): Observable<StockEntry[]> {
    return this.http.get<StockEntry[]>(`/api/tanks/${id}/entries/?month=${month}`);
  }
}
