import { Component, computed, input, output } from '@angular/core';
import { MonitorPage } from '../../core/api/monitor-api';

/** "Showing 51–100 of 230", with Previous and Next when there is more than one page. */
@Component({
  selector: 'app-monitor-pager',
  template: `
    <div class="pager">
      <p class="count muted">{{ showing() }}</p>
      @if (page().pages > 1) {
        <nav class="steps" aria-label="Pages">
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            [disabled]="page().page <= 1"
            (click)="pageChange.emit(page().page - 1)"
          >
            Previous
          </button>
          <span class="muted">Page {{ page().page }} of {{ page().pages }}</span>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            [disabled]="page().page >= page().pages"
            (click)="pageChange.emit(page().page + 1)"
          >
            Next
          </button>
        </nav>
      }
    </div>
  `,
  styles: `
    .pager {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px 20px;
      margin-top: 20px;
    }

    .count {
      margin: 0;
    }

    .steps {
      display: flex;
      align-items: center;
      gap: 12px;
    }
  `,
})
export class MonitorPager {
  readonly page = input.required<MonitorPage<unknown>>();
  readonly pageChange = output<number>();

  protected readonly showing = computed(() => {
    const { page, page_size: size, count, results } = this.page();
    const first = (page - 1) * size + 1;
    return `Showing ${first}–${first + results.length - 1} of ${count}`;
  });
}
