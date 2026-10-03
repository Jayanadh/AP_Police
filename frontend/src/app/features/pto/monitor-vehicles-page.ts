import { Component, inject, signal } from '@angular/core';
import {
  monitorExport,
  MonitorApi,
  MonitorFilters,
  MonitorPage,
  MonitorVehicle,
} from '../../core/api/monitor-api';
import { formatDate, km, litres } from '../../core/format';
import { Panel } from '../../core/panel';
import { usage } from '../../core/usage';
import { DownloadButton } from '../../ui/download-button';
import { EmptyState } from '../../ui/empty-state';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';
import { StatusBadge } from '../../ui/status-badge';
import { MonitorFilterBar, StatusOption } from './monitor-filter-bar';
import { MonitorPager } from './monitor-pager';

const STATUSES: readonly StatusOption[] = [
  { value: undefined, label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'TERMINATION_PENDING', label: 'Termination pending' },
  { value: 'TERMINATED', label: 'Terminated' },
];

/** The PTO's read-only view of every office's vehicles: people, this month's fuel, odometer and service. */
@Component({
  selector: 'app-monitor-vehicles-page',
  imports: [
    DownloadButton,
    EmptyState,
    LoadError,
    MonitorFilterBar,
    MonitorPager,
    PageHeader,
    StatusBadge,
  ],
  templateUrl: './monitor-vehicles-page.html',
  styleUrl: './monitor.scss',
})
export class MonitorVehiclesPage {
  private readonly api = inject(MonitorApi);

  protected readonly statuses = STATUSES;
  protected readonly litres = litres;
  protected readonly km = km;
  protected readonly formatDate = formatDate;
  protected readonly usage = usage;
  protected readonly exportUrl = monitorExport('vehicles');

  protected readonly filters = signal<MonitorFilters>({});
  private readonly pageNumber = signal(1);

  protected readonly vehicles = new Panel<MonitorPage<MonitorVehicle>>(() =>
    this.api.vehicles({ ...this.filters(), page: this.pageNumber() }),
  );

  constructor() {
    this.vehicles.load();
  }

  /** A changed filter starts again from the first page. */
  protected applyFilters(filters: MonitorFilters): void {
    this.filters.set(filters);
    this.goTo(1);
  }

  protected goTo(page: number): void {
    this.pageNumber.set(page);
    this.vehicles.load();
  }

  /** "140 L left", or "10 L over" once emergency fills went past the limit. */
  protected left(vehicle: MonitorVehicle): string {
    const remaining = Number(vehicle.remaining_litres);
    return remaining < 0 ? `${litres(-remaining)} over` : `${litres(remaining)} left`;
  }
}
