import { Routes } from '@angular/router';
import { PumpDashboard } from './pump-dashboard';

export const PUMP_ROUTES: Routes = [
  { path: '', component: PumpDashboard, title: 'Dashboard' },
  {
    path: 'fill',
    title: 'Fill',
    loadComponent: () => import('./fill-page').then((m) => m.FillPage),
  },
  {
    path: 'stock',
    title: 'Stock',
    loadComponent: () => import('./stock-page').then((m) => m.StockPage),
  },
  {
    path: 'statement',
    title: 'Fuel statement',
    loadComponent: () =>
      import('../statement/fuel-statement-page').then((m) => m.FuelStatementPage),
  },
];
