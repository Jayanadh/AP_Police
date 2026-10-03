import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';

export const CONFIRM_RESET_MS = 4000;

/** A second click sooner than this after arming is treated as a double-tap and ignored. */
export const CONFIRM_GUARD_MS = 300;

/** Two-step button for destructive actions: the first click asks, the second click confirms. */
@Component({
  selector: 'app-confirm-button',
  template: `
    <button type="button" [class]="'btn btn-' + tone()" (click)="click()">
      {{ armed() ? confirmLabel() : label() }}
    </button>
    <span class="sr-only" aria-live="polite">{{ announcement() }}</span>
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
    }
  `,
})
export class ConfirmButton {
  readonly label = input.required<string>();
  readonly confirmLabel = input('Confirm');
  readonly tone = input<'danger' | 'primary' | 'secondary'>('danger');
  readonly confirmed = output<void>();

  protected readonly armed = signal(false);
  protected readonly announcement = computed(() =>
    this.armed() ? `Press again to confirm: ${this.label()}` : '',
  );

  private timer: ReturnType<typeof setTimeout> | undefined;
  private armedAt = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected click(): void {
    if (this.armed()) {
      // A double-tap would otherwise arm and confirm in one go; leave the button armed.
      if (performance.now() - this.armedAt < CONFIRM_GUARD_MS) {
        return;
      }
      clearTimeout(this.timer);
      this.armed.set(false);
      this.confirmed.emit();
      return;
    }
    this.armed.set(true);
    this.armedAt = performance.now();
    this.timer = setTimeout(() => this.armed.set(false), CONFIRM_RESET_MS);
  }
}
