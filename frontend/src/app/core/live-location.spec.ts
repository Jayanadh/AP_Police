import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { LocationFix, Trip } from './api/tracking-api';
import { AuthStore } from './auth-store';
import { NOW } from './clock';
import { LIVE_FIRST_FIX_MS, LIVE_SEND_MS, LIVE_WAITING_KEY, LiveLocation } from './live-location';
import { LOCATION_SOURCE, LocationProblem, LocationSource } from './location-source';
import { makeMe, makeTrip, signInAs } from './test-data';

const CURRENT = '/api/tracking/trips/current/';
const TRIPS = '/api/tracking/trips/';
const POINTS = '/api/tracking/trips/41/points/';
const STOP = '/api/tracking/trips/41/stop/';
const ROUTE = '/api/tracking/trips/41/path/?after=0';
const DRIVER = makeMe({ id: 12, role: 'DRIVER', username: 'ap1001' });
const START = Date.parse('2026-10-04T04:30:00Z');
const MOCKED =
  "Another app is setting this phone's location (a mock location app). Turn it off to share where the vehicle really is.";

/** A location `seconds` after the start; 0.0003 degrees of latitude is about 33 metres. */
function fixAt(seconds: number, lat = 14.4426, accuracy: number | null = 8): LocationFix {
  return {
    latitude: lat,
    longitude: 79.9865,
    recorded_at: new Date(START + seconds * 1000).toISOString(),
    accuracy,
    speed: null,
    heading: null,
  };
}

/** Stands in for the phone's location: a test hands it readings and problems. */
class FakeLocation implements LocationSource {
  /** As the browser's: false. The phone apps' background service: true. */
  background = false;
  /** The Android app's service carries on once the app is closed. */
  carriesOnClosed = false;
  settingsOpened = 0;
  openSettings?: () => Promise<void>;
  carryOn?: (trip: number) => void;
  /** The trips the service was given to carry on with. */
  carried: number[] = [];
  watchers: {
    fix: (fix: LocationFix) => void;
    problem: (p: LocationProblem) => void;
    on: boolean;
  }[] = [];
  watch(fix: (fix: LocationFix) => void, problem: (p: LocationProblem) => void) {
    const watcher = { fix, problem, on: true };
    this.watchers.push(watcher);
    return () => (watcher.on = false);
  }
  get watching() {
    return this.watchers.filter((watcher) => watcher.on).length;
  }
  emit(...fixes: LocationFix[]) {
    for (const fix of fixes) {
      this.watchers.filter((w) => w.on).forEach((w) => w.fix(fix));
    }
  }
  fail(problem: LocationProblem) {
    this.watchers.filter((w) => w.on).forEach((w) => w.problem(problem));
  }
}

/** Lets promises and timers that are already due run. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('LiveLocation', () => {
  let http: HttpTestingController;
  let source: FakeLocation;
  /** How often the service sends on its own: an hour unless a test wants it, so tests send by hand. */
  let sendEveryMs: number;
  /** The service's clock, standing still unless a test moves it. */
  let clock: number;

  function configure() {
    source = new FakeLocation();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: LOCATION_SOURCE, useValue: source },
        { provide: LIVE_SEND_MS, useFactory: () => sendEveryMs },
        { provide: LIVE_FIRST_FIX_MS, useValue: 20 },
        { provide: NOW, useValue: () => new Date(clock) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  beforeEach(() => {
    localStorage.clear();
    sendEveryMs = 60 * 60_000;
    clock = Date.now();
    configure();
  });

  afterEach(() => {
    localStorage.clear();
  });

  /** Signs the driver in and answers the check for an open trip with `trip`. */
  async function driverWith(trip: Trip | null = makeTrip()) {
    const live = TestBed.inject(LiveLocation);
    await signInAs(DRIVER);
    TestBed.tick();
    http.expectOne(CURRENT).flush({ trip });
    if (trip) {
      http.expectOne(ROUTE).flush({ trip, points: [], cursor: 0, more: false });
    }
    await settle();
    return live;
  }

  /** What the next batch of locations carried, answered as accepted. */
  function sentBatch(trip = makeTrip()): string[] {
    const req = http.expectOne(POINTS);
    const times = (req.request.body.points as LocationFix[]).map((p) => p.recorded_at);
    req.flush({ accepted: times.length, trip });
    return times;
  }

  function online() {
    window.dispatchEvent(new Event('online'));
  }

  describe('after signing in', () => {
    it("picks a driver's open trip up again and watches the location", async () => {
      const live = await driverWith();
      expect(live.state()).toBe('on');
      expect(live.trip()?.id).toBe(41);
      expect(source.watching).toBe(1);
    });

    it('stays off when the driver has no open trip', async () => {
      const live = await driverWith(null);
      expect(live.state()).toBe('off');
      expect(source.watching).toBe(0);
    });

    it('asks nothing for anyone but a driver', async () => {
      const live = TestBed.inject(LiveLocation);
      await signInAs(makeMe({ role: 'MTO' }));
      TestBed.tick();
      http.expectNone(CURRENT);
      expect(live.state()).toBe('off');
    });

    it('waits for a new password before it asks', async () => {
      TestBed.inject(LiveLocation);
      await signInAs({ ...DRIVER, must_change_password: true });
      TestBed.tick();
      http.expectNone(CURRENT);
    });

    it('says so when the check fails, and can try again', async () => {
      const live = TestBed.inject(LiveLocation);
      await signInAs(DRIVER);
      TestBed.tick();
      http.expectOne(CURRENT).error(new ProgressEvent('error'), { status: 0 });
      await settle();
      expect(live.state()).toBe('unknown');

      live.check();
      http.expectOne(CURRENT).flush({ trip: null });
      expect(live.state()).toBe('off');
    });
  });

  describe('starting', () => {
    it('waits for the first location, then starts the trip with the duty particulars', async () => {
      const live = await driverWith(null);

      const started = live.start('  Night patrol  ');
      expect(live.state()).toBe('starting');
      expect(source.watching).toBe(1);
      http.expectNone(TRIPS);

      source.emit(fixAt(0));
      await settle();
      const req = http.expectOne(TRIPS);
      expect(req.request.body).toEqual({ duty_particulars: 'Night patrol' });
      req.flush(makeTrip());
      await settle();
      http.expectOne(ROUTE).flush({ trip: makeTrip(), points: [], cursor: 0, more: false });

      expect(await started).toBe('');
      expect(live.state()).toBe('on');
      expect(source.watching).toBe(1); // the same watch carries on
      online();
      expect(sentBatch()).toEqual([fixAt(0).recorded_at]);
    });

    it('needs the duty particulars', async () => {
      const live = await driverWith(null);
      expect(await live.start('   ')).toBe('Enter the duty particulars.');
      expect(source.watching).toBe(0);
    });

    it('does not start when location is blocked for the site', async () => {
      const live = await driverWith(null);

      const started = live.start('Night patrol');
      source.fail('denied');

      expect(await started).toContain('Location is blocked for this site');
      http.expectNone(TRIPS);
      expect(live.state()).toBe('off');
      expect(source.watching).toBe(0);
    });

    it('starts anyway when the first location is slow to come', async () => {
      const live = await driverWith(null);

      const started = live.start('Night patrol');
      source.fail('unavailable');
      await new Promise((resolve) => setTimeout(resolve, 40));

      http
        .expectOne(TRIPS)
        .flush(makeTrip({ last_point_at: null, latitude: null, longitude: null }));
      await settle();
      http.expectOne(ROUTE).flush({ trip: makeTrip(), points: [], cursor: 0, more: false });
      expect(await started).toBe('');
      expect(live.state()).toBe('on');
      expect(live.locationProblem()).toContain('Looking for your location');
    });

    it('stops watching and says why when the server refuses', async () => {
      const live = await driverWith(null);

      const started = live.start('Night patrol');
      source.emit(fixAt(0));
      await settle();
      http
        .expectOne(TRIPS)
        .flush(
          { detail: 'You are not linked to a vehicle. Contact your MTO.' },
          { status: 400, statusText: 'Bad Request' },
        );

      expect(await started).toBe('You are not linked to a vehicle. Contact your MTO.');
      expect(live.state()).toBe('off');
      expect(source.watching).toBe(0);
      online();
      http.expectNone(POINTS);
    });
  });

  describe('while sharing', () => {
    it('keeps a location after moving 25 metres or after a minute, not every reading', async () => {
      const live = await driverWith(makeTrip({ last_point_at: null }));

      source.emit(
        fixAt(0), // the first one
        fixAt(3, 14.4436), // moved, but only 3 seconds later
        fixAt(10, 14.44265), // 10 seconds on, about 5 metres
        fixAt(20, 14.4429), // about 33 metres from the first: kept
        fixAt(50, 14.44295), // barely moved
        fixAt(81, 14.44295), // a minute after the last one kept: kept
      );

      expect(live.waiting()).toBe(3);
      online();
      expect(sentBatch()).toEqual([fixAt(0), fixAt(20), fixAt(81)].map((f) => f.recorded_at));
      await settle();
      expect(live.waiting()).toBe(0);
    });

    it('skips a vague reading unless nothing better came for a minute', async () => {
      const live = await driverWith(makeTrip({ last_point_at: null }));
      source.emit(fixAt(0), fixAt(20, 14.4436, 250), fixAt(61, 14.4436, 250));
      expect(live.waiting()).toBe(2);
    });

    it('shows where the phone is and the route kept so far', async () => {
      const live = TestBed.inject(LiveLocation);
      await signInAs(DRIVER);
      TestBed.tick();
      http.expectOne(CURRENT).flush({ trip: makeTrip() });
      http.expectOne(ROUTE).flush({
        trip: makeTrip(),
        points: [{ latitude: 14.43, longitude: 79.98, recorded_at: '2026-10-04T09:58:00+05:30' }],
        cursor: 3,
        more: false,
      });
      await settle();

      source.emit(fixAt(600, 14.44));

      expect(live.here()).toEqual({ lat: 14.44, lng: 79.9865 });
      expect(live.route()).toEqual([
        { lat: 14.43, lng: 79.98 },
        { lat: 14.44, lng: 79.9865 },
      ]);
    });

    it('sends at most 200 locations at a time, one batch after another', async () => {
      const live = await driverWith(makeTrip({ last_point_at: null }));
      source.emit(...Array.from({ length: 250 }, (_, i) => fixAt(i * 60)));

      online();
      expect(sentBatch()).toHaveLength(200);
      await settle();
      expect(sentBatch()).toHaveLength(50);
      await settle();
      expect(live.waiting()).toBe(0);
      expect(live.trip()?.last_point_at).toBe(makeTrip().last_point_at); // as the server answered
    });

    it('sends every so often on its own', async () => {
      sendEveryMs = 30;
      const live = await driverWith(makeTrip({ last_point_at: null }));
      source.emit(fixAt(0));

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(sentBatch()).toHaveLength(1);
      await settle();
      expect(live.waiting()).toBe(0);
    });

    it('keeps the locations through a lost connection and sends them once it is back', async () => {
      const live = await driverWith(makeTrip({ last_point_at: null }));
      source.emit(fixAt(0));

      online();
      http.expectOne(POINTS).error(new ProgressEvent('error'), { status: 0 });
      await settle();
      expect(live.waiting()).toBe(1);
      expect(live.sendProblem()).toContain('kept on this phone');

      source.emit(fixAt(70, 14.45));
      online();
      expect(sentBatch()).toHaveLength(2);
      await settle();
      expect(live.sendProblem()).toBe('');
    });

    it('keeps waiting locations on the phone, so a reload sends them', async () => {
      await driverWith(makeTrip({ last_point_at: null }));
      source.emit(fixAt(0), fixAt(90));

      expect(JSON.parse(localStorage.getItem(LIVE_WAITING_KEY)!)).toEqual({
        trip: 41,
        points: [fixAt(0), fixAt(90)],
      });

      TestBed.resetTestingModule(); // a reload: a fresh app on the same phone
      configure();
      const live = await driverWith();

      expect(live.waiting()).toBe(2);
      online();
      expect(sentBatch()).toEqual([fixAt(0).recorded_at, fixAt(90).recorded_at]);
    });

    it("drops locations kept for a trip that is not the driver's open one", async () => {
      localStorage.setItem(LIVE_WAITING_KEY, JSON.stringify({ trip: 7, points: [fixAt(0)] }));
      const live = await driverWith();
      expect(live.waiting()).toBe(0);
      expect(localStorage.getItem(LIVE_WAITING_KEY)).toBeNull();
    });

    it('stops sharing and says why once the trip has been ended elsewhere', async () => {
      const live = await driverWith(makeTrip({ last_point_at: null }));
      source.emit(fixAt(0));

      online();
      http
        .expectOne(POINTS)
        .flush(
          { detail: 'This trip has ended. No location for 12 hours.' },
          { status: 400, statusText: 'Bad Request' },
        );
      await settle();
      http.expectOne(CURRENT).flush({ trip: null });
      await settle();

      expect(live.state()).toBe('off');
      expect(live.ended()).toBe('This trip has ended. No location for 12 hours.');
      expect(source.watching).toBe(0);
      expect(localStorage.getItem(LIVE_WAITING_KEY)).toBeNull();
    });

    it('drops a batch the server will never take, says why and carries on', async () => {
      const live = await driverWith(makeTrip({ last_point_at: null }));
      source.emit(fixAt(0));

      online();
      http
        .expectOne(POINTS)
        .flush(
          { detail: "A location's time is outside this trip. Check the phone's clock." },
          { status: 400, statusText: 'Bad Request' },
        );
      await settle();
      http.expectOne(CURRENT).flush({ trip: makeTrip() });
      await settle();

      expect(live.state()).toBe('on');
      expect(live.waiting()).toBe(0);
      expect(live.sendProblem()).toBe(
        "A location's time is outside this trip. Check the phone's clock.",
      );
    });

    it('says when location is blocked or cannot be found, and clears it once a reading comes', async () => {
      const live = await driverWith();
      source.fail('denied');
      expect(live.locationProblem()).toContain('Location is blocked for this site');
      expect(live.settingsHelpWith(live.locationProblem())).toBe(false); // a web page cannot open them
      source.emit(fixAt(0));
      expect(live.locationProblem()).toBe('');
    });
  });

  describe('stopping', () => {
    it('sends what is waiting first, then ends the trip', async () => {
      const live = await driverWith(makeTrip({ last_point_at: null }));
      source.emit(fixAt(0));

      const stopped = live.stop();
      expect(live.state()).toBe('stopping');
      expect(sentBatch()).toHaveLength(1);
      await settle();
      http
        .expectOne(STOP)
        .flush(makeTrip({ is_open: false, ended_at: '2026-10-04T10:30:00+05:30' }));

      expect(await stopped).toBe('');
      expect(live.state()).toBe('off');
      expect(live.trip()).toBeNull();
      expect(source.watching).toBe(0);
      expect(localStorage.getItem(LIVE_WAITING_KEY)).toBeNull();
    });

    it('stays on and says why when it cannot reach the server', async () => {
      const live = await driverWith();

      const stopped = live.stop();
      http.expectOne(STOP).error(new ProgressEvent('error'), { status: 0 });

      expect(await stopped).toBe('Cannot reach the server. Check your connection.');
      expect(live.state()).toBe('on');
      expect(source.watching).toBe(1);
    });

    it('counts a trip that had already ended as stopped', async () => {
      const live = await driverWith();

      const stopped = live.stop();
      http
        .expectOne(STOP)
        .flush(
          { detail: 'This trip has already ended.' },
          { status: 400, statusText: 'Bad Request' },
        );

      expect(await stopped).toBe('');
      expect(live.state()).toBe('off');
    });
  });

  describe('in the phone apps', () => {
    /** The phone apps' source: in the background, with the phone's settings to open. */
    function phoneSource() {
      source.background = true;
      source.openSettings = async () => {
        source.settingsOpened++;
      };
    }

    /** The Android app's: its service also carries on sending once the app is closed. */
    function serviceSource() {
      phoneSource();
      source.carriesOnClosed = true;
      source.carryOn = (trip) => source.carried.push(trip);
    }

    it('says precise location is off for the app, and opens the phone’s settings for it', async () => {
      phoneSource();
      const live = await driverWith();
      source.fail('denied');
      expect(live.locationProblem()).toBe(
        "Precise location is off for this app. Allow it in the phone's settings.",
      );
      expect(live.canOpenSettings).toBe(true);
      await live.openSettings();
      expect(source.settingsOpened).toBe(1);
    });

    it('offers the phone’s settings only for what they can put right: location refused', async () => {
      phoneSource();
      const live = await driverWith();
      const refused = "Precise location is off for this app. Allow it in the phone's settings.";
      expect(live.settingsHelpWith(refused)).toBe(true);
      expect(live.settingsHelpWith(`${refused} Then start again.`)).toBe(true);
      expect(live.settingsHelpWith(MOCKED)).toBe(false);
      expect(live.settingsHelpWith('You are not linked to a vehicle. Contact your MTO.')).toBe(
        false,
      );
      expect(live.settingsHelpWith('')).toBe(false);
    });

    it('gives the Android service the trip it picks up, so sharing carries on once the app is closed', async () => {
      serviceSource();
      const live = await driverWith();
      expect(live.carriesOnClosed).toBe(true);
      expect(source.carried).toEqual([41]);
    });

    it('gives the Android service the trip it starts as well', async () => {
      serviceSource();
      const live = await driverWith(null);
      expect(source.carried).toEqual([]);

      const started = live.start('Night patrol');
      source.emit(fixAt(0));
      await settle();
      http.expectOne(TRIPS).flush(makeTrip());
      await settle();
      http.expectOne(ROUTE).flush({ trip: makeTrip(), points: [], cursor: 0, more: false });

      expect(await started).toBe('');
      expect(source.carried).toEqual([41]);
    });

    it('does not start while another app sets the phone’s location', async () => {
      phoneSource();
      const live = await driverWith(null);

      const started = live.start('Night patrol');
      source.fail('simulated');

      expect(await started).toBe(`${MOCKED} Then start again.`);
      http.expectNone(TRIPS);
      expect(live.state()).toBe('off');
      expect(source.watching).toBe(0);
    });

    it('says so while sharing once another app sets the phone’s location', async () => {
      phoneSource();
      const live = await driverWith();
      source.fail('simulated');
      expect(live.locationProblem()).toBe(MOCKED);
      source.emit(fixAt(0));
      expect(live.locationProblem()).toBe('');
    });

    it('sends as locations arrive, not only on its timer, which a phone may hold back', async () => {
      phoneSource();
      sendEveryMs = 15_000;
      const live = await driverWith(makeTrip({ last_point_at: null }));

      source.emit(fixAt(0)); // kept, but sent less than 15 seconds after sharing began
      http.expectNone(POINTS);
      clock += 16_000;
      source.emit(fixAt(61));

      expect(sentBatch()).toEqual([fixAt(0).recorded_at, fixAt(61).recorded_at]);
      await settle();
      expect(live.waiting()).toBe(0);
    });
  });

  describe('the screen', () => {
    let released: number;
    let requested: number;

    beforeEach(() => {
      released = 0;
      requested = 0;
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: {
          request: async () => {
            requested++;
            return {
              addEventListener: () => undefined,
              release: async () => {
                released++;
              },
            };
          },
        },
      });
    });

    afterEach(() => {
      delete (navigator as unknown as Record<string, unknown>)['wakeLock'];
    });

    it('is not kept on by the phone apps, whose background service needs no screen', async () => {
      source.background = true;
      const live = await driverWith();
      await settle();
      expect(requested).toBe(0);
      expect(live.screenKeptOn()).toBe(false);
    });

    it('is kept on while sharing and let go once sharing stops', async () => {
      const live = await driverWith();
      await settle();
      expect(requested).toBe(1);
      expect(live.screenKeptOn()).toBe(true);

      const stopped = live.stop();
      http.expectOne(STOP).flush(makeTrip({ is_open: false }));
      await stopped;
      await settle();

      expect(released).toBe(1);
      expect(live.screenKeptOn()).toBe(false);
    });
  });

  describe('signing out', () => {
    function recordNavigation() {
      TestBed.inject(Router).navigateByUrl = async (_url: string | UrlTree) => true;
    }

    it('stops sharing first, so the office does not see a trip that is still running', async () => {
      recordNavigation();
      const live = await driverWith();

      TestBed.inject(AuthStore).signOut();
      http.expectOne(STOP).flush(makeTrip({ is_open: false }));
      await settle();
      http.expectOne('/api/auth/logout/').flush(null, { status: 204, statusText: 'No Content' });

      expect(live.state()).toBe('off');
      expect(source.watching).toBe(0);
    });

    it('stops watching when the session ends on its own', async () => {
      const live = await driverWith();
      await signInAs(null);
      TestBed.tick();
      expect(live.state()).toBe('off');
      expect(source.watching).toBe(0);
      http.expectNone(STOP);
    });
  });
});
