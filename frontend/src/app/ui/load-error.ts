import { booleanAttribute, Component, input, output } from '@angular/core';

/** A load that failed: what went wrong, and a button to load it again. */
@Component({
  selector: 'app-load-error',
  template: `
    <p class="error" role="alert">{{ message() }}</p>
    <button
      type="button"
      class="btn btn-secondary retry"
      [class.btn-sm]="small()"
      (click)="retry.emit()"
    >
      Try again
    </button>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }
  `,
})
export class LoadError {
  readonly message = input.required<string | null>();
  /** A smaller button, for a section inside a card rather than the whole page. */
  readonly small = input(false, { transform: booleanAttribute });
  readonly retry = output();
}
