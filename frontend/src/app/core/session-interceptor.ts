import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { AuthStore, isSessionRefusal } from './auth-store';

const AUTH_API = '/api/auth/';

/**
 * When an API call is refused with 401/403, finds out whether the session has expired or now
 * belongs to someone else (see AuthStore.recheckSession). The auth endpoints answer for
 * themselves and are left alone.
 */
export const sessionInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthStore);
  const watched = req.url.startsWith('/api/') && !req.url.startsWith(AUTH_API);
  return next(req).pipe(
    tap({
      error: (err: unknown) => {
        if (watched && isSessionRefusal(err)) {
          void auth.recheckSession();
        }
      },
    }),
  );
};
