import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { nextDueLabel, ServiceDue, ServicingApi } from '../../core/api/servicing-api';
import { formatDate, km } from '../../core/format';
import { Panel } from '../../core/panel';
import { EmptyState } from '../../ui/empty-state';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';

/** The vehicles that are due for a service now, with the figures behind it. */
@Component({
  selector: 'app-servicing-page',
  imports: [EmptyState, LoadError, PageHeader, RouterLink],
  templateUrl: './servicing-page.html',
  styles: `
    .dues {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
      gap: 16px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .due {
      display: flex;
      flex-direction: column;
      gap: 14px;
      overflow-wrap: anywhere;
    }

    .registration {
      color: inherit;
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.02em;
      text-underline-offset: 3px;
    }

    .facts {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 0;

      dt {
        color: var(--muted);
        font-size: 13px;
        font-weight: 600;
      }

      dd {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
      }
    }
  `,
})
export class ServicingPage {
  private readonly api = inject(ServicingApi);

  protected readonly formatDate = formatDate;
  protected readonly km = km;
  protected readonly nextDue = nextDueLabel;

  protected readonly due = new Panel<ServiceDue[]>(() => this.api.due());

  constructor() {
    this.due.load();
  }
}
