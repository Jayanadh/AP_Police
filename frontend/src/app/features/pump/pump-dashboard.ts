import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardApi, PumpDashboard as PumpSummary } from '../../core/api/dashboard-api';
import { AuthStore, PumpKind } from '../../core/auth-store';
import { litres, monthLabel } from '../../core/format';
import { Panel } from '../../core/panel';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';
import { StatCard } from '../../ui/stat-card';
import { TankLevel } from './tank-level';

const KIND_LABELS: Readonly<Record<PumpKind, string>> = {
  POLICE: 'Police pump',
  TIE_UP: 'Tie-up bunk',
};

/**
 * The pump staff's home: the vehicles waiting and today's fills, the way to fill a vehicle under them, and at a police
 * pump its tanks. Every fill of any period is in the fuel statement.
 */
@Component({
  selector: 'app-pump-dashboard',
  imports: [Icon, LoadError, PageHeader, RouterLink, StatCard, TankLevel],
  templateUrl: './pump-dashboard.html',
  styles: `
    // Right under the day's figures, and as big as a thumb: filling is what the staff came to do.
    .fill-button {
      width: 100%;
      height: 64px;
      margin-bottom: 16px;
      font-size: 18px;

      @media (min-width: 640px) {
        width: auto;
        min-width: 320px;
      }
    }

    .today {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }

    .panels {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;

      @media (min-width: 1000px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start;
      }
    }

    h2 {
      margin-bottom: 14px;
      font-size: 19px;
    }

    // A police pump's tanks take the full width.
    .stacked {
      grid-template-columns: minmax(0, 1fr);
    }

    .tanks {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
      gap: 22px 32px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .more {
      margin-top: 16px;
    }
  `,
})
export class PumpDashboard {
  private readonly api = inject(DashboardApi);
  private readonly user = inject(AuthStore).user;

  protected readonly litres = litres;

  protected readonly dashboard = new Panel<PumpSummary>(() => this.api.get<PumpSummary>());

  protected readonly name = computed(
    () => this.dashboard.data()?.pump.name ?? this.user()?.pump_name ?? 'Dashboard',
  );
  protected readonly kind = computed<PumpKind | null>(
    () => this.dashboard.data()?.pump.kind ?? this.user()?.pump_kind ?? null,
  );
  protected readonly kindLabel = computed(() => {
    const kind = this.kind();
    return kind ? KIND_LABELS[kind] : '';
  });
  protected readonly subtitle = computed(() => {
    const data = this.dashboard.data();
    return data ? `Today and ${monthLabel(data.month)}` : '';
  });

  constructor() {
    this.dashboard.load();
  }
}
