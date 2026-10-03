import { afterNextRender, Component, inject, Injector, input, OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MasterItem, MastersApi, MasterKind } from '../../core/api/masters-api';
import { apiErrorMessage } from '../../core/api-error';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { ToastService } from '../../ui/toast';

/** One master list (districts, designations or cadres): add a value, rename one, switch values on and off. */
@Component({
  selector: 'app-master-card',
  imports: [Icon, LoadError, ReactiveFormsModule],
  templateUrl: './master-card.html',
  styles: `
    :host {
      display: block;
    }

    h2 {
      margin-bottom: 16px;
      font-size: 19px;
    }

    .add {
      display: flex;
      align-items: flex-end;
      gap: 12px;
      margin-bottom: 16px;

      .field {
        flex: 1;
      }
    }

    .card > .error,
    .card > .empty {
      margin-bottom: 12px;
    }

    // A long name keeps its words whole: the buttons move under it when the card is narrow.
    .master-row {
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px 12px;
    }

    .master-name {
      flex: 1 1 140px;
      min-width: 0;
      font-weight: 600;
      overflow-wrap: break-word;

      &.off {
        color: var(--muted);
        font-weight: 500;
      }
    }

    .row-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }

    .rename {
      display: flex;
      flex: 1;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;

      .rename-field {
        flex: 1 1 160px;
        margin: 0;
      }
    }

    .toggle {
      flex: none;
      min-width: 88px;
      justify-content: center;
    }
  `,
})
export class MasterCard implements OnInit {
  private readonly api = inject(MastersApi);
  private readonly toasts = inject(ToastService);
  private readonly injector = inject(Injector);

  readonly kind = input.required<MasterKind>();
  /** The heading, plural: "Districts". */
  readonly title = input.required<string>();
  /** One value, lowercase: "district". */
  readonly noun = input.required<string>();

  protected readonly items = signal<MasterItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly error = signal('');
  protected readonly adding = signal(false);
  /** The item whose switch or new name is waiting for the server. */
  protected readonly busyId = signal<number | null>(null);
  /** The item being renamed, and the name typed for it. */
  protected readonly editingId = signal<number | null>(null);
  protected readonly draft = signal('');
  protected readonly form = inject(NonNullableFormBuilder).group({ name: [''] });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.api.list(this.kind(), false).subscribe({
      next: (rows) => {
        this.items.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(apiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  protected nameId(item: MasterItem): string {
    return `master-${this.kind()}-${item.id}-name`;
  }

  protected switchId(item: MasterItem): string {
    return `master-${this.kind()}-${item.id}-switch`;
  }

  protected editId(item: MasterItem): string {
    return `master-${this.kind()}-${item.id}-edit`;
  }

  protected startEdit(item: MasterItem): void {
    this.error.set('');
    this.editingId.set(item.id);
    this.draft.set(item.name);
    afterNextRender(() => document.getElementById(this.editId(item))?.focus(), {
      injector: this.injector,
    });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.error.set('');
  }

  protected rename(item: MasterItem): void {
    if (this.busyId() !== null) {
      return;
    }
    const name = this.draft().trim();
    if (!name) {
      this.error.set('Enter a name.');
      return;
    }
    if (name === item.name) {
      this.cancelEdit();
      return;
    }
    this.error.set('');
    this.busyId.set(item.id);
    this.api.update(this.kind(), item.id, { name }).subscribe({
      next: (updated) => {
        this.items.update((all) =>
          all
            .map((one) => (one.id === updated.id ? updated : one))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        this.busyId.set(null);
        this.editingId.set(null);
        this.toasts.show(`Renamed to ${updated.name}.`);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err));
        this.busyId.set(null);
      },
    });
  }

  protected add(): void {
    if (this.adding()) {
      return;
    }
    const name = this.form.controls.name.value.trim();
    if (!name) {
      this.error.set('Enter a name to add.');
      return;
    }
    this.error.set('');
    this.adding.set(true);
    this.api.create(this.kind(), name).subscribe({
      next: (created) => {
        this.items.update((all) => [...all, created].sort((a, b) => a.name.localeCompare(b.name)));
        this.form.reset();
        this.adding.set(false);
        this.toasts.show(`${this.capitalised(this.noun())} added.`);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err));
        this.adding.set(false);
      },
    });
  }

  protected toggle(item: MasterItem): void {
    if (this.busyId() !== null) {
      return;
    }
    this.error.set('');
    this.busyId.set(item.id);
    this.api.update(this.kind(), item.id, { is_active: !item.is_active }).subscribe({
      next: (updated) => {
        this.items.update((all) => all.map((one) => (one.id === updated.id ? updated : one)));
        this.busyId.set(null);
        this.toasts.show(`${updated.name} is now ${updated.is_active ? 'active' : 'inactive'}.`);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err));
        this.busyId.set(null);
      },
    });
  }

  private capitalised(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
}
