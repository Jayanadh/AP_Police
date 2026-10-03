import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EmptyState } from './empty-state';

@Component({
  imports: [EmptyState],
  template: `
    <app-empty-state icon="bell" title="No alerts" text="You are all caught up.">
      <button class="btn">Refresh</button>
    </app-empty-state>
    <app-empty-state icon="car" title="No vehicles" />
  `,
})
class Host {}

describe('EmptyState', () => {
  it('shows the title, text and projected actions', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const [full, bare] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-empty-state'),
    );
    expect(full.querySelector('h3')?.textContent?.trim()).toBe('No alerts');
    expect(full.querySelector('p')?.textContent?.trim()).toBe('You are all caught up.');
    expect(full.querySelector('button')?.textContent?.trim()).toBe('Refresh');
    expect(full.querySelector('svg')).not.toBeNull();
    expect(bare.querySelector('h3')?.textContent?.trim()).toBe('No vehicles');
    expect(bare.querySelector('p')).toBeNull();
  });
});
