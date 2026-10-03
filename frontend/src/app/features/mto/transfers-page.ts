import { NgTemplateOutlet } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import {
  OfficerLookup,
  Transfer,
  TransferDirection,
  TransfersApi,
} from '../../core/api/transfers-api';
import { apiErrorMessage } from '../../core/api-error';
import { formatDate } from '../../core/format';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';
import { StatusBadge } from '../../ui/status-badge';
import { ToastService } from '../../ui/toast';

type ListState = { rows: Transfer[]; loading: boolean; error: string };

const LOADING: ListState = { rows: [], loading: true, error: '' };

/** Asking another office for an officer, and deciding on requests for officers of this office. */
@Component({
  selector: 'app-transfers-page',
  imports: [
    EmptyState,
    Icon,
    LoadError,
    NgTemplateOutlet,
    PageHeader,
    ReactiveFormsModule,
    StatusBadge,
  ],
  templateUrl: './transfers-page.html',
  styles: `
    h2 {
      font-size: 18px;
    }

    .request-card {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-bottom: 28px;
    }

    .lookup {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .lookup-form {
      display: flex;
      align-items: flex-end;
      gap: 12px;

      .field {
        flex: 1;
      }
    }

    .request-form {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 14px;

      .field {
        align-self: stretch;
      }
    }

    .officer-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      overflow-wrap: anywhere;

      p {
        font-size: 14px;
      }
    }

    .avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--primary) 22%, white);
      color: var(--primary-strong);
    }

    .lists {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 28px;

      @media (min-width: 1100px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start;
      }
    }

    .list-section > .muted {
      margin: 4px 0 16px;
      font-size: 14px;
    }

    .transfers {
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .transfer {
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow-wrap: anywhere;
    }

    .transfer-head {
      display: flex;
      align-items: center;
      gap: 12px;

      .who {
        flex: 1;
        min-width: 0;
      }

      p {
        font-size: 14px;
      }
    }

    .route {
      font-weight: 600;
    }

    .small {
      font-size: 13px;
    }

    .decide {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }
  `,
})
export class TransfersPage {
  private readonly api = inject(TransfersApi);
  private readonly toasts = inject(ToastService);
  /** Counts lookups, so a slow answer for an Emp ID that has since been changed is ignored. */
  private lookups = 0;

  /** Officers leaving this office: this office accepts or rejects. */
  protected readonly outgoing = signal<ListState>(LOADING);
  /** Requests this office sent: this office may cancel them. */
  protected readonly incoming = signal<ListState>(LOADING);

  protected readonly empId = new FormControl('', { nonNullable: true });
  protected readonly note = new FormControl('', { nonNullable: true });
  protected readonly finding = signal(false);
  protected readonly officer = signal<OfficerLookup | null>(null);
  protected readonly lookupError = signal('');
  protected readonly sending = signal(false);
  protected readonly sendError = signal('');
  /** The request that is waiting for the server's answer to a decision. */
  protected readonly busyId = signal<number | null>(null);

  constructor() {
    this.load('outgoing');
    this.load('incoming');
  }

  protected when(iso: string | null): string {
    return formatDate(iso);
  }

  /** Reads one list; `quiet` keeps the rows on screen while it does. */
  protected load(direction: TransferDirection, quiet = false): void {
    const list = direction === 'outgoing' ? this.outgoing : this.incoming;
    if (!quiet) {
      list.set(LOADING);
    }
    this.api.list(direction).subscribe({
      next: (rows) => list.set({ rows, loading: false, error: '' }),
      error: (err) =>
        list.update((state) => ({ ...state, loading: false, error: apiErrorMessage(err) })),
    });
  }

  /** Typing a different Emp ID drops the officer found, so a request never goes out for the wrong one. */
  protected forget(): void {
    this.lookups++;
    this.finding.set(false);
    this.officer.set(null);
    this.lookupError.set('');
    this.sendError.set('');
  }

  protected find(event: Event): void {
    event.preventDefault();
    if (this.finding()) {
      return;
    }
    const empId = this.empId.value.trim().toUpperCase();
    this.officer.set(null);
    this.sendError.set('');
    if (!empId) {
      this.lookupError.set('Type the Emp ID of the officer.');
      return;
    }
    this.lookupError.set('');
    this.finding.set(true);
    const mine = ++this.lookups;
    this.api.lookup(empId).subscribe({
      next: (officer) => {
        if (mine === this.lookups) {
          this.officer.set(officer);
          this.finding.set(false);
        }
      },
      error: (err) => {
        if (mine === this.lookups) {
          this.lookupError.set(apiErrorMessage(err));
          this.finding.set(false);
        }
      },
    });
  }

  protected send(event: Event, officer: OfficerLookup): void {
    event.preventDefault();
    if (this.sending()) {
      return;
    }
    this.sendError.set('');
    this.sending.set(true);
    this.api.request(officer.id, this.note.value.trim()).subscribe({
      next: () => {
        this.sending.set(false);
        this.toasts.show(`Request sent to ${officer.unit_name}.`);
        this.officer.set(null);
        this.empId.reset();
        this.note.reset();
        this.load('incoming', true);
      },
      error: (err) => {
        this.sending.set(false);
        this.sendError.set(apiErrorMessage(err));
      },
    });
  }

  protected accept(transfer: Transfer): void {
    this.decide(
      transfer,
      this.api.accept(transfer.id),
      `${transfer.officer_name} will move to ${transfer.to_unit_name}.`,
      'outgoing',
    );
  }

  protected reject(transfer: Transfer): void {
    this.decide(transfer, this.api.reject(transfer.id), 'Request rejected.', 'outgoing');
  }

  protected cancel(transfer: Transfer): void {
    this.decide(transfer, this.api.cancel(transfer.id), 'Request cancelled.', 'incoming');
  }

  private decide(
    transfer: Transfer,
    call: Observable<Transfer>,
    message: string,
    reload: TransferDirection,
  ): void {
    if (this.busyId() !== null) {
      return;
    }
    this.busyId.set(transfer.id);
    call.subscribe({
      next: () => {
        this.busyId.set(null);
        this.toasts.show(message);
        this.load(reload, true);
      },
      error: (err) => {
        this.busyId.set(null);
        this.toasts.show(apiErrorMessage(err), 'danger');
      },
    });
  }
}
