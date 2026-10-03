import { Provider } from '@angular/core';
import { LeafletLoader } from '../leaflet-loader';

/**
 * For specs of a page that holds a map. jsdom cannot draw map tiles, so Leaflet never arrives
 * and the map shows its loading note; the spec checks the page through `MapView`'s inputs and outputs.
 */
export const NEVER_LOADING_LEAFLET: Provider = {
  provide: LeafletLoader,
  useValue: { load: () => new Promise(() => {}) },
};
