import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardApi, DriverDashboard as DriverSummary } from '../../core/api/dashboard-api';
import { FuelRequestsApi } from '../../core/api/fuel-requests-api';
import { fuelLabel } from '../../core/api/vehicles-api';
import { apiErrorMessage } from '../../core/api-error';
import { AuthStore } from '../../core/auth-store';
import { formatDate, formatDateTime, km, litres, monthLabel } from '../../core/format';
import { Panel } from '../../core/panel';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';
import { ToastService } from '../../ui/toast';
import { FuelLeftCard } from './fuel-left-card';
import { PinCard } from './pin-card';

/** The driver's home: the vehicle, the fuel left, the open PIN, what is owed, and the way to a pump. */
@Component({
  selector: 'app-driver-dashboard',
  imports: [EmptyState, FuelLeftCard, Icon, LoadError, PageHeader, PinCard, RouterLink],
  templateUrl: './driver-dashboard.html',
  styles: `
    // One column on a phone (in the order of the markup's 'order' values); two from a laptop.
    .home {
      display: flex;
      flex-direction: column;
      gap: 16px;

      @media (min-width: 1000px) {
        display: grid;
        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
        align-items: start;
      }
    }

    .column {
      display: contents;

      @media (min-width: 1000px) {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 0;
      }
    }

    @media (max-width: 999px) {
      .o1 {
        order: 1;
      }
      .o2 {
        order: 2;
      }
      .o3 {
        order: 3;
      }
      .o4 {
        order: 4;
      }
      .o5 {
        order: 5;
      }
      .o6 {
        order: 6;
      }
    }

    h2 {
      font-size: 18px;
    }

    .notice {
      margin-bottom: 16px;
    }

    .vehicle {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .round {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--primary) 22%, white);
      color: color-mix(in srgb, var(--primary-strong) 70%, black);
    }

    .who {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .registration {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    .actions {
      display: flex;
      flex-direction: column;
      gap: 10px;

      .btn {
        height: 56px;
        font-size: 16px;
      }

      // On the grey page a grey pill would vanish: the second button is white.
      .btn-secondary {
        background: var(--surface);
        box-shadow: var(--shadow-card);
      }
    }

    .card-head {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }

    .duty-row {
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px 12px;
    }

    .duty-what {
      display: flex;
      flex-direction: column;
      min-width: 0;
      font-size: 14px;
      overflow-wrap: anywhere;

      strong {
        font-size: 15px;
      }
    }

    .duty-act {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .recorded {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;

      app-icon {
        color: var(--success);
      }
    }

    .odometer .btn {
      margin-top: 12px;
    }
  `,
})
export class DriverDashboard {
  private readonly api = inject(DashboardApi);
  private readonly requests = inject(FuelRequestsApi);
  private readonly toasts = inject(ToastService);
  private readonly user = inject(AuthStore).user;

  protected readonly litres = litres;
  protected readonly km = km;
  protected readonly formatDate = formatDate;
  protected readonly formatDateTime = formatDateTime;
  protected readonly fuelLabel = fuelLabel;

  protected readonly dashboard = new Panel<DriverSummary>(() => this.api.get<DriverSummary>());

  protected readonly greeting = computed(() => {
    const name = this.user()?.full_name;
    return name ? `Hello, ${name}` : 'Hello';
  });

  protected readonly subtitle = computed(() => {
    const data = this.dashboard.data();
    return [data ? monthLabel(data.month) : '', this.user()?.unit_name].filter(Boolean).join(' · ');
  });

  constructor() {
    this.dashboard.load();
  }

  protected cancelRequest(id: number): void {
    this.requests.cancel(id).subscribe({
      next: () => {
        this.toasts.show('Request cancelled.');
        this.dashboard.load(true);
      },
      error: (err) => this.toasts.show(apiErrorMessage(err), 'danger'),
    });
  }
}
