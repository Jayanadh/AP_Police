import { TestBed } from '@angular/core/testing';
import { FuelLeft, FuelLeftCard } from './fuel-left-card';

const quota = (overrides: Partial<FuelLeft> = {}): FuelLeft => ({
  limit_litres: '60.00',
  used_litres: '17.50',
  remaining_litres: '42.50',
  emergency_remaining_litres: '10.00',
  ...overrides,
});

describe('FuelLeftCard', () => {
  async function render(value: FuelLeft) {
    const fixture = TestBed.createComponent(FuelLeftCard);
    fixture.componentRef.setInput('quota', value);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    return { el, text };
  }

  it('shows what is left large, what was used against the limit, and the emergency litres', async () => {
    const { el, text } = await render(quota());
    expect(text(el.querySelector('h2'))).toBe('Fuel left this month');
    expect(text(el.querySelector('.remaining'))).toBe('42.5 L');
    expect(text(el.querySelector('.used'))).toBe('Used 17.5 L of 60 L');
    expect(text(el.querySelector('.emergency'))).toBe('Emergency: 10 L left');
    const bar = el.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(bar.classList).toContain('progress');
    expect(bar.getAttribute('aria-valuenow')).toBe('29');
    expect(bar.querySelector<HTMLElement>('span')!.style.width).toBe('29%');
  });

  it('shows nothing left, not a negative figure, once an emergency took it past the limit', async () => {
    const { el, text } = await render(
      quota({
        used_litres: '65.00',
        remaining_litres: '-5.00',
        emergency_remaining_litres: '5.00',
      }),
    );
    expect(text(el.querySelector('.remaining'))).toBe('0 L');
    expect(text(el.querySelector('.over'))).toBe('5 L over the limit');
    expect(el.querySelector<HTMLElement>('[role="progressbar"] span')!.style.width).toBe('100%');
  });
});
