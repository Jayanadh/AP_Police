import { NgTemplateOutlet } from '@angular/common';
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
import {
  FormControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { apiErrorMessage } from '../../core/api-error';
import { OdometerApi, OdometerReading } from '../../core/api/odometer-api';
import { PeopleApi, Person } from '../../core/api/people-api';
import { Quota, QuotaApi } from '../../core/api/quota-api';
import {
  nextDueLabel,
  ServiceRecord,
  ServicingApi,
  ServiceStatus,
} from '../../core/api/servicing-api';
import {
  Assignment,
  fuelLabel,
  LinkedPerson,
  linkHistoryExport,
  Vehicle,
  VehiclesApi,
  vehicleTypeLabel,
} from '../../core/api/vehicles-api';
import { formatDate, km, litres, monthLabel } from '../../core/format';
import { Panel } from '../../core/panel';
import { ConfirmButton } from '../../ui/confirm-button';
import { DownloadButton } from '../../ui/download-button';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { NumberField } from '../../ui/number-field';
import { PageHeader } from '../../ui/page-header';
import { StatusBadge } from '../../ui/status-badge';
import { ToastService } from '../../ui/toast';
import { VehicleForm } from './vehicle-form';

type Kind = Assignment['kind'];

type Slot = {
  kind: Kind;
  role: 'officer' | 'driver';
  title: string;
  linkLabel: string;
  prompt: string;
  none: string;
  person: LinkedPerson | null;
  candidates: Panel<Person[]>;
};

/** The statuses in which the server still takes new links. */
const LINKABLE = ['ACTIVE', 'PAUSED'];

/** How many odometer readings the card shows. */
const READINGS_SHOWN = 8;
/** Links shown on each history tab before "Show more". */
const HISTORY_FIRST = 4;

const NO_NOTE = 'Write why this vehicle should be terminated.';
const NO_SERVICE_DETAILS = 'Enter the service date and the odometer reading.';

/** One vehicle of the office: who is linked, its fuel, odometer and servicing, and the actions on it. */
@Component({
  selector: 'app-vehicle-detail-page',
  imports: [
    ConfirmButton,
    DownloadButton,
    Icon,
    LoadError,
    NgTemplateOutlet,
    NumberField,
    PageHeader,
    ReactiveFormsModule,
    RouterLink,
    StatusBadge,
    VehicleForm,
  ],
  templateUrl: './vehicle-detail-page.html',
  styles: `
    h2 {
      font-size: 18px;
    }

    h3 {
      font-size: 15px;
    }

    .form-slot,
    .notice {
      margin-bottom: 16px;
    }

    .dashboard {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
      margin-bottom: 16px;

      @media (min-width: 1200px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    section.card {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .card-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
    }

    .row-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 12px;
    }

    .person-tile {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      min-width: 0;
      padding: 16px;
      border-radius: var(--radius-md);
      background: var(--surface-2);
    }

    .kind {
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
    }

    .person-name {
      font-size: 17px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .call {
      font-weight: 600;
    }

    .link-form {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
      width: 100%;

      button {
        align-self: flex-start;
      }
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
    }

    .negative {
      // darkened from --danger so the text reaches 4.5:1 on the tile
      color: color-mix(in srgb, var(--danger) 80%, black);
    }

    .facts {
      display: grid;
      gap: 8px;
      margin: 0;
      font-size: 14px;

      > div {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 4px 12px;
      }

      dt {
        color: var(--muted);
        font-weight: 600;
      }

      dd {
        margin: 0;
        text-align: right;
      }
    }

    .service-form {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
      padding-top: 16px;
      border-top: 1px solid var(--border);

      .form-grid {
        width: 100%;
      }
    }

    .history-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px 16px;
      margin-bottom: 12px;

      h2 {
        margin: 0;
      }
    }

    .history-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;

      .count {
        margin-left: 4px;
        font-weight: 700;
      }
    }

    #history .more {
      margin-top: 8px;
    }

    .record,
    .history-row {
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 4px 14px;
    }

    .record-notes {
      flex: 1 1 100%;
    }

    .when {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      font-size: 14px;
    }
  `,
})
export class VehicleDetailPage {
  private readonly vehicles = inject(VehiclesApi);
  private readonly quotas = inject(QuotaApi);
  private readonly odometer = inject(OdometerApi);
  private readonly servicing = inject(ServicingApi);
  private readonly people = inject(PeopleApi);
  private readonly toasts = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly fb = inject(NonNullableFormBuilder);

  /** The vehicle's id, from the route. */
  readonly id = input.required<string>();
  protected readonly vehicleId = computed(() => Number(this.id()));

  // Each card loads on its own, so one failing request leaves the others on screen.
  protected readonly vehicle = new Panel<Vehicle>(() => this.vehicles.get(this.vehicleId()));
  protected readonly links = new Panel<Assignment[]>(() =>
    this.vehicles.assignments(this.vehicleId()),
  );

  // The link history: drivers and officers on their own tabs, the latest few until more are asked for.
  protected readonly historyTabs: readonly { kind: Kind; label: string }[] = [
    { kind: 'DRIVER', label: 'Drivers' },
    { kind: 'OFFICER', label: 'Officers' },
  ];
  protected readonly historyFirst = HISTORY_FIRST;
  protected readonly historyKind = signal<Kind>('DRIVER');
  protected readonly historyAll = signal(false);
  protected readonly historyExport = computed(() => linkHistoryExport(this.vehicleId()));
  protected readonly historyRows = computed(() => {
    const all = this.linksOf(this.historyKind());
    return this.historyAll() ? all : all.slice(0, HISTORY_FIRST);
  });
  protected readonly hiddenLinks = computed(
    () => this.linksOf(this.historyKind()).length - this.historyRows().length,
  );
  protected readonly historyNoun = computed(() =>
    this.historyKind() === 'OFFICER' ? 'officer' : 'driver',
  );
  protected readonly quota = new Panel<Quota>(() => this.quotas.forVehicle(this.vehicleId()));
  protected readonly readings = new Panel<OdometerReading[]>(() =>
    this.odometer.list(this.vehicleId()),
  );
  protected readonly service = new Panel<ServiceStatus>(() =>
    this.servicing.status(this.vehicleId()),
  );
  protected readonly records = new Panel<ServiceRecord[]>(() =>
    this.servicing.records(this.vehicleId()),
  );
  /** Who could be linked: asked for only while the vehicle has nobody of that kind. */
  private readonly officers = new Panel<Person[]>(() =>
    this.people.list('officers', { status: 'ACTIVE' }),
  );
  private readonly drivers = new Panel<Person[]>(() =>
    this.people.list('drivers', { status: 'ACTIVE', unassigned: true }),
  );

  protected readonly litres = litres;
  protected readonly km = km;
  protected readonly nextDue = nextDueLabel;
  protected readonly formatDate = formatDate;
  protected readonly monthLabel = monthLabel;

  /** Set while an action waits for the server's answer. */
  protected readonly busy = signal(false);

  protected readonly editTarget = signal<Vehicle | null>(null);
  protected readonly terminationOpen = signal(false);
  protected readonly terminationNote = new FormControl('', { nonNullable: true });
  protected readonly terminationError = signal('');

  protected readonly chosen = signal<Record<Kind, number | null>>({ OFFICER: null, DRIVER: null });
  protected readonly linkError = signal<{ kind: Kind; message: string } | null>(null);

  protected readonly serviceForm = this.fb.group({
    service_date: ['', Validators.required],
    odometer_km: [null as number | null, Validators.required],
    notes: [''],
  });
  protected readonly serviceError = signal('');

  protected readonly slots = computed<Slot[]>(() => {
    const vehicle = this.vehicle.data();
    if (!vehicle) {
      return [];
    }
    return [
      {
        kind: 'OFFICER',
        role: 'officer',
        title: 'Officer',
        linkLabel: 'Link an officer',
        prompt: 'Select an officer',
        none: 'No active officers to link. A new officer needs the PTO’s approval first.',
        person: vehicle.current_officer,
        candidates: this.officers,
      },
      {
        kind: 'DRIVER',
        role: 'driver',
        title: 'Driver',
        linkLabel: 'Link a driver',
        prompt: 'Select a driver',
        none: 'No unassigned drivers. Add a driver, or end a driver’s link to another vehicle first.',
        person: vehicle.current_driver,
        candidates: this.drivers,
      },
    ];
  });

  /** Litres used as a share of this month's limit; a limit of zero counts as full once anything is used. */
  protected readonly fuelPercent = computed(() => {
    const quota = this.quota.data();
    if (!quota) {
      return 0;
    }
    const limit = Number(quota.limit_litres);
    const used = Number(quota.used_litres);
    if (limit <= 0) {
      return used > 0 ? 100 : 0;
    }
    return Math.max(0, (used / limit) * 100);
  });
  protected readonly fuelBar = computed(() => Math.min(100, this.fuelPercent()));

  protected readonly fuelStats = computed(() => {
    const quota = this.quota.data();
    if (!quota) {
      return [];
    }
    const stat = (label: string, value: string, icon: string, canBeNegative = false) => ({
      label,
      value,
      icon,
      negative: canBeNegative && Number(value) < 0,
    });
    return [
      stat('Limit', quota.limit_litres, 'fuel'),
      stat('Used', quota.used_litres, 'droplet'),
      stat('Remaining', quota.remaining_litres, 'gauge', true),
      stat('Additional quota balance', quota.additional_balance_litres, 'file-plus', true),
      stat('Emergency left', quota.emergency_remaining_litres, 'alert-triangle'),
    ];
  });

  protected readonly latestReadings = computed(() =>
    (this.readings.data() ?? []).slice(0, READINGS_SHOWN),
  );
  protected readonly readingsShown = READINGS_SHOWN;

  constructor() {
    effect(() => {
      this.vehicleId();
      untracked(() => {
        this.resetAll();
        this.loadAll();
      });
    });
    effect(() => {
      const vehicle = this.vehicle.data();
      untracked(() => this.syncCandidates(vehicle));
    });
  }

  protected loadAll(): void {
    for (const panel of [
      this.vehicle,
      this.links,
      this.quota,
      this.readings,
      this.service,
      this.records,
    ]) {
      panel.load();
    }
  }

  /** A different vehicle: nothing of the last one stays on screen or in a form. */
  private resetAll(): void {
    for (const panel of [
      this.vehicle,
      this.links,
      this.quota,
      this.readings,
      this.service,
      this.records,
      this.officers,
      this.drivers,
    ]) {
      panel.reset();
    }
    this.busy.set(false);
    this.editTarget.set(null);
    this.closeTermination();
    this.chosen.set({ OFFICER: null, DRIVER: null });
    this.linkError.set(null);
    this.serviceForm.reset();
    this.serviceError.set('');
  }

  /** Reads who is free to link for a kind with nobody linked, and forgets the list once somebody is. */
  private syncCandidates(vehicle: Vehicle | null): void {
    const linkable = vehicle !== null && LINKABLE.includes(vehicle.status);
    const wanted: [Panel<Person[]>, Kind, boolean][] = [
      [this.officers, 'OFFICER', linkable && !vehicle.current_officer],
      [this.drivers, 'DRIVER', linkable && !vehicle.current_driver],
    ];
    for (const [panel, kind, needed] of wanted) {
      if (needed && !panel.requested) {
        panel.load();
      } else if (!needed && panel.requested) {
        panel.reset();
        this.choose(kind, '');
      }
    }
  }

  protected subtitle(vehicle: Vehicle): string {
    return [
      `${vehicle.make} ${vehicle.model}`,
      vehicleTypeLabel(vehicle.vehicle_type),
      fuelLabel(vehicle.fuel_type),
      vehicle.year_of_manufacture,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  protected canChange(vehicle: Vehicle): boolean {
    return LINKABLE.includes(vehicle.status);
  }

  /** Runs an action once at a time, and ignores its answer if the page has moved to another vehicle. */
  private act<T>(
    call: Observable<T>,
    done: (result: T) => void,
    failed: (message: string) => void = (message) => this.toasts.show(message, 'danger'),
  ): void {
    if (this.busy()) {
      return;
    }
    const mine = this.vehicleId();
    this.busy.set(true);
    call.subscribe({
      next: (result) => {
        if (mine === this.vehicleId()) {
          this.busy.set(false);
          done(result);
        }
      },
      error: (err) => {
        if (mine === this.vehicleId()) {
          this.busy.set(false);
          failed(apiErrorMessage(err));
        }
      },
    });
  }

  // ---------------------------------------------------------------- header actions

  protected openEdit(vehicle: Vehicle): void {
    this.closeTermination();
    this.editTarget.set(vehicle);
  }

  protected edited(saved: Vehicle): void {
    this.editTarget.set(null);
    this.vehicle.set(saved);
    this.toasts.show('Vehicle updated.');
    // The limit and the service intervals may have changed.
    this.quota.load(true);
    this.service.load(true);
  }

  protected pause(): void {
    this.act(this.vehicles.pause(this.vehicleId()), (vehicle) => {
      this.vehicle.set(vehicle);
      this.toasts.show('Vehicle paused.');
    });
  }

  protected resume(): void {
    this.act(this.vehicles.resume(this.vehicleId()), (vehicle) => {
      this.vehicle.set(vehicle);
      this.toasts.show('Vehicle resumed.');
    });
  }

  protected openTermination(): void {
    this.editTarget.set(null);
    this.terminationOpen.set(true);
    afterNextRender(() => document.getElementById('termination-note')?.focus(), {
      injector: this.injector,
    });
  }

  protected closeTermination(): void {
    this.terminationOpen.set(false);
    this.terminationNote.reset();
    this.terminationError.set('');
  }

  protected requestTermination(): void {
    const note = this.terminationNote.value.trim();
    if (!note) {
      this.terminationError.set(NO_NOTE);
      return;
    }
    this.terminationError.set('');
    this.act(
      this.vehicles.requestTermination(this.vehicleId(), note),
      (vehicle) => {
        this.vehicle.set(vehicle);
        this.closeTermination();
        this.toasts.show('Termination request sent to the PTO.');
      },
      (message) => this.terminationError.set(message),
    );
  }

  // ---------------------------------------------------------------------- people

  protected choose(kind: Kind, value: string): void {
    this.chosen.update((chosen) => ({ ...chosen, [kind]: value ? Number(value) : null }));
    this.linkError.set(null);
  }

  protected link(event: Event, slot: Slot): void {
    event.preventDefault();
    const person = this.chosen()[slot.kind];
    if (person === null) {
      return;
    }
    this.linkError.set(null);
    this.act(
      this.vehicles.assign(this.vehicleId(), person),
      (link) => {
        this.toasts.show(`${link.person_name} linked.`);
        this.choose(slot.kind, '');
        this.refreshLinks();
      },
      (message) => this.linkError.set({ kind: slot.kind, message }),
    );
  }

  protected endLink(person: LinkedPerson): void {
    this.act(this.vehicles.endAssignment(person.assignment_id), () => {
      this.toasts.show(`Link with ${person.full_name} ended.`);
      this.refreshLinks();
    });
  }

  /** The vehicle shows who is linked now, and the history shows the change. */
  private refreshLinks(): void {
    this.vehicle.load(true);
    this.links.load(true);
  }

  // ---------------------------------------------------------------------- servicing

  protected addService(event: Event): void {
    event.preventDefault();
    if (this.serviceForm.invalid) {
      this.serviceError.set(NO_SERVICE_DETAILS);
      return;
    }
    const value = this.serviceForm.getRawValue();
    this.serviceError.set('');
    this.act(
      this.servicing.add(this.vehicleId(), {
        service_date: value.service_date,
        odometer_km: value.odometer_km!,
        notes: value.notes.trim(),
      }),
      () => {
        this.serviceForm.reset();
        this.toasts.show('Service recorded.');
        this.records.load(true);
        this.service.load(true);
      },
      (message) => this.serviceError.set(message),
    );
  }

  protected serviceBadge(status: ServiceStatus): { label: string; tone: string } {
    if (status.due) {
      return { label: 'Service due', tone: 'warning' };
    }
    if (status.next_due_km === null && status.next_due_date === null) {
      return { label: 'No interval set', tone: 'muted' };
    }
    return { label: 'Up to date', tone: 'success' };
  }

  /** The links of one kind, newest first as the server sends them. */
  protected linksOf(kind: Kind): Assignment[] {
    return (this.links.data() ?? []).filter((link) => link.kind === kind);
  }

  protected showHistory(kind: Kind): void {
    this.historyKind.set(kind);
    this.historyAll.set(false);
  }
}
