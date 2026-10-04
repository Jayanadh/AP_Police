import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { GeoService } from '../../core/geo';
import { makeFuelStatement, makeMe, makeMyVehicle, signInAs } from '../../core/test-data';
import { NEVER_LOADING_LEAFLET } from '../../ui/testing/leaflet-stub';
import { DRIVER_ROUTES } from './driver.routes';

const MINE = {
  vehicles: [makeMyVehicle()],
  mto: { unit_name: 'MTO Nellore', full_name: 'Ravi Kumar', mobile: '9876543210' },
};

const PUMP = {
  id: 3,
  name: 'Nellore Police Pump',
  kind: 'POLICE',
  kind_label: 'Police pump',
  address: 'Police Lines, Nellore',
  district_name: 'Nellore',
  unit_name: 'MTO Nellore',
  latitude: '14.450000',
  longitude: '79.990000',
  opening_hours: '24/7',
  sells_petrol: true,
  sells_diesel: true,
  petrol_available: true,
  diesel_available: true,
};

describe('Driver routes', () => {
  beforeEach(() => {
    // The same router features as the app (see app.config.ts): query parameters reach component inputs.
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'driver', children: DRIVER_ROUTES }], withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
        NEVER_LOADING_LEAFLET,
        { provide: GeoService, useValue: { current: () => Promise.resolve(null) } },
      ],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  const title = () => TestBed.inject(Title).getTitle();

  it('/driver is the driver’s home', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/driver');
    TestBed.inject(HttpTestingController)
      .expectOne('/api/dashboard/')
      .flush({
        role: 'DRIVER',
        month: '2026-10',
        vehicle: null,
        quota: null,
        open_request: null,
        duty_due: [],
        odometer: { week_of: '2026-09-27', recorded: false, reading_km: null },
      });
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-driver-dashboard h1')).not.toBeNull();
    expect(title()).toBe('Home');
  });

  it('/driver/pumps is the pump finder', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/driver/pumps');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/me/vehicles/').flush(MINE);
    await harness.fixture.whenStable();
    http.expectOne('/api/pump-directory/?fuel=DIESEL').flush([PUMP]);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-pump-finder-page h1')?.textContent?.trim()).toBe(
      'Found 1 petrol station near you',
    );
    expect(title()).toBe('Pumps');
  });

  it('/driver/pumps/:id is the page of that pump', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/driver/pumps/3');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/me/vehicles/').flush(MINE);
    http.expectOne('/api/pump-directory/').flush([PUMP]);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-driver-pump-detail-page h1')?.textContent?.trim()).toBe(
      'Nellore Police Pump',
    );
    expect(title()).toBe('Pump');
  });

  it('/driver/fuel is the fuel page, and ?pump= reaches it', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/driver/fuel?pump=3');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/me/vehicles/').flush(MINE);
    http.expectOne('/api/fuel/requests/').flush([]);
    await harness.fixture.whenStable();
    http.expectOne((r) => r.url === '/api/pump-directory/').flush([PUMP]);
    http.expectOne('/api/fuel/vehicles/5/quota/').flush({
      month: '2026-10',
      base_litres: '60.00',
      additional_litres: '0.00',
      limit_litres: '60.00',
      used_litres: '0.00',
      remaining_litres: '60.00',
      emergency_used_litres: '0.00',
      emergency_remaining_litres: '10.00',
      additional_balance_litres: '0.00',
    });
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-driver-fuel-page h1')?.textContent?.trim()).toBe('Fuel');
    expect(el.querySelector<HTMLSelectElement>('#fuel-pump')?.value).toBe(String(PUMP.id));
    expect(title()).toBe('Fuel');
  });

  it('/driver/live is the live location page', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/driver/live');
    TestBed.inject(HttpTestingController).expectOne('/api/me/vehicles/').flush(MINE);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-live-location-page h1')?.textContent?.trim()).toBe(
      'Live location',
    );
    expect(title()).toBe('Live location');
  });

  it('/driver/odometer is the odometer page', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/driver/odometer');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/me/vehicles/').flush(MINE);
    http.expectOne('/api/odometer/').flush([]);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-driver-odometer-page h1')?.textContent?.trim()).toBe('Odometer');
    expect(title()).toBe('Odometer');
  });

  it('/driver/statement is the fuel statement page', async () => {
    await signInAs(makeMe({ role: 'DRIVER' }));
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/driver/statement');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((r) => r.url === '/api/fuel/statement/').flush(makeFuelStatement());
    http.expectOne((r) => r.url === '/api/fuel/requests/').flush([]);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-fuel-statement-page h1')?.textContent?.trim()).toBe(
      'Fuel statement',
    );
    expect(title()).toBe('Fuel statement');
  });
});
