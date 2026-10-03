import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardApi, PtoDashboard, PtoUnitSummary } from '../../core/api/dashboard-api';
import { apiErrorMessage } from '../../core/api-error';
import { litres, monthLabel } from '../../core/format';
import { EmptyState } from '../../ui/empty-state';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';
import { StatCard } from '../../ui/stat-card';

/** From this share of the limit the progress bar turns amber; at the limit it turns red. */
const WARN_FROM_PERCENT = 80;

@Component({
  selector: 'app-pto-dashboard',
  imports: [EmptyState, LoadError, NgTemplateOutlet, PageHeader, RouterLink, StatCard],
  templateUrl: './pto-dashboard.html',
  styles: `
    // Two across on a laptop with the sidebar open, four across on a wide screen, one on a phone.
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
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

    h2 {
      margin: 28px 0 14px;
      font-size: 19px;
    }

    // Table from tablet width up, stacked cards below it.
    .office-cards {
      display: flex;
      flex-direction: column;
      gap: 16px;

      @media (min-width: 700px) {
        display: none;
      }
    }

    .table-card {
      display: none;
      padding: 8px;

      @media (min-width: 700px) {
        display: block;
      }
    }

    .office-code {
      margin-left: 6px;
      font-size: 13px;
    }

    .fuel-cell {
      min-width: 170px;
    }

    // Headings may wrap so the six columns fit sooner; cells stay on one line.
    th {
      white-space: normal;
    }

    .fuel-figure {
      display: block;
      margin-bottom: 6px;
    }

    .office-card h3 {
      margin-bottom: 12px;
      font-size: 17px;
    }

    .figure {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid var(--border);

      &:last-child {
        border-bottom: 0;
      }

      dt {
        color: var(--muted);
      }

      dd {
        margin: 0;
        font-weight: 600;
        text-align: right;
      }

      // The fuel row stacks its figure above the progress bar.
      &.fuel {
        flex-direction: column;
        align-items: stretch;
        gap: 8px;

        dd {
          display: flex;
          flex-direction: column;
          gap: 8px;
          text-align: left;
        }
      }
    }

    dl {
      margin: 0;
    }
  `,
})
export class PtoDashboardPage {
  private readonly api = inject(DashboardApi);

  protected readonly data = signal<PtoDashboard | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  protected readonly monthText = computed(() => {
    const data = this.data();
    return data ? monthLabel(data.month) : '';
  });

  protected readonly fuelText = computed(() => {
    const totals = this.data()?.totals;
    return totals
      ? `${litres(totals.fuel_used_litres)} of ${litres(totals.fuel_limit_litres)}`
      : '';
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.get<PtoDashboard>().subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  protected fuel(unit: PtoUnitSummary): string {
    return `${litres(unit.fuel_used_litres)} / ${litres(unit.fuel_limit_litres)}`;
  }

  /** Share of the monthly limit used, 0 to 100; 0 when the office has no limit at all. */
  protected percent(unit: PtoUnitSummary): number {
    const limit = Number(unit.fuel_limit_litres);
    if (!(limit > 0)) {
      return 0;
    }
    return Math.min(100, Math.round((Number(unit.fuel_used_litres) / limit) * 100));
  }

  protected barTone(unit: PtoUnitSummary): 'danger' | 'warning' | '' {
    const percent = this.percent(unit);
    if (percent >= 100) {
      return 'danger';
    }
    return percent >= WARN_FROM_PERCENT ? 'warning' : '';
  }
}
