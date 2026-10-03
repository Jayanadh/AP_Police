import { Component, inject, input, output } from '@angular/core';
import { Unit, UnitsApi } from '../core/api/units-api';
import { Panel } from '../core/panel';

/** The PTO's choice of one MTO office, or all of them. It reads the offices itself. */
@Component({
  selector: 'app-office-select',
  template: `
    <div class="field">
      <label [for]="inputId()">Office</label>
      <select #select [id]="inputId()" (change)="choose(select.value)">
        <option value="">All offices</option>
        @for (office of units.data(); track office.id) {
          <option [value]="office.id">{{ office.name }}</option>
        }
      </select>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .field {
      margin: 0;
    }
  `,
})
export class OfficeSelect {
  /** The id of the select, so the page's label and tests can find it. */
  readonly inputId = input.required<string>();
  /** The chosen office's id, or undefined for all offices. */
  readonly officeChange = output<number | undefined>();

  private readonly api = inject(UnitsApi);
  protected readonly units = new Panel<Unit[]>(() => this.api.list());

  constructor() {
    this.units.load();
  }

  protected choose(value: string): void {
    this.officeChange.emit(value ? Number(value) : undefined);
  }
}
