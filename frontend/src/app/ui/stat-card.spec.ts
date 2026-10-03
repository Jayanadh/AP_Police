import { TestBed } from '@angular/core/testing';
import { StatCard } from './stat-card';

async function render(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(StatCard);
  for (const [key, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(key, value);
  }
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('StatCard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StatCard] });
  });

  it('shows the icon, label and value', async () => {
    const el = await render({ icon: 'fuel', label: 'Fuel left', value: '12.5 L' });
    expect(el.querySelector('.stat-icon svg')).not.toBeNull();
    expect(el.querySelector('.stat-label')?.textContent?.trim()).toBe('Fuel left');
    expect(el.querySelector('.stat-value')?.textContent?.trim()).toBe('12.5 L');
  });

  it('accepts a numeric value', async () => {
    const el = await render({ icon: 'bell', label: 'Alerts', value: 3 });
    expect(el.querySelector('.stat-value')?.textContent?.trim()).toBe('3');
  });

  it('applies the tone class', async () => {
    const plain = await render({ icon: 'bell', label: 'A', value: 1 });
    expect(plain.querySelector('.stat')?.classList.contains('stat-default')).toBe(true);
    const danger = await render({ icon: 'bell', label: 'A', value: 1, tone: 'danger' });
    expect(danger.querySelector('.stat')?.classList.contains('stat-danger')).toBe(true);
  });
});
