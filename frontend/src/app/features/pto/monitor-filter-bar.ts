import { Component, input, output, signal } from '@angular/core';
import { MonitorFilters } from '../../core/api/monitor-api';
import { OfficeSelect } from '../../ui/office-select';

export type StatusOption = { value: string | undefined; label: string };

/** The filters of the PTO's monitoring lists: office, a search box and status chips. Emits all three on any change. */
@Component({
  selector: 'app-monitor-filter-bar',
  imports: [OfficeSelect],
  template: `
    <section class="card filters" aria-label="Filters">
      <app-office-select
        class="office"
        inputId="monitor-unit"
        (officeChange)="change({ unit: $event })"
      />
      <form class="search" role="search" (submit)="search($event, searchBox.value)">
        <div class="field">
          <label for="monitor-search">{{ searchLabel() }}</label>
          <input #searchBox id="monitor-search" type="search" [placeholder]="searchPlaceholder()" />
        </div>
        <button type="submit" class="btn btn-secondary">Search</button>
      </form>
      <div class="chips" role="group" aria-label="Status">
        @for (option of statuses(); track option.label) {
          <button
            type="button"
            class="chip"
            [class.active]="values().status === option.value"
            [attr.aria-pressed]="values().status === option.value"
            (click)="change({ status: option.value })"
          >
            {{ option.label }}
          </button>
        }
      </div>
    </section>
  `,
  styles: `
    .filters {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 16px 24px;
      margin-bottom: 20px;
    }

    .office {
      flex: 1 1 220px;
      max-width: 320px;
    }

    .search {
      display: flex;
      flex: 1 1 280px;
      align-items: flex-end;
      gap: 10px;
      max-width: 420px;

      .field {
        flex: 1 1 auto;
        min-width: 0;
        margin: 0;
      }
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      width: 100%;
    }
  `,
})
export class MonitorFilterBar {
  readonly statuses = input.required<readonly StatusOption[]>();
  readonly searchLabel = input.required<string>();
  readonly searchPlaceholder = input('');
  readonly filtersChange = output<MonitorFilters>();

  protected readonly values = signal<MonitorFilters>({});

  protected search(event: Event, value: string): void {
    event.preventDefault();
    this.change({ search: value.trim() });
  }

  protected change(changes: MonitorFilters): void {
    this.values.update((values) => ({ ...values, ...changes }));
    this.filtersChange.emit(this.values());
  }
}
