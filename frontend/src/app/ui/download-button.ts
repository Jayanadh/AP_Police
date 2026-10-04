import { booleanAttribute, Component, inject, input, signal } from '@angular/core';
import { apiErrorMessage } from '../core/api-error';
import { DownloadParams, Downloads } from '../core/downloads';
import { ConfirmDialog } from './confirm-dialog';
import { Icon } from './icon';
import { ToastService } from './toast';

/** Downloads a report as an Excel file, for the same filters the page shows, once the person confirms. */
@Component({
  selector: 'app-download-button',
  imports: [Icon],
  template: `
    <button
      type="button"
      class="btn btn-secondary download"
      [class.btn-sm]="small()"
      [disabled]="busy()"
      (click)="download()"
    >
      <app-icon name="download" [size]="18" />
      {{ busy() ? 'Preparing…' : label() }}
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
  `,
})
export class DownloadButton {
  /** The export address, such as `/api/fuel/statement/export/`. */
  readonly url = input.required<string>();
  readonly params = input<DownloadParams>({});
  readonly label = input('Download Excel');
  readonly small = input(false, { transform: booleanAttribute });

  private readonly downloads = inject(Downloads);
  private readonly confirm = inject(ConfirmDialog);
  private readonly toasts = inject(ToastService);
  protected readonly busy = signal(false);

  protected async download(): Promise<void> {
    const yes = await this.confirm.ask({
      title: 'Download as Excel?',
      message: 'The file is saved to this device, for what this page shows now.',
      confirmLabel: 'Download',
    });
    if (!yes || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.downloads.save(this.url(), this.params()).subscribe({
      next: () => this.busy.set(false),
      error: (err) => {
        this.busy.set(false);
        this.toasts.show(apiErrorMessage(err), 'danger');
      },
    });
  }
}
