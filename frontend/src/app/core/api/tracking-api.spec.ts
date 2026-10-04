import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { makeTrip } from '../test-data';
import { BoardRow, RoutePage, TrackingApi, Trip } from './tracking-api';

describe('TrackingApi', () => {
  let api: TrackingApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(TrackingApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the trip the driver still has open, or none', () => {
    const answers: (Trip | null)[] = [];
    api.current().subscribe((trip) => answers.push(trip));
    api.current().subscribe((trip) => answers.push(trip));
    const [first, second] = http.match('/api/tracking/trips/current/');
    first.flush({ trip: makeTrip() });
    second.flush({ trip: null });
    expect(answers.map((trip) => trip?.id ?? null)).toEqual([41, null]);
  });

  it('starts a trip with the duty particulars', () => {
    api.start('Night patrol').subscribe();
    const req = http.expectOne('/api/tracking/trips/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ duty_particulars: 'Night patrol' });
    req.flush(makeTrip());
  });

  it('sends a batch of locations to the trip', () => {
    const point = {
      latitude: 14.4426,
      longitude: 79.9865,
      recorded_at: '2026-10-04T04:30:00.000Z',
      accuracy: 8,
      speed: null,
      heading: null,
    };
    let accepted = -1;
    api.send(41, [point]).subscribe((answer) => (accepted = answer.accepted));
    const req = http.expectOne('/api/tracking/trips/41/points/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ points: [point] });
    req.flush({ accepted: 1, trip: makeTrip() });
    expect(accepted).toBe(1);
  });

  it('stops a trip', () => {
    api.stop(41).subscribe();
    const req = http.expectOne('/api/tracking/trips/41/stop/');
    expect(req.request.method).toBe('POST');
    req.flush(makeTrip({ is_open: false }));
  });

  it("reads the office's live board", () => {
    let rows: BoardRow[] = [];
    api.board().subscribe((answer) => (rows = answer));
    http.expectOne('/api/tracking/live/').flush([
      {
        driver: { id: 3, full_name: 'Ravi Kumar', emp_id: 'AP1001', mobile: '9876543210' },
        vehicle: null,
        trip: null,
      },
    ]);
    expect(rows.map((row) => row.driver.full_name)).toEqual(['Ravi Kumar']);
  });

  it('reads every page of a route after the cursor and gives it oldest first', () => {
    let route: RoutePage | undefined;
    api.route(41, 7).subscribe((answer) => (route = answer));
    const at = (time: string) => ({ latitude: 14.4, longitude: 79.9, recorded_at: time });

    const first = http.expectOne('/api/tracking/trips/41/path/?after=7');
    first.flush({
      trip: makeTrip(),
      points: [at('2026-10-04T10:05:00+05:30'), at('2026-10-04T10:06:00+05:30')],
      cursor: 9,
      more: true,
    });
    expect(route).toBeUndefined();
    http.expectOne('/api/tracking/trips/41/path/?after=9').flush({
      trip: makeTrip({ last_point_at: '2026-10-04T10:07:00+05:30' }),
      points: [at('2026-10-04T10:04:00+05:30')], // sent late, from before the others
      cursor: 10,
      more: false,
    });

    expect(route!.points.map((point) => point.recorded_at)).toEqual([
      '2026-10-04T10:04:00+05:30',
      '2026-10-04T10:05:00+05:30',
      '2026-10-04T10:06:00+05:30',
    ]);
    expect(route!.cursor).toBe(10);
    expect(route!.trip.last_point_at).toBe('2026-10-04T10:07:00+05:30');
  });
});
