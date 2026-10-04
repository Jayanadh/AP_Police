import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Grant, GrantsApi } from '../../core/api/grants-api';
import { Quota, QuotaApi } from '../../core/api/quota-api';
import { Vehicle, VehiclesApi } from '../../core/api/vehicles-api';
import { apiErrorMessage } from '../../core/api-error';
import { addMonths, currentMonth, formatDateTime, litres, monthLabel } from '../../core/format';
import { Panel } from '../../core/panel';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { NumberField } from '../../ui/number-field';
import { PageHeader } from '../../ui/page-header';
import { StatCard, StatTone } from '../../ui/stat-card';
import { ToastService } from '../../ui/toast';

const LETTER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf'];
const LETTER_MAX_BYTES = 5 * 1024 * 1024;

const WRONG_TYPE = 'Upload the letter as JPG, PNG or PDF.';
const TOO_BIG = 'The letter must be 5 MB or smaller.';
const NO_LETTER = 'Upload the approval letter.';
const NO_LITRES = 'Enter the quantity in litres.';
const NO_APPROVER = 'Enter who approved it.';

type Field = 'litres' | 'approved_by' | 'letter';
type FieldErrors = Partial<Record<Field, string>>;

/** The problem with a letter file the server would refuse anyway, found before anything is sent. */
function letterProblem(file: File): string | null {
  const dot = file.name.lastIndexOf('.');
  const extension = dot < 0 ? '' : file.name.slice(dot).toLowerCase();
  if (!LETTER_EXTENSIONS.includes(extension)) {
    return WRONG_TYPE;
  }
  return file.size > LETTER_MAX_BYTES ? TOO_BIG : null;
}

/** Adding quota to a vehicle for this month or next, with the approval letter, and what was added this month. */
@Component({
  selector: 'app-additional-quota-page',
  imports: [Icon, LoadError, NumberField, PageHeader, ReactiveFormsModule, StatCard],
  templateUrl: './additional-quota-page.html',
  styles: `
    .search-card,
    .quota-card,
    .grant-form,
    .grants-card {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-bottom: 20px;
    }

    .search {
      display: flex;
      align-items: flex-end;
      gap: 12px;

      .field {
        flex: 1;
      }

      // Large, for typing a registration number with a thumb.
      .field input {
        height: 56px;
        font-size: 18px;
      }

      .btn {
        height: 56px;
      }
    }

    .vehicle-chips,
    .month-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .card-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 4px 12px;
    }

    h2 {
      font-size: 18px;
      overflow-wrap: anywhere;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;

      @media (min-width: 900px) {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }

    .month-hint,
    .hint {
      margin: 0;
      font-size: 14px;
    }

    .drop-zone {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 20px 16px;
      border: 2px dashed var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
      color: var(--muted);
      text-align: center;
      transition:
        border-color 0.15s ease,
        background-color 0.15s ease;

      &.dragging {
        border-color: var(--primary-strong);
        background: color-mix(in srgb, var(--primary) 12%, white);
      }

      p {
        margin: 0;
        font-size: 14px;
      }

      .file-input {
        flex-wrap: wrap;
        justify-content: center;
        max-width: 100%;
      }

      .file-input-name {
        max-width: 100%;
      }
    }

    .form-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }

    .grants {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .grant {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 14px 0;
      border-bottom: 1px solid var(--border);
      font-size: 14px;
      overflow-wrap: anywhere;

      &:first-child {
        padding-top: 0;
      }

      &:last-child {
        padding-bottom: 0;
        border-bottom: 0;
      }

      p {
        margin: 0;
      }
    }

    .grant-top {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 4px 12px;
    }

    .amount {
      font-size: 17px;
      font-weight: 700;
    }
  `,
})
export class AdditionalQuotaPage {
  private readonly vehicleApi = inject(VehiclesApi);
  private readonly quotaApi = inject(QuotaApi);
  private readonly grantsApi = inject(GrantsApi);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(NonNullableFormBuilder);

  /** `?vehicle=<id>` of the route: the vehicle to start with. */
  readonly vehicle = input<string>();

  protected readonly litres = litres;
  protected readonly monthLabel = monthLabel;
  protected readonly formatDateTime = formatDateTime;

  protected readonly thisMonth = currentMonth();
  protected readonly months = [
    { value: this.thisMonth, label: 'This month' },
    { value: addMonths(this.thisMonth, 1), label: 'Next month' },
  ];

  /** What is typed in the search box, and what the results are for. */
  protected readonly searchText = signal('');
  protected readonly search = signal('');
  protected readonly results = new Panel<Vehicle[]>(() =>
    this.vehicleApi.list({ search: this.search() }),
  );

  /** The vehicle of `?vehicle=`, read so it can be selected. */
  protected readonly preselectId = computed(() => {
    const id = Number(this.vehicle());
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  protected readonly preselected = new Panel<Vehicle>(() =>
    this.vehicleApi.get(this.preselectId()!),
  );

  protected readonly selected = signal<Vehicle | null>(null);
  /** The vehicles to choose from: the ones found, and the one selected even when it was not found by the search. */
  protected readonly choices = computed(() => {
    const found = (this.results.data() ?? []).filter((vehicle) => vehicle.status !== 'TERMINATED');
    const chosen = this.selected();
    return chosen && !found.some((vehicle) => vehicle.id === chosen.id)
      ? [chosen, ...found]
      : found;
  });

  protected readonly quota = new Panel<Quota>(() => this.quotaApi.forVehicle(this.selected()!.id));
  protected readonly grants = new Panel<Grant[]>(() =>
    this.grantsApi.list({ vehicle: this.selected()!.id, month: this.thisMonth }),
  );
  protected readonly stats = computed(() => {
    const quota = this.quota.data();
    if (!quota) {
      return [];
    }
    const stat = (
      label: string,
      value: string,
      icon: string,
      tone: StatTone,
      canBeNegative = false,
    ) => ({
      label,
      value,
      icon,
      // A figure below zero turns red, whatever its own colour.
      tone: canBeNegative && Number(value) < 0 ? ('danger' as const) : tone,
    });
    return [
      stat('Limit', quota.limit_litres, 'fuel', 'primary'),
      stat('Used', quota.used_litres, 'droplet', 'info'),
      stat('Remaining', quota.remaining_litres, 'gauge', 'success', true),
      stat(
        'Additional quota balance',
        quota.additional_balance_litres,
        'file-plus',
        'violet',
        true,
      ),
    ];
  });

  protected readonly month = signal(this.thisMonth);
  protected readonly form = this.fb.group({
    litres: [null as number | null],
    approved_by: [''],
    note: [''],
  });
  protected readonly letter = signal<File | null>(null);
  protected readonly dragging = signal(false);
  protected readonly errors = signal<FieldErrors>({});
  protected readonly formError = signal('');
  protected readonly saving = signal(false);

  constructor() {
    effect(() => {
      const id = this.preselectId();
      untracked(() => (id === null ? this.preselected.reset() : this.preselected.load()));
    });
    effect(() => {
      const vehicle = this.preselected.data();
      untracked(() => {
        if (vehicle) {
          this.select(vehicle);
        }
      });
    });
  }

  /** Where a grant's letter is opened, on the page's own origin. */
  protected grantLetter(grant: Grant): string {
    return this.grantsApi.letterUrl(grant.id);
  }

  protected applySearch(event: Event): void {
    event.preventDefault();
    const term = this.searchText().trim();
    this.search.set(term);
    if (term) {
      this.results.load();
    } else {
      this.results.reset();
    }
  }

  protected select(vehicle: Vehicle): void {
    if (this.selected()?.id === vehicle.id) {
      return;
    }
    this.selected.set(vehicle);
    this.startOver();
    this.quota.load();
    this.grants.load();
  }

  protected chooseFile(input: HTMLInputElement): void {
    this.takeFile(input.files?.[0] ?? null);
    // The file is kept here, so choosing the same one again still counts as a change.
    input.value = '';
  }

  protected dragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.takeFile(file);
    }
  }

  protected clearError(field: Field): void {
    this.setError(field, undefined);
  }

  protected save(event: Event): void {
    event.preventDefault();
    const vehicle = this.selected();
    if (this.saving() || !vehicle) {
      return;
    }
    const { litres: amount, approved_by, note } = this.form.getRawValue();
    const letter = this.letter();
    const errors: FieldErrors = {};
    if (amount === null || !(amount > 0)) {
      errors.litres = NO_LITRES;
    }
    if (!approved_by.trim()) {
      errors.approved_by = NO_APPROVER;
    }
    if (!letter) {
      // A letter that was refused on the spot keeps its own message.
      errors.letter = this.errors().letter ?? NO_LETTER;
    }
    this.errors.set(errors);
    this.formError.set('');
    if (amount === null || !letter || Object.keys(errors).length) {
      return;
    }

    const month = this.month();
    this.saving.set(true);
    this.grantsApi
      .create({
        vehicle: vehicle.id,
        month,
        litres: amount,
        approved_by: approved_by.trim(),
        note: note.trim(),
        letter,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toasts.show(
            `Added ${litres(amount)} to ${vehicle.registration_number} for ${monthLabel(month)}.`,
          );
          // Another vehicle may have been selected while this one was saving.
          if (this.selected()?.id === vehicle.id) {
            this.startOver();
            this.quota.load(true);
            this.grants.load(true);
          }
        },
        error: (err) => {
          this.saving.set(false);
          this.formError.set(apiErrorMessage(err));
        },
      });
  }

  private takeFile(file: File | null): void {
    const problem = file ? letterProblem(file) : null;
    this.letter.set(problem ? null : file);
    this.setError('letter', problem ?? undefined);
  }

  private setError(field: Field, message: string | undefined): void {
    const next = { ...this.errors() };
    if (message) {
      next[field] = message;
    } else {
      delete next[field];
    }
    this.errors.set(next);
  }

  /** An empty form for the vehicle selected: this month, nothing typed, no letter. */
  private startOver(): void {
    this.month.set(this.thisMonth);
    this.form.reset();
    this.letter.set(null);
    this.errors.set({});
    this.formError.set('');
    this.dragging.set(false);
  }
}
