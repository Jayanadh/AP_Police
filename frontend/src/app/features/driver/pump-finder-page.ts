import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  DirectoryPump,
  PumpsApi,
  pumpToPoint,
  pumpTone,
  pumpWhere,
} from '../../core/api/pumps-api';
import { fuelLabel, MyVehicles, VehiclesApi } from '../../core/api/vehicles-api';
import { distanceKm, formatDistance, formatTravelTime, GeoService, LatLng } from '../../core/geo';
import { Panel } from '../../core/panel';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { MapMarker, MapView } from '../../ui/map-view';
import { ToastService } from '../../ui/toast';

/** A pump with how far it is from the driver (null while the location is unknown). */
type PumpRow = { pump: DirectoryPump; km: number | null };

/** The id of the driver's own marker; pump ids are positive. */
const ME = -1;

/** How many pumps the sideways strip of cards holds; the list below it has them all. */
const STRIP_SIZE = 10;

/** Zoom levels between which the map, centred on the driver, is set to show the nearest pump. */
const MIN_ZOOM = 6;
const MAX_ZOOM = 15;
/** Roughly how far from the centre, in px, the nearest pump should land on a phone-sized map. */
const NEAREST_PX = 140;
const METRES_PER_PX_AT_ZOOM_0 = 156_543.03;

/** The zoom at which a pump `km` away from `here` is on screen with `here` in the middle. */
function zoomToShow(km: number, here: LatLng): number {
  const metres = Math.max(km, 0.5) * 1000;
  const metresPerPxAtZoom0 = METRES_PER_PX_AT_ZOOM_0 * Math.cos((here.lat * Math.PI) / 180);
  const zoom = Math.floor(Math.log2((NEAREST_PX * metresPerPxAtZoom0) / metres));
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * The pumps that can fill the driver's vehicle now, on a map and in a bottom sheet, nearest first, like the reference
 * app's finder: tie-up bunks that sell its fuel and police pumps that have it in stock. A driver without a vehicle
 * sees every open pump.
 */
@Component({
  selector: 'app-pump-finder-page',
  imports: [EmptyState, Icon, LoadError, MapView, RouterLink],
  templateUrl: './pump-finder-page.html',
  styleUrl: './pump-finder-page.scss',
})
export class PumpFinderPage {
  private readonly api = inject(PumpsApi);
  private readonly vehiclesApi = inject(VehiclesApi);
  private readonly geo = inject(GeoService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly mapView = viewChild(MapView);
  private readonly cardStrip = viewChild<ElementRef<HTMLElement>>('cardStrip');

  protected readonly formatDistance = formatDistance;
  protected readonly formatTravelTime = formatTravelTime;
  protected readonly pumpWhere = pumpWhere;

  private readonly mine = new Panel<MyVehicles>(() => this.vehiclesApi.myVehicles());
  private readonly vehicle = computed(() => this.mine.data()?.vehicles[0] ?? null);
  protected readonly pumps = new Panel<DirectoryPump[]>(() => {
    const vehicle = this.vehicle();
    return this.api.directory(vehicle ? { fuel: vehicle.fuel_type } : {});
  });
  /** What the list is for: the driver's vehicle and its fuel, or every pump. */
  protected readonly forVehicle = computed(() => {
    const vehicle = this.vehicle();
    return vehicle
      ? `Pumps that can fill ${vehicle.registration_number} with ${fuelLabel(vehicle.fuel_type).toLowerCase()} now.`
      : 'You are not linked to a vehicle yet, so every pump is shown.';
  });
  protected readonly location = signal<LatLng | null>(null);
  protected readonly locating = signal(false);
  protected readonly search = signal('');
  protected readonly searchOpen = signal(false);

  /** Every pump with its distance, nearest first; by name while the location is unknown. */
  private readonly allRows = computed<PumpRow[]>(() => {
    const here = this.location();
    const rows = (this.pumps.data() ?? []).map((pump) => ({
      pump,
      km: here ? distanceKm(here, pumpToPoint(pump)) : null,
    }));
    return rows.sort(
      (a, b) =>
        (a.km !== null && b.km !== null ? a.km - b.km : 0) ||
        a.pump.name.localeCompare(b.pump.name),
    );
  });

  /** The pumps that match the search, in the same order. */
  protected readonly rows = computed(() => {
    const term = this.search().trim().toLowerCase();
    return this.allRows().filter(
      ({ pump }) =>
        !term ||
        [pump.name, pump.address, pump.district_name].some((text) =>
          text.toLowerCase().includes(term),
        ),
    );
  });

  protected readonly strip = computed(() => this.rows().slice(0, STRIP_SIZE));

  protected readonly title = computed(() => {
    const count = this.rows().length;
    return `Found ${count} petrol station${count === 1 ? '' : 's'} near you`;
  });

  protected readonly markers = computed<MapMarker[]>(() => {
    const markers: MapMarker[] = this.rows().map(({ pump }) => ({
      id: pump.id,
      ...pumpToPoint(pump),
      label: pump.name,
      tone: pumpTone(pump.kind),
    }));
    const here = this.location();
    if (here) {
      markers.push({ id: ME, ...here, label: 'You are here', tone: 'me' });
    }
    return markers;
  });

  /** The driver in the middle; while a search is typed, none, so the map fits the matches instead. */
  protected readonly mapCenter = computed(() => (this.search().trim() ? null : this.location()));

  /** Close enough to see the nearest pump of all (not of the filtered ones, so typing does not zoom). */
  protected readonly zoom = computed(() => {
    const here = this.location();
    const nearest = this.allRows()[0]?.km;
    return here && nearest !== undefined && nearest !== null ? zoomToShow(nearest, here) : 12;
  });

  private asking = false;

  constructor() {
    // The pumps are read once it is known which vehicle (and fuel) they are for, or that there is none.
    this.mine.load();
    effect(() => {
      const known = this.mine.data() !== null || this.mine.error() !== '';
      untracked(() => {
        if (known && !this.pumps.requested) {
          this.pumps.load();
        }
      });
    });
    this.locate(false);
    // A new order (the location arrived, the search changed) starts the strip at the nearest pump again;
    // otherwise scroll snapping keeps the card that was in view, wherever it moved to.
    effect(() => {
      this.rows();
      afterNextRender(
        () => {
          const strip = this.cardStrip()?.nativeElement;
          if (strip) {
            strip.scrollLeft = 0;
          }
        },
        { injector: this.injector },
      );
    });
  }

  /** Asks the device where it is. `byHand`: the driver pressed a button, so say if it fails and re-centre. */
  protected locate(byHand = true): void {
    if (this.asking) {
      return;
    }
    this.asking = true;
    this.locating.set(true);
    void this.geo.current().then((position) => {
      this.asking = false;
      this.locating.set(false);
      this.location.set(position);
      if (!byHand) {
        return;
      }
      if (position) {
        afterNextRender(() => this.mapView()?.recentre(), { injector: this.injector });
      } else {
        this.toasts.show('Could not get your location. Check that location is turned on.', 'info');
      }
    });
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected toggleSearch(): void {
    if (this.searchOpen()) {
      this.closeSearch();
      return;
    }
    this.searchOpen.set(true);
    afterNextRender(() => document.getElementById('pump-search')?.focus(), {
      injector: this.injector,
    });
  }

  /** Closing the box on a phone also drops its words, so no hidden search keeps filtering. */
  protected closeSearch(): void {
    this.searchOpen.set(false);
    this.search.set('');
  }

  protected clearSearch(): void {
    this.search.set('');
  }

  protected openPump(id: number): void {
    if (id !== ME) {
      void this.router.navigateByUrl(`/driver/pumps/${id}`);
    }
  }
}
