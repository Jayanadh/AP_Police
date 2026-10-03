import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';

/** A dropdown value the PTO manages. Rows are deactivated, never deleted. */
export type MasterItem = {
  id: number;
  name: string;
  is_active: boolean;
};

export type MasterKind = 'districts' | 'designations' | 'cadres';

/** What the PTO may change on an item. */
export type MasterChanges = Partial<Pick<MasterItem, 'name' | 'is_active'>>;

/** The districts, designations and cadres. Anyone signed in may read; only the PTO changes them. */
@Service()
export class MastersApi {
  private readonly http = inject(HttpClient);

  /** Active items only by default, which is what a dropdown needs; pass false to also get inactive ones. */
  list(kind: MasterKind, activeOnly = true): Observable<MasterItem[]> {
    const suffix = activeOnly ? '?active=1' : '';
    return this.http.get<MasterItem[]>(`/api/masters/${kind}/${suffix}`);
  }

  create(kind: MasterKind, name: string): Observable<MasterItem> {
    return this.http.post<MasterItem>(`/api/masters/${kind}/`, { name });
  }

  update(kind: MasterKind, id: number, changes: MasterChanges): Observable<MasterItem> {
    return this.http.patch<MasterItem>(`/api/masters/${kind}/${id}/`, changes);
  }
}
