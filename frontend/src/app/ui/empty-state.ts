import { Component, input } from '@angular/core';
import { Icon } from './icon';

/** Shown when a list has nothing in it. Project a button to give the user a next step. */
@Component({
  selector: 'app-empty-state',
  imports: [Icon],
  template: `
    <div class="empty">
      <span class="empty-icon"><app-icon [name]="icon()" [size]="28" /></span>
      <h3>{{ title() }}</h3>
      @if (text()) {
        <p class="muted">{{ text() }}</p>
      }
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 32px 16px;
      text-align: center;
    }

    .empty-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      margin-bottom: 8px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--primary) 18%, white);
      color: var(--primary-strong);
    }

    h3 {
      font-size: 17px;
    }

    p {
      max-width: 34ch;
    }
  `,
})
export class EmptyState {
  readonly icon = input.required<string>();
  readonly title = input.required<string>();
  readonly text = input('');
}
