import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { makeFuelStatement, makeMe, signInAs } from '../../core/test-data';
import { OFFICER_ROUTES } from './officer.routes';

describe('Officer routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'officer', children: OFFICER_ROUTES }], withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  const title = () => TestBed.inject(Title).getTitle();

  it('/officer is the dashboard', async () => {
    await signInAs(makeMe({ role: 'OFFICER', full_name: 'Anil Reddy' }));
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/officer');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/dashboard/').flush({
      role: 'OFFICER',
      month: '2026-10',
      vehicles: [],
      recent_fills: [],
    });
    http.expectOne('/api/me/vehicles/').flush({
      vehicles: [],
      mto: { unit_name: 'MTO Nellore', full_name: null, mobile: null },
    });
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-officer-dashboard h1')?.textContent?.trim()).toBe(
      'Welcome, Anil Reddy',
    );
    expect(title()).toBe('Dashboard');
  });

  it('/officer/fuel is the fuel statement page', async () => {
    await signInAs(makeMe({ role: 'OFFICER' }));
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/officer/fuel');
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
