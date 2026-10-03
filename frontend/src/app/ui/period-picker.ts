import { Component, computed, inject, model, signal } from '@angular/core';
import { NOW } from '../core/clock';
import {
  checkCustomPeriod,
  customPeriod,
  Period,
  PERIOD_KINDS,
  PeriodKind,
  periodLabel,
  periodOf,
  periodRange,
  shiftPeriod,
  todayIso,
} from '../core/period';
import { Icon } from './icon';

let nextId = 0;

/**
 * Chooses the period a statement covers: a day, a week, a month or a financial year stepped with arrows (never into
 * the future), or a custom range of two dates. Two-way bound: `[(period)]`.
 */
@Component({
  selector: 'app-period-picker',
  imports: [Icon],
  template: `
    <div class="chips kinds" role="group" aria-label="Period">
      @for (option of kinds; track option.kind) {
        <button
          type="button"
          class="chip"
          [class.active]="period().kind === option.kind"
          [attr.aria-pressed]="period().kind === option.kind"
          (click)="choose(option.kind)"
        >
          {{ option.label }}
        </button>
      }
    </div>

    @if (period().kind === 'custom') {
      <div class="custom">
        <div class="field">
          <label [for]="id + '-from'">From</label>
          <input
            #from
            type="date"
            [id]="id + '-from'"
            [value]="period().from"
            [max]="today()"
            (change)="setCustom(from.value, to.value)"
          />
        </div>
        <div class="field">
          <label [for]="id + '-to'">To</label>
          <input
            #to
            type="date"
            [id]="id + '-to'"
            [value]="period().to"
            [max]="today()"
            (change)="setCustom(from.value, to.value)"
          />
        </div>
      </div>
      @if (customError()) {
        <p class="field-error" role="alert">{{ customError() }}</p>
      }
    } @else {
      <div class="stepper">
        <button
          type="button"
          class="btn-icon"
          [attr.aria-label]="'Previous ' + period().kind"
          (click)="step(-1)"
        >
          <app-icon name="chevron-left" [size]="20" />
        </button>
        <div class="named">
          <strong class="label" aria-live="polite">{{ label() }}</strong>
          @if (period().from !== period().to) {
            <span class="range muted">{{ range() }}</span>
          }
        </div>
        <button
          type="button"
          class="btn-icon"
          [attr.aria-label]="'Next ' + period().kind"
          [disabled]="!canStepForward()"
          (click)="step(1)"
        >
          <app-icon name="chevron-right" [size]="20" />
        </button>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 14px;
      min-width: 0;
    }

    .kinds {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .stepper {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .named {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      align-items: center;
      min-width: 0;
      text-align: center;
    }

    .label {
      font-size: 17px;
    }

    .range {
      font-size: 13px;
    }

    .custom {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
  `,
})
export class PeriodPicker {
  readonly period = model.required<Period>();

  private readonly now = inject(NOW);

  protected readonly kinds = PERIOD_KINDS;
  protected readonly id = `period-${++nextId}`;
  protected readonly label = computed(() => periodLabel(this.period()));
  protected readonly range = computed(() => periodRange(this.period()));
  protected readonly customError = signal('');

  protected today(): string {
    return todayIso(this.now());
  }

  protected canStepForward(): boolean {
    return shiftPeriod(this.period(), 1).from <= this.today();
  }

  /** Switches kind around the last day shown, or around today when the period runs past it. */
  protected choose(kind: PeriodKind): void {
    const current = this.period();
    if (kind === current.kind) {
      return;
    }
    this.customError.set('');
    if (kind === 'custom') {
      this.period.set(customPeriod(current.from, current.to));
      return;
    }
    const today = this.today();
    this.period.set(periodOf(kind, current.to < today ? current.to : today));
  }

  protected step(by: number): void {
    const next = shiftPeriod(this.period(), by);
    if (next.from > this.today()) {
      return;
    }
    this.period.set(next);
  }

  protected setCustom(from: string, to: string): void {
    const problem = checkCustomPeriod(from, to);
    this.customError.set(problem);
    if (!problem) {
      this.period.set(customPeriod(from, to));
    }
  }
}
