import {
  afterNextRender,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import type {
  FitBoundsOptions,
  LayerGroup,
  LeafletKeyboardEvent,
  LeafletMouseEvent,
  Map as LeafletMap,
  Marker,
  Polyline,
} from 'leaflet';
import { LatLng, roundCoordinate } from '../core/geo';
import { Icon, iconSvg } from './icon';
import { LeafletLib, LeafletLoader } from './leaflet-loader';

export type MapTone =
  'police' | 'tieup' | 'me' | 'selected' | 'vehicle' | 'vehicle-stale' | 'vehicle-tracked';

export type MapMarker = {
  id: number;
  lat: number;
  lng: number;
  /** Names the marker for people using a keyboard or a screen reader, and shows as its tooltip. */
  label: string;
  /**
   * Police pump (red) by default; a tie-up bunk is amber, "me" a blue dot, "selected" the highlighted pump. A
   * vehicle on duty is a car pin: "vehicle-stale" when its location is old, "vehicle-tracked" the one followed.
   */
  tone?: MapTone;
  /** A short name written under the pin, such as a registration number. */
  caption?: string;
};

/** A line on the map, such as the route a vehicle took. */
export type MapPath = {
  id: number;
  points: LatLng[];
  /** A vehicle's route by default; "tracked" is the route of the vehicle being followed, drawn bolder. */
  tone?: 'route' | 'tracked';
};

const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© OpenStreetMap contributors';

/** Shown when there is nothing to centre on: all of Andhra Pradesh. */
const ANDHRA_PRADESH: LatLng = { lat: 15.9129, lng: 79.74 };
const ANDHRA_PRADESH_ZOOM = 6;

/** The closest the map zooms when it fits its markers, so one pump does not fill the screen with a street. */
const FIT_MAX_ZOOM = 15;

/**
 * Room left around fitted markers, in px: more on the right, where the buttons are, and below, for the captions
 * under the pins.
 */
const FIT_PADDING: FitBoundsOptions = { paddingTopLeft: [40, 40], paddingBottomRight: [72, 48] };

/** How close the map comes, at least, when it starts to follow a marker: close enough to see the streets. */
const FOLLOW_MIN_ZOOM = 15;

/** Pin sizes in px: a pump's pin, the highlighted pump, the blue dot for "me", and vehicles. */
const SIZES: Readonly<Record<MapTone, number>> = {
  police: 36,
  tieup: 36,
  selected: 44,
  me: 22,
  vehicle: 36,
  'vehicle-stale': 32,
  'vehicle-tracked': 44,
};

/** The highlighted pump, the followed vehicle and "me" are drawn above the other pins; old locations below. */
const Z_OFFSETS: Readonly<Record<MapTone, number>> = {
  police: 0,
  tieup: 0,
  selected: 1000,
  me: 500,
  vehicle: 200,
  'vehicle-stale': 100,
  'vehicle-tracked': 1000,
};

/** The icon inside each kind of pin; the "me" dot has none. */
const PIN_ICONS: Readonly<Record<MapTone, string>> = {
  police: 'fuel',
  tieup: 'fuel',
  selected: 'fuel',
  me: '',
  vehicle: 'car',
  'vehicle-stale': 'car',
  'vehicle-tracked': 'car',
};

/** A marker on the map, with what it was last drawn from, so it is changed only when that changes. */
type Pin = { marker: Marker; key: string };

/** A line on the map with the white outline under it, kept the same way. */
type Line = { outline: Polyline; line: Polyline; tone: string; key: string };

/** Route colours stand out from OpenStreetMap's own: a strong blue on a white outline, never the orange of roads. */
const ROUTE_BLUE = '#2563eb';
const TRACKED_BLUE = '#1d4ed8';

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Text made safe to place inside the HTML of a pin. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * A map of pump pins on OpenStreetMap tiles. Leaflet loads on first use; if it cannot, the box shows a
 * small note and the page around it carries on. Set `pickable` to turn clicks on the map into `mapClick`.
 */
@Component({
  selector: 'app-map-view',
  imports: [Icon],
  encapsulation: ViewEncapsulation.None, // Leaflet's markers live outside Angular's templates
  template: `
    <div class="map-view" [class.pickable]="pickable()" [class.failed]="failed()">
      <div #canvas class="map-canvas"></div>
      @if (ready()) {
        <div class="map-controls">
          <button type="button" class="btn-icon" aria-label="Zoom in" (click)="zoomIn()">
            <app-icon name="plus" [size]="20" />
          </button>
          <button type="button" class="btn-icon" aria-label="Zoom out" (click)="zoomOut()">
            <app-icon name="minus" [size]="20" />
          </button>
          <button type="button" class="btn-icon" aria-label="Re-centre map" (click)="recentre()">
            <app-icon name="locate" [size]="20" />
          </button>
        </div>
      }
      @if (failed()) {
        <p class="map-note" role="status">
          The map could not be loaded. Everything else on this page still works.
        </p>
      } @else if (!ready()) {
        <p class="map-note" role="status">Loading map…</p>
      }
    </div>
  `,
  styles: `
    app-map-view {
      display: block;
    }

    .map-view {
      position: relative;
      // Leaflet's panes use z-index up to 1000; keep them inside the map so they never cover the
      // app bar, the bottom navigation or a toast.
      isolation: isolate;
      height: var(--map-height, 300px);
      overflow: hidden;
      border-radius: var(--map-radius, var(--radius-md));
      background: var(--surface-2);
      box-shadow: var(--shadow-card);

      @media (min-width: 900px) {
        height: var(--map-height, 400px);
      }
    }

    .map-view .map-canvas {
      position: absolute;
      inset: 0;
      font-family: var(--font);
    }

    .map-view.pickable .map-canvas {
      cursor: crosshair;
    }

    .map-view.failed {
      height: auto;
      box-shadow: none;

      .map-canvas {
        display: none;
      }
    }

    .map-view .map-note {
      position: relative;
      margin: 0;
      padding: 14px 16px;
      color: var(--muted);
      font-size: 14px;
    }

    .map-view:not(.failed) .map-note {
      position: absolute;
      top: 50%;
      right: 0;
      left: 0;
      transform: translateY(-50%);
      text-align: center;
    }

    // A page that covers the top or the bottom edge of the map (with its own buttons or a sheet) moves
    // the zoom buttons with --map-controls-top / --map-controls-bottom, and lifts Leaflet's attribution
    // above a covered bottom edge with --map-inset-bottom.
    .map-controls {
      position: absolute;
      top: var(--map-controls-top, 12px);
      bottom: var(--map-controls-bottom, auto);
      right: 12px;
      z-index: 500;
      display: flex;
      flex-direction: column;
      gap: 8px;

      .btn-icon {
        width: 44px;
        height: 44px;
      }
    }

    .map-view .leaflet-bottom {
      bottom: var(--map-inset-bottom, 0px);
    }

    // Pump pins: a round white pin with a fuel icon, drawn in the colour of its kind.
    .map-pin-wrap {
      background: none;
      border: 0;
    }

    .map-pin {
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      border: 2px solid currentColor;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 6px 16px rgba(20, 24, 33, 0.28);
      transition: transform 0.12s ease;
    }

    .map-pin-police {
      color: var(--danger);
    }

    .map-pin-tieup {
      // darkened from --primary-strong so the icon reaches 3:1 on white
      color: color-mix(in srgb, var(--primary-strong) 78%, black);
    }

    .map-pin-selected {
      border-color: #ffffff;
      background: var(--primary);
      color: var(--on-primary);
    }

    .map-pin-me {
      border: 3px solid #ffffff;
      background: var(--info);
      box-shadow: 0 0 0 6px rgba(59, 130, 246, 0.22);
    }

    // Vehicles on duty: a car in blue, apart from the red and amber pumps; dimmed and dashed when the location
    // is old; filled when followed.
    .map-pin-vehicle {
      color: #1d4ed8;
    }

    .map-pin-vehicle-stale {
      border-style: dashed;
      color: var(--muted);
      box-shadow: 0 4px 10px rgba(20, 24, 33, 0.18);
    }

    .map-pin-vehicle-tracked {
      border-color: #ffffff;
      background: #1d4ed8;
      color: #ffffff;
      box-shadow:
        0 0 0 6px rgba(29, 78, 216, 0.25),
        0 6px 16px rgba(20, 24, 33, 0.28);
    }

    .map-pin-caption {
      position: absolute;
      top: calc(100% + 4px);
      left: 50%;
      transform: translateX(-50%);
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.96);
      color: #1d2433;
      font: 700 11px/1.3 var(--font);
      letter-spacing: 0.02em;
      white-space: nowrap;
      box-shadow: 0 2px 6px rgba(20, 24, 33, 0.22);
      pointer-events: none;
    }

    // Routes: no fill, and the outline a little see-through so the streets under it still read.
    .map-view .map-path,
    .map-view .map-path-outline {
      fill: none;
    }

    .map-view .map-path-outline {
      stroke-opacity: 0.85;
    }

    .leaflet-marker-icon:hover .map-pin,
    .leaflet-marker-icon:focus-visible .map-pin {
      transform: scale(1.08);
    }

    .leaflet-marker-icon:focus-visible {
      outline: none;

      .map-pin {
        outline: 3px solid var(--primary-strong);
        outline-offset: 2px;
      }
    }
  `,
})
export class MapView {
  readonly markers = input<MapMarker[]>([]);
  /** Where to look. Without one, the map fits its markers (or shows Andhra Pradesh when there are none). */
  readonly center = input<LatLng | null>(null);
  readonly zoom = input(12);
  /** Clicks on the map become `mapClick`, for choosing a location. */
  readonly pickable = input(false);
  /**
   * On a touch device a one-finger swipe scrolls the page rather than moving the map (pinching and the
   * buttons still work). Set this for a full-screen map, where there is no page to scroll.
   */
  readonly touchDrag = input(false);
  /** Lines drawn under the pins, such as the routes vehicles took. */
  readonly paths = input<MapPath[]>([]);
  /**
   * The markers move on their own (vehicles on duty): the map fits them again when one comes or goes, not each
   * time one moves, so it stays where the person looking has put it.
   */
  readonly live = input(false);
  /** The id of a marker to keep in view: the map centres on it once, then pans along as it moves. */
  readonly follow = input<number | null>(null);

  readonly markerClick = output<number>();
  readonly mapClick = output<LatLng>();

  private readonly loader = inject(LeafletLoader);
  private readonly canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');

  protected readonly ready = signal(false);
  protected readonly failed = signal(false);

  private lib: LeafletLib | null = null;
  private map: LeafletMap | null = null;
  private layer: LayerGroup | null = null;
  private pathLayer: LayerGroup | null = null;
  /** The markers on the map by id, so an update changes them in place and keeps keyboard focus. */
  private readonly pins = new Map<number, Pin>();
  /** The lines on the map by id, so a growing route is redrawn in place. */
  private readonly lines = new Map<number, Line>();
  private observer: ResizeObserver | null = null;
  private destroyed = false;
  /** What the view was last pointed at, so a change of markers alone does not move it again. */
  private viewKey = '';
  /** Where the followed marker was when the view last moved with it. */
  private followedAt = '';

  constructor() {
    afterNextRender(() => void this.start());
    effect(() => {
      const markers = this.markers();
      if (this.ready()) {
        this.draw(markers);
      }
    });
    effect(() => {
      const paths = this.paths();
      if (this.ready()) {
        this.drawPaths(paths);
      }
    });
    effect(() => {
      if (this.ready()) {
        this.applyView();
      }
    });
    effect(() => {
      const touchDrag = this.touchDrag();
      if (this.ready()) {
        this.applyDragging(touchDrag);
      }
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  private async start(): Promise<void> {
    let lib: LeafletLib;
    try {
      lib = await this.loader.load();
    } catch {
      if (!this.destroyed) {
        this.failed.set(true);
      }
      return;
    }
    if (this.destroyed) {
      return;
    }
    try {
      const element = this.canvas().nativeElement;
      // The buttons zoom (as do double-clicks, pinching and + / -); the wheel is left to the page, which
      // otherwise cannot be scrolled while the pointer is over a map.
      const map = lib.map(element, { zoomControl: false, scrollWheelZoom: false });
      // Kept at once, so that if anything below throws, stop() still removes the map.
      this.lib = lib;
      this.map = map;
      lib.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
      this.pathLayer = lib.layerGroup().addTo(map);
      this.layer = lib.layerGroup().addTo(map);
      map.on('click', (event: LeafletMouseEvent) => {
        if (this.pickable()) {
          this.mapClick.emit({
            lat: roundCoordinate(event.latlng.lat),
            lng: roundCoordinate(event.latlng.lng),
          });
        }
      });
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(() => this.map?.invalidateSize());
        this.observer.observe(element);
      }
      this.ready.set(true);
    } catch {
      this.stop();
      this.failed.set(true);
    }
  }

  private stop(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.observer = null;
    this.map?.remove();
    this.map = null;
    this.layer = null;
    this.pathLayer = null;
    this.lib = null;
    this.pins.clear();
    this.lines.clear();
  }

  /** Brings the markers on the map in line with the input: new ones are added, changed ones updated in place, gone ones removed. */
  private draw(markers: MapMarker[]): void {
    const { lib, layer } = this;
    if (!lib || !layer) {
      return;
    }
    const present = new Set<number>();
    for (const item of markers) {
      present.add(item.id);
      const tone = item.tone ?? 'police';
      const caption = item.caption ?? '';
      const key = `${tone}|${item.label}|${caption}|${item.lat}|${item.lng}`;
      const pin = this.pins.get(item.id);
      if (!pin) {
        const marker = lib.marker([item.lat, item.lng], {
          icon: this.icon(lib, tone, caption),
          title: item.label,
          keyboard: true,
          zIndexOffset: Z_OFFSETS[tone],
        });
        marker.on('click', () => this.markerClick.emit(item.id));
        marker.on('keypress', (event: LeafletKeyboardEvent) => this.pressed(event, item.id));
        layer.addLayer(marker);
        this.pins.set(item.id, { marker, key });
      } else if (pin.key !== key) {
        // The icon element is reused (so focus stays), and Leaflet only writes the title onto a new one.
        pin.marker.options.title = item.label;
        pin.marker.getElement()?.setAttribute('title', item.label);
        pin.marker.setLatLng([item.lat, item.lng]);
        pin.marker.setZIndexOffset(Z_OFFSETS[tone]);
        pin.marker.setIcon(this.icon(lib, tone, caption));
        pin.key = key;
      }
    }
    for (const [id, pin] of this.pins) {
      if (!present.has(id)) {
        layer.removeLayer(pin.marker);
        this.pins.delete(id);
      }
    }
  }

  /** Brings the lines on the map in line with the input, the same way as the markers. */
  private drawPaths(paths: MapPath[]): void {
    const { lib, pathLayer } = this;
    if (!lib || !pathLayer) {
      return;
    }
    const present = new Set<number>();
    for (const path of paths) {
      present.add(path.id);
      const tone = path.tone ?? 'route';
      const latlngs = path.points.map((point): [number, number] => [point.lat, point.lng]);
      const [first, last] = [latlngs[0], latlngs.at(-1)];
      const key = `${latlngs.length}|${first}|${last}`;
      const drawn = this.lines.get(path.id);
      if (drawn && drawn.tone === tone) {
        if (drawn.key !== key) {
          drawn.outline.setLatLngs(latlngs);
          drawn.line.setLatLngs(latlngs);
          drawn.key = key;
        }
        continue;
      }
      if (drawn) {
        // Leaflet gives a line its class and colour only when it makes it, so a new tone means new lines.
        pathLayer.removeLayer(drawn.outline);
        pathLayer.removeLayer(drawn.line);
      }
      const weight = tone === 'tracked' ? 6 : 5;
      const shape = { interactive: false, lineCap: 'round', lineJoin: 'round' } as const;
      const outline = lib.polyline(latlngs, {
        ...shape,
        className: 'map-path-outline',
        color: '#ffffff',
        weight: weight + 4,
      });
      const line = lib.polyline(latlngs, {
        ...shape,
        className: `map-path map-path-${tone}`,
        color: tone === 'tracked' ? TRACKED_BLUE : ROUTE_BLUE,
        weight,
        opacity: 0.95,
      });
      pathLayer.addLayer(outline); // first, so it lies under the line
      pathLayer.addLayer(line);
      this.lines.set(path.id, { outline, line, tone, key });
    }
    for (const [id, drawn] of this.lines) {
      if (!present.has(id)) {
        pathLayer.removeLayer(drawn.outline);
        pathLayer.removeLayer(drawn.line);
        this.lines.delete(id);
      }
    }
  }

  private icon(lib: LeafletLib, tone: MapTone, caption: string) {
    const size = SIZES[tone];
    return lib.divIcon({
      className: 'map-pin-wrap',
      html: this.pinHtml(tone, caption),
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  /** A pin is a focusable button, but Leaflet reports Enter and Space as key presses, not clicks. */
  private pressed(event: LeafletKeyboardEvent, id: number): void {
    const key = event.originalEvent.key;
    if (key === 'Enter' || key === ' ') {
      event.originalEvent.preventDefault(); // Space would scroll the page
      this.markerClick.emit(id);
    }
  }

  private pinHtml(tone: MapTone, caption: string): string {
    const large = tone === 'selected' || tone === 'vehicle-tracked';
    const icon = PIN_ICONS[tone] ? iconSvg(PIN_ICONS[tone], large ? 22 : 18) : '';
    const label = caption ? `<span class="map-pin-caption">${escapeHtml(caption)}</span>` : '';
    return `<span class="map-pin map-pin-${tone}">${icon}</span>${label}`;
  }

  /**
   * Points the map at the centre, or at the followed marker, or fits the markers; does nothing if it already
   * looks there.
   */
  private applyView(force = false): void {
    const map = this.map;
    if (!map) {
      return;
    }
    const center = this.center();
    const markers = this.markers();
    const follow = this.follow();
    const followed = follow === null ? undefined : markers.find((m) => m.id === follow);
    let key: string;
    if (center) {
      const zoom = this.zoom();
      key = `centre:${center.lat},${center.lng},${zoom}`;
      if (force || key !== this.viewKey) {
        map.setView([center.lat, center.lng], zoom);
      }
    } else if (followed) {
      key = `follow:${followed.id}`;
      const at = `${followed.lat},${followed.lng}`;
      if (force || key !== this.viewKey) {
        const zoom = map.getZoom();
        map.setView(
          [followed.lat, followed.lng],
          Math.max(Number.isFinite(zoom) ? zoom : 0, FOLLOW_MIN_ZOOM),
        );
      } else if (at !== this.followedAt) {
        map.panTo([followed.lat, followed.lng]); // keeps whatever zoom the person chose
      }
      this.followedAt = at;
    } else {
      if (markers.length > 0) {
        const live = this.live();
        key =
          'fit:' + markers.map((m) => (live ? `${m.id}` : `${m.id}:${m.lat},${m.lng}`)).join('|');
        if (force || key !== this.viewKey) {
          map.fitBounds(
            markers.map((m): [number, number] => [m.lat, m.lng]),
            { ...FIT_PADDING, maxZoom: FIT_MAX_ZOOM },
          );
        }
      } else {
        key = 'default';
        if (force || key !== this.viewKey) {
          map.setView([ANDHRA_PRADESH.lat, ANDHRA_PRADESH.lng], ANDHRA_PRADESH_ZOOM);
        }
      }
    }
    this.viewKey = key;
  }

  /** One-finger dragging is switched off on touch devices unless `touchDrag` asks for it. */
  private applyDragging(touchDrag: boolean): void {
    const { lib, map } = this;
    if (!lib || !map) {
      return;
    }
    if (lib.Browser.mobile && !touchDrag) {
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
  }

  protected zoomIn(): void {
    this.map?.zoomIn();
  }

  protected zoomOut(): void {
    this.map?.zoomOut();
  }

  /** Points the map back at the centre (or at the markers), even when it was moved away by hand. */
  recentre(): void {
    this.applyView(true);
  }
}
