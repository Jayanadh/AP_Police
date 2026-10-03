import { Routes } from '@angular/router';
import { MtoDashboard } from './mto-dashboard';

export const MTO_ROUTES: Routes = [
  { path: '', component: MtoDashboard, title: 'Dashboard' },
  {
    path: 'drivers',
    title: 'Drivers',
    data: { kind: 'drivers' },
    loadComponent: () => import('./people-page').then((m) => m.PeoplePage),
  },
  {
    path: 'officers',
    title: 'Officers',
    data: { kind: 'officers' },
    loadComponent: () => import('./people-page').then((m) => m.PeoplePage),
  },
  {
    path: 'vehicles',
    title: 'Vehicles',
    loadComponent: () => import('./vehicles-page').then((m) => m.VehiclesPage),
  },
  {
    path: 'vehicles/:id',
    title: 'Vehicle',
    loadComponent: () => import('./vehicle-detail-page').then((m) => m.VehicleDetailPage),
  },
  {
    path: 'transfers',
    title: 'Transfers',
    loadComponent: () => import('./transfers-page').then((m) => m.TransfersPage),
  },
  {
    path: 'pumps',
    title: 'Pumps',
    loadComponent: () => import('./pumps-page').then((m) => m.PumpsPage),
  },
  {
    path: 'pumps/:id',
    title: 'Pump',
    loadComponent: () => import('./pump-detail-page').then((m) => m.PumpDetailPage),
  },
  {
    path: 'additional-quota',
    title: 'Additional quota',
    loadComponent: () => import('./additional-quota-page').then((m) => m.AdditionalQuotaPage),
  },
  {
    path: 'emergencies',
    title: 'Emergencies',
    loadComponent: () => import('./emergencies-page').then((m) => m.EmergenciesPage),
  },
  {
    path: 'fuel',
    title: 'Fuel statement',
    loadComponent: () =>
      import('../statement/fuel-statement-page').then((m) => m.FuelStatementPage),
  },
  {
    path: 'statements',
    title: 'Bunk statements',
    loadComponent: () => import('./bunk-statements-page').then((m) => m.BunkStatementsPage),
  },
  {
    path: 'odometer',
    title: 'Odometer',
    loadComponent: () => import('./odometer-page').then((m) => m.OdometerPage),
  },
  {
    path: 'servicing',
    title: 'Servicing',
    loadComponent: () => import('./servicing-page').then((m) => m.ServicingPage),
  },
];
