import { Component, computed, input } from '@angular/core';

type BadgeTone = 'success' | 'warning' | 'danger' | 'muted';

const TONES: Readonly<Record<string, BadgeTone>> = {
  ACTIVE: 'success',
  FILLED: 'success',
  VERIFIED: 'success',
  APPROVED: 'success',
  ACCEPTED: 'success',
  ALLOWED: 'success',
  PENDING: 'warning',
  PENDING_APPROVAL: 'warning',
  ISSUED: 'warning',
  SUBMITTED: 'warning',
  TERMINATION_PENDING: 'warning',
  PAUSED: 'muted',
  NONE: 'muted',
  TERMINATED: 'danger',
  REJECTED: 'danger',
  CANCELLED: 'danger',
  EXPIRED: 'danger',
  DISPUTED: 'danger',
};

/** "TERMINATION_PENDING" -> "Termination pending". */
function readable(code: string): string {
  const words = code.replace(/_/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

@Component({
  selector: 'app-status-badge',
  template: `<span [class]="classes()">{{ text() }}</span>`,
  styles: `
    :host {
      display: inline-flex;
    }
  `,
})
export class StatusBadge {
  readonly status = input.required<string>();
  readonly label = input<string>();

  protected readonly classes = computed(() => {
    const status = this.status();
    const tone = Object.hasOwn(TONES, status) ? TONES[status] : 'muted';
    return `badge badge-${tone}`;
  });

  protected readonly text = computed(() => this.label() || readable(this.status()));
}
