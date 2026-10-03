import { TestBed } from '@angular/core/testing';
import { LeafletLib, LeafletLoader, leafletFrom } from './leaflet-loader';

describe('LeafletLoader', () => {
  it('loads the Leaflet library on demand', async () => {
    const lib = await TestBed.inject(LeafletLoader).load();
    expect(typeof lib.map).toBe('function');
    expect(typeof lib.divIcon).toBe('function');
  });

  it('hands out the same library every time', async () => {
    const loader = TestBed.inject(LeafletLoader);
    expect(await loader.load()).toBe(await loader.load());
  });

  it('finds the library whether the bundle exposes it by name or as the default export', async () => {
    const lib = await TestBed.inject(LeafletLoader).load();
    // A production bundle wraps Leaflet (a CommonJS package) as { default: L }.
    expect(leafletFrom({ default: lib } as unknown as LeafletLib)).toBe(lib);
    expect(leafletFrom(lib)).toBe(lib);
  });
});
