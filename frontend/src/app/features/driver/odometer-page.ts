import { Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { OdometerApi, OdometerReading, weekOf } from '../../core/api/odometer-api';
import { MyVehicles, VehiclesApi } from '../../core/api/vehicles-api';
import { apiErrorMessage } from '../../core/api-error';
import { formatDate, km } from '../../core/format';
import { Panel } from '../../core/panel';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { NumberField } from '../../ui/number-field';
import { PageHeader } from '../../ui/page-header';
import { ToastService } from '../../ui/toast';

const NOT_WHOLE_KM = 'Enter the reading in whole kilometres.';

/** The driver's weekly odometer reading for the most recent Sunday, and the readings before it. */
@Component({
  selector: 'app-driver-odometer-page',
  imports: [EmptyState, Icon, LoadError, NumberField, PageHeader, ReactiveFormsModule],
  templateUrl: './odometer-page.html',
  styles: `
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;

      @media (min-width: 1000px) {
        grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
        align-items: start;
      }
    }

    h2 {
      font-size: 18px;
    }

    #readings-title {
      margin-bottom: 14px;
    }

    .head {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 18px;
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

    form {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    // The id outranks the design system's .field input rule: large digits, easy to check.
    #odometer-km {
      height: 60px;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }

    .recorded {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--success) 10%, white);

      app-icon {
        color: var(--success);
      }

      strong {
        display: block;
        font-size: 22px;
      }
    }

    .reading {
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 4px 12px;
    }

    .figure {
      font-weight: 700;
    }

    .since {
      font-size: 13px;
    }
  `,
})
export class OdometerPage {
  private readonly odometer = inject(OdometerApi);
  private readonly vehiclesApi = inject(VehiclesApi);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly formatDate = formatDate;
  protected readonly km = km;

  /** The Sunday this week's reading is for. */
  protected readonly week = weekOf();

  protected readonly vehicles = new Panel<MyVehicles>(() => this.vehiclesApi.myVehicles());
  protected readonly readings = new Panel<OdometerReading[]>(() => this.odometer.list());

  protected readonly vehicle = computed(() => this.vehicles.data()?.vehicles[0] ?? null);
  protected readonly thisWeek = computed(
    () => this.readings.data()?.find((reading) => reading.week_of === this.week) ?? null,
  );
  protected readonly previous = computed(() =>
    (this.readings.data() ?? []).filter((reading) => reading.week_of !== this.week),
  );
  protected readonly last = computed(() => this.previous()[0] ?? null);

  protected readonly form = this.fb.group({ reading_km: [null as number | null] });
  protected readonly error = signal('');
  protected readonly fieldError = signal('');
  protected readonly saving = signal(false);

  constructor() {
    this.vehicles.load();
    this.readings.load();
  }

  protected save(): void {
    if (this.saving()) {
      return;
    }
    const value = this.form.controls.reading_km.value;
    if (value === null || !Number.isInteger(value) || value < 0) {
      this.fieldError.set(NOT_WHOLE_KM);
      return;
    }
    const lowest = this.vehicle()?.latest_odometer_km ?? 0;
    if (value < lowest) {
      this.fieldError.set(`The reading can't be lower than the last reading (${km(lowest)}).`);
      return;
    }
    this.fieldError.set('');
    this.error.set('');
    this.saving.set(true);
    this.odometer.record(value).subscribe({
      next: (reading) => {
        this.saving.set(false);
        this.readings.set([reading, ...(this.readings.data() ?? [])]);
        this.toasts.show('Reading saved.');
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(apiErrorMessage(err));
      },
    });
  }
}
