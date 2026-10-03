import {
  afterNextRender,
  Component,
  inject,
  InjectionToken,
  Injector,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import {
  CheckedRequest,
  FuelRequest,
  FuelRequestsApi,
  IncomingRequest,
} from '../../core/api/fuel-requests-api';
import { fuelLabel } from '../../core/api/vehicles-api';
import { apiErrorMessage } from '../../core/api-error';
import { NOW } from '../../core/clock';
import { formatTime, litres } from '../../core/format';
import { Panel } from '../../core/panel';
import { periodOf, todayIso } from '../../core/period';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';

const NO_PIN = 'Enter the 6-digit PIN.';
const PIN_LENGTH = 6;

/** How often the list of waiting vehicles is read again while the page is open. */
export const INCOMING_POLL_MS = new InjectionToken<number>('INCOMING_POLL_MS', {
  factory: () => 30_000,
});

/** What the last fill came to: the fill that was made, or why it was refused. */
type Outcome = { ok: true; fill: FuelRequest } | { ok: false; message: string };

/**
 * The vehicles waiting at this pump: pick one, check the driver's PIN to see the litres, fill exactly those. Built to
 * be quick on a phone, with the day's fills beside it.
 */
@Component({
  selector: 'app-fill-page',
  imports: [EmptyState, Icon, LoadError, PageHeader],
  templateUrl: './fill-page.html',
  styles: `
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;

      @media (min-width: 1000px) {
        grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
        align-items: start;
      }
    }

    .side {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 0;
    }

    h2 {
      margin-bottom: 14px;
      font-size: 18px;
    }

    form {
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    #fill-pin {
      height: 76px;
      font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
      font-size: 36px;
      font-weight: 700;
      letter-spacing: 0.4em;
      // letter-spacing trails the last digit; shift back so the digits sit centred
      text-align: center;
      text-indent: 0.4em;
    }

    .fill-submit {
      height: 64px;
      font-size: 18px;
    }

    .result {
      display: flex;
      flex-direction: column;
      gap: 6px;
      scroll-margin: 96px 0 120px;
      overflow-wrap: anywhere;

      p {
        margin: 0;
      }
    }

    .result-head {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .result-ok {
      background: color-mix(in srgb, var(--success) 14%, white);

      .result-head {
        color: color-mix(in srgb, var(--success) 55%, black);
      }
    }

    .result-error {
      background: color-mix(in srgb, var(--danger) 10%, white);

      .result-head,
      .result-message {
        color: color-mix(in srgb, var(--danger) 80%, black);
      }
    }

    .result-message {
      font-size: 17px;
      font-weight: 600;
    }

    .result-vehicle {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }

    .result-litres {
      font-size: 34px;
      font-weight: 700;
      letter-spacing: -0.03em;
      line-height: 1.1;
    }

    .emergency-badge {
      align-self: flex-start;
      background: color-mix(in srgb, var(--accent) 22%, white);
      color: color-mix(in srgb, var(--accent) 40%, black);
    }

    .fills {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .fill {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 14px 0;
      border-bottom: 1px solid var(--border);
      overflow-wrap: anywhere;

      &:first-child {
        padding-top: 0;
      }

      &:last-child {
        padding-bottom: 0;
        border-bottom: 0;
      }
    }

    .top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
    }

    .registration {
      font-size: 17px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    .amount {
      flex: none;
      font-size: 17px;
      font-weight: 700;
    }

    .meta {
      margin: 0;
      font-size: 14px;
    }

    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;

      h2 {
        margin: 0;
      }
    }

    #fill-card {
      display: flex;
      flex-direction: column;
      gap: 16px;
      scroll-margin: 96px 0 120px;
      overflow-wrap: anywhere;

      p {
        margin: 0;
      }
    }

    .back {
      align-self: flex-start;
    }

    .chosen {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .chosen-vehicle {
      margin: 0;
      font-size: 26px;
      letter-spacing: 0.04em;
    }

    .to-fill {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
    }

    .to-fill-label {
      font-size: 14px;
      font-weight: 600;
    }

    .to-fill-litres {
      font-size: 44px;
      font-weight: 700;
      letter-spacing: -0.03em;
      line-height: 1.05;
    }

    .incoming-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .incoming-row {
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--surface);

      &.chosen-row {
        border-color: var(--primary);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 35%, transparent);
      }
    }

    .pick {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      min-width: 0;
      padding: 14px 16px;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      overflow-wrap: anywhere;

      &:focus-visible {
        outline: 2px solid var(--primary-strong);
        outline-offset: -2px;
        border-radius: 16px;
      }
    }

    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .call {
      flex: none;
      margin-right: 10px;
    }
  `,
})
export class FillPage {
  private readonly api = inject(FuelRequestsApi);
  private readonly injector = inject(Injector);
  private readonly now = inject(NOW);

  protected readonly litres = litres;
  protected readonly formatTime = formatTime;
  protected readonly fuelLabel = fuelLabel;

  /** The requests drivers raised for this pump, oldest first. */
  protected readonly incoming = new Panel<IncomingRequest[]>(() => this.api.incoming());
  /** Today's fills at this pump: today in India, worked out again on every load. */
  protected readonly fills = new Panel<FuelRequest[]>(() =>
    this.api.pumpFills(periodOf('day', todayIso(this.now()))),
  );

  protected readonly selected = signal<IncomingRequest | null>(null);
  /** The selected request once its PIN was right: the litres to fill. */
  protected readonly checked = signal<CheckedRequest | null>(null);
  protected readonly pin = signal('');
  protected readonly formError = signal('');
  protected readonly saving = signal(false);
  protected readonly outcome = signal<Outcome | null>(null);

  constructor() {
    this.incoming.load();
    this.fills.load();
    // New requests arrive while the page is open.
    interval(inject(INCOMING_POLL_MS))
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.incoming.load(true));
  }

  protected choose(request: IncomingRequest): void {
    this.selected.set(request);
    this.checked.set(null);
    this.pin.set('');
    this.formError.set('');
    this.outcome.set(null);
    afterNextRender(
      () => {
        document.getElementById('fill-card')?.scrollIntoView?.({ block: 'nearest' });
        document.getElementById('fill-pin')?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  protected back(): void {
    this.selected.set(null);
    this.checked.set(null);
    this.formError.set('');
  }

  /**
   * The PIN takes digits only, so a stray letter never costs one of the driver's five attempts. The box has no
   * maxlength: it would cut a pasted "123 456" before the space is dropped, so the first six digits are kept here.
   */
  protected typePin(event: Event): void {
    const box = event.target as HTMLInputElement;
    const digits = box.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
    box.value = digits;
    this.pin.set(digits);
  }

  /** Tapping the PIN box selects what is in it, so the next digits replace a PIN that was refused. */
  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  protected isEmergency(fill: FuelRequest): boolean {
    return Number(fill.emergency_litres) > 0;
  }

  protected checkPin(): void {
    const request = this.selected();
    if (!request || this.saving()) {
      return;
    }
    // A short PIN is not sent: the server would count it as a wrong attempt.
    if (!/^\d{6}$/.test(this.pin())) {
      this.formError.set(NO_PIN);
      return;
    }
    this.formError.set('');
    this.saving.set(true);
    this.api.checkPin(request.id, this.pin()).subscribe({
      next: (checked) => {
        this.saving.set(false);
        this.checked.set(checked);
      },
      error: (err) => {
        this.saving.set(false);
        // The server's own words, such as "Wrong PIN. 4 attempt(s) left."
        this.formError.set(apiErrorMessage(err));
      },
    });
  }

  protected fill(): void {
    const request = this.selected();
    if (!request || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.api.fill(request.id, this.pin()).subscribe({
      next: (fill) => {
        this.saving.set(false);
        this.back();
        this.outcome.set({ ok: true, fill });
        this.incoming.load(true);
        this.fills.load(true);
        this.showOutcome();
      },
      error: (err) => {
        this.saving.set(false);
        this.back();
        this.outcome.set({ ok: false, message: apiErrorMessage(err) });
        this.incoming.load(true);
        this.showOutcome();
      },
    });
  }

  /** The result may be above the screen once the keyboard is down: bring it into view. */
  private showOutcome(): void {
    afterNextRender(
      () => document.getElementById('fill-result')?.scrollIntoView?.({ block: 'nearest' }),
      { injector: this.injector },
    );
  }
}
