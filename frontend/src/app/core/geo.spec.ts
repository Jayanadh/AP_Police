import { TestBed } from '@angular/core/testing';
import {
  distanceKm,
  formatDistance,
  formatTravelTime,
  GEO_FALLBACK_MS,
  GeoService,
  LatLng,
  roundCoordinate,
  travelMinutes,
} from './geo';

const NELLORE: LatLng = { lat: 14.4426, lng: 79.9865 };
const GUNTUR: LatLng = { lat: 16.3067, lng: 80.4365 };

describe('distanceKm', () => {
  it('measures Nellore to Guntur by the haversine formula', () => {
    const km = distanceKm(NELLORE, GUNTUR);
    expect(km).toBeGreaterThan(205);
    expect(km).toBeLessThan(215);
  });

  it('is zero for the same point and symmetric', () => {
    expect(distanceKm(NELLORE, NELLORE)).toBe(0);
    expect(distanceKm(NELLORE, GUNTUR)).toBeCloseTo(distanceKm(GUNTUR, NELLORE), 9);
  });
});

describe('roundCoordinate', () => {
  it('keeps six decimals, which is what the server stores', () => {
    expect(roundCoordinate(14.44260051)).toBe(14.442601);
    expect(roundCoordinate(79.98649951234)).toBe(79.9865);
    expect(roundCoordinate(14.4426)).toBe(14.4426);
  });
});

describe('travelMinutes', () => {
  it('assumes 30 km/h and rounds up', () => {
    expect(travelMinutes(1)).toBe(2);
    expect(travelMinutes(15)).toBe(30);
    expect(travelMinutes(15.1)).toBe(31);
  });

  it('never goes below one minute', () => {
    expect(travelMinutes(0)).toBe(1);
    expect(travelMinutes(0.1)).toBe(1);
  });
});

describe('formatDistance', () => {
  it('shows one decimal under 10 km and whole kilometres from there', () => {
    expect(formatDistance(1.234)).toBe('1.2 km');
    expect(formatDistance(9.94)).toBe('9.9 km');
    expect(formatDistance(12.6)).toBe('13 km');
    expect(formatDistance(1234.4)).toBe('1,234 km');
  });

  it('never shows less than 0.1 km, and a dash when the distance is unknown', () => {
    expect(formatDistance(0)).toBe('0.1 km');
    expect(formatDistance(0.04)).toBe('0.1 km');
    expect(formatDistance(null)).toBe('—');
  });
});

describe('formatTravelTime', () => {
  it('shows the minutes at 30 km/h', () => {
    expect(formatTravelTime(0.2)).toBe('1 min');
    expect(formatTravelTime(2)).toBe('4 mins');
    expect(formatTravelTime(29)).toBe('58 mins');
  });

  it('shows hours from an hour on', () => {
    expect(formatTravelTime(30)).toBe('1 h');
    expect(formatTravelTime(212)).toBe('7 h 4 mins');
    expect(formatTravelTime(30.4)).toBe('1 h 1 min');
  });

  it('shows a dash when the distance is unknown', () => {
    expect(formatTravelTime(null)).toBe('—');
  });
});

describe('GeoService', () => {
  let geo: GeoService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: GEO_FALLBACK_MS, useValue: 40 }] });
    geo = TestBed.inject(GeoService);
  });

  function withGeolocation(stub: unknown, run: () => Promise<void>): Promise<void> {
    Object.defineProperty(navigator, 'geolocation', { value: stub, configurable: true });
    return run().finally(() => {
      delete (navigator as unknown as Record<string, unknown>)['geolocation'];
    });
  }

  it('resolves null when navigator.geolocation is missing', async () => {
    expect(navigator.geolocation).toBeUndefined();
    expect(await geo.current()).toBeNull();
  });

  it('resolves the current position', () =>
    withGeolocation(
      {
        getCurrentPosition: (ok: (p: unknown) => void) =>
          ok({ coords: { latitude: 14.4426, longitude: 79.9865 } }),
      },
      async () => {
        expect(await geo.current()).toEqual({ lat: 14.4426, lng: 79.9865 });
      },
    ));

  it('resolves null when the user denies permission', () =>
    withGeolocation(
      {
        getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) => fail({ code: 1 }),
      },
      async () => {
        expect(await geo.current()).toBeNull();
      },
    ));

  it('resolves null when the position never arrives', () =>
    withGeolocation({ getCurrentPosition: () => undefined }, async () => {
      const started = Date.now();
      expect(await geo.current()).toBeNull();
      expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    }));

  it('ignores a position that arrives after the fallback has fired', () => {
    let late: (p: unknown) => void = () => undefined;
    return withGeolocation(
      {
        getCurrentPosition: (ok: (p: unknown) => void) => {
          late = ok;
        },
      },
      async () => {
        expect(await geo.current()).toBeNull();
        expect(() => late({ coords: { latitude: 1, longitude: 2 } })).not.toThrow();
      },
    );
  });
});

describe('GEO_FALLBACK_MS', () => {
  it('gives up after 8 seconds unless overridden', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(GEO_FALLBACK_MS)).toBe(8000);
  });
});
