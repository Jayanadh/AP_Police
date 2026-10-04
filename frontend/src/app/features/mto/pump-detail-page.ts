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
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { map, Observable } from 'rxjs';
import { apiErrorMessage } from '../../core/api-error';
import { PeopleApi, Person, PersonAction, PersonStatus } from '../../core/api/people-api';
import {
  Pump,
  pumpFuels,
  PumpsApi,
  PumpTank,
  pumpToPoint,
  pumpTone,
} from '../../core/api/pumps-api';
import { Tank } from '../../core/api/tanks-api';
import { fuelLabel } from '../../core/api/vehicles-api';
import { addMonths, currentMonth, monthLabel } from '../../core/format';
import { LatLng } from '../../core/geo';
import { Panel } from '../../core/panel';
import { ConfirmButton } from '../../ui/confirm-button';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { MapMarker, MapView } from '../../ui/map-view';
import { PageHeader } from '../../ui/page-header';
import { StatusBadge } from '../../ui/status-badge';
import { ToastService } from '../../ui/toast';
import { PumpForm } from './pump-form';
import { PumpTankCard } from './pump-tank-card';

const PAST_TENSE: Readonly<Record<PersonAction, string>> = {
  pause: 'paused',
  resume: 'resumed',
  terminate: 'terminated',
};

/** Statuses of people who can still log in or be paused, terminated or given a new password. */
const IN_SERVICE: readonly PersonStatus[] = ['ACTIVE', 'PAUSED'];

const INCOMPLETE_LOGIN = 'Fill in the login ID, name and first password.';

/** What a pump's own list says about a tank, from the tank as the server answers after a change. */
function toPumpTank(tank: Tank): PumpTank {
  return {
    id: tank.id,
    fuel_type: tank.fuel_type,
    current_stock_litres: tank.current_stock_litres,
    low_stock_threshold_litres: tank.low_stock_threshold_litres,
    capacity_litres: tank.capacity_litres,
    is_low: tank.is_low,
    opening_set: tank.opening_set,
  };
}

/** One pump or tie-up bunk of the office: its details, its tanks and stock (police pumps), and its staff logins. */
@Component({
  selector: 'app-pump-detail-page',
  imports: [
    ConfirmButton,
    Icon,
    LoadError,
    MapView,
    PageHeader,
    PumpForm,
    PumpTankCard,
    ReactiveFormsModule,
    StatusBadge,
  ],
  templateUrl: './pump-detail-page.html',
  styles: `
    h2 {
      font-size: 18px;
    }

    h3 {
      font-size: 15px;
    }

    .form-slot,
    section {
      margin-bottom: 16px;
    }

    section.card {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .card-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px 12px;
      margin-bottom: 12px;
    }

    section.card > .card-head {
      margin-bottom: 0;
    }

    .detail-map {
      --map-height: 240px;
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
        overflow-wrap: anywhere;
      }
    }

    .fuels {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px;
    }

    .fuel {
      height: 26px;
      padding: 0 12px;
      font-size: 12.5px;
    }

    .month {
      display: flex;
      align-items: center;
      gap: 8px;

      .btn-icon {
        width: 40px;
        height: 40px;
      }
    }

    .month-label {
      min-width: 120px;
      font-weight: 600;
      text-align: center;
    }

    // One card per row: each holds a table of stock entries that needs the width.
    .tanks {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
    }

    .staff-row {
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 10px 14px;
    }

    .staff-main {
      display: flex;
      flex: 1 1 200px;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .staff-name {
      font-size: 16px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .staff-login {
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .staff-actions {
      display: flex;
      flex: 1 1 100%;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    .reset {
      display: flex;
      flex: 1 1 100%;
      flex-direction: column;
      gap: 10px;
      max-width: 360px;
    }

    .reset-actions,
    .form-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .add-staff {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--border);

      .form-grid {
        width: 100%;
      }

      button[type='submit'] {
        align-self: flex-start;
      }
    }
  `,
})
export class PumpDetailPage {
  private readonly pumps = inject(PumpsApi);
  private readonly people = inject(PeopleApi);
  private readonly toasts = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly fb = inject(NonNullableFormBuilder);

  /** The pump's id, from the route. */
  readonly id = input.required<string>();
  protected readonly pumpId = computed(() => Number(this.id()));

  // Each part loads on its own, so one failing request leaves the others on screen.
  protected readonly pump = new Panel<Pump>(() => this.pumps.get(this.pumpId()));
  /** The server lists the staff of every pump of the office; this keeps the ones of this pump. */
  protected readonly staff = new Panel<Person[]>(() =>
    this.people
      .list('pump-staff')
      .pipe(map((rows) => rows.filter((person) => person.pump === this.pumpId()))),
  );

  protected readonly fuelLabel = fuelLabel;
  protected readonly pumpFuels = pumpFuels;
  protected readonly monthLabel = monthLabel;
  protected readonly inService = (person: Person) => IN_SERVICE.includes(person.status);

  /** Set while an action on the pump waits for the server's answer. */
  protected readonly busy = signal(false);
  protected readonly editTarget = signal<Pump | null>(null);

  /** The month of the stock entries shown on the tank cards. */
  protected readonly month = signal(currentMonth());
  protected readonly thisMonth = computed(() => this.month() >= currentMonth());

  /** The member of staff whose action waits for the server's answer. */
  protected readonly busyId = signal<number | null>(null);
  protected readonly resetFor = signal<number | null>(null);
  protected readonly resetValue = signal('');
  protected readonly resetError = signal('');

  protected readonly staffForm = this.fb.group({
    username: [''],
    full_name: [''],
    mobile: [''],
    emp_id: [''],
    password: [''],
  });
  protected readonly adding = signal(false);
  protected readonly addError = signal('');

  protected readonly point = computed<LatLng | null>(() => {
    const pump = this.pump.data();
    return pump ? pumpToPoint(pump) : null;
  });
  protected readonly markers = computed<MapMarker[]>(() => {
    const pump = this.pump.data();
    const point = this.point();
    if (!pump || !point) {
      return [];
    }
    return [
      {
        id: pump.id,
        ...point,
        label: pump.name,
        tone: pumpTone(pump.kind),
      },
    ];
  });

  constructor() {
    effect(() => {
      this.pumpId();
      untracked(() => {
        this.resetAll();
        this.loadAll();
      });
    });
  }

  protected loadAll(): void {
    this.pump.load();
    this.staff.load();
  }

  /** A different pump: nothing of the last one stays on screen or in a form. */
  private resetAll(): void {
    this.pump.reset();
    this.staff.reset();
    this.busy.set(false);
    this.editTarget.set(null);
    this.month.set(currentMonth());
    this.busyId.set(null);
    this.closeReset();
    this.staffForm.reset();
    this.adding.set(false);
    this.addError.set('');
  }

  // ---------------------------------------------------------------- pump

  protected edited(saved: Pump): void {
    this.editTarget.set(null);
    this.pump.set(saved);
    this.toasts.show('Pump updated.');
  }

  protected setActive(active: boolean): void {
    if (this.busy()) {
      return;
    }
    const mine = this.pumpId();
    this.busy.set(true);
    const call = active ? this.pumps.activate(mine) : this.pumps.deactivate(mine);
    call.subscribe({
      next: (saved) => {
        if (mine === this.pumpId()) {
          this.busy.set(false);
          this.pump.set(saved);
          this.toasts.show(active ? 'Pump activated.' : 'Pump deactivated.');
        }
      },
      error: (err) => {
        if (mine === this.pumpId()) {
          this.busy.set(false);
          this.toasts.show(apiErrorMessage(err), 'danger');
        }
      },
    });
  }

  // ---------------------------------------------------------------- tanks

  protected moveMonth(by: number): void {
    const next = addMonths(this.month(), by);
    if (next <= currentMonth()) {
      this.month.set(next);
    }
  }

  /** A tank's levels were saved: the card shows the server's answer. */
  protected tankChanged(saved: Tank): void {
    const current = this.pump.data();
    if (current) {
      this.pump.set({
        ...current,
        tanks: current.tanks.map((tank) => (tank.id === saved.id ? toPumpTank(saved) : tank)),
      });
    }
  }

  // ---------------------------------------------------------------- staff

  protected act(person: Person, action: PersonAction): void {
    this.runForPerson(this.people.act('pump-staff', person.id, action), person, () => {
      this.toasts.show(`${person.full_name} ${PAST_TENSE[action]}.`);
      this.staff.load(true);
    });
  }

  /** Runs one action on one member of staff at a time, and ignores its answer if the page has moved to another pump. */
  private runForPerson<T>(
    call: Observable<T>,
    person: Person,
    done: () => void,
    failed: (message: string) => void = (message) => this.toasts.show(message, 'danger'),
  ): void {
    if (this.busyId() !== null) {
      return;
    }
    const mine = this.pumpId();
    this.busyId.set(person.id);
    call.subscribe({
      next: () => {
        if (mine === this.pumpId()) {
          this.busyId.set(null);
          done();
        }
      },
      error: (err) => {
        if (mine === this.pumpId()) {
          this.busyId.set(null);
          failed(apiErrorMessage(err));
        }
      },
    });
  }

  protected openReset(person: Person): void {
    this.resetFor.set(person.id);
    this.resetValue.set('');
    this.resetError.set('');
    afterNextRender(() => document.getElementById(`staff-reset-${person.id}`)?.focus(), {
      injector: this.injector,
    });
  }

  protected closeReset(): void {
    this.resetFor.set(null);
    this.resetValue.set('');
    this.resetError.set('');
  }

  protected submitReset(event: Event, person: Person): void {
    event.preventDefault();
    const password = this.resetValue();
    if (!password) {
      this.resetError.set('Type a new password.');
      return;
    }
    this.resetError.set('');
    this.runForPerson(
      this.people.resetPassword('pump-staff', person.id, password),
      person,
      () => {
        this.closeReset();
        this.toasts.show(
          `Password reset for ${person.full_name}. They must change it at next login.`,
        );
      },
      (message) => this.resetError.set(message),
    );
  }

  protected addStaff(): void {
    if (this.adding()) {
      return;
    }
    const value = this.staffForm.getRawValue();
    const username = value.username.trim();
    const fullName = value.full_name.trim();
    if (!username || !fullName || !value.password) {
      this.addError.set(INCOMPLETE_LOGIN);
      return;
    }
    const empId = value.emp_id.trim().toUpperCase();
    const mine = this.pumpId();
    this.addError.set('');
    this.adding.set(true);
    this.people
      .create('pump-staff', {
        username,
        full_name: fullName,
        mobile: value.mobile.trim(),
        ...(empId ? { emp_id: empId } : {}),
        password: value.password,
        pump: mine,
      })
      .subscribe({
        next: () => {
          if (mine !== this.pumpId()) {
            return;
          }
          this.adding.set(false);
          this.staffForm.reset();
          this.toasts.show('Staff login added.');
          this.staff.load(true);
        },
        error: (err) => {
          if (mine === this.pumpId()) {
            this.adding.set(false);
            this.addError.set(apiErrorMessage(err));
          }
        },
      });
  }
}
