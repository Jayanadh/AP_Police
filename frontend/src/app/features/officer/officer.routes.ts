import { Routes } from '@angular/router';
import { OfficerDashboard } from './officer-dashboard';

export const OFFICER_ROUTES: Routes = [
  { path: '', component: OfficerDashboard, title: 'Dashboard' },
  {
    path: 'fuel',
    title: 'Fuel statement',
    loadComponent: () =>
      import('../statement/fuel-statement-page').then((m) => m.FuelStatementPage),
  },
];
