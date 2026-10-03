import { TestBed } from '@angular/core/testing';
import { StatusBadge } from './status-badge';

async function render(status: string, label?: string) {
  const fixture = TestBed.createComponent(StatusBadge);
  fixture.componentRef.setInput('status', status);
  if (label !== undefined) {
    fixture.componentRef.setInput('label', label);
  }
  await fixture.whenStable();
  return (fixture.nativeElement as HTMLElement).querySelector('.badge') as HTMLElement;
}

describe('StatusBadge', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StatusBadge] });
  });

  const TONES: Record<string, string[]> = {
    'badge-success': ['ACTIVE', 'FILLED', 'VERIFIED', 'APPROVED', 'ACCEPTED', 'ALLOWED'],
    'badge-warning': ['PENDING', 'PENDING_APPROVAL', 'ISSUED', 'SUBMITTED', 'TERMINATION_PENDING'],
    'badge-muted': ['PAUSED', 'NONE'],
    'badge-danger': ['TERMINATED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'DISPUTED'],
  };

  for (const [tone, codes] of Object.entries(TONES)) {
    for (const code of codes) {
      it(`${code} is ${tone}`, async () => {
        const badge = await render(code);
        expect(badge.classList.contains('badge')).toBe(true);
        expect(badge.classList.contains(tone)).toBe(true);
      });
    }
  }

  it('uses the muted tone for an unknown code', async () => {
    const badge = await render('SOMETHING_NEW');
    expect(badge.classList.contains('badge-muted')).toBe(true);
    expect(badge.textContent?.trim()).toBe('Something new');
  });

  it('shows a readable version of the code', async () => {
    expect((await render('TERMINATION_PENDING')).textContent?.trim()).toBe('Termination pending');
    expect((await render('ACTIVE')).textContent?.trim()).toBe('Active');
  });

  it('prefers an explicit label', async () => {
    const badge = await render('PENDING', 'Waiting for PTO');
    expect(badge.textContent?.trim()).toBe('Waiting for PTO');
    expect(badge.classList.contains('badge-warning')).toBe(true);
  });
});
