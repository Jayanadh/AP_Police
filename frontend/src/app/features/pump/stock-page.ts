import { Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { tap } from 'rxjs';
import { apiErrorMessage } from '../../core/api-error';
import { STOCK_ENTRIES_EXPORT, StockEntry, Tank, TanksApi } from '../../core/api/tanks-api';
import { fuelLabel } from '../../core/api/vehicles-api';
import { NOW } from '../../core/clock';
import { formatDateTime, litres } from '../../core/format';
import { Panel } from '../../core/panel';
import { Period, periodOf, todayIso } from '../../core/period';
import { DownloadButton } from '../../ui/download-button';
import { EmptyState } from '../../ui/empty-state';
import { LoadError } from '../../ui/load-error';
import { NumberField } from '../../ui/number-field';
import { PageHeader } from '../../ui/page-header';
import { PeriodPicker } from '../../ui/period-picker';
import { ToastService } from '../../ui/toast';
import { TankLevel } from './tank-level';

const NO_RECEIPT = 'Enter the litres received.';

/**
 * The police pump's stock: its tanks, tanker receipts and the stock entries of any period, which download as Excel.
 * The stock is never measured or set here: receipts add to it, fills take from it, and the MTO set where it started.
 */
@Component({
  selector: 'app-stock-page',
  imports: [
    DownloadButton,
    EmptyState,
    LoadError,
    NumberField,
    PageHeader,
    PeriodPicker,
    ReactiveFormsModule,
    TankLevel,
  ],
  templateUrl: './stock-page.html',
  styles: `
    h2 {
      margin-bottom: 14px;
      font-size: 19px;
    }

    h3 {
      margin-bottom: 14px;
      font-size: 17px;
    }

    // As many columns as fit: the sidebar takes room from 900px, so a fixed count would squeeze them.
    .tanks,
    .forms,
    .entries-list {
      display: grid;
      gap: 16px;
      margin-bottom: 16px;
    }

    .tanks {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
    }

    .forms {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
      align-items: start;
    }

    .entries-list {
      grid-template-columns: minmax(0, 1fr);
      margin-bottom: 0;
    }

    form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .hint {
      margin: -6px 0 0;
      font-size: 14px;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .group-label {
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
    }

    // The id outranks the design system's .field input rule.
    #receipt-litres {
      height: 56px;
      padding-right: 44px;
      font-size: 22px;
      font-weight: 700;
    }

    .litres-box {
      position: relative;

      span {
        position: absolute;
        right: 18px;
        bottom: 15px;
        color: var(--muted);
        font-weight: 700;
      }
    }

    .sub {
      color: var(--muted);
      font-size: 13px;
    }

    .entries-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px 16px;
      margin-bottom: 16px;
    }

    td.number {
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class StockPage {
  private readonly api = inject(TanksApi);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly litres = litres;
  protected readonly fuelLabel = fuelLabel;
  protected readonly formatDateTime = formatDateTime;

  protected readonly exportUrl = STOCK_ENTRIES_EXPORT;
  /** The period of the entries shown, and downloaded: this month to start with. */
  protected readonly period = signal<Period>(periodOf('month', todayIso(inject(NOW)())));
  protected readonly downloadParams = computed(() => ({
    from: this.period().from,
    to: this.period().to,
  }));
  private readonly entries = new Map<number, Panel<StockEntry[]>>();
  protected readonly tanks = new Panel<Tank[]>(() =>
    this.api.list().pipe(tap((list) => this.readEntries(list))),
  );

  /** The tank the receipt is for; until one is chosen, the first. */
  private readonly receiptChoice = signal<number | null>(null);
  protected readonly receiptId = computed(
    () => this.receiptChoice() ?? this.tanks.data()?.[0]?.id ?? null,
  );

  protected readonly receiptForm = this.fb.group({
    litres: [null as number | null],
    note: [''],
  });
  protected readonly receiptError = signal('');
  protected readonly receiving = signal(false);

  constructor() {
    this.tanks.load();
  }

  protected chooseForReceipt(id: number): void {
    this.receiptChoice.set(id);
  }

  protected entriesOf(tank: Tank): Panel<StockEntry[]> {
    return this.entries.get(tank.id)!;
  }

  protected choosePeriod(period: Period): void {
    this.period.set(period);
    for (const panel of this.entries.values()) {
      panel.load();
    }
  }

  protected receive(): void {
    const tank = this.tankFor(this.receiptId());
    if (this.receiving() || !tank) {
      return;
    }
    const { litres: amount, note } = this.receiptForm.getRawValue();
    if (amount === null || !(amount > 0)) {
      this.receiptError.set(NO_RECEIPT);
      return;
    }
    this.receiptError.set('');
    this.receiving.set(true);
    this.api.receive(tank.id, amount, note.trim()).subscribe({
      next: (saved) => {
        this.receiving.set(false);
        this.receiptForm.reset();
        // The tank shows its new stock and its entries are read again.
        this.tanks.set((this.tanks.data() ?? []).map((one) => (one.id === saved.id ? saved : one)));
        this.entries.get(saved.id)?.load(true);
        this.toasts.show(
          `Received ${litres(amount)} of ${fuelLabel(saved.fuel_type).toLowerCase()}.`,
        );
      },
      error: (err) => {
        this.receiving.set(false);
        this.receiptError.set(apiErrorMessage(err));
      },
    });
  }

  private tankFor(id: number | null): Tank | undefined {
    return this.tanks.data()?.find((tank) => tank.id === id);
  }

  /** Reads each tank's entries of the period, in a panel of its own so one failing leaves the rest. */
  private readEntries(tanks: Tank[]): void {
    for (const tank of tanks) {
      let panel = this.entries.get(tank.id);
      if (!panel) {
        panel = new Panel(() => this.api.entriesIn(tank.id, this.period()));
        this.entries.set(tank.id, panel);
      }
      panel.load();
    }
  }
}
