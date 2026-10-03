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
import { PeopleApi, Person, PersonAction, PersonStatus } from '../../core/api/people-api';
import { apiErrorMessage } from '../../core/api-error';
import { ConfirmButton } from '../../ui/confirm-button';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';
import { StatusBadge } from '../../ui/status-badge';
import { ToastService } from '../../ui/toast';
import { PersonForm } from './person-form';

type Chip = { value: PersonStatus | undefined; label: string };

const PAST_TENSE: Readonly<Record<PersonAction, string>> = {
  pause: 'paused',
  resume: 'resumed',
  terminate: 'terminated',
};

/** Statuses in which the server still lets the MTO change a person's details. */
const EDITABLE: readonly PersonStatus[] = ['ACTIVE', 'PAUSED', 'PENDING_APPROVAL'];

/** Statuses of people who can still log in or be paused, terminated or given a new password. */
const IN_SERVICE: readonly PersonStatus[] = ['ACTIVE', 'PAUSED'];

/** The MTO's drivers or officers (the route's `kind`): find them, add or change them, and manage their access. */
@Component({
  selector: 'app-people-page',
  imports: [ConfirmButton, EmptyState, Icon, LoadError, PageHeader, PersonForm, StatusBadge],
  templateUrl: './people-page.html',
  styles: `
    .form-slot {
      margin-bottom: 20px;
    }

    .toolbar {
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin-bottom: 20px;
    }

    .search {
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: 460px;

      .field {
        flex: 1;
      }
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    // Phones and tablets: every person is a card, and each cell names itself with its data-label.
    // From 1280px the same markup is a table.
    .people {
      display: block;
      width: 100%;
    }

    thead {
      display: none;
    }

    tbody {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;

      @media (min-width: 640px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    .person {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px 12px;
      padding: 18px;
      border-radius: var(--radius-md);
      background: var(--surface);
      box-shadow: var(--shadow-card);

      td {
        display: flex;
        grid-column: 1 / -1;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-width: 0;
        overflow-wrap: anywhere;
        text-align: right;
      }

      td::before {
        content: attr(data-label);
        flex: none;
        color: var(--muted);
        font-size: 13px;
        font-weight: 600;
        text-align: left;
      }

      td[data-label='Name'] {
        grid-column: 1;
        grid-row: 1;
        justify-content: flex-start;
        font-size: 17px;
        font-weight: 700;
        text-align: left;
      }

      td[data-label='Status'] {
        grid-column: 2;
        grid-row: 1;
      }

      td[data-label='Name']::before,
      td[data-label='Status']::before,
      td[data-label='Actions']::before {
        display: none;
      }

      td[data-label='Actions'] {
        padding-top: 14px;
        border-top: 1px solid var(--border);
        text-align: left;
      }
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .reset {
      display: flex;
      flex: 1 1 100%;
      flex-direction: column;
      gap: 10px;
      min-width: 220px;
      padding-top: 6px;
    }

    .reset-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    @media (min-width: 1280px) {
      .people-wrap {
        max-width: 100%;
        overflow-x: auto;
        padding: 8px 20px;
        border-radius: var(--radius-md);
        background: var(--surface);
        box-shadow: var(--shadow-card);
      }

      .people {
        display: table;
        border-collapse: collapse;
        font-size: 14px;
      }

      thead {
        display: table-header-group;
      }

      tbody {
        display: table-row-group;
      }

      th {
        padding: 12px 10px;
        color: var(--muted);
        font-size: 12.5px;
        font-weight: 600;
        text-align: left;
      }

      .person {
        display: table-row;
        padding: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;

        td,
        td[data-label='Name'],
        td[data-label='Actions'] {
          display: table-cell;
          padding: 12px 10px;
          border-top: 1px solid var(--border);
          font-size: 14px;
          font-weight: 400;
          text-align: left;
          vertical-align: middle;
        }

        td[data-label='Name'] {
          font-weight: 700;
        }

        td::before {
          display: none;
        }

        td[data-label='Actions'] {
          max-width: 340px;
        }
      }
    }
  `,
})
export class PeoplePage {
  private readonly api = inject(PeopleApi);
  private readonly toasts = inject(ToastService);
  private readonly injector = inject(Injector);
  /** Counts loads, so a slow answer for a filter the user has already left is ignored. */
  private loads = 0;

  readonly kind = input.required<'drivers' | 'officers'>();

  protected readonly isDriver = computed(() => this.kind() === 'drivers');
  protected readonly title = computed(() => (this.isDriver() ? 'Drivers' : 'Officers'));
  protected readonly noun = computed(() => (this.isDriver() ? 'driver' : 'officer'));
  protected readonly subtitle = computed(() =>
    this.isDriver()
      ? 'The drivers of your office.'
      : 'The officers of your office. A new officer needs PTO approval.',
  );
  protected readonly chips = computed<Chip[]>(() => [
    { value: undefined, label: 'All' },
    { value: 'ACTIVE', label: 'Active' },
    { value: 'PAUSED', label: 'Paused' },
    ...(this.isDriver() ? [] : [{ value: 'PENDING_APPROVAL' as const, label: 'Waiting for PTO' }]),
    { value: 'TERMINATED', label: 'Terminated' },
  ]);

  protected readonly people = signal<Person[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  /** The status chosen with the chips; undefined is "All". */
  protected readonly status = signal<PersonStatus | undefined>(undefined);
  /** What is typed in the search box, and what the list is currently narrowed by. */
  protected readonly searchText = signal('');
  protected readonly search = signal('');
  protected readonly filtered = computed(() => !!this.search() || !!this.status());

  protected readonly formOpen = signal(false);
  protected readonly editing = signal<Person | null>(null);
  /** The person whose action is waiting for the server's answer. */
  protected readonly busyId = signal<number | null>(null);

  protected readonly resetFor = signal<number | null>(null);
  protected readonly resetValue = signal('');
  protected readonly resetError = signal('');

  constructor() {
    effect(() => {
      this.kind();
      untracked(() => {
        this.status.set(undefined);
        this.searchText.set('');
        this.search.set('');
        this.closeForm();
        this.closeReset();
        this.load();
      });
    });
  }

  /** Reads the people matching the search and status; `quiet` keeps the current list on screen while it does. */
  protected load(quiet = false): void {
    const mine = ++this.loads;
    if (!quiet) {
      this.loading.set(true);
    }
    this.loadError.set('');
    this.api.list(this.kind(), { search: this.search(), status: this.status() }).subscribe({
      next: (rows) => {
        if (mine === this.loads) {
          this.people.set(rows);
          this.loading.set(false);
        }
      },
      error: (err) => {
        if (mine === this.loads) {
          this.loadError.set(apiErrorMessage(err));
          this.loading.set(false);
        }
      },
    });
  }

  protected choose(status: PersonStatus | undefined): void {
    if (status === this.status()) {
      return;
    }
    this.status.set(status);
    this.load();
  }

  protected typeSearch(text: string): void {
    this.searchText.set(text);
    // Emptying the box shows everyone again without another press.
    if (!text.trim() && this.search()) {
      this.search.set('');
      this.load();
    }
  }

  protected applySearch(event: Event): void {
    event.preventDefault();
    this.search.set(this.searchText().trim());
    this.load();
  }

  protected vehicles(person: Person): string {
    return person.current_vehicles.map((v) => v.registration_number).join(', ') || 'None';
  }

  protected canEdit(person: Person): boolean {
    return EDITABLE.includes(person.status);
  }

  protected inService(person: Person): boolean {
    return IN_SERVICE.includes(person.status);
  }

  protected openAdd(): void {
    this.closeReset();
    this.editing.set(null);
    this.formOpen.set(true);
  }

  protected openEdit(person: Person): void {
    this.closeReset();
    this.editing.set(person);
    this.formOpen.set(true);
  }

  protected closeForm(): void {
    this.formOpen.set(false);
    this.editing.set(null);
  }

  protected saved(): void {
    const edited = this.editing() !== null;
    const name = this.isDriver() ? 'Driver' : 'Officer';
    this.closeForm();
    if (edited) {
      this.toasts.show(`${name} updated.`);
    } else {
      this.toasts.show(this.isDriver() ? 'Driver added.' : 'Officer sent to PTO for approval.');
    }
    this.load(true);
  }

  protected act(person: Person, action: PersonAction): void {
    if (this.busyId() !== null) {
      return;
    }
    this.busyId.set(person.id);
    this.api.act(this.kind(), person.id, action).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toasts.show(`${person.full_name} ${PAST_TENSE[action]}.`);
        this.load(true);
      },
      error: (err) => {
        this.busyId.set(null);
        this.toasts.show(apiErrorMessage(err), 'danger');
      },
    });
  }

  protected openReset(person: Person): void {
    this.resetFor.set(person.id);
    this.resetValue.set('');
    this.resetError.set('');
    afterNextRender(() => document.getElementById(`reset-${person.id}`)?.focus(), {
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
    if (this.busyId() !== null) {
      return;
    }
    const password = this.resetValue();
    if (!password) {
      this.resetError.set('Type a new password.');
      return;
    }
    this.resetError.set('');
    this.busyId.set(person.id);
    this.api.resetPassword(this.kind(), person.id, password).subscribe({
      next: () => {
        this.busyId.set(null);
        this.closeReset();
        this.toasts.show(
          `Password reset for ${person.full_name}. They must change it at next login.`,
        );
      },
      error: (err) => {
        this.busyId.set(null);
        this.resetError.set(apiErrorMessage(err));
      },
    });
  }
}
