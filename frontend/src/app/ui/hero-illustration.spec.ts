import { TestBed } from '@angular/core/testing';
import { HeroIllustration } from './hero-illustration';

describe('HeroIllustration', () => {
  it('renders an accessible svg scene that fills its width', async () => {
    const fixture = TestBed.createComponent(HeroIllustration);
    await fixture.whenStable();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('100%');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBeTruthy();
    expect(svg?.querySelector('linearGradient')).not.toBeNull();
  });
});
