import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from './icon';

/** Page title with an optional subtitle and back button. Project action buttons to put them on the right. */
@Component({
  selector: 'app-page-header',
  imports: [RouterLink, Icon],
  template: `
    <header class="page-header">
      @if (backLink(); as link) {
        <a class="btn-icon" [routerLink]="link" aria-label="Back">
          <app-icon name="chevron-left" [size]="22" />
        </a>
      }
      <div class="titles">
        <h1 class="page-title">{{ title() }}</h1>
        @if (subtitle()) {
          <p class="muted">{{ subtitle() }}</p>
        }
      </div>
      <div class="actions"><ng-content /></div>
    </header>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: 20px;
    }

    // Actions that do not fit beside the title drop to a line of their own, on the right.
    .page-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px 14px;
    }

    .titles {
      flex: 1 1 180px;
      min-width: 0;
    }

    .titles p {
      margin-top: 2px;
    }

    .actions {
      margin-left: auto;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }

    .actions:empty {
      display: none;
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly backLink = input<string | null>(null);
}
