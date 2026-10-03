import {
  afterNextRender,
  Component,
  computed,
  effect,
  inject,
  Injector,
  input,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FuelRequest, FuelRequestPayload, FuelRequestsApi } from '../../core/api/fuel-requests-api';
import { DirectoryPump, PumpsApi } from '../../core/api/pumps-api';
import { Quota, QuotaApi } from '../../core/api/quota-api';
import { MyVehicles, VehiclesApi } from '../../core/api/vehicles-api';
import { apiErrorMessage } from '../../core/api-error';
import { formatDateTime, litres } from '../../core/format';
import { Panel } from '../../core/panel';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';
import { StatusBadge } from '../../ui/status-badge';
import { ToastService } from '../../ui/toast';
import { FuelLeftCard } from './fuel-left-card';
import { PinCard } from './pin-card';

/** The quick amounts offered beside the litres field. */
const QUICK_LITRES = [10, 20];

const NO_LITRES = 'Enter the litres you need.';
const NO_PUMP = 'Pick the pump you will fill at.';
const NOT_TICKED = 'Tick “This is an emergency” to ask for more than what is left.';
const NO_REASON = 'Give the reason for the emergency.';
const NO_DUTY = 'Enter the duty particulars.';

/** A positive id from a query parameter, or null. */
function idFrom(value: string | undefined): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Asking for fuel and getting its PIN, and the driver's requests with the duty particulars still owed. */
@Component({
  selector: 'app-driver-fuel-page',
  imports: [
    EmptyState,
    FuelLeftCard,
    Icon,
    LoadError,
    PageHeader,
    PinCard,
    ReactiveFormsModule,
    RouterLink,
    StatusBadge,
  ],
  templateUrl: './fuel-page.html',
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

    .side {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 0;
    }

    h2 {
      font-size: 18px;
    }

    .find-link {
      align-self: flex-start;
      font-size: 14px;
      font-weight: 600;
      color: var(--primary-strong);
    }

    form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .litres-box {
      position: relative;

      // The id outranks the design system's .field input rule.
      #fuel-litres {
        height: 60px;
        padding-right: 44px;
        font-size: 22px;
        font-weight: 700;
      }

      span {
        position: absolute;
        right: 18px;
        bottom: 17px;
        color: var(--muted);
        font-weight: 700;
      }
    }

    .litre-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .emergency {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 16px;
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--danger) 8%, white);

      p {
        font-size: 14px;
      }
    }

    .emergency-head {
      display: flex;
      align-items: center;
      gap: 8px;
      color: color-mix(in srgb, var(--danger) 80%, black);
    }

    .get-pin {
      height: 56px;
      font-size: 16px;
    }

    .request {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 14px 0;
      border-bottom: 1px solid var(--border);
      scroll-margin: 96px 0 120px;

      &:last-child {
        border-bottom: 0;
      }

      &.highlight {
        margin: 0 -12px;
        padding: 14px 12px;
        border-radius: var(--radius-md);
        background: color-mix(in srgb, var(--primary) 14%, white);
        box-shadow: inset 0 0 0 2px var(--primary);
      }

      p {
        font-size: 14px;
        overflow-wrap: anywhere;
      }
    }

    .top {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 6px 12px;
    }

    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .amount {
      font-size: 18px;
      font-weight: 700;
    }

    .duty {
      margin-top: 6px;

      .top {
        margin-bottom: 2px;
      }

      textarea {
        min-height: 80px;
      }

      .btn {
        align-self: flex-start;
      }
    }

    .duty-text {
      color: var(--text);
    }
  `,
})
export class FuelPage {
  /** `?pump=<id>`: the pump the driver chose in the finder. */
  readonly pump = input<string>();
  /** `?duty=<id>`: the fill whose duty particulars the driver came to enter. */
  readonly duty = input<string>();

  private readonly vehiclesApi = inject(VehiclesApi);
  private readonly quotaApi = inject(QuotaApi);
  private readonly requestsApi = inject(FuelRequestsApi);
  private readonly pumpsApi = inject(PumpsApi);
  private readonly toasts = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly litres = litres;
  protected readonly formatDateTime = formatDateTime;
  protected readonly quickLitres = QUICK_LITRES;

  protected readonly vehicles = new Panel<MyVehicles>(() => this.vehiclesApi.myVehicles());
  protected readonly quota = new Panel<Quota>(() => this.quotaApi.forVehicle(this.vehicle()!.id));
  protected readonly requests = new Panel<FuelRequest[]>(() => this.requestsApi.list());
  /** The pumps that sell the vehicle's fuel, to pick where the request will be filled. */
  protected readonly directory = new Panel<DirectoryPump[]>(() =>
    this.pumpsApi.directory({ fuel: this.vehicle()!.fuel_type }),
  );

  protected readonly vehicle = computed(() => this.vehicles.data()?.vehicles[0] ?? null);
  private readonly pumpId = computed(() => idFrom(this.pump()));
  protected readonly highlightId = computed(() => idFrom(this.duty()));
  protected readonly policePumps = computed(() =>
    (this.directory.data() ?? []).filter((pump) => pump.kind === 'POLICE'),
  );
  protected readonly tieUps = computed(() =>
    (this.directory.data() ?? []).filter((pump) => pump.kind === 'TIE_UP'),
  );
  /** The request whose PIN is still open: at most one per vehicle. */
  protected readonly open = computed(
    () =>
      this.requests.data()?.find((request) => request.status === 'ISSUED' && request.pin) ?? null,
  );

  protected readonly form = this.fb.group({
    pump: [''],
    litres: [null as number | null],
    is_emergency: [false],
    emergency_reason: [''],
  });
  protected readonly litresValue = toSignal(this.form.controls.litres.valueChanges, {
    initialValue: null,
  });
  /** What is left of the month's quota for a normal request, never below zero. */
  protected readonly normalLeft = computed(() =>
    Math.max(0, Number(this.quota.data()?.remaining_litres ?? 0)),
  );
  protected readonly emergencyLeft = computed(() =>
    Number(this.quota.data()?.emergency_remaining_litres ?? 0),
  );
  /** Asking for more than is left makes the request an emergency. */
  protected readonly over = computed(() => {
    const value = this.litresValue();
    return value !== null && value > this.normalLeft();
  });
  /** A full tank: what the tank holds, but no more than is left this month. */
  protected readonly fullTank = computed(() =>
    Math.min(Number(this.vehicle()?.tank_capacity_litres ?? 0), this.normalLeft()),
  );
  protected readonly formError = signal('');
  protected readonly saving = signal(false);

  /** What is typed into each fill's duty particulars, its error, and the one being sent. */
  protected readonly drafts = signal<Record<number, string>>({});
  protected readonly dutyErrors = signal<Record<number, string>>({});
  protected readonly dutyBusy = signal<number | null>(null);
  private scrolledTo: number | null = null;

  constructor() {
    this.vehicles.load();
    this.requests.load();
    effect(() => {
      const vehicle = this.vehicle();
      untracked(() => {
        if (vehicle) {
          this.quota.load();
          this.directory.load();
        } else {
          this.quota.reset();
          this.directory.reset();
        }
      });
    });
    // Coming from a pump in the finder: start on that pump, if it is offered.
    effect(() => {
      const id = this.pumpId();
      const offered = this.directory.data()?.find((pump) => pump.id === id && this.available(pump));
      untracked(() => {
        if (offered && !this.form.controls.pump.value) {
          this.form.controls.pump.setValue(String(offered.id));
        }
      });
    });
    effect(() => {
      const id = this.highlightId();
      const rows = this.requests.data();
      // Wait for the cards above the list, so they do not push it away mid-scroll.
      const settled = !this.vehicles.loading() && !(this.vehicle() && this.quota.loading());
      if (id !== null && id !== this.scrolledTo && settled && rows?.some((row) => row.id === id)) {
        this.scrolledTo = id;
        afterNextRender(() => this.showRequest(id), { injector: this.injector });
      }
    });
  }

  /** Sold here and, at a police pump, in stock: a pump the driver can pick. */
  protected available(pump: DirectoryPump): boolean {
    return this.vehicle()?.fuel_type === 'PETROL' ? pump.petrol_available : pump.diesel_available;
  }

  protected pumpOption(pump: DirectoryPump): string {
    const place = pump.district_name ? `${pump.name}, ${pump.district_name}` : pump.name;
    return this.available(pump) ? place : `${place} (out of stock)`;
  }

  protected setLitres(value: number): void {
    this.form.controls.litres.setValue(value);
  }

  protected submit(): void {
    if (this.saving()) {
      return;
    }
    const { pump, litres: amount, is_emergency, emergency_reason } = this.form.getRawValue();
    if (amount === null || !(amount > 0)) {
      this.formError.set(NO_LITRES);
      return;
    }
    if (!pump) {
      this.formError.set(NO_PUMP);
      return;
    }
    let payload: FuelRequestPayload = { pump: Number(pump), litres: amount, is_emergency: false };
    if (amount > this.normalLeft()) {
      const reason = emergency_reason.trim();
      if (!is_emergency) {
        this.formError.set(NOT_TICKED);
        return;
      }
      if (!reason) {
        this.formError.set(NO_REASON);
        return;
      }
      payload = {
        pump: Number(pump),
        litres: amount,
        is_emergency: true,
        emergency_reason: reason,
      };
    }
    this.formError.set('');
    this.saving.set(true);
    this.requestsApi.create(payload).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.form.reset();
        this.requests.set([created, ...(this.requests.data() ?? [])]);
        this.toasts.show('Your PIN is ready. Show it at the pump.');
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(apiErrorMessage(err));
      },
    });
  }

  protected cancel(request: FuelRequest): void {
    this.requestsApi.cancel(request.id).subscribe({
      next: (cancelled) => {
        this.replace(cancelled);
        this.toasts.show('Request cancelled.');
      },
      error: (err) => this.toasts.show(apiErrorMessage(err), 'danger'),
    });
  }

  protected when(request: FuelRequest): string {
    return request.status === 'FILLED'
      ? `Filled ${formatDateTime(request.filled_at)}`
      : `Requested ${formatDateTime(request.issued_at)}`;
  }

  protected owesDuty(request: FuelRequest): boolean {
    return request.status === 'FILLED' && !request.duty_submitted_at;
  }

  protected draft(id: number, event: Event): void {
    const text = (event.target as HTMLTextAreaElement).value;
    this.drafts.update((all) => ({ ...all, [id]: text }));
  }

  protected submitDuty(request: FuelRequest): void {
    if (this.dutyBusy() !== null) {
      return;
    }
    const text = (this.drafts()[request.id] ?? '').trim();
    if (!text) {
      this.setDutyError(request.id, NO_DUTY);
      return;
    }
    this.setDutyError(request.id, '');
    this.dutyBusy.set(request.id);
    this.requestsApi.submitDuty(request.id, text).subscribe({
      next: (updated) => {
        this.dutyBusy.set(null);
        this.replace(updated);
        this.toasts.show('Duty particulars saved.');
      },
      error: (err) => {
        this.dutyBusy.set(null);
        this.setDutyError(request.id, apiErrorMessage(err));
      },
    });
  }

  private setDutyError(id: number, message: string): void {
    this.dutyErrors.update((all) => ({ ...all, [id]: message }));
  }

  private replace(updated: FuelRequest): void {
    this.requests.set(
      (this.requests.data() ?? []).map((request) =>
        request.id === updated.id ? updated : request,
      ),
    );
  }

  /** Brings the request of `?duty=` into view, and its duty particulars box into focus. */
  private showRequest(id: number): void {
    document
      .getElementById(`request-${id}`)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    document.getElementById(`duty-${id}`)?.focus({ preventScroll: true });
  }
}
