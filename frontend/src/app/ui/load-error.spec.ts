import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LoadError } from './load-error';

@Component({
  imports: [LoadError],
  template: `
    <app-load-error [message]="message()" (retry)="retries.set(retries() + 1)" />
    <app-load-error message="Could not load the tanks." small />
  `,
})
class Host {
  readonly message = signal('Could not reach the server.');
  readonly retries = signal(0);
}

describe('LoadError', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const [page, inline] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-load-error'),
    );
    return { fixture, page, inline };
  }

  it('says what went wrong as an alert', async () => {
    const { fixture, page } = await setup();
    expect(page.querySelector('p.error[role="alert"]')?.textContent?.trim()).toBe(
      'Could not reach the server.',
    );
    fixture.componentInstance.message.set('You are offline.');
    await fixture.whenStable();
    expect(page.querySelector('[role="alert"]')?.textContent?.trim()).toBe('You are offline.');
  });

  it('asks the page to load again each time the button is pressed', async () => {
    const { fixture, page } = await setup();
    const button = page.querySelector('button.retry') as HTMLButtonElement;
    expect(button.type).toBe('button');
    expect(button.textContent?.trim()).toBe('Try again');
    button.click();
    button.click();
    expect(fixture.componentInstance.retries()).toBe(2);
  });

  it('uses a small button inside a card section and a full one for the page', async () => {
    const { page, inline } = await setup();
    expect(page.querySelector('button')?.classList).not.toContain('btn-sm');
    expect(inline.querySelector('button')?.classList).toContain('btn-sm');
  });
});
