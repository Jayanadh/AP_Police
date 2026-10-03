import { signal } from '@angular/core';
import { Observable } from 'rxjs';
import { apiErrorMessage } from './api-error';

/**
 * One piece of a page that loads on its own, so a slow or failing request leaves the rest on screen.
 * `load` reads again; an answer that a newer `load` or a `reset` has overtaken is ignored.
 */
export class Panel<T> {
  readonly data = signal<T | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  /** Whether a load has been asked for since the panel was last reset. */
  requested = false;

  private runs = 0;

  constructor(private readonly source: () => Observable<T>) {}

  /** Reads the data; `quiet` keeps what is shown on screen while it does. */
  load(quiet = false): void {
    const mine = ++this.runs;
    this.requested = true;
    if (!quiet) {
      this.loading.set(true);
    }
    this.error.set('');
    this.source().subscribe({
      next: (value) => {
        if (mine === this.runs) {
          this.data.set(value);
          this.loading.set(false);
        }
      },
      error: (err) => {
        if (mine === this.runs) {
          this.error.set(apiErrorMessage(err));
          this.loading.set(false);
        }
      },
    });
  }

  /** Shows a value the page already has, such as the answer to an action. */
  set(value: T): void {
    this.runs++;
    this.data.set(value);
    this.loading.set(false);
    this.error.set('');
  }

  /** Back to the start: nothing shown, nothing asked for, and any answer on its way is ignored. */
  reset(): void {
    this.runs++;
    this.requested = false;
    this.data.set(null);
    this.loading.set(true);
    this.error.set('');
  }
}
