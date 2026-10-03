import { Component, inject, signal } from '@angular/core';
import { FuelRequest, FuelRequestsApi } from '../../core/api/fuel-requests-api';
import { apiErrorMessage } from '../../core/api-error';
import { formatDateTime, litres } from '../../core/format';
import { Panel } from '../../core/panel';
import { EmptyState } from '../../ui/empty-state';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';
import { StatusBadge } from '../../ui/status-badge';
import { ToastService } from '../../ui/toast';

type Tab = 'pending' | 'allowed';

const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'allowed', label: 'Allowed' },
];

/** Fills that went beyond the month's quota: the MTO allows them, and they count against the additional quota. */
@Component({
  selector: 'app-emergencies-page',
  imports: [EmptyState, LoadError, PageHeader, StatusBadge],
  templateUrl: './emergencies-page.html',
  styles: `
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 20px;
    }

    .emergencies {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
      gap: 16px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .emergency {
      display: flex;
      flex-direction: column;
      gap: 14px;
      height: 100%;
    }

    .top {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px 12px;
    }

    .registration {
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.02em;
      overflow-wrap: anywhere;
    }

    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .rows {
      display: grid;
      gap: 8px;
      margin: 0;
      padding-top: 14px;
      border-top: 1px solid var(--border);
      font-size: 14px;

      > div {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }

      dt {
        flex: none;
        color: var(--muted);
        font-weight: 600;
      }

      dd {
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
        text-align: right;
      }
    }

    .allow {
      margin-top: auto;
      align-self: stretch;
    }
  `,
})
export class EmergenciesPage {
  private readonly api = inject(FuelRequestsApi);
  private readonly toasts = inject(ToastService);

  protected readonly tabs = TABS;
  protected readonly litres = litres;
  protected readonly formatDateTime = formatDateTime;

  protected readonly tab = signal<Tab>('pending');
  /** The fill waiting for the server's answer to Allow. */
  protected readonly busyId = signal<number | null>(null);

  protected readonly fills = new Panel<FuelRequest[]>(() =>
    this.api.list({ emergency: this.tab() }),
  );

  constructor() {
    this.fills.load();
  }

  protected choose(tab: Tab): void {
    if (tab === this.tab()) {
      return;
    }
    this.tab.set(tab);
    this.fills.load();
  }

  protected allow(fill: FuelRequest): void {
    if (this.busyId() !== null) {
      return;
    }
    this.busyId.set(fill.id);
    this.api.allowEmergency(fill.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toasts.show(`Emergency fill of ${fill.registration_number} allowed.`);
        this.fills.load(true);
      },
      error: (err) => {
        this.busyId.set(null);
        this.toasts.show(apiErrorMessage(err), 'danger');
      },
    });
  }
}
