import { Component, input } from '@angular/core';
import { Icon } from './icon';

/** A small tile with an icon circle, a label and a value, like the reference's Distance and Opening tiles. */
@Component({
  selector: 'app-stat-card',
  imports: [Icon],
  template: `
    <div [class]="'stat stat-' + tone()">
      <span class="stat-icon"><app-icon [name]="icon()" [size]="20" /></span>
      <div>
        <div class="stat-label">{{ label() }}</div>
        <div class="stat-value">{{ value() }}</div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class StatCard {
  readonly icon = input.required<string>();
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly tone = input<'default' | 'primary' | 'warning' | 'danger'>('default');
}
