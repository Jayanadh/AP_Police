import { TestBed } from '@angular/core/testing';
import { CONFIRM_GUARD_MS, CONFIRM_RESET_MS, ConfirmButton } from './confirm-button';

const pastGuard = () => new Promise((resolve) => setTimeout(resolve, CONFIRM_GUARD_MS + 50));

describe('ConfirmButton', () => {
  async function setup(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(ConfirmButton);
    fixture.componentRef.setInput('label', 'Terminate vehicle');
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    let confirmed = 0;
    fixture.componentInstance.confirmed.subscribe(() => confirmed++);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button',
    ) as HTMLButtonElement;
    return { fixture, button, count: () => confirmed };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ConfirmButton] });
  });

  it('shows the label first and does not emit on the first click', async () => {
    const { fixture, button, count } = await setup();
    expect(button.textContent?.trim()).toBe('Terminate vehicle');
    button.click();
    await fixture.whenStable();
    expect(count()).toBe(0);
    expect(button.textContent?.trim()).toBe('Confirm');
  });

  it('emits only on the second click', async () => {
    const { fixture, button, count } = await setup();
    button.click();
    await fixture.whenStable();
    expect(count()).toBe(0);
    await pastGuard();
    button.click();
    await fixture.whenStable();
    expect(count()).toBe(1);
    expect(button.textContent?.trim()).toBe('Terminate vehicle');
  });

  it('needs two clicks again after confirming', async () => {
    const { fixture, button, count } = await setup();
    button.click();
    await pastGuard();
    button.click();
    await fixture.whenStable();
    expect(count()).toBe(1);
    button.click();
    await pastGuard();
    await fixture.whenStable();
    expect(count()).toBe(1);
    expect(button.textContent?.trim()).toBe('Confirm');
  });

  it('ignores a double-tap: a second click right after arming does not confirm', async () => {
    const { fixture, button, count } = await setup();
    button.click();
    button.click();
    await fixture.whenStable();
    expect(count()).toBe(0);
    expect(button.textContent?.trim()).toBe('Confirm');
    await pastGuard();
    button.click();
    await fixture.whenStable();
    expect(count()).toBe(1);
  });

  it('announces the armed state to screen readers and clears it again', async () => {
    const { fixture, button } = await setup();
    const live = (fixture.nativeElement as HTMLElement).querySelector(
      '[aria-live="polite"]',
    ) as HTMLElement;
    expect(live).not.toBeNull();
    expect(live.textContent?.trim()).toBe('');
    button.click();
    await fixture.whenStable();
    expect(live.textContent).toContain('Press again to confirm');
    expect(live.textContent).toContain('Terminate vehicle');
    await pastGuard();
    button.click();
    await fixture.whenStable();
    expect(live.textContent?.trim()).toBe('');
  });

  it('uses a custom confirm label and tone', async () => {
    const { fixture, button } = await setup({ confirmLabel: 'Yes, terminate', tone: 'primary' });
    expect(button.classList.contains('btn-primary')).toBe(true);
    button.click();
    await fixture.whenStable();
    expect(button.textContent?.trim()).toBe('Yes, terminate');
  });

  it('is a danger button by default', async () => {
    const { button } = await setup();
    expect(button.classList.contains('btn-danger')).toBe(true);
  });

  it('resets to the label after four seconds', async () => {
    const { fixture, button, count } = await setup();
    button.click();
    await fixture.whenStable();
    expect(button.textContent?.trim()).toBe('Confirm');
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_RESET_MS + 150));
    await fixture.whenStable();
    expect(button.textContent?.trim()).toBe('Terminate vehicle');
    button.click();
    await fixture.whenStable();
    expect(count()).toBe(0);
  });
});
