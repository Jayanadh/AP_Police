import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore, Role } from './auth-store';

const CHANGE_PASSWORD_PATH = '/change-password';

function pathOf(url: string): string {
  return url.split(/[?#]/)[0];
}

/**
 * Signed-in users only; a user who must change the password may reach nothing else.
 * Use it as canActivateChild on the shell so it runs on every navigation inside it.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const user = inject(AuthStore).user();
  const router = inject(Router);
  if (!user) {
    return router.parseUrl('/login');
  }
  if (user.must_change_password && pathOf(state.url) !== CHANGE_PASSWORD_PATH) {
    return router.parseUrl(CHANGE_PASSWORD_PATH);
  }
  return true;
};

/** Only the listed roles; anyone else goes to /, which sends them to their own area. */
export function roleGuard(...roles: Role[]): CanActivateFn {
  return () => {
    const role = inject(AuthStore).role();
    return role !== null && roles.includes(role) ? true : inject(Router).parseUrl('/');
  };
}
