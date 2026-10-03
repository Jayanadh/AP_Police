import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { fuelLabel, Vehicle, VehicleStatus, VehiclesApi } from '../../core/api/vehicles-api';
import { litres } from '../../core/format';
import { Panel } from '../../core/panel';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';
import { StatusBadge } from '../../ui/status-badge';
import { ToastService } from '../../ui/toast';
import { VehicleForm } from './vehicle-form';

type Chip = { value: VehicleStatus | undefined; label: string };

const CHIPS: readonly Chip[] = [
  { value: undefined, label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'TERMINATION_PENDING', label: 'Termination pending' },
  { value: 'TERMINATED', label: 'Terminated' },
];

/** The MTO's vehicles: find one, add one, and open one to see and manage it. */
@Component({
  selector: 'app-vehicles-page',
  imports: [EmptyState, Icon, LoadError, PageHeader, RouterLink, StatusBadge, VehicleForm],
  templateUrl: './vehicles-page.html',
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

    .vehicles {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
      margin: 0;
      padding: 0;
      list-style: none;

      @media (min-width: 640px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      @media (min-width: 1100px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    .vehicle {
      display: flex;
      flex-direction: column;
      gap: 14px;
      height: 100%;
      color: inherit;
      text-decoration: none;
      transition:
        box-shadow 0.15s ease,
        transform 0.1s ease;

      &:hover {
        box-shadow: var(--shadow-float);
      }

      &:active {
        transform: scale(0.99);
      }
    }

    .top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .registration {
      display: block;
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.02em;
      overflow-wrap: anywhere;
    }

    .make {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 10px;
      margin-top: 4px;
    }

    .fuel {
      height: 26px;
      padding: 0 12px;
      font-size: 12.5px;
    }

    .rows {
      display: grid;
      gap: 8px;
      margin: 0;
      padding-top: 14px;
      border-top: 1px solid var(--border);
      font-size: 14px;

      > div {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }

      dt {
        flex: none;
        color: var(--muted);
        font-weight: 600;
      }

      dd {
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
        text-align: right;
      }
    }
  `,
})
export class VehiclesPage {
  private readonly api = inject(VehiclesApi);
  private readonly toasts = inject(ToastService);

  protected readonly chips = CHIPS;
  protected readonly fuelLabel = fuelLabel;
  protected readonly litres = litres;

  /** The status chosen with the chips; undefined is "All". */
  protected readonly status = signal<VehicleStatus | undefined>(undefined);
  /** What is typed in the search box, and what the list is currently narrowed by. */
  protected readonly searchText = signal('');
  protected readonly search = signal('');
  protected readonly filtered = computed(() => !!this.search() || !!this.status());
  protected readonly formOpen = signal(false);

  protected readonly vehicles = new Panel<Vehicle[]>(() =>
    this.api.list({ search: this.search(), status: this.status() }),
  );

  constructor() {
    this.vehicles.load();
  }

  protected choose(status: VehicleStatus | undefined): void {
    if (status === this.status()) {
      return;
    }
    this.status.set(status);
    this.vehicles.load();
  }

  protected typeSearch(text: string): void {
    this.searchText.set(text);
    // Emptying the box shows every vehicle again without another press.
    if (!text.trim() && this.search()) {
      this.search.set('');
      this.vehicles.load();
    }
  }

  protected applySearch(event: Event): void {
    event.preventDefault();
    this.search.set(this.searchText().trim());
    this.vehicles.load();
  }

  protected saved(): void {
    this.formOpen.set(false);
    this.toasts.show('Vehicle added.');
    this.vehicles.load(true);
  }
}
