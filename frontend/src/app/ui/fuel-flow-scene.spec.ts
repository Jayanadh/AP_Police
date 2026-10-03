import { TestBed } from '@angular/core/testing';
import { FuelFlowScene } from './fuel-flow-scene';

describe('FuelFlowScene', () => {
  async function setup() {
    const fixture = TestBed.createComponent(FuelFlowScene);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('describes the whole digital fill in one label for screen readers', async () => {
    const svg = (await setup()).querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe(
      "A police vehicle at a pump: the driver's PIN reaches the pump's screen, the litres are filled, " +
        'and the statement updates.',
    );
  });

  it('shows each step: the vehicle, the PIN, the pump screen, the fill and the statement', async () => {
    const el = await setup();
    for (const part of [
      '.vehicle',
      '.phone',
      '.signal',
      '.pump-screen',
      '.hose',
      '.filled',
      '.statement',
    ]) {
      expect(el.querySelector(part), part).not.toBeNull();
    }
    expect(el.querySelector('.vehicle')?.textContent).toContain('POLICE');
    expect(el.querySelector('.phone')?.textContent).toContain('PIN');
    expect(el.querySelector('.filled')?.textContent).toContain('20 L');
  });
});
