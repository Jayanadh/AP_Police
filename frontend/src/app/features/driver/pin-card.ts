import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { formatDateTime, litres } from '../../core/format';
import { ConfirmButton } from '../../ui/confirm-button';
import { Icon } from '../../ui/icon';

/** How often the countdown is brought up to date. */
const TICK_MS = 15_000;

/** "Expires in 2 h 5 min", rounded up to the minute; "This PIN has expired." once it has. */
function countdownText(msLeft: number): string {
  if (msLeft <= 0) {
    return 'This PIN has expired.';
  }
  const total = Math.ceil(msLeft / 60_000);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) {
    return `Expires in ${minutes} min`;
  }
  return minutes === 0 ? `Expires in ${hours} h` : `Expires in ${hours} h ${minutes} min`;
}

/** The driver's open fuel request: its PIN to show at the pump, how long it lasts, and a way to cancel it. */
@Component({
  selector: 'app-pin-card',
  imports: [ConfirmButton, Icon],
  template: `
    <section class="card card-hero pin-card" aria-labelledby="pin-title">
      <div class="head">
        <span class="head-icon"><app-icon name="lock" [size]="22" /></span>
        <div>
          <h2 id="pin-title">Your fuel PIN</h2>
          <p class="muted">
            @if (pump()) {
              Show it to the staff at {{ pump() }}.
            } @else {
              Show it to the staff at the pump.
            }
          </p>
        </div>
      </div>

      <div class="pin-box" [class.over]="msLeft() <= 0">
        <span class="sr-only">PIN {{ spokenPin() }}</span>
        <div class="pin" aria-hidden="true">{{ pin() }}</div>
        <p class="countdown" [class.error]="msLeft() <= 0">
          <app-icon name="clock" [size]="16" />
          {{ countdown() }}
        </p>
      </div>

      <dl class="facts">
        <div>
          <dt>Litres</dt>
          <dd>{{ litresText() }}</dd>
        </div>
        <div>
          <dt>Vehicle</dt>
          <dd>{{ vehicle() }}</dd>
        </div>
      </dl>
      <p class="valid-until muted">Valid until {{ validUntil() }}</p>

      <app-confirm-button
        class="cancel"
        label="Cancel request"
        confirmLabel="Tap again to cancel"
        tone="secondary"
        (confirmed)="cancel.emit()"
      />
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .pin-card {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .head {
      display: flex;
      align-items: center;
      gap: 14px;

      h2 {
        font-size: 18px;
      }

      p {
        font-size: 14px;
      }
    }

    .head-icon {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--primary) 22%, white);
      color: color-mix(in srgb, var(--primary-strong) 70%, black);
    }

    .pin-box {
      padding: 20px 12px 16px;
      border: 2px dashed color-mix(in srgb, var(--primary) 70%, white);
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--primary) 12%, white);
      text-align: center;

      &.over {
        opacity: 0.6;
      }
    }

    .pin {
      overflow-wrap: anywhere;
    }

    .countdown {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      font-size: 14px;
      font-weight: 600;
    }

    .facts {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin: 0;

      div {
        padding: 12px 14px;
        border-radius: var(--radius-sm);
        background: var(--surface-2);
      }

      dt {
        color: var(--muted);
        font-size: 13px;
        font-weight: 600;
      }

      dd {
        margin: 0;
        font-size: 17px;
        font-weight: 700;
        overflow-wrap: anywhere;
      }
    }

    .valid-until {
      margin-top: -4px;
      font-size: 14px;
    }

    .cancel {
      align-self: flex-start;
    }
  `,
})
export class PinCard {
  readonly pin = input.required<string>();
  /** The litres asked for, as the server sends them ("20.00"). */
  readonly litres = input.required<string>();
  /** The vehicle's registration number. */
  readonly vehicle = input.required<string>();
  /** When the PIN stops working (ISO 8601). */
  readonly expiresAt = input.required<string>();
  /** The pump the driver picked; only its staff can fill the request. */
  readonly pump = input('');

  readonly cancel = output<void>();
  /** Emitted once, when the PIN runs out while it is on screen. */
  readonly expired = output<void>();

  private readonly now = signal(Date.now());
  /** The expiry that `expired` was last emitted for, so it is emitted once per PIN. */
  private toldFor: string | null = null;

  protected readonly msLeft = computed(() => new Date(this.expiresAt()).getTime() - this.now());
  protected readonly countdown = computed(() => countdownText(this.msLeft()));
  protected readonly validUntil = computed(() => formatDateTime(this.expiresAt()));
  protected readonly litresText = computed(() => litres(this.litres()));
  /** "4 8 2 9 1 7", so a screen reader reads digits rather than a large number. */
  protected readonly spokenPin = computed(() => this.pin().split('').join(' '));

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    effect(() => {
      const expiresAt = this.expiresAt();
      if (this.msLeft() <= 0 && this.toldFor !== expiresAt) {
        this.toldFor = expiresAt;
        untracked(() => this.expired.emit());
      }
    });
  }
}
