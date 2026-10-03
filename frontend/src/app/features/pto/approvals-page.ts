import { Component, computed, inject, signal } from '@angular/core';
import { Approval, ApprovalFilter, ApprovalsApi } from '../../core/api/approvals-api';
import { apiErrorMessage } from '../../core/api-error';
import { formatDateTime } from '../../core/format';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';
import { StatusBadge } from '../../ui/status-badge';
import { ToastService } from '../../ui/toast';

const NEEDS_REASON = 'Give a reason for rejecting.';

const FILTERS: readonly { value: ApprovalFilter; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'ALL', label: 'All' },
];

const EMPTY_TITLES: Readonly<Record<ApprovalFilter, string>> = {
  PENDING: 'Nothing waiting for approval',
  APPROVED: 'No approved requests',
  REJECTED: 'No rejected requests',
  ALL: 'No requests yet',
};

@Component({
  selector: 'app-approvals-page',
  imports: [EmptyState, Icon, LoadError, PageHeader, StatusBadge],
  templateUrl: './approvals-page.html',
  styles: `
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 20px;
    }

    .requests {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;

      @media (min-width: 900px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    .request {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .request-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;

      time {
        margin-left: auto;
        font-size: 13px;
      }
    }

    h2 {
      font-size: 18px;
    }

    .subject {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      overflow-wrap: anywhere;

      p {
        font-size: 14px;
      }
    }

    .subject-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--surface);
    }

    .note p {
      overflow-wrap: anywhere;
    }

    .small {
      font-size: 13px;
    }

    .decide {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
    }

    .decide-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
  `,
})
export class ApprovalsPage {
  private readonly api = inject(ApprovalsApi);
  private readonly toasts = inject(ToastService);
  /** Counts loads, so a slow answer for a chip the user has already left is ignored. */
  private loads = 0;

  protected readonly filters = FILTERS;
  protected readonly status = signal<ApprovalFilter>('PENDING');
  protected readonly requests = signal<Approval[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly notes = signal<Readonly<Record<number, string>>>({});
  protected readonly errors = signal<Readonly<Record<number, string>>>({});
  /** The request that is waiting for the server's answer to a decision. */
  protected readonly busyId = signal<number | null>(null);
  protected readonly emptyTitle = computed(() => EMPTY_TITLES[this.status()]);

  constructor() {
    this.load();
  }

  protected when(iso: string | null): string {
    return formatDateTime(iso);
  }

  protected choose(status: ApprovalFilter): void {
    if (status === this.status()) {
      return;
    }
    this.status.set(status);
    this.load();
  }

  /** Reads the requests of the chosen status; `quiet` keeps the current list on screen while it does. */
  protected load(quiet = false): void {
    const mine = ++this.loads;
    if (!quiet) {
      this.loading.set(true);
    }
    this.loadError.set('');
    this.api.list(this.status()).subscribe({
      next: (rows) => {
        if (mine === this.loads) {
          this.requests.set(rows);
          this.loading.set(false);
        }
      },
      error: (err) => {
        if (mine === this.loads) {
          this.loadError.set(apiErrorMessage(err));
          this.loading.set(false);
        }
      },
    });
  }

  protected setNote(id: number, text: string): void {
    this.notes.update((all) => ({ ...all, [id]: text }));
  }

  protected approve(request: Approval): void {
    this.decide(request, true);
  }

  protected reject(request: Approval): void {
    this.decide(request, false);
  }

  private decide(request: Approval, approve: boolean): void {
    if (this.busyId() !== null) {
      return;
    }
    const note = (this.notes()[request.id] ?? '').trim();
    if (!approve && !note) {
      this.setError(request.id, NEEDS_REASON);
      return;
    }
    this.setError(request.id, '');
    this.busyId.set(request.id);
    const call = approve ? this.api.approve(request.id, note) : this.api.reject(request.id, note);
    call.subscribe({
      next: () => {
        this.busyId.set(null);
        this.toasts.show(approve ? 'Request approved.' : 'Request rejected.');
        this.load(true);
      },
      error: (err) => {
        this.busyId.set(null);
        this.setError(request.id, apiErrorMessage(err));
      },
    });
  }

  private setError(id: number, message: string): void {
    this.errors.update((all) => ({ ...all, [id]: message }));
  }
}
