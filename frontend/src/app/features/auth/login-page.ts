import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { apiErrorMessage } from '../../core/api-error';
import { AuthStore } from '../../core/auth-store';
import { FuelFlowScene } from '../../ui/fuel-flow-scene';

@Component({
  selector: 'app-login-page',
  imports: [FuelFlowScene, ReactiveFormsModule],
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly form = inject(NonNullableFormBuilder).group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected submit(): void {
    if (this.busy()) {
      return;
    }
    const { username, password } = this.form.getRawValue();
    if (!username.trim() || !password) {
      this.error.set('Enter your login ID and password.');
      return;
    }
    this.error.set('');
    this.busy.set(true);
    this.auth.login(username.trim(), password).subscribe({
      next: (user) =>
        void this.router.navigateByUrl(user.must_change_password ? '/change-password' : '/'),
      error: (err) => {
        this.error.set(apiErrorMessage(err));
        this.busy.set(false);
      },
    });
  }
}
