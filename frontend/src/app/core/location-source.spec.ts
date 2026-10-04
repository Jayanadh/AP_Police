import { TestBed } from '@angular/core/testing';
import type {
  CallbackError,
  Location,
  WatcherOptions,
} from '@capacitor-community/background-geolocation';
import { Capacitor } from '@capacitor/core';
import { LocationFix } from './api/tracking-api';
import { LOCATION_SOURCE, LocationProblem, phoneLocation } from './location-source';
import { NATIVE_APP } from './native';

type Watcher = {
  ok: (position: unknown) => void;
  fail: (error: unknown) => void;
  options: unknown;
};

describe('LOCATION_SOURCE in the browser', () => {
  let watchers: Watcher[];
  let cleared: number[];

  function withGeolocation(stub: unknown): void {
    Object.defineProperty(navigator, 'geolocation', { value: stub, configurable: true });
  }

  beforeEach(() => {
    watchers = [];
    cleared = [];
    withGeolocation({
      watchPosition: (ok: Watcher['ok'], fail: Watcher['fail'], options: unknown) =>
        watchers.push({ ok, fail, options }),
      clearWatch: (id: number) => cleared.push(id),
    });
  });

  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>)['geolocation'];
  });

  function watch() {
    const fixes: LocationFix[] = [];
    const problems: LocationProblem[] = [];
    const stop = TestBed.inject(LOCATION_SOURCE).watch(
      (fix) => fixes.push(fix),
      (problem) => problems.push(problem),
    );
    return { fixes, problems, stop };
  }

  it('watches with high accuracy and passes each reading on with the time it was taken', () => {
    const { fixes } = watch();
    expect(watchers).toHaveLength(1);
    expect(watchers[0].options).toMatchObject({ enableHighAccuracy: true });

    watchers[0].ok({
      coords: { latitude: 14.4426, longitude: 79.9865, accuracy: 8.5, speed: 11.2, heading: 90 },
      timestamp: Date.parse('2026-10-04T04:30:00Z'),
    });

    expect(fixes).toEqual([
      {
        latitude: 14.4426,
        longitude: 79.9865,
        recorded_at: '2026-10-04T04:30:00.000Z',
        accuracy: 8.5,
        speed: 11.2,
        heading: 90,
      },
    ]);
  });

  it('leaves out a speed or heading the phone does not know', () => {
    const { fixes } = watch();
    watchers[0].ok({
      coords: { latitude: 14.4, longitude: 79.9, accuracy: 20, speed: null, heading: NaN },
      timestamp: Date.parse('2026-10-04T04:30:00Z'),
    });
    expect(fixes[0]).toMatchObject({ speed: null, heading: null });
  });

  it('tells a refused permission apart from a location that cannot be found', () => {
    const { problems } = watch();
    watchers[0].fail({ code: 1 });
    watchers[0].fail({ code: 2 });
    watchers[0].fail({ code: 3 });
    expect(problems).toEqual(['denied', 'unavailable', 'unavailable']);
  });

  it('stops watching when asked', () => {
    withGeolocation({
      watchPosition: () => 17,
      clearWatch: (id: number) => cleared.push(id),
    });
    const { stop } = watch();
    stop();
    expect(cleared).toEqual([17]);
  });

  it('says the location is unavailable when the browser has none', () => {
    delete (navigator as unknown as Record<string, unknown>)['geolocation'];
    const { problems, stop } = watch();
    expect(problems).toEqual(['unavailable']);
    expect(() => stop()).not.toThrow();
  });
});

describe('the phone apps’ background location', () => {
  type Callback = (position?: Location, error?: CallbackError) => void;
  const failure = (code: string): CallbackError => Object.assign(new Error(code), { code });

  /** Stands in for the background geolocation plugin. */
  function fakePlugin() {
    const plugin = {
      options: [] as WatcherOptions[],
      callbacks: [] as Callback[],
      removed: [] as string[],
      settings: 0,
      release: (_id: string) => undefined as void,
      addWatcher(options: WatcherOptions, callback: Callback) {
        plugin.options.push(options);
        plugin.callbacks.push(callback);
        return new Promise<string>((resolve) => (plugin.release = resolve));
      },
      async removeWatcher({ id }: { id: string }) {
        plugin.removed.push(id);
      },
      async openSettings() {
        plugin.settings++;
      },
    };
    return plugin;
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve));
  const location = (overrides: Partial<Location> = {}): Location => ({
    latitude: 14.4426,
    longitude: 79.9865,
    accuracy: 6,
    altitude: null,
    altitudeAccuracy: null,
    simulated: false,
    bearing: 90,
    speed: 11,
    time: Date.parse('2026-10-04T04:30:00Z'),
    ...overrides,
  });

  it('works in the background, with a notification, asking for the notification permission first', async () => {
    const plugin = fakePlugin();
    const order: string[] = [];
    const source = phoneLocation(plugin, async () => {
      order.push('notifications');
    });
    expect(source.background).toBe(true);

    source.watch(
      () => undefined,
      () => undefined,
    );
    await settle();

    expect(order).toEqual(['notifications']);
    expect(plugin.options).toEqual([
      {
        backgroundTitle: 'Sharing live location',
        backgroundMessage: 'Your MTO sees where the vehicle is until you stop it in the app.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 0,
      },
    ]);
  });

  it('passes each location on with its own time, leaving out what the phone does not know', async () => {
    const plugin = fakePlugin();
    const fixes: LocationFix[] = [];
    phoneLocation(plugin, async () => undefined).watch(
      (fix) => fixes.push(fix),
      () => undefined,
    );
    await settle();

    plugin.callbacks[0](location());
    plugin.callbacks[0](location({ speed: -1, bearing: -1, accuracy: -1 })); // iOS: not known

    expect(fixes).toEqual([
      {
        latitude: 14.4426,
        longitude: 79.9865,
        recorded_at: '2026-10-04T04:30:00.000Z',
        accuracy: 6,
        speed: 11,
        heading: 90,
      },
      {
        latitude: 14.4426,
        longitude: 79.9865,
        recorded_at: '2026-10-04T04:30:00.000Z',
        accuracy: null,
        speed: null,
        heading: null,
      },
    ]);
  });

  it('tells a refused permission apart from other trouble', async () => {
    const plugin = fakePlugin();
    const problems: LocationProblem[] = [];
    phoneLocation(plugin, async () => undefined).watch(
      () => undefined,
      (problem) => problems.push(problem),
    );
    await settle();

    plugin.callbacks[0](undefined, failure('NOT_AUTHORIZED'));
    plugin.callbacks[0](undefined, failure('SOMETHING_ELSE'));

    expect(problems).toEqual(['denied', 'unavailable']);
  });

  it('removes its watcher when stopped, even one that was still starting', async () => {
    const plugin = fakePlugin();
    const source = phoneLocation(plugin, async () => undefined);

    const stopEarly = source.watch(
      () => undefined,
      () => undefined,
    );
    await settle();
    stopEarly();
    plugin.release('watcher-1');
    await settle();
    expect(plugin.removed).toEqual(['watcher-1']);

    const stop = source.watch(
      () => undefined,
      () => undefined,
    );
    await settle();
    plugin.release('watcher-2');
    await settle();
    stop();
    expect(plugin.removed).toEqual(['watcher-1', 'watcher-2']);
  });

  it('opens the app’s settings, where location can be allowed again', async () => {
    const plugin = fakePlugin();
    await phoneLocation(plugin, async () => undefined).openSettings!();
    expect(plugin.settings).toBe(1);
  });

  it('takes no location another app sets (a mock location app), and says so', async () => {
    const plugin = fakePlugin();
    const fixes: LocationFix[] = [];
    const problems: LocationProblem[] = [];
    phoneLocation(plugin, async () => undefined).watch(
      (fix) => fixes.push(fix),
      (problem) => problems.push(problem),
    );
    await settle();

    plugin.callbacks[0](location({ simulated: true })); // iOS marks it
    plugin.callbacks[0](undefined, failure('SIMULATED')); // the Android service drops it and says so

    expect(fixes).toEqual([]);
    expect(problems).toEqual(['simulated', 'simulated']);
  });

  describe('in the Android app', () => {
    type Carried = { trip: number; api: string; token: string };

    /** Stands in for the Android app's own location service, which can carry on once the app is closed. */
    function servicePlugin(refuse = false) {
      return Object.assign(fakePlugin(), {
        carried: [] as Carried[],
        async carryOn(this: { carried: Carried[] }, options: Carried) {
          this.carried.push(options);
          if (refuse) {
            throw new Error('The trip, the server’s address and the sign-in are needed.');
          }
        },
      });
    }

    it('gives the service the trip, the server and the sign-in, so it carries on once the app is closed', async () => {
      const plugin = servicePlugin();
      const source = phoneLocation(
        plugin,
        async () => undefined,
        () => ({ api: 'https://mto.example.gov.in', token: 'device-token-1' }),
      );
      expect(source.carriesOnClosed).toBe(true);

      source.carryOn!(41);
      await settle();

      expect(plugin.carried).toEqual([
        { trip: 41, api: 'https://mto.example.gov.in', token: 'device-token-1' },
      ]);
    });

    it('gives it no trip without a sign-in to send with', async () => {
      const plugin = servicePlugin();
      const source = phoneLocation(
        plugin,
        async () => undefined,
        () => ({ api: 'https://mto.example.gov.in', token: null }),
      );
      source.carryOn!(41);
      await settle();
      expect(plugin.carried).toEqual([]);
    });

    it('carries on in the app when the service will not take the trip', async () => {
      const plugin = servicePlugin(true);
      const source = phoneLocation(
        plugin,
        async () => undefined,
        () => ({ api: 'https://mto.example.gov.in', token: 'device-token-1' }),
      );
      expect(() => source.carryOn!(41)).not.toThrow();
      await settle(); // and no unhandled rejection
      expect(plugin.carried).toHaveLength(1);
    });
  });

  it('in the iPhone app, sharing stops with the app: there is no trip to carry on with', () => {
    const source = phoneLocation(fakePlugin(), async () => undefined);
    expect(source.carriesOnClosed).toBe(false);
    expect(source.carryOn).toBeUndefined();
  });
});

describe('LOCATION_SOURCE in the phone apps', () => {
  afterEach(() => vi.restoreAllMocks());

  function sourceOn(platform: 'android' | 'ios') {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue(platform);
    TestBed.configureTestingModule({ providers: [{ provide: NATIVE_APP, useValue: true }] });
    return TestBed.inject(LOCATION_SOURCE);
  }

  it('is the app’s own service in the Android app, which carries on once the app is closed', () => {
    const source = sourceOn('android');
    expect(source.background).toBe(true);
    expect(source.carriesOnClosed).toBe(true);
  });

  it('is the background geolocation plugin in the iPhone app', () => {
    const source = sourceOn('ios');
    expect(source.background).toBe(true);
    expect(source.carriesOnClosed).toBe(false);
  });
});
