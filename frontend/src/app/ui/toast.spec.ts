import { TestBed } from '@angular/core/testing';
import { TOAST_LIFETIME_MS, ToastHost, ToastService } from './toast';

describe('ToastService', () => {
  let toasts: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ToastHost] });
    toasts = TestBed.inject(ToastService);
  });

  it('adds a success message by default', () => {
    toasts.show('Saved');
    const messages = toasts.messages();
    expect(messages.length).toBe(1);
    expect(messages[0].text).toBe('Saved');
    expect(messages[0].tone).toBe('success');
  });

  it('keeps the tone it is given and stacks messages', () => {
    toasts.show('Saved');
    toasts.show('Could not save', 'danger');
    expect(toasts.messages().map((m) => m.tone)).toEqual(['success', 'danger']);
  });

  it('removes a message after four seconds', async () => {
    toasts.show('Saved');
    expect(toasts.messages().length).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, TOAST_LIFETIME_MS + 150));
    expect(toasts.messages().length).toBe(0);
  });

  it('removes only the message asked for', () => {
    toasts.show('One');
    toasts.show('Two');
    const [first, second] = toasts.messages();
    toasts.remove(first.id);
    expect(toasts.messages()).toEqual([second]);
  });

  it('renders the messages in the host', async () => {
    const fixture = TestBed.createComponent(ToastHost);
    toasts.show('Quota added', 'success');
    toasts.show('Pump is out of stock', 'danger');
    await fixture.whenStable();
    const items = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.toast'),
    ) as HTMLElement[];
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      'Quota added',
      'Pump is out of stock',
    ]);
    expect(items[0].classList.contains('toast-success')).toBe(true);
    expect(items[1].classList.contains('toast-danger')).toBe(true);
  });

  it('announces only danger toasts as alerts', async () => {
    const fixture = TestBed.createComponent(ToastHost);
    toasts.show('Saved', 'success');
    toasts.show('Pump is out of stock', 'danger');
    toasts.show('Check the odometer', 'warning');
    await fixture.whenStable();
    const items = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.toast'),
    ) as HTMLElement[];
    expect(items.map((i) => i.getAttribute('role'))).toEqual([null, 'alert', null]);
  });

  it('has a dismiss button labelled with the message that removes the toast', async () => {
    const fixture = TestBed.createComponent(ToastHost);
    toasts.show('Quota added');
    toasts.show('Pump is out of stock', 'danger');
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(host.querySelectorAll('.toast button')) as HTMLButtonElement[];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Dismiss: Quota added',
      'Dismiss: Pump is out of stock',
    ]);
    buttons[0].click();
    await fixture.whenStable();
    expect(toasts.messages().map((m) => m.text)).toEqual(['Pump is out of stock']);
    expect(host.querySelectorAll('.toast').length).toBe(1);
  });
});
