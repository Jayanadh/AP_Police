import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Title } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { makeFuelStatement, makeMe, signInAs } from '../../core/test-data';
import { NEVER_LOADING_LEAFLET } from '../../ui/testing/leaflet-stub';
import { MTO_ROUTES } from './mto.routes';

describe('MTO routes', () => {
  beforeEach(() => {
    // The same router features as the app (see app.config.ts): route data reaches component inputs.
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'mto', children: MTO_ROUTES }], withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
        NEVER_LOADING_LEAFLET,
      ],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('/mto is the dashboard', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/mto');
    TestBed.inject(HttpTestingController)
      .expectOne('/api/dashboard/')
      .flush({
        role: 'MTO',
        month: '2026-10',
        vehicles: { active: 0, paused: 0, termination_pending: 0 },
        fuel: { used_litres: '0.00', limit_litres: '0.00' },
        top_vehicles: [],
        tanks: [],
        pending_emergencies: 0,
        overdue_duty: 0,
        missing_odometer: 0,
        services_due: 0,
        transfers_to_decide: 0,
      });
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-mto-dashboard h1')).not.toBeNull();
    expect(TestBed.inject(Title).getTitle()).toBe('Dashboard');
  });

  it.each([
    ['drivers', 'Drivers'],
    ['officers', 'Officers'],
  ])('/mto/%s is the %s page', async (kind, title) => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/mto/${kind}`);
    TestBed.inject(HttpTestingController).expectOne(`/api/${kind}/`).flush([]);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-people-page h1')?.textContent?.trim()).toBe(title);
    expect(TestBed.inject(Title).getTitle()).toBe(title);
  });

  it('/mto/vehicles is the vehicles page', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/mto/vehicles');
    TestBed.inject(HttpTestingController).expectOne('/api/vehicles/').flush([]);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-vehicles-page h1')?.textContent?.trim()).toBe('Vehicles');
    expect(TestBed.inject(Title).getTitle()).toBe('Vehicles');
  });

  it('/mto/vehicles/:id is the page of that vehicle', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/mto/vehicles/5');
    const http = TestBed.inject(HttpTestingController);
    // The page asks for the vehicle of the route; its other cards load beside it.
    http.expectOne('/api/vehicles/5/').flush({
      id: 5,
      registration_number: 'AP39PA1234',
      vehicle_type: 'JEEP',
      make: 'Mahindra',
      model: 'Bolero',
      year_of_manufacture: 2022,
      fuel_type: 'DIESEL',
      status: 'PAUSED',
      current_officer: null,
      current_driver: null,
    });
    await harness.fixture.whenStable();
    for (const request of http.match(() => true)) {
      request.flush({ detail: 'Not needed here.' }, { status: 500, statusText: 'Server' });
    }
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-vehicle-detail-page h1')?.textContent?.trim()).toBe('AP39PA1234');
    expect(TestBed.inject(Title).getTitle()).toBe('Vehicle');
  });

  it('/mto/transfers is the transfers page', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/mto/transfers');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/transfers/?direction=outgoing').flush([]);
    http.expectOne('/api/transfers/?direction=incoming').flush([]);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-transfers-page h1')?.textContent?.trim()).toBe('Transfers');
    expect(TestBed.inject(Title).getTitle()).toBe('Transfers');
  });

  it('/mto/pumps is the pumps page', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/mto/pumps');
    TestBed.inject(HttpTestingController).expectOne('/api/pumps/').flush([]);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-pumps-page h1')?.textContent?.trim()).toBe('Pumps');
    expect(TestBed.inject(Title).getTitle()).toBe('Pumps');
  });

  it('/mto/pumps/:id is the page of that pump', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/mto/pumps/4');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/pumps/4/').flush({
      id: 4,
      name: 'Kavali Bunk',
      kind: 'TIE_UP',
      kind_label: 'Tie-up bunk',
      address: 'NH16, Kavali',
      district: 7,
      district_name: 'Prakasam',
      latitude: '14.915000',
      longitude: '79.992000',
      opening_hours: '24/7',
      sells_petrol: true,
      sells_diesel: false,
      is_active: true,
      tanks: [],
      staff_count: 0,
    });
    http.expectOne('/api/pump-staff/').flush([]);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-pump-detail-page h1')?.textContent?.trim()).toBe('Kavali Bunk');
    expect(TestBed.inject(Title).getTitle()).toBe('Pump');
  });

  it('/mto/additional-quota is the additional quota page, and ?vehicle= preselects a vehicle', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/mto/additional-quota');
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-additional-quota-page h1')?.textContent?.trim()).toBe(
      'Additional quota',
    );
    expect(TestBed.inject(Title).getTitle()).toBe('Additional quota');

    await harness.navigateByUrl('/mto/additional-quota?vehicle=5');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/vehicles/5/').flush({ id: 5, registration_number: 'AP39PA1234' });
    await harness.fixture.whenStable();
    for (const request of http.match(() => true)) {
      request.flush({ detail: 'Not needed here.' }, { status: 500, statusText: 'Server' });
    }
    await harness.fixture.whenStable();
    expect(el.querySelector('#quota-card h2')?.textContent).toContain('AP39PA1234');
  });

  it('/mto/emergencies is the emergencies page', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/mto/emergencies');
    TestBed.inject(HttpTestingController)
      .expectOne('/api/fuel/requests/?emergency=pending')
      .flush([]);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-emergencies-page h1')?.textContent?.trim()).toBe('Emergencies');
    expect(TestBed.inject(Title).getTitle()).toBe('Emergencies');
  });

  it('/mto/fuel is the fuel statement page', async () => {
    await signInAs(makeMe({ role: 'MTO' }));
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/mto/fuel');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/vehicles/').flush([]);
    http.expectOne((r) => r.url === '/api/fuel/statement/').flush(makeFuelStatement());
    http.expectOne((r) => r.url === '/api/fuel/requests/').flush([]);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-fuel-statement-page h1')?.textContent?.trim()).toBe(
      'Fuel statement',
    );
    expect(TestBed.inject(Title).getTitle()).toBe('Fuel statement');
  });

  it('/mto/statements is the bunk statements page', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/mto/statements');
    TestBed.inject(HttpTestingController).expectOne('/api/fuel/bunk-statement/pumps/').flush([]);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-bunk-statements-page h1')?.textContent?.trim()).toBe(
      'Bunk statements',
    );
    expect(TestBed.inject(Title).getTitle()).toBe('Bunk statements');
  });

  it('/mto/odometer is the odometer page', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/mto/odometer');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/vehicles/').flush([]);
    http.expectOne('/api/odometer/missing/').flush([]);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-odometer-page h1')?.textContent?.trim()).toBe('Odometer');
    expect(TestBed.inject(Title).getTitle()).toBe('Odometer');
  });

  it('/mto/servicing is the servicing page', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/mto/servicing');
    TestBed.inject(HttpTestingController).expectOne('/api/service-due/').flush([]);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-servicing-page h1')?.textContent?.trim()).toBe('Servicing');
    expect(TestBed.inject(Title).getTitle()).toBe('Servicing');
  });
});
