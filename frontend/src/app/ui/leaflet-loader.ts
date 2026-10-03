import { Service } from '@angular/core';

export type LeafletLib = typeof import('leaflet');

/**
 * The library out of the imported module. Leaflet is a CommonJS package: the development server hands it over by
 * name, but a production bundle wraps it as the module's default export.
 */
export function leafletFrom(module: LeafletLib): LeafletLib {
  if (typeof module.map === 'function') {
    return module;
  }
  return (module as unknown as { default: LeafletLib }).default;
}

/**
 * Brings in Leaflet only when a map is first shown, so pages without a map do not carry it.
 * Specs provide a stub with the same `load()`, since jsdom cannot draw map tiles.
 */
@Service()
export class LeafletLoader {
  load(): Promise<LeafletLib> {
    return import('leaflet').then(leafletFrom);
  }
}
