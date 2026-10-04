import { inject, InjectionToken } from '@angular/core';
import type {
  BackgroundGeolocationPlugin,
  CallbackError,
  Location as PhoneLocation,
} from '@capacitor-community/background-geolocation';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { LocationFix } from './api/tracking-api';
import { DeviceToken } from './device-token';
import { API_BASE, NATIVE_APP } from './native';

/**
 * Why there is no location: the person refused it (sharing cannot go on), it cannot be found just now, or another app
 * is setting the phone's location (a mock location app), so none of it is the vehicle's.
 */
export type LocationProblem = 'denied' | 'unavailable' | 'simulated';

/**
 * Where live locations come from: the browser's location in the web app, which a phone pauses while the page is in
 * the background; in the phone apps, a background location service that goes on with the screen locked.
 */
export interface LocationSource {
  /** Passes on each new reading, or the problem when there is none; returns a function that stops watching. */
  watch(fix: (fix: LocationFix) => void, problem: (problem: LocationProblem) => void): () => void;
  /** Whether locations keep coming with the screen locked and other apps in front. */
  readonly background?: boolean;
  /** Whether sharing also goes on once the app is closed (the Android app's own service). */
  readonly carriesOnClosed?: boolean;
  /** Opens the phone's settings for the app, where location can be allowed again (the phone apps only). */
  openSettings?(): Promise<void>;
  /** Gives the background service the trip it sends to by itself once the app is closed (the Android app). */
  carryOn?(trip: number): void;
}

const PERMISSION_DENIED = 1;
/** The plugins' error codes for a problem that is not just "no location now". */
const PROBLEMS: ReadonlyMap<string | undefined, LocationProblem> = new Map([
  ['NOT_AUTHORIZED', 'denied'],
  ['SIMULATED', 'simulated'],
]);
/** The fastest a reading may say the vehicle moves, as the server takes it: 150 m/s. */
const MAX_SPEED = 150;
const MAX_ACCURACY = 100_000;

/** A figure the phone gave, or null when it does not know it (NaN, or out of its range, such as iOS's -1). */
function within(value: number | null | undefined, min: number, max: number): number | null {
  return value === null ||
    value === undefined ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
    ? null
    : value;
}

function reading(
  latitude: number,
  longitude: number,
  time: number,
  accuracy: number | null | undefined,
  speed: number | null | undefined,
  heading: number | null | undefined,
): LocationFix {
  return {
    latitude,
    longitude,
    recorded_at: new Date(time).toISOString(),
    accuracy: within(accuracy, 0, MAX_ACCURACY),
    speed: within(speed, 0, MAX_SPEED),
    heading: within(heading, 0, 360),
  };
}

/** The browser's own location, as precise as the phone can give it. */
const browserLocation: LocationSource = {
  background: false,
  watch(fix, problem) {
    const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
    if (!geolocation) {
      problem('unavailable');
      return () => undefined;
    }
    const id = geolocation.watchPosition(
      ({ coords, timestamp }) =>
        fix(
          reading(
            coords.latitude,
            coords.longitude,
            timestamp,
            coords.accuracy,
            coords.speed,
            coords.heading,
          ),
        ),
      (error) => problem(error.code === PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    return () => geolocation.clearWatch(id);
  },
};

/**
 * The phone apps' location plugin, with the background geolocation plugin's calls: that plugin itself in the iPhone
 * app; in the Android app, the app's own (android/app/src/main/java/in/gov/appolice/mto/location/), whose service
 * also carries on sending by itself once the app is closed.
 */
export type PhoneLocationPlugin = Pick<
  BackgroundGeolocationPlugin,
  'addWatcher' | 'removeWatcher' | 'openSettings'
> & {
  carryOn?(options: { trip: number; api: string; token: string }): Promise<void>;
};

/** Where the Android service sends once the app is closed: the server, and the device token to sign in with. */
export type SignIn = () => { api: string; token: string | null };

/** Android 13 and later ask before showing the notification that says the location is being shared. */
async function askToNotifyOnAndroid(): Promise<void> {
  if (Capacitor.getPlatform() === 'android') {
    await LocalNotifications.requestPermissions();
  }
}

/**
 * The phone apps' location: a background service (a foreground service with its notification on Android, the
 * location background mode on iOS) that goes on with the screen locked or another app in front. Every reading is
 * passed on; Live location keeps what it needs. A reading another app set (a mock location) is not.
 *
 * With `carryOnWith` (the Android app) the service is also given the trip, and sends by itself once the app is
 * closed, signed in as `carryOnWith` says. A plugin cannot be asked whether it has carryOn: Capacitor's plugin
 * object answers to any name.
 */
export function phoneLocation(
  plugin: PhoneLocationPlugin,
  askToNotify: () => Promise<unknown> = askToNotifyOnAndroid,
  carryOnWith?: SignIn,
): LocationSource {
  const carryOn = carryOnWith
    ? (trip: number) => {
        const { api, token } = carryOnWith();
        if (token) {
          // Refused, the service stops with the app, as on iOS; sharing goes on in the app.
          plugin.carryOn?.({ trip, api, token }).catch(() => undefined);
        }
      }
    : undefined;
  return {
    background: true,
    carriesOnClosed: carryOn !== undefined,
    carryOn,
    watch(fix, problem) {
      let watcher: string | null = null;
      let stopped = false;
      askToNotify()
        .catch(() => undefined) // refused: the location is still shared, without the notification
        .then(() =>
          stopped
            ? null
            : plugin.addWatcher(
                {
                  backgroundTitle: 'Sharing live location',
                  backgroundMessage:
                    'Your MTO sees where the vehicle is until you stop it in the app.',
                  requestPermissions: true,
                  stale: false,
                  distanceFilter: 0,
                },
                (location?: PhoneLocation, error?: CallbackError) => {
                  if (error) {
                    problem(PROBLEMS.get(error.code) ?? 'unavailable');
                  } else if (location?.simulated) {
                    problem('simulated');
                  } else if (location) {
                    const at = location.time ?? Date.now();
                    fix(
                      reading(
                        location.latitude,
                        location.longitude,
                        at,
                        location.accuracy,
                        location.speed,
                        location.bearing,
                      ),
                    );
                  }
                },
              ),
        )
        .then((id) => {
          if (id === null) {
            return;
          }
          if (stopped) {
            void plugin.removeWatcher({ id });
          } else {
            watcher = id;
          }
        })
        .catch(() => problem('unavailable'));
      return () => {
        stopped = true;
        if (watcher !== null) {
          void plugin.removeWatcher({ id: watcher });
          watcher = null;
        }
      };
    },
    openSettings: () => plugin.openSettings(),
  };
}

export const LOCATION_SOURCE = new InjectionToken<LocationSource>('LOCATION_SOURCE', {
  providedIn: 'root',
  factory: () => {
    if (!inject(NATIVE_APP)) {
      return browserLocation;
    }
    if (Capacitor.getPlatform() !== 'android') {
      return phoneLocation(registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation'));
    }
    const api = inject(API_BASE);
    const device = inject(DeviceToken);
    return phoneLocation(
      registerPlugin<PhoneLocationPlugin>('DutyLocation'),
      askToNotifyOnAndroid,
      () => ({ api, token: device.current() }),
    );
  },
});
