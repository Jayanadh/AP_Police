import {
  afterNextRender,
  Component,
  effect,
  ElementRef,
  inject,
  Injector,
  Service,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

/** A question to confirm before something happens, such as a download or logging out. */
export type ConfirmRequest = {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" for an action that cannot be undone: the dialog then starts on Cancel. */
  tone?: 'primary' | 'danger';
};

type OpenQuestion = ConfirmRequest & { answer: (yes: boolean) => void };

/** Asks the person to confirm. One question at a time; the app root shows it (see ConfirmHost). */
@Service()
export class ConfirmDialog {
  private readonly current = signal<OpenQuestion | null>(null);
  readonly open = this.current.asReadonly();

  /** Resolves true once confirmed; false on Cancel, Escape, a click outside, or a newer question. */
  ask(request: ConfirmRequest): Promise<boolean> {
    this.current()?.answer(false);
    return new Promise((resolve) => {
      const question: OpenQuestion = {
        ...request,
        answer: (yes) => {
          if (this.current() === question) {
            this.current.set(null);
          }
          resolve(yes);
        },
      };
      this.current.set(question);
    });
  }
}

/** Shows the open question of ConfirmDialog, centred over the page. Place once in the app root. */
@Component({
  selector: 'app-confirm-host',
  template: `
    @if (dialog.open(); as question) {
      <div class="confirm-backdrop" (click)="question.answer(false)"></div>
      <div
        #box
        class="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        [attr.aria-describedby]="question.message ? 'confirm-message' : null"
        (keydown)="keydown($event, question)"
      >
        <h2 id="confirm-title">{{ question.title }}</h2>
        @if (question.message) {
          <p id="confirm-message">{{ question.message }}</p>
        }
        <div class="confirm-actions">
          <button
            #cancelButton
            type="button"
            class="btn btn-secondary"
            (click)="question.answer(false)"
          >
            {{ question.cancelLabel ?? 'Cancel' }}
          </button>
          <button
            #confirmButton
            type="button"
            [class]="'btn btn-' + (question.tone ?? 'primary')"
            (click)="question.answer(true)"
          >
            {{ question.confirmLabel }}
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    .confirm-backdrop {
      position: fixed;
      inset: 0;
      z-index: 85;
      background: rgba(20, 24, 33, 0.45);
    }

    .confirm {
      position: fixed;
      top: 50%;
      left: 50%;
      z-index: 90;
      width: min(420px, calc(100% - 32px));
      padding: 24px;
      border-radius: var(--radius-lg);
      background: var(--surface);
      box-shadow: var(--shadow-float);
      transform: translate(-50%, -50%);

      h2 {
        margin: 0 0 8px;
        font-size: 19px;
      }

      p {
        margin: 0;
        color: var(--muted);
        overflow-wrap: anywhere;
      }
    }

    .confirm-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 22px;
    }
  `,
})
export class ConfirmHost {
  protected readonly dialog = inject(ConfirmDialog);
  private readonly injector = inject(Injector);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');
  private readonly confirmButton = viewChild<ElementRef<HTMLButtonElement>>('confirmButton');
  /** What had focus before the question, to give it back after. */
  private returnTo: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const question = this.dialog.open();
      untracked(() => {
        if (question) {
          this.returnTo ??= document.activeElement as HTMLElement | null;
          const start = question.tone === 'danger' ? this.cancelButton : this.confirmButton;
          afterNextRender(() => start()?.nativeElement.focus(), { injector: this.injector });
        } else if (this.returnTo) {
          const target = this.returnTo;
          this.returnTo = null;
          afterNextRender(() => target.focus?.(), { injector: this.injector });
        }
      });
    });
  }

  protected keydown(event: KeyboardEvent, question: OpenQuestion): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      question.answer(false);
    } else if (event.key === 'Tab') {
      // Two buttons: Tab and Shift+Tab move between them and never leave the dialog.
      event.preventDefault();
      const buttons = Array.from(this.box()?.nativeElement.querySelectorAll('button') ?? []);
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = (at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }
}
