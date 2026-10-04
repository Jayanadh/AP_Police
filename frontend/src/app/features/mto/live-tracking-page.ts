import {
  Component,
  computed,
  effect,
  inject,
  InjectionToken,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, Subscription } from 'rxjs';
import { BoardRow, TrackingApi } from '../../core/api/tracking-api';
import { NOW } from '../../core/clock';
import { formatTime, timeAgo } from '../../core/format';
import { Panel } from '../../core/panel';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { MapMarker, MapPath, MapView } from '../../ui/map-view';
import { PageHeader } from '../../ui/page-header';
import { ToastService } from '../../ui/toast';

/** How often the board is read again while the page is open and in view. */
export const LIVE_BOARD_POLL_MS = new InjectionToken<number>('LIVE_BOARD_POLL_MS', {
  factory: () => 10_000,
});

/** Where the vehicles picked for the map are remembered on this device. */
export const PICKED_KEY = 'mto.live-tracking.picked';

/** A location older than this is shown as stale: the phone may be locked, switched off or out of signal. */
const STALE_MS = 5 * 60_000;

/** A point of the tracked vehicle's route, by the moment it was taken. */
type TimedPoint = { at: number; lat: number; lng: number };

function readPicked(): ReadonlySet<number> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(PICKED_KEY) ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter(Number.isInteger) : []);
  } catch {
    return new Set(); // unreadable, or storage is blocked
  }
}

function registration(row: BoardRow): string {
  return row.vehicle?.registration_number ?? row.trip?.registration_number ?? '';
}

/**
 * The MTO's live map: every driver of the office, and where the vehicles of those sharing their live location are.
 * Pick vehicles to show only those; Track one to follow it and draw its route. The board is read again every few
 * seconds while the page is in view.
 */
@Component({
  selector: 'app-live-tracking-page',
  imports: [EmptyState, Icon, LoadError, MapView, PageHeader],
  templateUrl: './live-tracking-page.html',
  styleUrl: './live-tracking-page.scss',
  host: { '(document:visibilitychange)': 'refresh()' },
})
export class LiveTrackingPage {
  private readonly api = inject(TrackingApi);
  private readonly toasts = inject(ToastService);
  private readonly clock = inject(NOW);

  protected readonly formatTime = formatTime;
  protected readonly registration = registration;

  protected readonly board = new Panel<BoardRow[]>(() => this.api.board());
  protected readonly now = signal(this.clock());
  protected readonly search = signal('');
  /** The drivers whose vehicles are picked for the map; none picked shows them all. */
  protected readonly picked = signal<ReadonlySet<number>>(readPicked());
  /** The driver whose vehicle is followed, with its route. */
  protected readonly tracked = signal<number | null>(null);
  private readonly trackedTrip = signal<number | null>(null);
  private readonly routePoints = signal<TimedPoint[]>([]);
  private trackedReg = '';
  private cursor = 0;
  private routeRequest: Subscription | null = null;

  protected readonly rows = computed(() => this.board.data() ?? []);
  protected readonly sharingCount = computed(() => this.rows().filter((row) => row.trip).length);
  private readonly matching = computed(() => {
    const words = this.search().trim().toLowerCase();
    if (!words) {
      return this.rows();
    }
    return this.rows().filter((row) =>
      [
        registration(row),
        row.vehicle?.vehicle_name ?? '',
        row.driver.full_name,
        row.driver.emp_id ?? '',
      ].some((value) => value.toLowerCase().includes(words)),
    );
  });
  protected readonly sharing = computed(() => this.matching().filter((row) => row.trip));
  protected readonly notSharing = computed(() => this.matching().filter((row) => !row.trip));
  protected readonly trackedRow = computed(
    () => this.rows().find((row) => row.driver.id === this.tracked()) ?? null,
  );

  protected readonly markers = computed<MapMarker[]>(() => {
    const picked = this.picked();
    const tracked = this.tracked();
    const markers: MapMarker[] = [];
    for (const row of this.rows()) {
      const trip = row.trip;
      if (!trip || trip.latitude === null || trip.longitude === null) {
        continue;
      }
      if (picked.size > 0 && !picked.has(row.driver.id) && row.driver.id !== tracked) {
        continue;
      }
      const reg = registration(row);
      markers.push({
        id: row.driver.id,
        lat: trip.latitude,
        lng: trip.longitude,
        label: `${reg}, ${row.driver.full_name}, last seen ${timeAgo(trip.last_point_at, this.now())}`,
        caption: reg,
        tone:
          row.driver.id === tracked
            ? 'vehicle-tracked'
            : this.isStale(row)
              ? 'vehicle-stale'
              : 'vehicle',
      });
    }
    return markers;
  });

  protected readonly paths = computed<MapPath[]>(() => {
    const tripId = this.trackedTrip();
    if (tripId === null) {
      return [];
    }
    const points = this.routePoints().map(({ lat, lng }) => ({ lat, lng }));
    return [{ id: tripId, tone: 'tracked', points }];
  });

  constructor() {
    this.board.load();
    interval(inject(LIVE_BOARD_POLL_MS))
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.refresh());
    // Each fresh board: drop the vehicle being tracked if it stopped sharing, or fetch what is new on its route.
    effect(() => {
      const rows = this.board.data();
      untracked(() => this.followUp(rows ?? []));
    });
  }

  /** Reads the board again, unless the page is out of view. */
  protected refresh(): void {
    if (document.visibilityState === 'hidden') {
      return;
    }
    this.now.set(this.clock());
    this.board.load(true);
  }

  protected isStale(row: BoardRow): boolean {
    const seen = row.trip?.last_point_at;
    return !!seen && this.now().getTime() - Date.parse(seen) > STALE_MS;
  }

  protected seen(row: BoardRow): string {
    const seen = row.trip?.last_point_at ?? null;
    return seen ? `Last seen ${timeAgo(seen, this.now())}` : 'Waiting for the first location';
  }

  protected setSearch(value: string): void {
    this.search.set(value);
  }

  protected pick(driverId: number, on: boolean): void {
    const next = new Set(this.picked());
    if (on) {
      next.add(driverId);
    } else {
      next.delete(driverId);
    }
    this.savePicked(next);
  }

  protected showAll(): void {
    this.savePicked(new Set());
  }

  protected toggleTrack(row: BoardRow): void {
    if (this.tracked() === row.driver.id) {
      this.stopTracking();
    } else {
      this.track(row);
    }
  }

  /** A vehicle clicked on the map is tracked. */
  protected trackDriver(driverId: number): void {
    const row = this.rows().find((each) => each.driver.id === driverId);
    if (row && this.tracked() !== driverId) {
      this.track(row);
    }
  }

  protected stopTracking(): void {
    this.routeRequest?.unsubscribe();
    this.routeRequest = null;
    this.tracked.set(null);
    this.trackedTrip.set(null);
    this.routePoints.set([]);
    this.cursor = 0;
  }

  private track(row: BoardRow): void {
    if (!row.trip) {
      return;
    }
    this.stopTracking();
    this.tracked.set(row.driver.id);
    this.trackedTrip.set(row.trip.id);
    this.trackedReg = registration(row);
    this.loadRoute();
  }

  private followUp(rows: BoardRow[]): void {
    const driverId = this.tracked();
    if (driverId === null) {
      return;
    }
    const row = rows.find((each) => each.driver.id === driverId);
    if (!row?.trip || row.trip.id !== this.trackedTrip()) {
      const reg = this.trackedReg;
      this.stopTracking();
      this.toasts.show(`${reg} stopped sharing its location.`, 'info');
      return;
    }
    this.loadRoute();
  }

  /** Fetches the part of the tracked route kept since the last answer, late batches included. */
  private loadRoute(): void {
    const tripId = this.trackedTrip();
    if (tripId === null || (this.routeRequest && !this.routeRequest.closed)) {
      return;
    }
    this.routeRequest = this.api.route(tripId, this.cursor).subscribe({
      next: (route) => {
        if (this.trackedTrip() !== tripId) {
          return;
        }
        this.cursor = route.cursor;
        const byMoment = new Map(this.routePoints().map((point) => [point.at, point]));
        for (const point of route.points) {
          const at = Date.parse(point.recorded_at);
          byMoment.set(at, { at, lat: point.latitude, lng: point.longitude });
        }
        this.routePoints.set([...byMoment.values()].sort((a, b) => a.at - b.at));
      },
      error: () => undefined, // the map keeps what it has; the next refresh asks again
    });
  }

  private savePicked(next: ReadonlySet<number>): void {
    this.picked.set(next);
    try {
      localStorage.setItem(PICKED_KEY, JSON.stringify([...next]));
    } catch {
      // storage is blocked: the choice lasts while the page is open
    }
  }
}
