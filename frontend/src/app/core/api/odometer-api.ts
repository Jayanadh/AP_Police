import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';

const KOLKATA_DATE = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Kolkata',
});

/**
 * The Sunday a reading taken at `now` is for, "YYYY-MM-DD": the most recent Sunday on or before
 * today in Asia/Kolkata (a Sunday is its own week), as the server counts it.
 */
export function weekOf(now: Date = new Date()): string {
  const [year, month, day] = KOLKATA_DATE.format(now).split('-').map(Number);
  const today = new Date(Date.UTC(year, month - 1, day));
  today.setUTCDate(day - today.getUTCDay());
  return today.toISOString().slice(0, 10);
}

/** The Sunday reading of a vehicle. */
export type OdometerReading = {
  id: number;
  vehicle: number;
  registration_number: string;
  /** "YYYY-MM-DD": the Sunday the reading is for. */
  week_of: string;
  reading_km: number;
  /** Null for a vehicle's first reading. */
  km_since_previous: number | null;
  recorded_by_name: string;
  created_at: string;
};

/** A vehicle with a driver but no reading yet for this week. */
export type MissingReading = {
  vehicle: number;
  registration_number: string;
  driver_name: string;
  week_of: string;
};

@Service()
export class OdometerApi {
  private readonly http = inject(HttpClient);

  /** Readings, newest first: of one vehicle, or of every vehicle the caller can see. */
  list(vehicleId?: number): Observable<OdometerReading[]> {
    let params = new HttpParams();
    if (vehicleId !== undefined) {
      params = params.set('vehicle', String(vehicleId));
    }
    return this.http.get<OdometerReading[]>('/api/odometer/', { params });
  }

  /** For drivers: records this week's reading of their vehicle. */
  record(readingKm: number): Observable<OdometerReading> {
    return this.http.post<OdometerReading>('/api/odometer/', { reading_km: readingKm });
  }

  /** For the MTO: active vehicles with a driver but no reading this week. */
  missing(): Observable<MissingReading[]> {
    return this.http.get<MissingReading[]>('/api/odometer/missing/');
  }
}
