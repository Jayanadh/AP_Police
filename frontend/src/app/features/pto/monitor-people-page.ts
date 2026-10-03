import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import {
  monitorExport,
  MonitorApi,
  MonitorDriver,
  MonitorFilters,
  MonitorPage,
  MonitorPeopleKind,
  MonitorPerson,
} from '../../core/api/monitor-api';
import { formatDate, litres } from '../../core/format';
import { Panel } from '../../core/panel';
import { DownloadButton } from '../../ui/download-button';
import { EmptyState } from '../../ui/empty-state';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';
import { StatusBadge } from '../../ui/status-badge';
import { MonitorFilterBar, StatusOption } from './monitor-filter-bar';
import { MonitorPager } from './monitor-pager';

const OFFICER_STATUSES: readonly StatusOption[] = [
  { value: undefined, label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PENDING_APPROVAL', label: 'Waiting for PTO' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'TERMINATED', label: 'Terminated' },
];

/** Drivers are added without the PTO's approval, so none waits for it. */
const DRIVER_STATUSES: readonly StatusOption[] = OFFICER_STATUSES.filter(
  (option) => option.value !== 'PENDING_APPROVAL',
);

const PAGES: Record<MonitorPeopleKind, { title: string; subtitle: string; none: string }> = {
  officers: {
    title: 'Officers',
    subtitle:
      'Every office’s officers and the vehicles linked to them. This view is read only; each office’s MTO makes changes.',
    none: 'No officers match.',
  },
  drivers: {
    title: 'Drivers',
    subtitle:
      'Every office’s drivers: their vehicles, this month’s fuel and duty particulars past 48 hours. This view is read only; each office’s MTO makes changes.',
    none: 'No drivers match.',
  },
};

/** The PTO's read-only view of every office's officers or drivers (`kind`, from the route). */
@Component({
  selector: 'app-monitor-people-page',
  imports: [
    DownloadButton,
    EmptyState,
    LoadError,
    MonitorFilterBar,
    MonitorPager,
    PageHeader,
    StatusBadge,
  ],
  templateUrl: './monitor-people-page.html',
  styleUrl: './monitor.scss',
})
export class MonitorPeoplePage implements OnInit {
  readonly kind = input.required<MonitorPeopleKind>();

  private readonly api = inject(MonitorApi);

  protected readonly litres = litres;
  protected readonly formatDate = formatDate;

  protected readonly page = computed(() => PAGES[this.kind()]);
  protected readonly isDrivers = computed(() => this.kind() === 'drivers');
  protected readonly exportUrl = computed(() => monitorExport(this.kind()));
  protected readonly statuses = computed(() =>
    this.isDrivers() ? DRIVER_STATUSES : OFFICER_STATUSES,
  );

  protected readonly filters = signal<MonitorFilters>({});
  private readonly pageNumber = signal(1);

  protected readonly people = new Panel<MonitorPage<MonitorPerson>>(() =>
    this.api.people(this.kind(), { ...this.filters(), page: this.pageNumber() }),
  );

  ngOnInit(): void {
    this.people.load();
  }

  /** A changed filter starts again from the first page. */
  protected applyFilters(filters: MonitorFilters): void {
    this.filters.set(filters);
    this.goTo(1);
  }

  protected goTo(page: number): void {
    this.pageNumber.set(page);
    this.people.load();
  }

  protected asDriver(person: MonitorPerson): MonitorDriver {
    return person as MonitorDriver;
  }

  protected vehicleNames(person: MonitorPerson): string {
    return person.current_vehicles.map((vehicle) => vehicle.registration_number).join(', ');
  }

  /** "2 fills · 48 L", or "No fills". */
  protected monthText(driver: MonitorDriver): string {
    if (!driver.fills_this_month) {
      return 'No fills';
    }
    const fills = driver.fills_this_month === 1 ? '1 fill' : `${driver.fills_this_month} fills`;
    return `${fills} · ${litres(driver.litres_this_month)}`;
  }

  protected overdueText(driver: MonitorDriver): string {
    return driver.overdue_duty === 1
      ? '1 fill without duty particulars'
      : `${driver.overdue_duty} fills without duty particulars`;
  }
}
