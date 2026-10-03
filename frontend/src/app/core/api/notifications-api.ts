import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map, Observable, Subject, tap } from 'rxjs';

export type AppNotification = {
  id: number;
  title: string;
  body: string;
  /** A frontend route such as /mto/emergencies, or empty. */
  link: string;
  created_at: string;
  read_at: string | null;
};

/** The signed-in user's own alerts. */
@Service()
export class NotificationsApi {
  private readonly http = inject(HttpClient);
  private readonly changed = new Subject<void>();

  /** Emits after alerts are marked read, so the unread badge can refresh at once. */
  readonly changes$ = this.changed.asObservable();

  list(): Observable<AppNotification[]> {
    return this.http.get<AppNotification[]>('/api/notifications/');
  }

  unreadCount(): Observable<number> {
    return this.http
      .get<{ count: number }>('/api/notifications/unread-count/')
      .pipe(map((response) => response.count));
  }

  markRead(id: number): Observable<AppNotification> {
    return this.http
      .post<AppNotification>(`/api/notifications/${id}/read/`, {})
      .pipe(tap(() => this.changed.next()));
  }

  markAllRead(): Observable<void> {
    return this.http.post<{ updated: number }>('/api/notifications/read-all/', {}).pipe(
      tap(() => this.changed.next()),
      map(() => undefined),
    );
  }
}
