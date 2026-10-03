import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';

/** Additional quota the MTO added to a vehicle for a month. Litres arrive as strings such as "20.00". */
export type Grant = {
  id: number;
  vehicle: number;
  registration_number: string;
  /** "YYYY-MM". */
  month: string;
  litres: string;
  approved_by: string;
  note: string;
  /** Where the approval letter can be opened. */
  letter_url: string;
  created_by_name: string;
  created_at: string;
};

/** Narrows the list. Empty values are left out of the request. */
export type GrantFilters = {
  vehicle?: number;
  /** "YYYY-MM". */
  month?: string;
};

/** What is sent to add quota. The letter is mandatory: a JPG, PNG or PDF of at most 5 MB. */
export type GrantPayload = {
  vehicle: number;
  /** "YYYY-MM": this month or next month. */
  month: string;
  litres: number | string;
  approved_by: string;
  note: string;
  letter: File;
};

/** Additional fuel quota, added by the MTO with the approval letter attached. */
@Service()
export class GrantsApi {
  private readonly http = inject(HttpClient);

  list(filters: GrantFilters = {}): Observable<Grant[]> {
    let params = new HttpParams();
    if (filters.vehicle !== undefined) {
      params = params.set('vehicle', String(filters.vehicle));
    }
    if (filters.month) {
      params = params.set('month', filters.month);
    }
    return this.http.get<Grant[]>('/api/fuel/grants/', { params });
  }

  /** Sent as multipart form data, because of the letter file. */
  create(payload: GrantPayload): Observable<Grant> {
    const body = new FormData();
    body.append('vehicle', String(payload.vehicle));
    body.append('month', payload.month);
    body.append('litres', String(payload.litres));
    body.append('approved_by', payload.approved_by);
    body.append('note', payload.note);
    body.append('letter', payload.letter, payload.letter.name);
    return this.http.post<Grant>('/api/fuel/grants/', body);
  }

  /** The address of a grant's letter, on the page's own origin. */
  letterUrl(id: number): string {
    return `/api/fuel/grants/${id}/letter/`;
  }
}
