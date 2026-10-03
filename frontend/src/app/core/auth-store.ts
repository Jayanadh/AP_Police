import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Service, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, firstValueFrom, map, Observable, of, tap, throwError } from 'rxjs';
import { ToastService } from '../ui/toast';
import { apiErrorMessage } from './api-error';

export type Role = 'PTO' | 'MTO' | 'OFFICER' | 'DRIVER' | 'PUMP_OPERATOR';

export type PumpKind = 'POLICE' | 'TIE_UP';

/** The signed-in user, as the API's MeSerializer returns it. */
export type Me = {
  id: number;
  username: string;
  full_name: string;
  emp_id: string | null;
  role: Role;
  status: string;
  unit: number | null;
  unit_name: string | null;
  designation_name: string | null;
  district_name: string | null;
  cadre_name: string | null;
  mobile: string;
  must_change_password: boolean;
  pump: number | null;
  pump_name: string | null;
  pump_kind: PumpKind | null;
};

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  PTO: 'PTO',
  MTO: 'MTO',
  OFFICER: 'Officer',
  DRIVER: 'Driver',
  PUMP_OPERATOR: 'Pump operator',
};

type SessionResponse = { user: Me | null };

/** The server says nobody is logged in (DRF answers 403 for session auth, 401 for others). */
export function isSessionRefusal(err: unknown): boolean {
  return err instanceof HttpErrorResponse && (err.status === 401 || err.status === 403);
}

/** Who is signed in. The session cookie is the source of truth; this holds the last answer. */
@Service()
export class AuthStore {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly current = signal<Me | null>(null);
  private sessionCheck: Promise<void> | null = null;

  readonly user = this.current.asReadonly();
  readonly role = computed<Role | null>(() => this.current()?.role ?? null);

  /** Asks the server who is signed in. A failed call counts as signed out; it never rejects. */
  async loadSession(): Promise<void> {
    try {
      const { user } = await firstValueFrom(this.http.get<SessionResponse>('/api/auth/session/'));
      this.current.set(user);
    } catch {
      this.current.set(null);
    }
  }

  login(username: string, password: string): Observable<Me> {
    return this.http.post<{ user: Me }>('/api/auth/login/', { username, password }).pipe(
      map((response) => response.user),
      tap((user) => this.current.set(user)),
    );
  }

  /**
   * The user is forgotten once the server has ended the session, or has said there is none
   * (401/403: it expired, so the user is already logged out). Any other failure, such as an
   * unreachable server or a 5xx, leaves the user signed in and is passed on.
   */
  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout/', {}).pipe(
      map(() => undefined),
      catchError((err: unknown) => (isSessionRefusal(err) ? of(undefined) : throwError(() => err))),
      tap(() => this.current.set(null)),
    );
  }

  /** Logs out and goes to /login, or says why it could not. Used by every Log out button. */
  signOut(): void {
    this.logout().subscribe({
      next: () => void this.router.navigateByUrl('/login'),
      error: (err) => this.toasts.show(apiErrorMessage(err), 'danger'),
    });
  }

  /**
   * Asks the server who the session belongs to now, one check at a time: after an API call is
   * refused with 401/403, and when the window comes back into view. Goes to /login if the session
   * is gone, and home if another tab has signed someone else in; otherwise stays where it is.
   */
  recheckSession(): Promise<void> {
    const before = this.current();
    if (!before) {
      return Promise.resolve();
    }
    this.sessionCheck ??= this.loadSession()
      .then(() => {
        const now = this.current();
        if (!now) {
          void this.router.navigateByUrl('/login');
        } else if (now.id !== before.id) {
          void this.router.navigateByUrl('/');
        }
      })
      .finally(() => (this.sessionCheck = null));
    return this.sessionCheck;
  }

  changePassword(oldPassword: string, newPassword: string): Observable<void> {
    return this.http
      .post<void>('/api/auth/change-password/', {
        old_password: oldPassword,
        new_password: newPassword,
      })
      .pipe(
        tap(() => this.current.update((user) => user && { ...user, must_change_password: false })),
        map(() => undefined),
      );
  }
}
