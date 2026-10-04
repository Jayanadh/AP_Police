import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { EMPTY, expand, map, Observable, reduce } from 'rxjs';

/** A driver's duty trip: live location shared from the moment it starts until the driver stops it. */
export type Trip = {
  id: number;
  driver: number;
  driver_name: string;
  vehicle: number;
  registration_number: string;
  duty_particulars: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string;
  /** When the newest location that reached the server was taken; null until the first one. */
  last_point_at: string | null;
  latitude: number | null;
  longitude: number | null;
  /** How far off that location may be, in metres. */
  accuracy_m: number | null;
  is_open: boolean;
};

/** One location as the phone took it, with the phone's own time. */
export type LocationFix = {
  latitude: number;
  longitude: number;
  recorded_at: string;
  /** Metres. */
  accuracy: number | null;
  /** Metres a second. */
  speed: number | null;
  /** Degrees from north. */
  heading: number | null;
};

export type RoutePoint = { latitude: number; longitude: number; recorded_at: string };

/** A trip's route, or the part of it kept after an earlier answer. Ask again `after` the `cursor` for what is new. */
export type RoutePage = { trip: Trip; points: RoutePoint[]; cursor: number; more: boolean };

/** One driver of the office on the MTO's live board, with their vehicle and their trip if they are sharing. */
export type BoardRow = {
  driver: { id: number; full_name: string; emp_id: string | null; mobile: string };
  vehicle: { id: number; registration_number: string; vehicle_name: string } | null;
  trip: Trip | null;
};

const TRIPS = '/api/tracking/trips/';

@Service()
export class TrackingApi {
  private readonly http = inject(HttpClient);

  /** The driver's trip still open, if any. */
  current(): Observable<Trip | null> {
    return this.http
      .get<{ trip: Trip | null }>(`${TRIPS}current/`)
      .pipe(map((answer) => answer.trip));
  }

  start(dutyParticulars: string): Observable<Trip> {
    return this.http.post<Trip>(TRIPS, { duty_particulars: dutyParticulars });
  }

  /** Sends a batch of locations; the answer says how many were new, and how the trip stands now. */
  send(tripId: number, points: LocationFix[]): Observable<{ accepted: number; trip: Trip }> {
    return this.http.post<{ accepted: number; trip: Trip }>(`${TRIPS}${tripId}/points/`, {
      points,
    });
  }

  stop(tripId: number): Observable<Trip> {
    return this.http.post<Trip>(`${TRIPS}${tripId}/stop/`, {});
  }

  /** Every driver of the MTO's office, those sharing their location first. */
  board(): Observable<BoardRow[]> {
    return this.http.get<BoardRow[]>('/api/tracking/live/');
  }

  /**
   * The route kept after `after` (0 for all of it): every page of it in one answer, oldest first. Locations a phone
   * sent late are in it too, in their place.
   */
  route(tripId: number, after = 0): Observable<RoutePage> {
    const page = (from: number) =>
      this.http.get<RoutePage>(`${TRIPS}${tripId}/path/`, { params: { after: from } });
    return page(after).pipe(
      expand((answer) => (answer.more ? page(answer.cursor) : EMPTY)),
      reduce((all, answer) => ({ ...answer, points: [...all.points, ...answer.points] })),
      map((route) => ({
        ...route,
        points: [...route.points].sort(
          (a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at),
        ),
      })),
    );
  }
}
