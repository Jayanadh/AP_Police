import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CONFIRM_GUARD_MS } from '../../ui/confirm-button';
import { PinCard } from './pin-card';

const pastGuard = () => new Promise((resolve) => setTimeout(resolve, CONFIRM_GUARD_MS + 50));

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('PinCard', () => {
  async function setup(expiresAt = new Date(Date.now() + 23 * HOUR + 59 * MINUTE + 30_000)) {
    const fixture: ComponentFixture<PinCard> = TestBed.createComponent(PinCard);
    fixture.componentRef.setInput('pin', '482917');
    fixture.componentRef.setInput('litres', '20.00');
    fixture.componentRef.setInput('vehicle', 'AP39PA1234');
    fixture.componentRef.setInput('expiresAt', expiresAt.toISOString());
    let cancelled = 0;
    let expired = 0;
    fixture.componentInstance.cancel.subscribe(() => cancelled++);
    fixture.componentInstance.expired.subscribe(() => expired++);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const cancelButton = () => el.querySelector<HTMLButtonElement>('app-confirm-button button')!;
    return {
      fixture,
      el,
      text,
      cancelButton,
      cancelled: () => cancelled,
      expired: () => expired,
    };
  }

  it('shows the six digits of the PIN in large type', async () => {
    const { el, text } = await setup();
    expect(text(el.querySelector('.pin'))).toBe('482917');
    // Screen readers hear the digits one by one rather than a large number.
    expect(text(el.querySelector('.sr-only'))).toContain('4 8 2 9 1 7');
  });

  it('names the pump the driver picked, whose staff fill it', async () => {
    const { el, text, fixture } = await setup();
    expect(text(el.querySelector('.head p'))).toBe('Show it to the staff at the pump.');
    fixture.componentRef.setInput('pump', 'Kavali Bunk');
    await fixture.whenStable();
    expect(text(el.querySelector('.head p'))).toBe('Show it to the staff at Kavali Bunk.');
  });

  it('shows the litres, the vehicle number and until when the PIN is valid', async () => {
    const expiresAt = new Date('2026-10-03T14:05:00+05:30');
    const { el, text } = await setup(expiresAt);
    expect(text(el)).toContain('20 L');
    expect(text(el)).toContain('AP39PA1234');
    expect(text(el.querySelector('.valid-until'))).toBe('Valid until 03 Oct 2026, 2:05 pm');
  });

  it('counts down the time left', async () => {
    const { el, text } = await setup();
    expect(text(el.querySelector('.countdown'))).toBe('Expires in 24 h');

    const soon = await setup(new Date(Date.now() + 2 * HOUR + 5 * MINUTE - 1000));
    expect(text(soon.el.querySelector('.countdown'))).toBe('Expires in 2 h 5 min');

    const minutes = await setup(new Date(Date.now() + 42 * MINUTE - 1000));
    expect(text(minutes.el.querySelector('.countdown'))).toBe('Expires in 42 min');
  });

  it('says when the PIN has run out, and tells the page once', async () => {
    const { el, text, expired, fixture } = await setup(new Date(Date.now() - 1000));
    expect(text(el.querySelector('.countdown'))).toBe('This PIN has expired.');
    await fixture.whenStable();
    expect(expired()).toBe(1);
  });

  it('cancels the request only after a second click', async () => {
    const { cancelButton, cancelled, fixture, text } = await setup();
    expect(text(cancelButton())).toBe('Cancel request');
    cancelButton().click();
    await fixture.whenStable();
    expect(cancelled()).toBe(0);
    await pastGuard();
    cancelButton().click();
    await fixture.whenStable();
    expect(cancelled()).toBe(1);
  });
});
