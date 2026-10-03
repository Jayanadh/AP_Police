import { Routes } from '@angular/router';
import { PtoDashboardPage } from './pto-dashboard';

export const PTO_ROUTES: Routes = [
  { path: '', component: PtoDashboardPage, title: 'Dashboard' },
  {
    path: 'units',
    title: 'MTO offices',
    loadComponent: () => import('./units-page').then((m) => m.UnitsPage),
  },
  {
    path: 'approvals',
    title: 'Approvals',
    loadComponent: () => import('./approvals-page').then((m) => m.ApprovalsPage),
  },
  {
    path: 'vehicles',
    title: 'Vehicles',
    loadComponent: () => import('./monitor-vehicles-page').then((m) => m.MonitorVehiclesPage),
  },
  {
    path: 'officers',
    title: 'Officers',
    data: { kind: 'officers' },
    loadComponent: () => import('./monitor-people-page').then((m) => m.MonitorPeoplePage),
  },
  {
    path: 'drivers',
    title: 'Drivers',
    data: { kind: 'drivers' },
    loadComponent: () => import('./monitor-people-page').then((m) => m.MonitorPeoplePage),
  },
  {
    path: 'statement',
    title: 'Fuel statement',
    loadComponent: () =>
      import('../statement/fuel-statement-page').then((m) => m.FuelStatementPage),
  },
  {
    path: 'bunk-statements',
    title: 'Bunk statements',
    loadComponent: () => import('../mto/bunk-statements-page').then((m) => m.BunkStatementsPage),
  },
  {
    path: 'masters',
    title: 'Master lists',
    loadComponent: () => import('./masters-page').then((m) => m.MastersPage),
  },
];
