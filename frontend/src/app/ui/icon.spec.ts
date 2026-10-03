import { TestBed } from '@angular/core/testing';
import { Icon, iconSvg } from './icon';

const REQUIRED_NAMES = [
  'home',
  'compass',
  'card',
  'bell',
  'user',
  'users',
  'search',
  'navigation',
  'map-pin',
  'clock',
  'fuel',
  'car',
  'shield',
  'building',
  'check',
  'check-circle',
  'x',
  'chevron-left',
  'chevron-right',
  'menu',
  'log-out',
  'plus',
  'alert-triangle',
  'gauge',
  'wrench',
  'file-text',
  'file-plus',
  'droplet',
  'arrow-left-right',
  'upload',
  'download',
  'thumbs-up',
  'calendar',
  'list',
  'lock',
  'refresh',
  'locate',
  'minus',
  'phone',
];

async function render(name: string, size?: number) {
  const fixture = TestBed.createComponent(Icon);
  fixture.componentRef.setInput('name', name);
  if (size !== undefined) {
    fixture.componentRef.setInput('size', size);
  }
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('Icon', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Icon] });
  });

  it('renders an svg for bell', async () => {
    const el = await render('bell');
    const svg = el.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.querySelector('path')).not.toBeNull();
  });

  it('draws outline strokes with currentColor', async () => {
    const svg = (await render('bell')).querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('stroke-width')).toBe('1.75');
    expect(svg?.getAttribute('stroke-linecap')).toBe('round');
    expect(svg?.getAttribute('fill')).toBe('none');
  });

  it('is 20px by default and takes a size', async () => {
    const small = (await render('bell')).querySelector('svg');
    expect(small?.getAttribute('width')).toBe('20');
    expect(small?.getAttribute('height')).toBe('20');
    const big = (await render('bell', 32)).querySelector('svg');
    expect(big?.getAttribute('width')).toBe('32');
    expect(big?.getAttribute('height')).toBe('32');
  });

  it('is hidden from assistive technology', async () => {
    const svg = (await render('bell')).querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders nothing for an unknown name without throwing', async () => {
    const el = await render('does-not-exist');
    expect(el.querySelector('svg')).toBeNull();
  });

  it('has every icon the screens need', async () => {
    for (const name of REQUIRED_NAMES) {
      const el = await render(name);
      expect(el.querySelector('svg'), name).not.toBeNull();
      expect(el.querySelector('svg')?.children.length, name).toBeGreaterThan(0);
    }
  });

  it('can give an icon as plain svg markup, for places Angular does not draw', () => {
    const markup = iconSvg('fuel', 18);
    expect(markup.startsWith('<svg ')).toBe(true);
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('width="18"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<path');
    expect(iconSvg('does-not-exist')).toBe('');
  });
});
