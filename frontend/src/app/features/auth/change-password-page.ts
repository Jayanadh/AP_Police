import { Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { apiErrorMessage } from '../../core/api-error';
import { AuthStore } from '../../core/auth-store';
import { PageHeader } from '../../ui/page-header';
import { ToastService } from '../../ui/toast';

@Component({
  selector: 'app-change-password-page',
  imports: [ReactiveFormsModule, PageHeader],
  templateUrl: './change-password-page.html',
  styles: `
    .card {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 520px;
    }

    .hint {
      font-size: 13px;
    }

    .notice {
      padding: 12px 16px;
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--primary) 18%, white);
      font-weight: 600;
    }
  `,
})
export class ChangePasswordPage {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  protected readonly form = inject(NonNullableFormBuilder).group({
    current: [''],
    next: [''],
    confirm: [''],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly compulsory = computed(() => this.auth.user()?.must_change_password ?? false);

  protected submit(): void {
    if (this.busy()) {
      return;
    }
    const { current, next, confirm } = this.form.getRawValue();
    if (!current || !next || !confirm) {
      this.error.set('Enter your current password, a new password and the confirmation.');
      return;
    }
    if (next !== confirm) {
      this.error.set('The new passwords do not match.');
      return;
    }
    this.error.set('');
    this.busy.set(true);
    this.auth.changePassword(current, next).subscribe({
      next: () => {
        this.toasts.show('Password changed.');
        void this.router.navigateByUrl('/');
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err));
        this.busy.set(false);
      },
    });
  }
}
