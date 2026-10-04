import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LatLng } from '../core/geo';
import { LeafletLoader } from './leaflet-loader';
import { MapMarker, MapPath, MapView } from './map-view';

type Handler = (event?: unknown) => void;

/** A stand-in for Leaflet that records what the component asks of it (jsdom cannot draw tiles). */
function stubLeaflet() {
  const state = {
    maps: [] as StubMap[],
    markers: [] as StubMarker[],
    tiles: [] as { url: string; options: Record<string, unknown> }[],
    icons: [] as Record<string, unknown>[],
    /** The layer of pins (the last group made); every group, in the order they were made, is in `groups`. */
    group: null as StubGroup | null,
    groups: [] as StubGroup[],
    polylines: [] as StubPolyline[],
  };

  /** A layer group. Typed for the pins it mostly holds; the group of lines holds StubPolylines the same way. */
  class StubGroup {
    layers: StubMarker[] = [];
    constructor() {
      state.groups.push(this);
    }
    addTo() {
      return this;
    }
    addLayer(layer: StubMarker) {
      this.layers.push(layer);
      return this;
    }
    clearLayers() {
      this.layers = [];
      return this;
    }
    removeLayer(layer: StubMarker) {
      this.layers = this.layers.filter((each) => each !== layer);
      return this;
    }
  }

  class StubPolyline {
    /** How often this very line was redrawn in place. */
    redraws = 0;
    constructor(
      public latlngs: [number, number][],
      public options: Record<string, unknown>,
    ) {
      state.polylines.push(this);
    }
    setLatLngs(latlngs: [number, number][]) {
      this.latlngs = latlngs;
      this.redraws++;
      return this;
    }
  }

  class StubMarker {
    handlers: Record<string, Handler> = {};
    /** How often this very marker was changed in place. */
    moves = 0;
    iconsSet = 0;
    zIndexOffset: number;
    constructor(
      public latlng: [number, number],
      public options: Record<string, unknown>,
    ) {
      this.zIndexOffset = Number(options['zIndexOffset'] ?? 0);
      state.markers.push(this);
    }
    on(event: string, handler: Handler) {
      this.handlers[event] = handler;
      return this;
    }
    getElement() {
      return undefined;
    }
    setLatLng(latlng: [number, number]) {
      this.latlng = latlng;
      this.moves++;
      return this;
    }
    setIcon(icon: Record<string, unknown>) {
      this.options['icon'] = icon;
      this.iconsSet++;
      return this;
    }
    setZIndexOffset(offset: number) {
      this.zIndexOffset = offset;
      return this;
    }
  }

  class StubMap {
    handlers: Record<string, Handler> = {};
    views: { center: [number, number]; zoom: number }[] = [];
    fits: { points: [number, number][]; options: Record<string, unknown> }[] = [];
    pans: [number, number][] = [];
    /** The zoom now: set by setView, and by a test standing in for a person zooming by hand. */
    zoom: number | undefined = undefined;
    resized = 0;
    zoomedIn = 0;
    zoomedOut = 0;
    removed = false;
    /** One-finger dragging, which a test can see switched on and off. */
    dragging = {
      enabled: true,
      enable: () => (this.dragging.enabled = true),
      disable: () => (this.dragging.enabled = false),
    };
    constructor(
      public container: HTMLElement,
      public options: Record<string, unknown>,
    ) {
      state.maps.push(this);
    }
    setView(center: [number, number], zoom: number) {
      this.views.push({ center, zoom });
      this.zoom = zoom;
      return this;
    }
    getZoom() {
      return this.zoom;
    }
    panTo(center: [number, number]) {
      this.pans.push(center);
      return this;
    }
    fitBounds(points: [number, number][], options: Record<string, unknown>) {
      this.fits.push({ points, options });
      return this;
    }
    on(event: string, handler: Handler) {
      this.handlers[event] = handler;
      return this;
    }
    invalidateSize() {
      this.resized++;
    }
    zoomIn() {
      this.zoomedIn++;
    }
    zoomOut() {
      this.zoomedOut++;
    }
    remove() {
      this.removed = true;
    }
  }

  const lib = {
    /** Leaflet's own idea of whether this is a phone or tablet. */
    Browser: { mobile: false },
    map: (el: HTMLElement, options: Record<string, unknown>) => new StubMap(el, options),
    tileLayer: (url: string, options: Record<string, unknown>) => ({
      addTo() {
        state.tiles.push({ url, options });
        return this;
      },
    }),
    layerGroup: () => (state.group = new StubGroup()),
    marker: (latlng: [number, number], options: Record<string, unknown>) =>
      new StubMarker(latlng, options),
    polyline: (latlngs: [number, number][], options: Record<string, unknown>) =>
      new StubPolyline(latlngs, options),
    divIcon: (options: Record<string, unknown>) => {
      state.icons.push(options);
      return { options };
    },
  };
  return { lib, state };
}

/** Stands in for the browser's ResizeObserver, so a test can say "the box changed size". */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  disconnected = false;
  constructor(public callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}

const NELLORE: LatLng = { lat: 14.4426, lng: 79.9865 };
const PUMP_A: MapMarker = { id: 1, lat: 14.44, lng: 79.98, label: 'Nellore Police Pump' };
const PUMP_B: MapMarker = { id: 2, lat: 14.5, lng: 80.0, label: 'Kavali Bunk', tone: 'tieup' };

describe('MapView', () => {
  let stub: ReturnType<typeof stubLeaflet>['state'];
  let lib: ReturnType<typeof stubLeaflet>['lib'];
  let loadFails = false;
  /** While set, the library does not arrive until `release` is called. */
  let gate: Promise<void> | null = null;
  let release = () => {};

  beforeEach(() => {
    ({ state: stub, lib } = stubLeaflet());
    loadFails = false;
    gate = null;
    FakeResizeObserver.instances = [];
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LeafletLoader,
          useValue: {
            load: async () => {
              if (loadFails) {
                throw new Error('offline');
              }
              await gate;
              return lib;
            },
          },
        },
      ],
    });
  });

  afterEach(() => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });

  async function settle(fixture: ComponentFixture<MapView>) {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }

  async function setup(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(MapView);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    const clicked: number[] = [];
    const picked: LatLng[] = [];
    fixture.componentInstance.markerClick.subscribe((id) => clicked.push(id));
    fixture.componentInstance.mapClick.subscribe((point) => picked.push(point));
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const button = (label: string) =>
      el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
    return { fixture, el, clicked, picked, text, button, map: () => stub.maps[0] };
  }

  it('creates one map in its box, with OpenStreetMap tiles and their attribution', async () => {
    const { el, map } = await setup({ markers: [PUMP_A] });
    expect(stub.maps).toHaveLength(1);
    expect(map().container).toBe(el.querySelector('.map-canvas'));
    expect(stub.tiles).toHaveLength(1);
    expect(stub.tiles[0].url).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(stub.tiles[0].options['attribution']).toBe('© OpenStreetMap contributors');
  });

  it('leaves the mouse wheel to the page, so scrolling past the map does not zoom it', async () => {
    const { map } = await setup({ markers: [PUMP_A] });
    expect(map().options).toMatchObject({ scrollWheelZoom: false, zoomControl: false });
  });

  it('keeps the same map when its inputs change', async () => {
    const { fixture } = await setup({ markers: [PUMP_A] });
    fixture.componentRef.setInput('markers', [PUMP_A, PUMP_B]);
    fixture.componentRef.setInput('zoom', 9);
    await settle(fixture);
    expect(stub.maps).toHaveLength(1);
  });

  it('adds one marker per input marker, named by its label', async () => {
    await setup({ markers: [PUMP_A, PUMP_B] });
    expect(stub.group!.layers).toHaveLength(2);
    expect(stub.group!.layers.map((m) => m.latlng)).toEqual([
      [14.44, 79.98],
      [14.5, 80.0],
    ]);
    expect(stub.group!.layers.map((m) => m.options['title'])).toEqual([
      'Nellore Police Pump',
      'Kavali Bunk',
    ]);
  });

  it('replaces the markers when the input changes', async () => {
    const { fixture } = await setup({ markers: [PUMP_A, PUMP_B] });
    fixture.componentRef.setInput('markers', [PUMP_B]);
    await settle(fixture);
    expect(stub.group!.layers).toHaveLength(1);
    expect(stub.group!.layers[0].options['title']).toBe('Kavali Bunk');
  });

  it('draws each tone as its own round pin, police by default', async () => {
    await setup({
      markers: [
        PUMP_A,
        PUMP_B,
        { id: 3, lat: 14.4, lng: 79.9, label: 'You', tone: 'me' },
        { id: 4, lat: 14.6, lng: 80.1, label: 'Chosen', tone: 'selected' },
      ],
    });
    const classes = stub.icons.map((icon) => String(icon['html']));
    expect(classes[0]).toContain('map-pin-police');
    expect(classes[1]).toContain('map-pin-tieup');
    expect(classes[2]).toContain('map-pin-me');
    expect(classes[3]).toContain('map-pin-selected');
    // Pump pins carry the fuel icon (an svg); the "me" dot does not.
    expect(classes[0]).toContain('<svg');
    expect(classes[2]).not.toContain('<svg');
    expect(stub.icons[0]['iconSize']).toEqual([36, 36]);
  });

  it('draws a vehicle as a car pin with its caption: dimmed when stale, larger when tracked', async () => {
    await setup({
      markers: [
        {
          id: 1,
          lat: 14.44,
          lng: 79.98,
          label: 'AP39PA1001, Ravi',
          tone: 'vehicle',
          caption: 'AP39PA1001',
        },
        {
          id: 2,
          lat: 14.45,
          lng: 79.99,
          label: 'Old',
          tone: 'vehicle-stale',
          caption: 'AP39PA1002',
        },
        {
          id: 3,
          lat: 14.46,
          lng: 80.0,
          label: 'Followed',
          tone: 'vehicle-tracked',
          caption: 'AP39PA1003',
        },
      ],
    });
    const html = stub.icons.map((icon) => String(icon['html']));
    expect(html[0]).toContain('map-pin-vehicle');
    expect(html[1]).toContain('map-pin-vehicle-stale');
    expect(html[2]).toContain('map-pin-vehicle-tracked');
    expect(html.every((each) => each.includes('<svg'))).toBe(true);
    expect(html[0]).toContain('<span class="map-pin-caption">AP39PA1001</span>');
    expect(stub.icons.map((icon) => icon['iconSize'])).toEqual([
      [36, 36],
      [32, 32],
      [44, 44],
    ]);
  });

  it('writes a caption as text, never as markup', async () => {
    await setup({
      markers: [{ ...PUMP_A, tone: 'vehicle', caption: '<img src=x onerror=alert(1)>' }],
    });
    const html = String(stub.icons[0]['html']);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('changes a pin in place when only its caption changes', async () => {
    const vehicle: MapMarker = { ...PUMP_A, tone: 'vehicle', caption: 'AP39PA1001' };
    const { fixture } = await setup({ markers: [vehicle] });
    fixture.componentRef.setInput('markers', [{ ...vehicle, caption: 'AP39PA1009' }]);
    await settle(fixture);
    expect(stub.markers).toHaveLength(1);
    expect(stub.markers[0].iconsSet).toBe(1);
  });

  it('draws each path as a line on a white outline, under the pins, and redraws it as it grows', async () => {
    const route: MapPath = { id: 7, points: [NELLORE, { lat: 14.45, lng: 79.99 }] };
    const { fixture } = await setup({ markers: [PUMP_A], paths: [route] });
    const paths = stub.groups[0];
    expect(stub.group).not.toBe(paths); // the pins have their own layer, drawn above the lines
    const [outline, line] = stub.polylines;
    expect(stub.polylines).toHaveLength(2);
    expect(paths.layers).toEqual([outline, line]); // the outline first, so it lies underneath
    expect(line.latlngs).toEqual([
      [14.4426, 79.9865],
      [14.45, 79.99],
    ]);
    expect(outline.latlngs).toEqual(line.latlngs);
    expect(outline.options).toMatchObject({ className: 'map-path-outline', interactive: false });
    expect(line.options).toMatchObject({
      className: 'map-path map-path-route',
      interactive: false,
    });
    expect(Number(outline.options['weight'])).toBeGreaterThan(Number(line.options['weight']));

    fixture.componentRef.setInput('paths', [
      { ...route, points: [...route.points, { lat: 14.46, lng: 80.0 }] },
    ]);
    await settle(fixture);
    expect(stub.polylines).toHaveLength(2);
    expect([outline.redraws, line.redraws]).toEqual([1, 1]);
    expect(line.latlngs).toHaveLength(3);

    fixture.componentRef.setInput('paths', []);
    await settle(fixture);
    expect(paths.layers).toEqual([]);
  });

  it('draws the route of the vehicle being tracked in its own style', async () => {
    const route: MapPath = { id: 7, points: [NELLORE, { lat: 14.45, lng: 79.99 }] };
    const { fixture } = await setup({ paths: [route] });
    fixture.componentRef.setInput('paths', [{ ...route, tone: 'tracked' }]);
    await settle(fixture);
    expect(stub.groups[0].layers).toEqual([stub.polylines[2], stub.polylines[3]]);
    expect(stub.polylines[3].options['className']).toBe('map-path map-path-tracked');
  });

  it('when live, fits the vehicles again only when one comes or goes, not each time one moves', async () => {
    const { fixture } = await setup({ live: true, markers: [PUMP_A, PUMP_B] });
    fixture.componentRef.setInput('markers', [{ ...PUMP_A, lat: 14.47 }, PUMP_B]);
    await settle(fixture);
    expect(stub.maps[0].fits).toHaveLength(1);
    expect(stub.markers[0].latlng).toEqual([14.47, 79.98]);

    fixture.componentRef.setInput('markers', [PUMP_A]);
    await settle(fixture);
    expect(stub.maps[0].fits).toHaveLength(2);
  });

  it('follows a marker: centres on it once, then pans along as it moves and keeps the zoom', async () => {
    const { fixture, map } = await setup({ live: true, markers: [PUMP_A, PUMP_B] });
    map().zoom = 11;

    fixture.componentRef.setInput('follow', 2);
    await settle(fixture);
    expect(map().views).toEqual([{ center: [14.5, 80.0], zoom: 15 }]);

    map().zoom = 17; // zoomed in by hand
    fixture.componentRef.setInput('markers', [PUMP_A, { ...PUMP_B, lat: 14.51 }]);
    await settle(fixture);
    expect(map().pans).toEqual([[14.51, 80.0]]);
    expect(map().views).toHaveLength(1); // panned, not set again at another zoom

    fixture.componentRef.setInput('markers', [
      { ...PUMP_A, lat: 14.3 },
      { ...PUMP_B, lat: 14.51 },
    ]);
    await settle(fixture);
    expect(map().pans).toHaveLength(1); // another marker moving does not move the view

    fixture.componentRef.setInput('follow', null);
    fixture.componentRef.setInput('markers', [PUMP_A, { ...PUMP_B, lat: 14.52 }]);
    await settle(fixture);
    expect(map().pans).toHaveLength(1);
  });

  it('keeps the zoom when it is already close in as it starts to follow', async () => {
    const { fixture, map } = await setup({ markers: [PUMP_A] });
    map().zoom = 17;
    fixture.componentRef.setInput('follow', 1);
    await settle(fixture);
    expect(map().views.at(-1)).toEqual({ center: [14.44, 79.98], zoom: 17 });
  });

  it('re-centres on the marker it follows', async () => {
    const { fixture, button, map } = await setup({ markers: [PUMP_A, PUMP_B], follow: 1 });
    const views = map().views.length;
    button('Re-centre map')!.click();
    await settle(fixture);
    expect(map().views).toHaveLength(views + 1);
    expect(map().views.at(-1)!.center).toEqual([14.44, 79.98]);
  });

  it('emits markerClick with the id of the marker that was clicked', async () => {
    const { clicked } = await setup({ markers: [PUMP_A, PUMP_B] });
    stub.group!.layers[1].handlers['click']();
    stub.group!.layers[0].handlers['click']();
    expect(clicked).toEqual([2, 1]);
  });

  it('emits markerClick when Enter or Space is pressed on a focused pin', async () => {
    const { clicked } = await setup({ markers: [PUMP_A, PUMP_B] });
    const press = (index: number, key: string) =>
      stub.group!.layers[index].handlers['keypress']({
        originalEvent: { key, preventDefault: () => {} },
      });
    press(1, 'Enter');
    press(0, ' ');
    expect(clicked).toEqual([2, 1]);
  });

  it('ignores other keys on a pin', async () => {
    const { clicked } = await setup({ markers: [PUMP_A] });
    for (const key of ['Tab', 'a', 'Escape', 'ArrowDown']) {
      stub.group!.layers[0].handlers['keypress']({
        originalEvent: { key, preventDefault: () => {} },
      });
    }
    expect(clicked).toEqual([]);
  });

  it('does not let Space scroll the page when it presses a pin', async () => {
    await setup({ markers: [PUMP_A] });
    let prevented = 0;
    stub.group!.layers[0].handlers['keypress']({
      originalEvent: { key: ' ', preventDefault: () => prevented++ },
    });
    expect(prevented).toBe(1);
  });

  it('keeps a marker that did not change, and changes the others in place', async () => {
    const { fixture } = await setup({ markers: [PUMP_A, PUMP_B] });
    const [a, b] = stub.group!.layers;
    fixture.componentRef.setInput('markers', [
      { ...PUMP_A },
      { ...PUMP_B, tone: 'selected', label: 'Kavali Bunk (chosen)', lat: 14.6 },
    ]);
    await settle(fixture);
    expect(stub.group!.layers[0]).toBe(a);
    expect(stub.group!.layers[1]).toBe(b);
    expect(stub.markers).toHaveLength(2); // nothing was rebuilt
    expect([a.moves, a.iconsSet]).toEqual([0, 0]);
    expect(b.latlng).toEqual([14.6, 80.0]);
    expect(b.iconsSet).toBe(1);
    const icon = b.options['icon'] as { options: Record<string, unknown> };
    expect(String(icon.options['html'])).toContain('map-pin-selected');
    expect(b.options['title']).toBe('Kavali Bunk (chosen)');
    expect(b.zIndexOffset).toBe(1000);
  });

  it('adds a marker that is new and removes one that is gone, leaving the rest alone', async () => {
    const { fixture } = await setup({ markers: [PUMP_A, PUMP_B] });
    const [a, b] = stub.group!.layers;
    const pumpC: MapMarker = { id: 3, lat: 14.7, lng: 80.1, label: 'Gudur Pump' };
    fixture.componentRef.setInput('markers', [PUMP_A, pumpC]);
    await settle(fixture);
    expect(stub.group!.layers).toHaveLength(2);
    expect(stub.group!.layers[0]).toBe(a);
    expect(stub.group!.layers).not.toContain(b);
    expect(stub.group!.layers[1].options['title']).toBe('Gudur Pump');
    expect(stub.markers).toHaveLength(3);
  });

  it('still sends the right id from a marker that was changed in place', async () => {
    const { fixture, clicked } = await setup({ markers: [PUMP_A, PUMP_B] });
    fixture.componentRef.setInput('markers', [PUMP_A, { ...PUMP_B, tone: 'selected' }]);
    await settle(fixture);
    stub.group!.layers[1].handlers['click']();
    expect(clicked).toEqual([2]);
  });

  it('turns one-finger dragging off on a touch device, so a swipe scrolls the page', async () => {
    lib.Browser.mobile = true;
    await setup({ markers: [PUMP_A] });
    expect(stub.maps[0].dragging.enabled).toBe(false);
  });

  it('keeps dragging on a touch device when touchDrag is set', async () => {
    lib.Browser.mobile = true;
    const { fixture } = await setup({ markers: [PUMP_A], touchDrag: true });
    expect(stub.maps[0].dragging.enabled).toBe(true);
    fixture.componentRef.setInput('touchDrag', false);
    await settle(fixture);
    expect(stub.maps[0].dragging.enabled).toBe(false);
    fixture.componentRef.setInput('touchDrag', true);
    await settle(fixture);
    expect(stub.maps[0].dragging.enabled).toBe(true);
  });

  it('always lets a mouse drag the map', async () => {
    lib.Browser.mobile = false;
    await setup({ markers: [PUMP_A] });
    expect(stub.maps[0].dragging.enabled).toBe(true);
  });

  it('keeps the zoom and re-centre buttons when dragging is off on a touch device', async () => {
    lib.Browser.mobile = true;
    const { button } = await setup({ markers: [PUMP_A, PUMP_B] });
    button('Zoom in')!.click();
    button('Re-centre map')!.click();
    expect(stub.maps[0].zoomedIn).toBe(1);
    expect(stub.maps[0].fits).toHaveLength(2);
  });

  it('removes the map if starting up fails after it was created', async () => {
    lib.tileLayer = () => {
      throw new Error('tiles');
    };
    const { el, text, fixture } = await setup({ markers: [PUMP_A] });
    expect(stub.maps).toHaveLength(1);
    expect(stub.maps[0].removed).toBe(true);
    expect(text(el.querySelector('[role="status"]'))).toBe(
      'The map could not be loaded. Everything else on this page still works.',
    );
    expect(el.querySelector('button')).toBeNull();
    fixture.componentRef.setInput('markers', []);
    await settle(fixture);
    expect(stub.markers).toHaveLength(0);
  });

  it('emits mapClick only when the map can be picked from', async () => {
    const { fixture, picked } = await setup({ markers: [] });
    stub.maps[0].handlers['click']({ latlng: { lat: 14.4, lng: 79.9 } });
    expect(picked).toEqual([]);

    fixture.componentRef.setInput('pickable', true);
    await settle(fixture);
    stub.maps[0].handlers['click']({ latlng: { lat: 14.4, lng: 79.9 } });
    expect(picked).toEqual([{ lat: 14.4, lng: 79.9 }]);
  });

  it('rounds a picked point to 6 decimals', async () => {
    const { picked } = await setup({ pickable: true });
    stub.maps[0].handlers['click']({ latlng: { lat: 14.44260051, lng: 79.98649951234 } });
    expect(picked).toEqual([{ lat: 14.442601, lng: 79.9865 }]);
  });

  it('shows the given centre at the given zoom, 12 by default', async () => {
    await setup({ center: NELLORE, markers: [PUMP_A] });
    expect(stub.maps[0].views).toEqual([{ center: [14.4426, 79.9865], zoom: 12 }]);
  });

  it('moves to a new centre or zoom when they change', async () => {
    const { fixture } = await setup({ center: NELLORE });
    fixture.componentRef.setInput('center', { lat: 15.5, lng: 80.05 });
    fixture.componentRef.setInput('zoom', 14);
    await settle(fixture);
    expect(stub.maps[0].views.at(-1)).toEqual({ center: [15.5, 80.05], zoom: 14 });
  });

  it('does not move the view when only the markers change and a centre is given', async () => {
    const { fixture } = await setup({ center: NELLORE, markers: [PUMP_A] });
    fixture.componentRef.setInput('markers', [{ ...PUMP_A, lat: 14.45, lng: 79.99 }]);
    await settle(fixture);
    expect(stub.maps[0].views).toHaveLength(1);
    expect(stub.maps[0].fits).toHaveLength(0);
  });

  it('fits all the markers when there is no centre', async () => {
    await setup({ markers: [PUMP_A, PUMP_B] });
    expect(stub.maps[0].fits).toHaveLength(1);
    expect(stub.maps[0].fits[0].points).toEqual([
      [14.44, 79.98],
      [14.5, 80.0],
    ]);
  });

  it('keeps fitted pins and their captions clear of the edges and of the buttons on the right', async () => {
    await setup({ markers: [PUMP_A, PUMP_B] });
    expect(stub.maps[0].fits[0].options).toMatchObject({
      paddingTopLeft: [40, 40],
      paddingBottomRight: [72, 48],
    });
  });

  it('shows Andhra Pradesh when there is neither a centre nor a marker', async () => {
    await setup();
    expect(stub.maps[0].fits).toHaveLength(0);
    expect(stub.maps[0].views).toHaveLength(1);
    expect(stub.maps[0].views[0].zoom).toBe(6);
  });

  it('fits again when the markers are different, but not when only a tone changes', async () => {
    const { fixture } = await setup({ markers: [PUMP_A, PUMP_B] });
    fixture.componentRef.setInput('markers', [PUMP_A, { ...PUMP_B, tone: 'selected' }]);
    await settle(fixture);
    expect(stub.maps[0].fits).toHaveLength(1);
    fixture.componentRef.setInput('markers', [PUMP_A]);
    await settle(fixture);
    expect(stub.maps[0].fits).toHaveLength(2);
  });

  it('has round buttons that zoom and re-centre', async () => {
    const { fixture, button } = await setup({ markers: [PUMP_A, PUMP_B] });
    button('Zoom in')!.click();
    button('Zoom in')!.click();
    button('Zoom out')!.click();
    expect([stub.maps[0].zoomedIn, stub.maps[0].zoomedOut]).toEqual([2, 1]);
    button('Re-centre map')!.click();
    expect(stub.maps[0].fits).toHaveLength(2);

    fixture.componentRef.setInput('center', NELLORE);
    await settle(fixture);
    button('Re-centre map')!.click();
    expect(stub.maps[0].views.at(-1)).toEqual({ center: [14.4426, 79.9865], zoom: 12 });
  });

  it('tells Leaflet when its box changes size', async () => {
    await setup({ markers: [PUMP_A] });
    expect(FakeResizeObserver.instances).toHaveLength(1);
    const before = stub.maps[0].resized;
    FakeResizeObserver.instances[0].callback();
    expect(stub.maps[0].resized).toBe(before + 1);
  });

  it('removes the map and stops watching its size when it is destroyed', async () => {
    const { fixture } = await setup({ markers: [PUMP_A] });
    fixture.destroy();
    expect(stub.maps[0].removed).toBe(true);
    expect(FakeResizeObserver.instances[0].disconnected).toBe(true);
  });

  it('makes no map if it is destroyed before the library has loaded', async () => {
    gate = new Promise((resolve) => (release = resolve));
    const fixture = TestBed.createComponent(MapView);
    await fixture.whenStable();
    fixture.destroy();
    release();
    await new Promise((resolve) => setTimeout(resolve));
    expect(stub.maps).toHaveLength(0);
  });

  it('says so, and nothing else breaks, when the map cannot be loaded', async () => {
    loadFails = true;
    const { el, text, fixture } = await setup({ markers: [PUMP_A] });
    expect(text(el.querySelector('[role="status"]'))).toBe(
      'The map could not be loaded. Everything else on this page still works.',
    );
    expect(stub.maps).toHaveLength(0);
    expect(el.querySelector('button')).toBeNull();
    fixture.componentRef.setInput('markers', []);
    await settle(fixture);
  });

  it('lets people click on the map only when it is pickable', async () => {
    const { fixture, el } = await setup();
    const box = el.querySelector('.map-view')!;
    expect(box.classList.contains('pickable')).toBe(false);
    fixture.componentRef.setInput('pickable', true);
    await settle(fixture);
    expect(box.classList.contains('pickable')).toBe(true);
  });
});

describe('MapView with the real Leaflet', () => {
  it('draws a marker for each pump and removes them again', async () => {
    await TestBed.inject(LeafletLoader).load();
    const fixture = TestBed.createComponent(MapView);
    fixture.componentRef.setInput('markers', [PUMP_A, PUMP_B]);
    fixture.componentRef.setInput('center', NELLORE);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.leaflet-container')).toBeTruthy();
    expect(el.querySelectorAll('.leaflet-marker-icon')).toHaveLength(2);
    expect(el.querySelector('.map-pin-tieup')).toBeTruthy();

    fixture.componentRef.setInput('markers', [PUMP_A]);
    await fixture.whenStable();
    expect(el.querySelectorAll('.leaflet-marker-icon')).toHaveLength(1);
    fixture.destroy();
  });

  async function realMap(markers: MapMarker[]) {
    await TestBed.inject(LeafletLoader).load();
    const fixture = TestBed.createComponent(MapView);
    fixture.componentRef.setInput('markers', markers);
    fixture.componentRef.setInput('center', NELLORE);
    const clicked: number[] = [];
    fixture.componentInstance.markerClick.subscribe((id) => clicked.push(id));
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    const icons = () =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
          '.leaflet-marker-icon',
        ),
      );
    return { fixture, clicked, icons };
  }

  it('sends markerClick for a click, and for Enter and Space on a focused pin', async () => {
    const { fixture, clicked, icons } = await realMap([PUMP_A, PUMP_B]);
    icons()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    icons()[0].focus();
    icons()[0].dispatchEvent(
      new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }),
    );
    icons()[1].dispatchEvent(
      new KeyboardEvent('keypress', { key: ' ', keyCode: 32, bubbles: true }),
    );
    icons()[1].dispatchEvent(
      new KeyboardEvent('keypress', { key: 'a', keyCode: 65, bubbles: true }),
    );
    expect(clicked).toEqual([2, 1, 2]);
    fixture.destroy();
  });

  it('keeps keyboard focus on a pin when its tone or label changes', async () => {
    const { fixture, icons } = await realMap([PUMP_A, PUMP_B]);
    const first = icons()[0];
    expect(first.tabIndex).toBe(0);
    first.focus();
    expect(document.activeElement).toBe(first);

    fixture.componentRef.setInput('markers', [
      { ...PUMP_A, tone: 'selected', label: 'Nellore Police Pump (chosen)' },
      PUMP_B,
    ]);
    await fixture.whenStable();
    expect(icons()).toHaveLength(2);
    expect(icons()[0]).toBe(first);
    expect(document.activeElement).toBe(first);
    expect(first.querySelector('.map-pin-selected')).toBeTruthy();
    expect(first.title).toBe('Nellore Police Pump (chosen)');
    fixture.destroy();
  });
});
