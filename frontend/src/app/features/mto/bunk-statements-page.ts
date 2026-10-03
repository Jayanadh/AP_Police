import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  BUNK_STATEMENT_EXPORT,
  BunkStatement,
  BunkStatementApi,
  StatementPump,
} from '../../core/api/bunk-statement-api';
import { fuelLabel } from '../../core/api/vehicles-api';
import { AuthStore } from '../../core/auth-store';
import { NOW } from '../../core/clock';
import { formatDateTime, litres } from '../../core/format';
import { Panel } from '../../core/panel';
import { Period, periodOf, todayIso } from '../../core/period';
import { DownloadButton } from '../../ui/download-button';
import { EmptyState } from '../../ui/empty-state';
import { LoadError } from '../../ui/load-error';
import { OfficeSelect } from '../../ui/office-select';
import { PageHeader } from '../../ui/page-header';
import { PeriodPicker } from '../../ui/period-picker';
import { StatCard } from '../../ui/stat-card';

/**
 * Bunk statements: every fill made at one police pump or tie-up bunk in a period, with the totals, to read or
 * download. Nothing is submitted, verified or disputed: a fill is always exactly the litres the driver asked for.
 * The MTO picks one of the office's pumps; the PTO any office's.
 */
@Component({
  selector: 'app-bunk-statements-page',
  imports: [
    DownloadButton,
    EmptyState,
    LoadError,
    OfficeSelect,
    PageHeader,
    PeriodPicker,
    StatCard,
  ],
  templateUrl: './bunk-statements-page.html',
  styles: `
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 16px 28px;
      margin-bottom: 20px;

      app-period-picker {
        flex: 1 1 320px;
      }
    }

    .pickers {
      display: flex;
      flex: 1 1 320px;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 12px 16px;

      .office,
      .pump {
        flex: 1 1 200px;
        margin: 0;
      }
    }

    h2 {
      margin-bottom: 4px;
    }

    .office-name {
      margin: 0 0 4px;
    }

    .totals {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
      gap: 12px;
      margin: 12px 0 20px;
    }
  `,
})
export class BunkStatementsPage {
  private readonly api = inject(BunkStatementApi);
  private readonly auth = inject(AuthStore);

  protected readonly litres = litres;
  protected readonly formatDateTime = formatDateTime;
  protected readonly fuelLabel = fuelLabel;
  protected readonly exportUrl = BUNK_STATEMENT_EXPORT;

  protected readonly isPto = computed(() => this.auth.role() === 'PTO');
  protected readonly subtitle = computed(() =>
    this.isPto()
      ? 'Every fill at any office’s police pumps and tie-up bunks, for any period.'
      : 'Every fill at your office’s police pumps and tie-up bunks, for any period.',
  );

  protected readonly period = signal<Period>(periodOf('month', todayIso(inject(NOW)())));
  /** The PTO's chosen office, or undefined for all of them. */
  private readonly unitId = signal<number | undefined>(undefined);
  protected readonly pumpId = signal<number | null>(null);

  protected readonly pumps = new Panel<StatementPump[]>(() => this.api.pumps(this.unitId()));
  protected readonly statement = new Panel<BunkStatement>(() =>
    this.api.get(this.period(), this.pumpId()!),
  );
  protected readonly downloadParams = computed(() => ({
    pump: this.pumpId(),
    from: this.period().from,
    to: this.period().to,
  }));

  constructor() {
    this.pumps.load();
    // A new list of pumps: keep the chosen one if it is still there, otherwise start on the first.
    effect(() => {
      const list = this.pumps.data();
      untracked(() => {
        if (list === null || list.some((pump) => pump.id === this.pumpId())) {
          return;
        }
        const first = list[0]?.id ?? null;
        this.pumpId.set(first);
        if (first === null) {
          this.statement.reset();
        } else {
          this.statement.load();
        }
      });
    });
  }

  protected pumpLabel(pump: StatementPump): string {
    return pump.is_active
      ? `${pump.name} (${pump.kind_label})`
      : `${pump.name} (${pump.kind_label}, closed)`;
  }

  protected choosePump(value: string): void {
    this.pumpId.set(Number(value));
    this.statement.load();
  }

  protected choosePeriod(period: Period): void {
    this.period.set(period);
    if (this.pumpId() !== null) {
      this.statement.load();
    }
  }

  protected chooseUnit(unit: number | undefined): void {
    this.unitId.set(unit);
    this.pumps.load();
  }
}
