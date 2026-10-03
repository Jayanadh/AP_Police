import { Component, DestroyRef, inject, Service, signal } from '@angular/core';
import { Icon } from './icon';

export type ToastTone = 'success' | 'danger' | 'warning' | 'info';

export type Toast = { id: number; text: string; tone: ToastTone };

export const TOAST_LIFETIME_MS = 4000;

@Service()
export class ToastService {
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly list = signal<Toast[]>([]);

  /** The messages currently on screen, oldest first. */
  readonly messages = this.list.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timers.forEach((timer) => clearTimeout(timer)));
  }

  show(message: string, tone: ToastTone = 'success'): void {
    const id = this.nextId++;
    this.list.update((all) => [...all, { id, text: message, tone }]);
    this.timers.set(
      id,
      setTimeout(() => this.remove(id), TOAST_LIFETIME_MS),
    );
  }

  remove(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.list.update((all) => all.filter((toast) => toast.id !== id));
  }
}

const TONE_ICONS: Readonly<Record<ToastTone, string>> = {
  success: 'check-circle',
  danger: 'alert-triangle',
  warning: 'alert-triangle',
  info: 'info',
};

/** Renders the toasts bottom-centre, above the mobile bottom navigation. Place once in the app root. */
@Component({
  selector: 'app-toast-host',
  imports: [Icon],
  template: `
    <div class="toast-host" aria-live="polite">
      @for (toast of toasts.messages(); track toast.id) {
        <div
          [class]="'toast toast-' + toast.tone"
          [attr.role]="toast.tone === 'danger' ? 'alert' : null"
        >
          <app-icon [name]="icon(toast.tone)" [size]="18" />
          <span class="toast-text">{{ toast.text }}</span>
          <button
            type="button"
            class="toast-dismiss"
            [attr.aria-label]="'Dismiss: ' + toast.text"
            (click)="toasts.remove(toast.id)"
          >
            <app-icon name="x" [size]="16" />
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .toast-host {
      position: fixed;
      right: 16px;
      bottom: calc(var(--nav-height) + 28px + env(safe-area-inset-bottom, 0px));
      left: 16px;
      z-index: 100;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      pointer-events: none;

      @media (min-width: 900px) {
        bottom: 28px;
      }
    }

    .toast {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      max-width: min(100%, 440px);
      padding: 8px 8px 8px 18px;
      border: 0;
      border-radius: var(--radius-pill);
      background: var(--text);
      color: #ffffff;
      box-shadow: var(--shadow-float);
      font-size: 14px;
      font-weight: 600;
      text-align: left;
      pointer-events: auto;
    }

    .toast-text {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .toast-dismiss {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.12);
      color: inherit;

      &:hover {
        background: rgba(255, 255, 255, 0.24);
      }
    }

    .toast-success app-icon {
      color: #5fd39b;
    }

    .toast-danger app-icon {
      color: #ff8a8e;
    }

    .toast-warning app-icon {
      color: var(--primary);
    }

    .toast-info app-icon {
      color: #8db8ff;
    }
  `,
})
export class ToastHost {
  protected readonly toasts = inject(ToastService);

  protected icon(tone: ToastTone): string {
    return TONE_ICONS[tone];
  }
}
