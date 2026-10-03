import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';

/** A vehicle's fuel for one month. Litres arrive as strings; `remaining_litres` and the balance may be negative. */
export type Quota = {
  /** "YYYY-MM". */
  month: string;
  base_litres: string;
  additional_litres: string;
  /** The monthly limit plus the additional quota. */
  limit_litres: string;
  used_litres: string;
  remaining_litres: string;
  emergency_used_litres: string;
  emergency_remaining_litres: string;
  additional_balance_litres: string;
};

@Service()
export class QuotaApi {
  private readonly http = inject(HttpClient);

  /** The quota of a vehicle for "YYYY-MM"; this month when none is given. */
  forVehicle(vehicleId: number, month?: string): Observable<Quota> {
    let params = new HttpParams();
    if (month) {
      params = params.set('month', month);
    }
    return this.http.get<Quota>(`/api/fuel/vehicles/${vehicleId}/quota/`, { params });
  }
}
