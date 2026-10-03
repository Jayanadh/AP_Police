import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DashboardApi,
  DashboardTank,
  MtoDashboard as MtoSummary,
} from '../../core/api/dashboard-api';
import { tankLevelPercent } from '../../core/api/tanks-api';
import { fuelLabel } from '../../core/api/vehicles-api';
import { AuthStore } from '../../core/auth-store';
import { litres, monthLabel } from '../../core/format';
import { Panel } from '../../core/panel';
import { usage } from '../../core/usage';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';
import { StatCard } from '../../ui/stat-card';
import { StatusBadge } from '../../ui/status-badge';

type Tile = {
  label: string;
  icon: string;
  link: string;
  count: number;
  /** The tone the tile takes while the count is above zero. */
  alert: 'warning' | 'danger';
};

/** The MTO's home: what needs attention, this month's fuel, the police pumps' stock and the vehicles. */
@Component({
  selector: 'app-mto-dashboard',
  imports: [LoadError, PageHeader, RouterLink, StatCard, StatusBadge],
  templateUrl: './mto-dashboard.html',
  styles: `
    // One tile on a phone, two on a tablet, three from a laptop with the sidebar open.
    .tiles {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;

      @media (min-width: 560px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      @media (min-width: 900px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    // The tile lives in app-stat-card, so the link itself lifts on hover and focus.
    .stat-link {
      display: block;
      border-radius: var(--radius-md);
      color: inherit;
      text-decoration: none;
      transition:
        transform 0.15s ease,
        box-shadow 0.15s ease;

      &:hover,
      &:focus-visible {
        box-shadow: var(--shadow-card);
        transform: translateY(-2px);
      }
    }

    .panels {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
      margin-top: 16px;

      @media (min-width: 1100px) {
        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
        align-items: start;
      }

      > * {
        min-width: 0;
      }
    }

    .side {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    h2 {
      margin-bottom: 16px;
      font-size: 19px;
    }

    h3 {
      margin: 24px 0 14px;
      font-size: 15px;
    }

    .line {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
      overflow-wrap: anywhere;
    }

    .figure {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .registration {
      font-weight: 700;
      color: inherit;
      text-underline-offset: 3px;
    }

    .rows {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .status-row {
      justify-content: space-between;

      strong {
        font-size: 18px;
      }
    }

    // Without a capacity the bar is only a rough guide, and this says so.
    .hint {
      margin-left: 6px;
      font-size: 12.5px;
      font-weight: 500;
    }

    .badges {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .more {
      margin-top: 16px;
    }
  `,
})
export class MtoDashboard {
  private readonly api = inject(DashboardApi);
  private readonly user = inject(AuthStore).user;

  protected readonly litres = litres;
  protected readonly fuelLabel = fuelLabel;
  protected readonly usage = usage;

  protected readonly dashboard = new Panel<MtoSummary>(() => this.api.get<MtoSummary>());

  protected readonly greeting = computed(() => {
    const name = this.user()?.full_name;
    return name ? `Welcome, ${name}` : 'Welcome';
  });

  protected readonly subtitle = computed(() => {
    const data = this.dashboard.data();
    return [this.user()?.unit_name, data ? monthLabel(data.month) : ''].filter(Boolean).join(' · ');
  });

  protected readonly tiles = computed<Tile[]>(() => {
    const data = this.dashboard.data();
    if (!data) {
      return [];
    }
    return [
      {
        label: 'Pending emergencies',
        icon: 'alert-triangle',
        link: '/mto/emergencies',
        count: data.pending_emergencies,
        alert: 'danger',
      },
      {
        label: 'Overdue duty particulars',
        icon: 'clock',
        link: '/mto/fuel',
        count: data.overdue_duty,
        alert: 'danger',
      },
      {
        label: 'Missing odometer',
        icon: 'gauge',
        link: '/mto/odometer',
        count: data.missing_odometer,
        alert: 'warning',
      },
      {
        label: 'Services due',
        icon: 'wrench',
        link: '/mto/servicing',
        count: data.services_due,
        alert: 'warning',
      },
      {
        label: 'Transfers to decide',
        icon: 'arrow-left-right',
        link: '/mto/transfers',
        count: data.transfers_to_decide,
        alert: 'warning',
      },
    ];
  });

  constructor() {
    this.dashboard.load();
  }

  /** How full a police tank is, in whole percent: the same measure as the pumps page, whose bar this matches. */
  protected level(tank: DashboardTank): number {
    return Math.round(tankLevelPercent(tank));
  }
}
