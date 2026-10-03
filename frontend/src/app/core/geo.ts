import { inject, InjectionToken, Service } from '@angular/core';

export type LatLng = { lat: number; lng: number };

/** Latitude and longitude with six decimals (about 10 cm), which is what the server stores. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

const EARTH_RADIUS_KM = 6371;
const TRAVEL_SPEED_KMH = 30;
const NO_VALUE = '—';
const SHORT_DISTANCE = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const LONG_DISTANCE = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/**
 * How long current() waits in total before giving up with null. Browsers do not count the time
 * the permission prompt is open, so getCurrentPosition alone can hang; this timer cannot.
 * Override it in tests.
 */
export const GEO_FALLBACK_MS = new InjectionToken<number>('GEO_FALLBACK_MS', {
  providedIn: 'root',
  factory: () => 8000,
});

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Straight-line distance between two points (haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rough travel time at 30 km/h, rounded up to a whole minute, never less than 1. */
export function travelMinutes(km: number): number {
  return Math.max(1, Math.ceil((km / TRAVEL_SPEED_KMH) * 60));
}

/** "1.2 km" under 10 km, "13 km" from there, never under "0.1 km"; a dash when unknown. */
export function formatDistance(km: number | null): string {
  if (km === null || !Number.isFinite(km)) {
    return NO_VALUE;
  }
  const shown = Math.max(0.1, km);
  return `${(shown < 10 ? SHORT_DISTANCE : LONG_DISTANCE).format(shown)} km`;
}

/** The rough travel time to a place `km` away: "4 mins", "1 h 46 mins"; a dash when unknown. */
export function formatTravelTime(km: number | null): string {
  if (km === null || !Number.isFinite(km)) {
    return NO_VALUE;
  }
  const total = travelMinutes(km);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const minutesText = `${minutes} ${minutes === 1 ? 'min' : 'mins'}`;
  if (hours === 0) {
    return minutesText;
  }
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutesText}`;
}

@Service()
export class GeoService {
  private readonly fallbackMs = inject(GEO_FALLBACK_MS);

  /** The device's position, or null when location is unavailable, declined or too slow. */
  current(): Promise<LatLng | null> {
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(null);
        return;
      }
      const giveUp = setTimeout(() => resolve(null), this.fallbackMs);
      const finish = (position: LatLng | null) => {
        clearTimeout(giveUp);
        resolve(position);
      };
      navigator.geolocation.getCurrentPosition(
        (position) => finish({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => finish(null),
        { timeout: this.fallbackMs },
      );
    });
  }
}
