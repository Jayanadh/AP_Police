import { Component, computed, input } from '@angular/core';
import { Tank, tankLevelPercent } from '../../core/api/tanks-api';
import { fuelLabel } from '../../core/api/vehicles-api';
import { litres } from '../../core/format';

/** What the gauge needs of a tank: a tank on its own, or a row of the pump's dashboard. */
export type GaugeTank = Pick<
  Tank,
  'fuel_type' | 'current_stock_litres' | 'low_stock_threshold_litres' | 'capacity_litres' | 'is_low'
>;

/** One tank of the staff's own pump: the fuel, the litres in stock with a Low badge, the level bar and its alert level. */
@Component({
  selector: 'app-tank-level',
  template: `
    <div class="line">
      <span class="name">
        <strong class="fuel">{{ fuel() }}</strong>
        @if (tank().is_low) {
          <span class="badge badge-danger">Low</span>
        }
      </span>
      <span class="figure">{{ litres(tank().current_stock_litres) }}</span>
    </div>
    <div
      class="progress"
      [class.danger]="tank().is_low"
      role="meter"
      aria-valuemin="0"
      aria-valuemax="100"
      [attr.aria-label]="fuel() + ' level'"
      [attr.aria-valuenow]="percent().toFixed(0)"
      [attr.aria-valuetext]="litres(tank().current_stock_litres)"
    >
      <span [style.width.%]="percent()"></span>
    </div>
    <p class="notes muted">
      <span class="alert-level">Alert below {{ litres(tank().low_stock_threshold_litres) }}</span>
    </p>
  `,
  styles: `
    :host {
      display: block;
    }

    .line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }

    .name {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 17px;
    }

    .figure {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .notes {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 2px 12px;
      margin-top: 10px;
      font-size: 13px;
    }
  `,
})
export class TankLevel {
  readonly tank = input.required<GaugeTank>();

  protected readonly litres = litres;
  protected readonly fuel = computed(() => fuelLabel(this.tank().fuel_type));
  protected readonly percent = computed(() => tankLevelPercent(this.tank()));
}
