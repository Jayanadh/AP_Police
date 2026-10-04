import { Routes } from '@angular/router';
import { DriverDashboard } from './driver-dashboard';

export const DRIVER_ROUTES: Routes = [
  { path: '', component: DriverDashboard, title: 'Home' },
  {
    path: 'pumps',
    title: 'Pumps',
    loadComponent: () => import('./pump-finder-page').then((m) => m.PumpFinderPage),
  },
  {
    path: 'pumps/:id',
    title: 'Pump',
    loadComponent: () => import('./pump-detail-page').then((m) => m.PumpDetailPage),
  },
  {
    path: 'fuel',
    title: 'Fuel',
    loadComponent: () => import('./fuel-page').then((m) => m.FuelPage),
  },
  {
    path: 'live',
    title: 'Live location',
    loadComponent: () => import('./live-location-page').then((m) => m.LiveLocationPage),
  },
  {
    path: 'odometer',
    title: 'Odometer',
    loadComponent: () => import('./odometer-page').then((m) => m.OdometerPage),
  },
  {
    path: 'statement',
    title: 'Fuel statement',
    loadComponent: () =>
      import('../statement/fuel-statement-page').then((m) => m.FuelStatementPage),
  },
];
