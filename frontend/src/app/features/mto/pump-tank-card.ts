import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { apiErrorMessage } from '../../core/api-error';
import { PumpTank } from '../../core/api/pumps-api';
import { StockEntry, Tank, TanksApi, tankLevelPercent } from '../../core/api/tanks-api';
import { fuelLabel } from '../../core/api/vehicles-api';
import { formatDateTime, litres } from '../../core/format';
import { Panel } from '../../core/panel';
import { LoadError } from '../../ui/load-error';
import { StatCard } from '../../ui/stat-card';
import { ToastService } from '../../ui/toast';

const NO_THRESHOLD = 'Enter the alert level in litres, 0 or more.';
const NEGATIVE_CAPACITY = 'The capacity cannot be negative.';

/** One tank of a police pump: its stock and level, the alert level and capacity the MTO may change, and the month's stock entries. */
@Component({
  selector: 'app-pump-tank-card',
  imports: [LoadError, ReactiveFormsModule, StatCard],
  templateUrl: './pump-tank-card.html',
  styles: `
    :host {
      display: block;
    }

    .card {
      display: flex;
      flex-direction: column;
      gap: 16px;
      height: 100%;
    }

    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    h3 {
      font-size: 17px;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }

    .levels {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-top: 16px;
      border-top: 1px solid var(--border);

      .form-grid {
        width: 100%;
      }

      button {
        align-self: flex-start;
      }
    }

    .entries {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }

    h4 {
      font-size: 14px;
    }

    .sub {
      color: var(--muted);
      font-size: 13px;
    }

    td.number {
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class PumpTankCard {
  private readonly api = inject(TanksApi);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly tank = input.required<PumpTank>();
  /** The month of the stock entries, "YYYY-MM". */
  readonly month = input.required<string>();
  /** The tank as the server has it after the levels were saved. */
  readonly changed = output<Tank>();

  protected readonly litres = litres;
  protected readonly formatDateTime = formatDateTime;
  protected readonly fuel = computed(() => fuelLabel(this.tank().fuel_type));
  protected readonly percent = computed(() => tankLevelPercent(this.tank()));
  protected readonly tankId = computed(() => this.tank().id);

  protected readonly entries = new Panel<StockEntry[]>(() =>
    this.api.entries(this.tankId(), this.month()),
  );

  protected readonly levels = this.fb.group({
    threshold: [null as number | null],
    capacity: [null as number | null],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal('');

  constructor() {
    effect(() => {
      this.tankId();
      this.month();
      untracked(() => this.entries.load());
    });
    // The boxes follow the server, but never overwrite what is being typed.
    effect(() => {
      const tank = this.tank();
      untracked(() => {
        if (this.levels.pristine) {
          this.fillFrom(tank);
        }
      });
    });
  }

  private fillFrom(tank: PumpTank): void {
    this.levels.reset({
      threshold: Number(tank.low_stock_threshold_litres),
      capacity: tank.capacity_litres === null ? null : Number(tank.capacity_litres),
    });
  }

  protected save(): void {
    if (this.saving()) {
      return;
    }
    const { threshold, capacity } = this.levels.getRawValue();
    if (typeof threshold !== 'number' || threshold < 0) {
      this.error.set(NO_THRESHOLD);
      return;
    }
    if (typeof capacity === 'number' && capacity < 0) {
      this.error.set(NEGATIVE_CAPACITY);
      return;
    }
    this.error.set('');
    this.saving.set(true);
    this.api
      .update(this.tank().id, {
        low_stock_threshold_litres: threshold,
        capacity_litres: typeof capacity === 'number' ? capacity : null,
      })
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.levels.markAsPristine();
          this.toasts.show(`${this.fuel()} levels saved.`);
          this.changed.emit(saved);
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(apiErrorMessage(err));
        },
      });
  }
}
