import { HttpErrorResponse } from '@angular/common/http';
import {
  DestroyRef,
  effect,
  inject,
  InjectionToken,
  Service,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LocationFix, TrackingApi, Trip } from './api/tracking-api';
import { apiErrorMessage } from './api-error';
import { AuthStore } from './auth-store';
import { NOW } from './clock';
import { distanceKm, LatLng } from './geo';
import { LOCATION_SOURCE, LocationProblem } from './location-source';

/** How often the locations waiting on the phone are sent while sharing. */
export const LIVE_SEND_MS = new InjectionToken<number>('LIVE_SEND_MS', {
  providedIn: 'root',
  factory: () => 15_000,
});

/** How long starting waits for the first location before it goes ahead without one. */
export const LIVE_FIRST_FIX_MS = new InjectionToken<number>('LIVE_FIRST_FIX_MS', {
  providedIn: 'root',
  factory: () => 10_000,
});

/** Where the locations not yet sent are kept on the phone, so a reload or a lost connection does not lose them. */
export const LIVE_WAITING_KEY = 'mto.live-location.waiting';

/** A location is kept once the vehicle has moved this far from the last one kept… */
const MOVE_METRES = 25;
/** …but not sooner than this after it… */
const MIN_GAP_MS = 5_000;
/** …and, moving or not, at least this often, so the office sees the vehicle is still there. */
const HEARTBEAT_MS = 60_000;
/** A reading less precise than this is kept only when nothing better came for a minute. */
const VAGUE_METRES = 100;
/** The most locations the server takes in one batch. */
const BATCH = 200;
/** About seven hours of driving without a connection; beyond it the oldest locations go first. */
const MAX_WAITING = 5_000;
/** How long Log out waits for sharing to stop before it goes ahead anyway. */
const SIGN_OUT_WAIT_MS = 8_000;

const BLOCKED_IN_BROWSER =
  "Location is blocked for this site. Allow it in the browser's site settings.";
/** Refused altogether, or allowed only roughly (a kilometre or more off), which is no use to the office. */
const BLOCKED_IN_APP = "Precise location is off for this app. Allow it in the phone's settings.";
const MOCKED =
  "Another app is setting this phone's location (a mock location app). Turn it off to share where the vehicle really is.";
const NOT_FOUND = 'Looking for your location. Make sure location (GPS) is on.';
const OFFLINE = 'No connection. Locations are kept on this phone and sent once it is back.';

/**
 * Checking (or could not check) for an open trip, off, starting, on, stopping. "unknown" means the check failed:
 * the page offers to try again rather than to start.
 */
export type SharingState = 'checking' | 'unknown' | 'off' | 'starting' | 'on' | 'stopping';

/** A location kept on this phone or by the server, by the moment it was taken. */
type Kept = { at: number; lat: number; lng: number };

type Saved = { trip: number; points: LocationFix[] };

function isFix(value: unknown): value is LocationFix {
  const fix = value as LocationFix;
  return (
    typeof fix === 'object' &&
    fix !== null &&
    typeof fix.latitude === 'number' &&
    typeof fix.longitude === 'number' &&
    typeof fix.recorded_at === 'string'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The driver's live location while on duty, for the Live location page and the indicator in the top bar. Sharing
 * carries on across pages and is picked up again after a reload. A location is kept after the vehicle moves 25 m,
 * and at least every minute; kept locations wait on the phone and are sent every 15 seconds, when the page comes
 * back into view and when the connection returns.
 *
 * A web page cannot track from the background: phones pause it when the screen locks or another app is in front.
 * In the web app the screen is kept on while sharing, where the browser allows it. In the phone apps LOCATION_SOURCE
 * is a background service, so sharing goes on with the screen locked; locations are then sent as they arrive too,
 * since a phone holds a background app's timers back. In the Android app the service is told the trip, and carries
 * on sending by itself once the app is closed; opened again, the app takes back what it has not sent.
 */
@Service()
export class LiveLocation {
  private readonly api = inject(TrackingApi);
  private readonly auth = inject(AuthStore);
  private readonly source = inject(LOCATION_SOURCE);
  private readonly now = inject(NOW);
  private readonly sendEveryMs = inject(LIVE_SEND_MS);
  private readonly firstFixMs = inject(LIVE_FIRST_FIX_MS);

  readonly state = signal<SharingState>('off');
  readonly trip = signal<Trip | null>(null);
  /** Where the phone is now, as far as it knows. */
  readonly here = signal<LatLng | null>(null);
  /** The trip's route: what reached the server and what this phone kept since. */
  readonly route = signal<LatLng[]>([]);
  /** How many locations are waiting on the phone to be sent. */
  readonly waiting = signal(0);
  readonly locationProblem = signal('');
  readonly sendProblem = signal('');
  /** Why sharing stopped, when it was stopped from somewhere else (another device, or a long silence). */
  readonly ended = signal('');
  readonly screenKeptOn = signal(false);
  /** The phone apps: locations keep coming with the screen locked and other apps in front. */
  readonly inBackground = this.source.background === true;
  /** The Android app: its service carries on sharing once the app is closed. */
  readonly carriesOnClosed = this.source.carriesOnClosed === true;
  /** The phone apps can open the phone's settings, where location is allowed again. */
  readonly canOpenSettings = this.source.openSettings !== undefined;

  private readonly blocked = this.inBackground ? BLOCKED_IN_APP : BLOCKED_IN_BROWSER;
  private driverId: number | null = null;
  private queue: LocationFix[] = [];
  private lastKept: Kept | null = null;
  private routeFromServer: Kept[] = [];
  private keptHere: Kept[] = [];
  private unwatch: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private sending: Promise<boolean> | null = null;
  /** When sending last began: a location arriving later than the interval after it is sent at once. */
  private lastSendAt = 0;
  private screen: WakeLockSentinel | null = null;
  private forgetSignOutStep: (() => void) | null = null;
  private firstFix: ((outcome: 'fix' | 'blocked' | 'slow') => void) | null = null;
  /** Moves on whenever sharing halts, so an answer meant for an earlier run is ignored. */
  private generation = 0;

  constructor() {
    effect(() => {
      const user = this.auth.user();
      const driver = user?.role === 'DRIVER' && !user.must_change_password ? user.id : null;
      untracked(() => this.follow(driver));
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void this.sendWaiting();
        void this.keepScreenOn();
      }
    };
    const onOnline = () => void this.sendWaiting();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      this.halt();
    });
  }

  /** Asks the server whether the driver has a trip open, and carries on sharing it if so. */
  check(): void {
    const run = this.generation;
    this.state.set('checking');
    this.api.current().subscribe({
      next: (trip) => {
        if (run !== this.generation) {
          return;
        }
        if (trip) {
          this.queue = this.restoreWaiting(trip.id);
          this.share(trip);
        } else {
          this.forgetWaiting();
          this.state.set('off');
        }
      },
      error: () => {
        if (run === this.generation) {
          this.state.set('unknown');
        }
      },
    });
  }

  /**
   * Starts sharing for a duty: waits briefly for the first location (and the browser's permission), then starts
   * the trip. Resolves with why it could not start, or '' once sharing.
   */
  async start(dutyParticulars: string): Promise<string> {
    const particulars = dutyParticulars.trim();
    if (!particulars) {
      return 'Enter the duty particulars.';
    }
    if (this.state() !== 'off') {
      return '';
    }
    const run = this.generation;
    this.state.set('starting');
    this.ended.set('');
    this.locationProblem.set('');
    const first = this.waitForFirstFix();
    this.watch();
    if ((await first) === 'blocked') {
      const why = this.locationProblem() || this.blocked;
      if (run === this.generation) {
        this.halt();
        this.state.set('off');
      }
      return `${why} Then start again.`;
    }
    if (run !== this.generation) {
      return '';
    }
    try {
      const trip = await firstValueFrom(this.api.start(particulars));
      if (run === this.generation) {
        this.share(trip);
      }
      return '';
    } catch (err) {
      if (run === this.generation) {
        this.halt();
        this.state.set('off');
      }
      return apiErrorMessage(err);
    }
  }

  /** Sends what is waiting, then ends the trip. Resolves with why it could not, or '' once stopped. */
  async stop(): Promise<string> {
    const trip = this.trip();
    if (!trip || this.state() !== 'on') {
      return '';
    }
    const run = this.generation;
    this.state.set('stopping');
    if (this.queue.length > 0) {
      await this.sendWaiting(); // what cannot be sent now is lost with the trip: the server takes none after it
      if (run !== this.generation) {
        return '';
      }
    }
    try {
      await firstValueFrom(this.api.stop(trip.id));
    } catch (err) {
      if (run !== this.generation) {
        return '';
      }
      const alreadyEnded = err instanceof HttpErrorResponse && err.status === 400;
      if (!alreadyEnded) {
        this.state.set('on');
        return apiErrorMessage(err);
      }
    }
    if (run === this.generation) {
      this.halt();
      this.forgetWaiting();
      this.state.set('off');
    }
    return '';
  }

  /** Follows who is signed in: a driver's open trip is picked up; anyone else, or nobody, shares nothing. */
  private follow(driver: number | null): void {
    if (driver === this.driverId) {
      return;
    }
    this.halt();
    this.state.set('off');
    this.ended.set('');
    this.driverId = driver;
    if (driver !== null) {
      this.check();
    }
  }

  private share(trip: Trip): void {
    this.trip.set(trip);
    this.state.set('on');
    if (trip.last_point_at && trip.latitude !== null && trip.longitude !== null) {
      const atServer = {
        at: Date.parse(trip.last_point_at),
        lat: trip.latitude,
        lng: trip.longitude,
      };
      if (!this.lastKept || atServer.at > this.lastKept.at) {
        this.lastKept = atServer;
      }
      if (!this.here()) {
        this.here.set({ lat: trip.latitude, lng: trip.longitude });
      }
    }
    const lastWaiting = this.queue.at(-1);
    if (lastWaiting && (!this.lastKept || Date.parse(lastWaiting.recorded_at) > this.lastKept.at)) {
      this.lastKept = {
        at: Date.parse(lastWaiting.recorded_at),
        lat: lastWaiting.latitude,
        lng: lastWaiting.longitude,
      };
    }
    this.saveWaiting();
    this.watch();
    this.source.carryOn?.(trip.id);
    this.forgetSignOutStep ??= this.auth.beforeSignOut(() => this.endForSignOut());
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.sendWaiting(), this.sendEveryMs);
    void this.keepScreenOn();
    this.loadRoute(trip.id);
    void this.sendWaiting();
  }

  /** Stops watching, sending and keeping the screen on, and forgets the trip on this page; the locations waiting
   * on the phone stay unless forgotten as well. */
  private halt(): void {
    this.generation++;
    this.unwatch?.();
    this.unwatch = null;
    clearInterval(this.timer);
    this.timer = undefined;
    this.forgetSignOutStep?.();
    this.forgetSignOutStep = null;
    this.screen?.release().catch(() => undefined);
    this.screen = null;
    this.screenKeptOn.set(false);
    this.firstFix = null;
    this.sending = null;
    this.queue = [];
    this.keptHere = [];
    this.routeFromServer = [];
    this.lastKept = null;
    this.trip.set(null);
    this.here.set(null);
    this.route.set([]);
    this.waiting.set(0);
    this.locationProblem.set('');
    this.sendProblem.set('');
  }

  /** Before Log out: stops the trip (briefly waiting for the server), and forgets this phone's locations. */
  private async endForSignOut(): Promise<void> {
    await Promise.race([this.stop(), sleep(SIGN_OUT_WAIT_MS)]);
    this.halt();
    this.forgetWaiting();
    this.state.set('off');
  }

  private watch(): void {
    this.unwatch ??= this.source.watch(
      (fix) => this.onFix(fix),
      (problem) => this.onProblem(problem),
    );
  }

  private waitForFirstFix(): Promise<'fix' | 'blocked' | 'slow'> {
    return new Promise((resolve) => {
      const finish = (outcome: 'fix' | 'blocked' | 'slow') => {
        clearTimeout(timer);
        if (this.firstFix === finish) {
          this.firstFix = null;
        }
        resolve(outcome);
      };
      const timer = setTimeout(() => finish('slow'), this.firstFixMs);
      this.firstFix = finish;
    });
  }

  private onFix(fix: LocationFix): void {
    this.here.set({ lat: fix.latitude, lng: fix.longitude });
    this.locationProblem.set('');
    this.firstFix?.('fix');
    if (!this.worthKeeping(fix)) {
      return;
    }
    const kept = { at: Date.parse(fix.recorded_at), lat: fix.latitude, lng: fix.longitude };
    this.lastKept = kept;
    this.queue.push(fix);
    if (this.queue.length > MAX_WAITING) {
      this.queue.splice(0, this.queue.length - MAX_WAITING);
    }
    this.keptHere.push(kept);
    this.saveWaiting();
    this.drawRoute();
    // In the background a phone may hold the timer back; the locations themselves still arrive.
    if (this.trip() && this.now().getTime() - this.lastSendAt >= this.sendEveryMs) {
      void this.sendWaiting();
    }
  }

  /** Opens the phone's settings for the app, after location was refused (the phone apps only). */
  async openSettings(): Promise<void> {
    await this.source.openSettings?.();
  }

  /** Whether the phone's settings can put this problem right: location refused for the app (the phone apps only). */
  settingsHelpWith(problem: string): boolean {
    return this.canOpenSettings && problem.startsWith(BLOCKED_IN_APP);
  }

  private onProblem(problem: LocationProblem): void {
    if (problem === 'unavailable') {
      this.locationProblem.set(NOT_FOUND);
    } else {
      this.locationProblem.set(problem === 'denied' ? this.blocked : MOCKED);
      this.firstFix?.('blocked');
    }
  }

  private worthKeeping(fix: LocationFix): boolean {
    const last = this.lastKept;
    if (!last) {
      return true;
    }
    const gap = Date.parse(fix.recorded_at) - last.at;
    if (gap >= HEARTBEAT_MS) {
      return true;
    }
    if (gap < MIN_GAP_MS || (fix.accuracy !== null && fix.accuracy > VAGUE_METRES)) {
      return false;
    }
    const moved = distanceKm(
      { lat: last.lat, lng: last.lng },
      { lat: fix.latitude, lng: fix.longitude },
    );
    return moved * 1000 >= MOVE_METRES;
  }

  /** Sends what is waiting, one batch at a time; resolves true once nothing is left. One run at a time. */
  private sendWaiting(): Promise<boolean> {
    if (!this.sending) {
      this.lastSendAt = this.now().getTime();
      const run = this.drain();
      this.sending = run;
      void run.finally(() => {
        if (this.sending === run) {
          this.sending = null;
        }
      });
    }
    return this.sending;
  }

  private async drain(): Promise<boolean> {
    const run = this.generation;
    while (this.queue.length > 0) {
      const trip = this.trip();
      if (!trip || run !== this.generation) {
        return false;
      }
      const batch = this.queue.slice(0, BATCH);
      try {
        const answer = await firstValueFrom(this.api.send(trip.id, batch));
        if (run !== this.generation) {
          return false;
        }
        this.drop(batch);
        this.trip.set(answer.trip);
        this.sendProblem.set('');
      } catch (err) {
        if (run !== this.generation) {
          return false;
        }
        if (!(err instanceof HttpErrorResponse && err.status === 400)) {
          this.sendProblem.set(
            err instanceof HttpErrorResponse && err.status === 0 ? OFFLINE : apiErrorMessage(err),
          );
          return false; // kept for the next try
        }
        const message = apiErrorMessage(err);
        const open = await this.stillOpen(trip, message);
        if (run !== this.generation || open !== true) {
          if (open === null) {
            this.sendProblem.set(message);
          }
          return false;
        }
        this.drop(batch); // the server will never take these, as when the phone's clock is far off
        this.sendProblem.set(message);
      }
    }
    return true;
  }

  /**
   * After a refused batch: true while the trip is still open; false once it has ended, and sharing has stopped here
   * too, saying why; null when that cannot be told now.
   */
  private async stillOpen(trip: Trip, refusal: string): Promise<boolean | null> {
    let open: Trip | null;
    try {
      open = await firstValueFrom(this.api.current());
    } catch {
      return null;
    }
    if (open?.id === trip.id) {
      return true;
    }
    this.halt();
    this.forgetWaiting();
    if (open) {
      this.share(open); // another trip was started on another device: carry on with that one
    } else {
      this.state.set('off');
      this.ended.set(refusal);
    }
    return false;
  }

  /** Takes the locations that were sent (or will never be taken) off the waiting list. */
  private drop(batch: LocationFix[]): void {
    const done = new Set(batch);
    this.queue = this.queue.filter((fix) => !done.has(fix));
    this.saveWaiting();
  }

  private async keepScreenOn(): Promise<void> {
    const wakeLock = typeof navigator === 'undefined' ? undefined : navigator.wakeLock;
    if (
      this.inBackground || // the phone apps' background service needs no screen
      !wakeLock ||
      this.screen ||
      this.state() !== 'on' ||
      document.visibilityState !== 'visible'
    ) {
      return;
    }
    const run = this.generation;
    try {
      const sentinel = await wakeLock.request('screen');
      if (run !== this.generation || this.screen) {
        sentinel.release().catch(() => undefined);
        return;
      }
      this.screen = sentinel;
      this.screenKeptOn.set(true);
      // The browser lets go by itself when the page is hidden; it is asked for again when the page is back.
      sentinel.addEventListener('release', () => {
        if (this.screen === sentinel) {
          this.screen = null;
          this.screenKeptOn.set(false);
        }
      });
    } catch {
      this.screenKeptOn.set(false); // refused, as in battery saver
    }
  }

  private loadRoute(tripId: number): void {
    const run = this.generation;
    this.api.route(tripId).subscribe({
      next: (route) => {
        if (run !== this.generation) {
          return;
        }
        this.routeFromServer = route.points.map((point) => ({
          at: Date.parse(point.recorded_at),
          lat: point.latitude,
          lng: point.longitude,
        }));
        this.drawRoute();
      },
      error: () => undefined, // the route on this phone is only a help; sharing goes on without it
    });
  }

  private drawRoute(): void {
    const byMoment = new Map<number, Kept>();
    for (const point of [...this.routeFromServer, ...this.keptHere]) {
      byMoment.set(point.at, point);
    }
    const points = [...byMoment.values()].sort((a, b) => a.at - b.at);
    this.route.set(points.map(({ lat, lng }) => ({ lat, lng })));
  }

  private restoreWaiting(tripId: number): LocationFix[] {
    try {
      const saved = JSON.parse(localStorage.getItem(LIVE_WAITING_KEY) ?? 'null') as Saved | null;
      if (saved?.trip === tripId && Array.isArray(saved.points)) {
        return saved.points.filter(isFix).slice(-MAX_WAITING);
      }
    } catch {
      // unreadable, or storage is blocked: nothing to pick up
    }
    this.forgetWaiting();
    return [];
  }

  private saveWaiting(): void {
    this.waiting.set(this.queue.length);
    const trip = this.trip();
    if (!trip) {
      return; // still starting: kept on this page until the trip exists
    }
    try {
      if (this.queue.length === 0) {
        localStorage.removeItem(LIVE_WAITING_KEY);
      } else {
        const saved: Saved = { trip: trip.id, points: this.queue };
        localStorage.setItem(LIVE_WAITING_KEY, JSON.stringify(saved));
      }
    } catch {
      // storage is full or blocked: the locations are still held on this page
    }
  }

  private forgetWaiting(): void {
    this.queue = [];
    this.waiting.set(0);
    try {
      localStorage.removeItem(LIVE_WAITING_KEY);
    } catch {
      // storage is blocked: nothing was kept there
    }
  }
}
