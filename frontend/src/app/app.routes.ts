import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { AuthStore } from './core/auth-store';
import { authGuard, roleGuard } from './core/auth-guards';
import { homePathFor } from './layout/nav';

/** "/" goes to the signed-in user's own area, or to the login page. */
function homeRedirect(): string {
  const role = inject(AuthStore).role();
  return role ? homePathFor(role) : '/login';
}

export const routes: Routes = [
  {
    path: 'login',
    title: 'Log in',
    loadComponent: () => import('./features/auth/login-page').then((m) => m.LoginPage),
  },
  {
    path: '',
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    // canActivateChild, not canActivate: it must run on every navigation inside the shell.
    canActivateChild: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: homeRedirect },
      {
        path: 'change-password',
        title: 'Change password',
        loadComponent: () =>
          import('./features/auth/change-password-page').then((m) => m.ChangePasswordPage),
      },
      {
        path: 'profile',
        title: 'Profile',
        loadComponent: () => import('./features/profile/profile-page').then((m) => m.ProfilePage),
      },
      {
        path: 'alerts',
        title: 'Alerts',
        loadComponent: () => import('./features/alerts/alerts-page').then((m) => m.AlertsPage),
      },
      {
        path: 'pto',
        canActivate: [roleGuard('PTO')],
        loadChildren: () => import('./features/pto/pto.routes').then((m) => m.PTO_ROUTES),
      },
      {
        path: 'mto',
        canActivate: [roleGuard('MTO')],
        loadChildren: () => import('./features/mto/mto.routes').then((m) => m.MTO_ROUTES),
      },
      {
        path: 'officer',
        canActivate: [roleGuard('OFFICER')],
        loadChildren: () =>
          import('./features/officer/officer.routes').then((m) => m.OFFICER_ROUTES),
      },
      {
        path: 'driver',
        canActivate: [roleGuard('DRIVER')],
        loadChildren: () => import('./features/driver/driver.routes').then((m) => m.DRIVER_ROUTES),
      },
      {
        path: 'pump',
        canActivate: [roleGuard('PUMP_OPERATOR')],
        loadChildren: () => import('./features/pump/pump.routes').then((m) => m.PUMP_ROUTES),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
