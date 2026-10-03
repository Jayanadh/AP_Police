import { TestBed } from '@angular/core/testing';
import { makeTank } from '../../core/test-data';
import { Tank } from '../../core/api/tanks-api';
import { TankLevel } from './tank-level';

describe('TankLevel', () => {
  function setup(overrides: Partial<Tank> = {}) {
    const fixture = TestBed.createComponent(TankLevel);
    fixture.componentRef.setInput('tank', makeTank(overrides));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const text = (selector: string) =>
      el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
    return { el, text };
  }

  it('shows the fuel, the litres in stock and the alert level', () => {
    const { text } = setup();
    expect(text('.fuel')).toBe('Diesel');
    expect(text('.figure')).toBe('640 L');
    expect(text('.alert-level')).toBe('Alert below 100 L');
  });

  it('draws the level bar against the capacity', () => {
    const { el } = setup({ current_stock_litres: '1250.00', capacity_litres: '5000.00' });
    const meter = el.querySelector<HTMLElement>('[role="meter"]')!;
    expect(meter.getAttribute('aria-label')).toBe('Diesel level');
    expect(meter.getAttribute('aria-valuenow')).toBe('25');
    expect(meter.getAttribute('aria-valuetext')).toBe('1,250 L');
    expect(meter.querySelector<HTMLElement>('span')!.style.width).toBe('25%');
  });

  it('flags a low tank with a Low badge and a red bar', () => {
    const { el } = setup({ current_stock_litres: '80.00', is_low: true });
    expect(el.querySelector('.badge-danger')?.textContent?.trim()).toBe('Low');
    expect(el.querySelector('.progress.danger')).not.toBeNull();
  });

  it('shows no badge for a tank that is not low', () => {
    const { el } = setup();
    expect(el.querySelector('.badge')).toBeNull();
    expect(el.querySelector('.progress.danger')).toBeNull();
  });

  it('says when the stock was last measured, or that it never was', () => {
    expect(setup({ last_measured_at: '2026-10-03T07:10:00+05:30' }).text('.measured')).toBe(
      'Measured 03 Oct 2026, 7:10 am',
    );
    expect(setup({ last_measured_at: null }).text('.measured')).toBe('Not measured yet');
  });
});
