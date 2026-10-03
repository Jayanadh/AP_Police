import { Component, computed, input } from '@angular/core';
import { litres } from '../../core/format';
import { Icon } from '../../ui/icon';

/** The month's fuel of the driver's vehicle: the dashboard's `quota` and the quota API's answer both fit. */
export type FuelLeft = {
  limit_litres: string;
  used_litres: string;
  remaining_litres: string;
  emergency_remaining_litres: string;
};

/** The big amber "Fuel left this month" card of the driver's home and fuel pages. */
@Component({
  selector: 'app-fuel-left-card',
  imports: [Icon],
  template: `
    <section class="fuel-left" aria-labelledby="fuel-left-title">
      <div class="top">
        <h2 id="fuel-left-title">Fuel left this month</h2>
        <span class="icon"><app-icon name="fuel" [size]="22" /></span>
      </div>
      <p class="remaining">{{ remaining() }}</p>
      @if (over(); as over) {
        <p class="over">{{ over }} over the limit</p>
      }
      <p class="used">Used {{ used() }} of {{ limit() }}</p>
      <div
        class="progress"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="Fuel used this month"
        [attr.aria-valuenow]="percent()"
      >
        <span [style.width.%]="percent()"></span>
      </div>
      <p class="emergency">
        <app-icon name="alert-triangle" [size]="16" />
        Emergency: {{ emergencyLeft() }} left
      </p>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    // Dark ink on amber, as on the amber buttons (contrast ruling of Task 23).
    .fuel-left {
      position: relative;
      overflow: hidden;
      padding: 22px 22px 20px;
      border-radius: var(--radius-lg);
      background: linear-gradient(
        135deg,
        #f3c873 0%,
        var(--primary) 50%,
        var(--primary-strong) 100%
      );
      box-shadow: 0 16px 36px rgba(217, 152, 43, 0.3);
      color: var(--on-primary);

      // Soft rings in the corner, for depth.
      &::after {
        content: '';
        position: absolute;
        top: -70px;
        right: -60px;
        width: 200px;
        height: 200px;
        border: 28px solid rgba(255, 255, 255, 0.16);
        border-radius: 50%;
        pointer-events: none;
      }
    }

    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;

      h2 {
        font-size: 16px;
        font-weight: 600;
      }
    }

    .icon {
      position: relative;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.55);
    }

    .remaining {
      margin-top: 4px;
      font-size: 44px;
      font-weight: 700;
      letter-spacing: -0.03em;
      line-height: 1.1;
    }

    .over {
      font-weight: 700;
    }

    .used {
      margin: 6px 0 10px;
      font-size: 14px;
      font-weight: 600;
    }

    .progress {
      background: rgba(255, 255, 255, 0.5);

      > span {
        background: var(--on-primary);
      }
    }

    .emergency {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 14px;
      padding: 6px 12px;
      border-radius: var(--radius-pill);
      background: rgba(255, 255, 255, 0.55);
      font-size: 13.5px;
      font-weight: 600;
    }
  `,
})
export class FuelLeftCard {
  readonly quota = input.required<FuelLeft>();

  private readonly remainingLitres = computed(() => Number(this.quota().remaining_litres));

  /** What is left, never below zero: an emergency fill can take the month past its limit. */
  protected readonly remaining = computed(() => litres(Math.max(0, this.remainingLitres())));
  protected readonly over = computed(() =>
    this.remainingLitres() < 0 ? litres(-this.remainingLitres()) : '',
  );
  protected readonly used = computed(() => litres(this.quota().used_litres));
  protected readonly limit = computed(() => litres(this.quota().limit_litres));
  protected readonly emergencyLeft = computed(() =>
    litres(this.quota().emergency_remaining_litres),
  );

  /** Whole percent of the limit used, 0 to 100; a zero limit counts as full once anything is used. */
  protected readonly percent = computed(() => {
    const used = Number(this.quota().used_litres);
    const limit = Number(this.quota().limit_litres);
    const share = limit > 0 ? (used / limit) * 100 : used > 0 ? 100 : 0;
    return Math.min(100, Math.max(0, Math.round(share)));
  });
}
