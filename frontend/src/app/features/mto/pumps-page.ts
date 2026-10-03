import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Pump, pumpFuels, PumpsApi, pumpToPoint, pumpTone } from '../../core/api/pumps-api';
import { tankLevelPercent } from '../../core/api/tanks-api';
import { fuelLabel } from '../../core/api/vehicles-api';
import { litres } from '../../core/format';
import { Panel } from '../../core/panel';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { MapMarker, MapView } from '../../ui/map-view';
import { PageHeader } from '../../ui/page-header';
import { StatusBadge } from '../../ui/status-badge';
import { ToastService } from '../../ui/toast';
import { PumpForm } from './pump-form';

/** The MTO's pumps on a map and as cards: where they are, what they hold, and a way into each one. */
@Component({
  selector: 'app-pumps-page',
  imports: [EmptyState, Icon, LoadError, MapView, PageHeader, PumpForm, RouterLink, StatusBadge],
  templateUrl: './pumps-page.html',
  styles: `
    .form-slot,
    .map-slot {
      margin-bottom: 20px;
    }

    .pumps {
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

    .pump {
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

      &.selected {
        outline: 3px solid var(--primary-strong);
        outline-offset: 2px;
      }
    }

    .top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .name {
      display: block;
      margin-bottom: 6px;
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.02em;
      overflow-wrap: anywhere;
    }

    .where {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      font-size: 14px;

      > span {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        overflow-wrap: anywhere;
      }

      app-icon {
        margin-top: 2px;
        color: var(--muted);
      }
    }

    .fuels {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .fuel {
      height: 26px;
      padding: 0 12px;
      font-size: 12.5px;
    }

    .tanks {
      display: grid;
      gap: 12px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
    }

    .tank-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
      font-size: 14px;
    }

    .tank-name {
      font-weight: 600;
    }

    // Without a capacity the bar is only a rough guide, and this says so.
    .hint {
      margin-left: 6px;
      font-size: 12.5px;
      font-weight: 500;
    }

    .tank-stock {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .staff {
      margin: 0;
      margin-top: auto;
      font-size: 13px;
    }
  `,
})
export class PumpsPage {
  private readonly api = inject(PumpsApi);
  private readonly toasts = inject(ToastService);

  protected readonly litres = litres;
  protected readonly fuelLabel = fuelLabel;
  protected readonly pumpFuels = pumpFuels;
  protected readonly tankLevel = tankLevelPercent;

  protected readonly pumps = new Panel<Pump[]>(() => this.api.list());
  protected readonly formOpen = signal(false);
  /** The pump whose pin was clicked on the map. */
  protected readonly selectedId = signal<number | null>(null);

  protected readonly markers = computed<MapMarker[]>(() =>
    (this.pumps.data() ?? []).map((pump) => ({
      id: pump.id,
      ...pumpToPoint(pump),
      label: pump.is_active ? pump.name : `${pump.name} (inactive)`,
      tone: pump.id === this.selectedId() ? 'selected' : pumpTone(pump.kind),
    })),
  );

  constructor() {
    this.pumps.load();
  }

  protected staffText(pump: Pump): string {
    if (pump.staff_count === 0) {
      return 'No staff logins yet';
    }
    return `${pump.staff_count} staff login${pump.staff_count === 1 ? '' : 's'}`;
  }

  /** A pin was clicked: show which card it is. */
  protected select(id: number): void {
    this.selectedId.set(id);
    document
      .getElementById(`pump-card-${id}`)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }

  protected saved(): void {
    this.formOpen.set(false);
    this.toasts.show('Pump added.');
    this.pumps.load(true);
  }
}
