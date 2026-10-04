import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { BoardRow, Trip } from '../../core/api/tracking-api';
import { fixedClock, makeTrip } from '../../core/test-data';
import { MapView } from '../../ui/map-view';
import { NEVER_LOADING_LEAFLET } from '../../ui/testing/leaflet-stub';
import { ToastService } from '../../ui/toast';
import { LIVE_BOARD_POLL_MS, LiveTrackingPage, PICKED_KEY } from './live-tracking-page';

const BOARD = '/api/tracking/live/';
const NOW = '2026-10-04T10:00:00+05:30';

function row(
  driverId: number,
  reg: string | null,
  trip: Partial<Trip> | null,
  name = `Driver ${driverId}`,
): BoardRow {
  return {
    driver: {
      id: driverId,
      full_name: name,
      emp_id: `AP${1000 + driverId}`,
      mobile: `98765432${10 + driverId}`,
    },
    vehicle: reg
      ? { id: driverId * 10, registration_number: reg, vehicle_name: 'Mahindra Bolero' }
      : null,
    trip:
      trip === null
        ? null
        : makeTrip({
            id: driverId * 100,
            driver: driverId,
            driver_name: name,
            registration_number: reg ?? '',
            ...trip,
          }),
  };
}

/** Ravi is sharing and was seen a minute ago; Suresh was last seen 12 minutes ago; Imran is not sharing. */
const RAVI = row(
  1,
  'AP39PA1001',
  { last_point_at: '2026-10-04T09:59:00+05:30', latitude: 14.44, longitude: 79.98 },
  'Ravi Kumar',
);
const SURESH = row(
  2,
  'AP39PA1002',
  {
    last_point_at: '2026-10-04T09:48:00+05:30',
    latitude: 14.6,
    longitude: 80.1,
    duty_particulars: 'Escort to court',
  },
  'Suresh Babu',
);
const IMRAN = row(3, 'AP39PA1003', null, 'Shaik Imran');

describe('LiveTrackingPage', () => {
  let pollMs: number;

  beforeEach(() => {
    localStorage.clear();
    pollMs = 60 * 60_000;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        NEVER_LOADING_LEAFLET,
        fixedClock(() => NOW),
        { provide: LIVE_BOARD_POLL_MS, useFactory: () => pollMs },
      ],
    });
  });

  afterEach(() => localStorage.clear());

  async function setup(rows: BoardRow[] = [RAVI, SURESH, IMRAN]) {
    const fixture = TestBed.createComponent(LiveTrackingPage);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(BOARD).flush(rows);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const text = (node: Element | null = el) =>
      node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const map = () =>
      fixture.debugElement.query(By.directive(MapView)).componentInstance as MapView;
    const sharingRows = () => Array.from(el.querySelectorAll('.sharing .vehicle-row'));
    const pick = async (reg: string) => {
      el.querySelector<HTMLInputElement>(`input[aria-label="Show ${reg} on the map"]`)!.click();
      await fixture.whenStable();
    };
    const button = (label: string, within: Element = el) =>
      Array.from(within.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
    /** What the page does every few seconds, and when it comes back into view: reads the board again. */
    const refresh = async (next: BoardRow[]) => {
      document.dispatchEvent(new Event('visibilitychange'));
      http.expectOne(BOARD).flush(next);
      await fixture.whenStable();
    };
    return { fixture, el, http, text, map, sharingRows, pick, button, refresh };
  }

  it('lists those sharing first, with the vehicle, driver, duty and when each was last seen', async () => {
    const { el, text, sharingRows } = await setup();

    expect(sharingRows().map((r) => r.querySelector('.reg')?.textContent?.trim())).toEqual([
      'AP39PA1001',
      'AP39PA1002',
    ]);
    const ravi = text(sharingRows()[0]);
    expect(ravi).toContain('Ravi Kumar');
    expect(ravi).toContain('Night patrol, Kavali highway');
    expect(ravi).toContain('Last seen 1 min ago');
    expect(text(sharingRows()[1])).toContain('Last seen 12 mins ago');
    expect(text(el.querySelector('.not-sharing'))).toContain('Shaik Imran');
    expect(text(el.querySelector('.summary'))).toContain('2 of 3 drivers sharing');
  });

  it('puts each vehicle sharing on the map with its registration under the pin', async () => {
    const { map } = await setup();
    expect(map().markers()).toEqual([
      {
        id: 1,
        lat: 14.44,
        lng: 79.98,
        label: 'AP39PA1001, Ravi Kumar, last seen 1 min ago',
        caption: 'AP39PA1001',
        tone: 'vehicle',
      },
      {
        id: 2,
        lat: 14.6,
        lng: 80.1,
        label: 'AP39PA1002, Suresh Babu, last seen 12 mins ago',
        caption: 'AP39PA1002',
        tone: 'vehicle-stale',
      },
    ]);
    expect(map().live()).toBe(true);
  });

  it('marks a vehicle not heard from for five minutes', async () => {
    const { sharingRows } = await setup();
    expect(sharingRows()[1].classList).toContain('stale');
    expect(sharingRows()[0].classList).not.toContain('stale');
  });

  it('says when a vehicle has not sent its first location yet', async () => {
    const waiting = row(4, 'AP39PA1004', { last_point_at: null, latitude: null, longitude: null });
    const { text, sharingRows, map } = await setup([waiting]);
    expect(text(sharingRows()[0])).toContain('Waiting for the first location');
    expect(map().markers()).toEqual([]);
  });

  it('shows only the vehicles picked, once any is picked, and all again on Show all', async () => {
    const { fixture, map, pick, button } = await setup();

    await pick('AP39PA1002');
    expect(
      map()
        .markers()
        .map((m) => m.id),
    ).toEqual([2]);

    button('Show all')!.click();
    await fixture.whenStable();
    expect(
      map()
        .markers()
        .map((m) => m.id),
    ).toEqual([1, 2]);
  });

  it('remembers the vehicles picked on this device', async () => {
    const first = await setup();
    await first.pick('AP39PA1002');
    expect(JSON.parse(localStorage.getItem(PICKED_KEY)!)).toEqual([2]);
    first.fixture.destroy();

    const again = await setup();
    expect(
      again
        .map()
        .markers()
        .map((m) => m.id),
    ).toEqual([2]);
    expect(
      again.el.querySelector<HTMLInputElement>('input[aria-label="Show AP39PA1002 on the map"]')!
        .checked,
    ).toBe(true);
  });

  it('tracks a vehicle: follows it and draws its route, then adds what is new', async () => {
    const { fixture, http, map, sharingRows, button, refresh } = await setup();

    button('Track', sharingRows()[0])!.click();
    await fixture.whenStable();
    http.expectOne('/api/tracking/trips/100/path/?after=0').flush({
      trip: RAVI.trip,
      points: [
        { latitude: 14.42, longitude: 79.97, recorded_at: '2026-10-04T09:50:00+05:30' },
        { latitude: 14.44, longitude: 79.98, recorded_at: '2026-10-04T09:59:00+05:30' },
      ],
      cursor: 7,
      more: false,
    });
    await fixture.whenStable();

    expect(map().follow()).toBe(1);
    expect(map().paths()).toEqual([
      {
        id: 100,
        tone: 'tracked',
        points: [
          { lat: 14.42, lng: 79.97 },
          { lat: 14.44, lng: 79.98 },
        ],
      },
    ]);
    expect(
      map()
        .markers()
        .find((m) => m.id === 1)?.tone,
    ).toBe('vehicle-tracked');
    expect(button('Stop tracking', sharingRows()[0])?.getAttribute('aria-pressed')).toBe('true');

    await refresh([RAVI, SURESH, IMRAN]);
    http.expectOne('/api/tracking/trips/100/path/?after=7').flush({
      trip: RAVI.trip,
      points: [{ latitude: 14.45, longitude: 79.99, recorded_at: '2026-10-04T10:00:00+05:30' }],
      cursor: 8,
      more: false,
    });
    await fixture.whenStable();
    expect(map().paths()[0].points).toHaveLength(3);
  });

  it('tracks a vehicle picked on the map', async () => {
    const { fixture, http, map } = await setup();
    map().markerClick.emit(2);
    await fixture.whenStable();
    http.expectOne('/api/tracking/trips/200/path/?after=0').flush({
      trip: SURESH.trip,
      points: [],
      cursor: 0,
      more: false,
    });
    expect(map().follow()).toBe(2);
  });

  it('stops tracking a vehicle once it stops sharing, and says so', async () => {
    const { http, map, sharingRows, button, refresh } = await setup();
    button('Track', sharingRows()[0])!.click();
    http.expectOne('/api/tracking/trips/100/path/?after=0').flush({
      trip: RAVI.trip,
      points: [],
      cursor: 0,
      more: false,
    });

    await refresh([row(1, 'AP39PA1001', null, 'Ravi Kumar'), SURESH, IMRAN]);

    expect(map().follow()).toBeNull();
    expect(map().paths()).toEqual([]);
    expect(TestBed.inject(ToastService).messages()[0]?.text).toBe(
      'AP39PA1001 stopped sharing its location.',
    );
  });

  it('reads the board again every few seconds', async () => {
    pollMs = 30;
    const { fixture, http, sharingRows } = await setup([IMRAN]);

    await new Promise((resolve) => setTimeout(resolve, 45));
    for (const req of http.match(BOARD)) {
      req.flush([RAVI, IMRAN]);
    }
    await fixture.whenStable();

    expect(sharingRows()).toHaveLength(1);
  });

  it('finds a vehicle or a driver', async () => {
    const { fixture, el, sharingRows } = await setup();
    const search = el.querySelector<HTMLInputElement>('#live-search')!;
    search.value = 'suresh';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(sharingRows().map((r) => r.querySelector('.reg')?.textContent?.trim())).toEqual([
      'AP39PA1002',
    ]);
  });

  it('has a button to call each driver who is sharing', async () => {
    const { sharingRows } = await setup();
    const call = sharingRows()[0].querySelector<HTMLAnchorElement>('a.call')!;
    expect(call.getAttribute('href')).toBe('tel:9876543211');
    expect(call.getAttribute('aria-label')).toBe('Call Ravi Kumar');
  });

  it('says when nobody is sharing', async () => {
    const { text } = await setup([IMRAN]);
    expect(text()).toContain('No one is sharing their live location right now.');
  });

  it('says when the office has no drivers', async () => {
    const { text } = await setup([]);
    expect(text()).toContain('No drivers in your office yet.');
  });

  it('shows what went wrong and reads the board again on Try again', async () => {
    const fixture = TestBed.createComponent(LiveTrackingPage);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(BOARD).flush({ detail: 'Server error.' }, { status: 500, statusText: 'Server' });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Server error.');

    Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Try again')!
      .click();
    http.expectOne(BOARD).flush([RAVI]);
    await fixture.whenStable();
    expect(el.textContent).toContain('AP39PA1001');
  });
});
