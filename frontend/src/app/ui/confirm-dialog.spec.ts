import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmDialog, ConfirmHost } from './confirm-dialog';

@Component({
  imports: [ConfirmHost],
  template: `<button id="opener" type="button">Open</button><app-confirm-host />`,
})
class Page {}

describe('ConfirmDialog', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Page);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const dialog = TestBed.inject(ConfirmDialog);
    const button = (label: string) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('.confirm button')).find(
        (b) => b.textContent?.trim() === label,
      );
    return { fixture, el, dialog, button };
  }

  it('asks the question and answers yes on the confirm button, then closes', async () => {
    const { fixture, el, dialog, button } = await setup();

    const answer = dialog.ask({
      title: 'Log out?',
      message: 'You will need your password to come back in.',
      confirmLabel: 'Log out',
    });
    await fixture.whenStable();

    const box = el.querySelector('.confirm')!;
    expect(box.getAttribute('role')).toBe('alertdialog');
    expect(box.getAttribute('aria-modal')).toBe('true');
    expect(el.querySelector('#' + box.getAttribute('aria-labelledby'))?.textContent).toBe(
      'Log out?',
    );
    expect(el.querySelector('#' + box.getAttribute('aria-describedby'))?.textContent).toBe(
      'You will need your password to come back in.',
    );

    button('Log out')!.click();
    expect(await answer).toBe(true);
    await fixture.whenStable();
    expect(el.querySelector('.confirm')).toBeNull();
  });

  it('answers no on Cancel, on Escape and on a click outside', async () => {
    const { fixture, el, dialog, button } = await setup();
    // The answer is wrapped, so awaiting the opening does not wait for the answer too.
    const open = async () => {
      const answer = dialog.ask({ title: 'Download as Excel?', confirmLabel: 'Download' });
      await fixture.whenStable();
      return { answer };
    };

    const cancelled = await open();
    button('Cancel')!.click();
    expect(await cancelled.answer).toBe(false);

    const escaped = await open();
    el.querySelector('.confirm')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(await escaped.answer).toBe(false);

    const outside = await open();
    el.querySelector<HTMLElement>('.confirm-backdrop')!.click();
    expect(await outside.answer).toBe(false);
  });

  it('starts on the confirm button, or on Cancel when the action is destructive', async () => {
    const { fixture, dialog, button } = await setup();

    void dialog.ask({ title: 'Download as Excel?', confirmLabel: 'Download' });
    await fixture.whenStable();
    expect(document.activeElement).toBe(button('Download'));

    void dialog.ask({ title: 'Delete Krishna?', confirmLabel: 'Delete', tone: 'danger' });
    await fixture.whenStable();
    expect(document.activeElement).toBe(button('Cancel'));
    expect(button('Delete')!.classList).toContain('btn-danger');
  });

  it('keeps Tab inside the dialog', async () => {
    const { fixture, el, dialog, button } = await setup();
    void dialog.ask({ title: 'Log out?', confirmLabel: 'Log out' });
    await fixture.whenStable();
    const box = el.querySelector('.confirm')!;
    const tab = (shiftKey = false) =>
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));

    tab();
    expect(document.activeElement).toBe(button('Cancel'));
    tab(true);
    expect(document.activeElement).toBe(button('Log out'));
  });

  it('gives focus back to what had it before', async () => {
    const { fixture, el, dialog, button } = await setup();
    const opener = el.querySelector<HTMLButtonElement>('#opener')!;
    opener.focus();

    const answer = dialog.ask({ title: 'Log out?', confirmLabel: 'Log out' });
    await fixture.whenStable();
    button('Cancel')!.click();
    await answer;
    await fixture.whenStable();

    expect(document.activeElement).toBe(opener);
  });

  it('answers no to a question still open when a new one is asked', async () => {
    const { fixture, dialog, button } = await setup();
    const first = dialog.ask({ title: 'Log out?', confirmLabel: 'Log out' });
    const second = dialog.ask({ title: 'Download as Excel?', confirmLabel: 'Download' });
    await fixture.whenStable();

    expect(await first).toBe(false);
    button('Download')!.click();
    expect(await second).toBe(true);
  });
});
