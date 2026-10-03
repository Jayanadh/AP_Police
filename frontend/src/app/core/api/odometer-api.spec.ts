import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MissingReading, OdometerApi, OdometerReading, weekOf } from './odometer-api';

const READING: OdometerReading = {
  id: 3,
  vehicle: 5,
  registration_number: 'AP39PA1234',
  week_of: '2026-09-27',
  reading_km: 12480,
  km_since_previous: 180,
  recorded_by_name: 'Ramesh Babu',
  created_at: '2026-09-28T09:00:00+05:30',
};

describe('OdometerApi', () => {
  let api: OdometerApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(OdometerApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the readings of every visible vehicle when no vehicle is given', () => {
    let rows: OdometerReading[] = [];
    api.list().subscribe((result) => (rows = result));
    const req = http.expectOne('/api/odometer/');
    expect(req.request.method).toBe('GET');
    req.flush([READING]);
    expect(rows[0].km_since_previous).toBe(180);
  });

  it('narrows the readings to one vehicle', () => {
    api.list(5).subscribe();
    const req = http.expectOne((r) => r.url === '/api/odometer/');
    expect(req.request.params.get('vehicle')).toBe('5');
    req.flush([]);
  });

  it('records the reading of the driver vehicle', () => {
    api.record(12600).subscribe();
    const req = http.expectOne('/api/odometer/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reading_km: 12600 });
    req.flush({ ...READING, reading_km: 12600, km_since_previous: null });
  });

  it('lists the vehicles that have no reading yet this week', () => {
    let rows: MissingReading[] = [];
    api.missing().subscribe((result) => (rows = result));
    const req = http.expectOne('/api/odometer/missing/');
    expect(req.request.method).toBe('GET');
    req.flush([
      {
        vehicle: 5,
        registration_number: 'AP39PA1234',
        driver_name: 'Ramesh Babu',
        week_of: '2026-09-27',
      },
    ]);
    expect(rows[0].driver_name).toBe('Ramesh Babu');
  });
});

describe('weekOf', () => {
  it('is the Sunday on or before the day, in Asia/Kolkata', () => {
    expect(weekOf(new Date('2026-10-03T12:00:00+05:30'))).toBe('2026-09-27'); // a Saturday
    expect(weekOf(new Date('2026-10-05T09:00:00+05:30'))).toBe('2026-10-04'); // a Monday
  });

  it('counts a Sunday as its own week', () => {
    expect(weekOf(new Date('2026-10-04T18:00:00+05:30'))).toBe('2026-10-04');
  });

  it('follows the date in India, not the device clock', () => {
    // 00:30 on Sunday in India is still Saturday in UTC.
    expect(weekOf(new Date('2026-10-04T00:30:00+05:30'))).toBe('2026-10-04');
    // 23:30 on Saturday in India.
    expect(weekOf(new Date('2026-10-03T23:30:00+05:30'))).toBe('2026-09-27');
  });

  it('crosses a month and a year boundary', () => {
    expect(weekOf(new Date('2026-10-01T10:00:00+05:30'))).toBe('2026-09-27');
    expect(weekOf(new Date('2027-01-02T10:00:00+05:30'))).toBe('2026-12-27');
  });
});
