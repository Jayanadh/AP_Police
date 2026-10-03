import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppNotification, NotificationsApi } from '../../core/api/notifications-api';
import { apiErrorMessage } from '../../core/api-error';
import { formatDateTime } from '../../core/format';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';
import { ToastService } from '../../ui/toast';

@Component({
  selector: 'app-alerts-page',
  imports: [EmptyState, Icon, LoadError, PageHeader],
  templateUrl: './alerts-page.html',
  styles: `
    .card.alerts {
      padding: 8px;
    }

    li + li {
      margin-top: 4px;
    }

    .alert-item {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 14px 12px;
      border: 0;
      border-left: 4px solid transparent;
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      background: transparent;
      color: inherit;
      text-align: left;

      &:hover {
        background: var(--surface-2);
      }

      &.unread {
        border-left-color: var(--primary);

        .alert-title {
          font-weight: 700;
        }
      }
    }

    .alert-main {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .alert-title {
      font-weight: 500;
    }

    .alert-time {
      font-size: 13px;
    }
  `,
})
export class AlertsPage {
  private readonly api = inject(NotificationsApi);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  protected readonly alerts = signal<AppNotification[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly unreadCount = computed(
    () => this.alerts().filter((alert) => !alert.read_at).length,
  );

  constructor() {
    this.load();
  }

  protected when(iso: string): string {
    return formatDateTime(iso);
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list().subscribe({
      next: (rows) => {
        this.alerts.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  /** Marks the alert read (if it is not yet), then opens the page it points to. */
  protected open(alert: AppNotification): void {
    if (alert.read_at) {
      this.follow(alert);
      return;
    }
    this.api.markRead(alert.id).subscribe({
      next: (updated) => {
        this.alerts.update((all) => all.map((one) => (one.id === updated.id ? updated : one)));
        this.follow(alert);
      },
      error: (err) => this.toasts.show(apiErrorMessage(err), 'danger'),
    });
  }

  protected markAllRead(): void {
    this.api.markAllRead().subscribe({
      next: () => {
        const now = new Date().toISOString();
        this.alerts.update((all) =>
          all.map((one) => (one.read_at ? one : { ...one, read_at: now })),
        );
      },
      error: (err) => this.toasts.show(apiErrorMessage(err), 'danger'),
    });
  }

  private follow(alert: AppNotification): void {
    if (alert.link) {
      void this.router.navigateByUrl(alert.link);
    }
  }
}
