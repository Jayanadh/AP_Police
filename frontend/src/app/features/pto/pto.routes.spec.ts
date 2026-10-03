import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { makeFuelStatement, makeMe, monitorPage, signInAs } from '../../core/test-data';
import { PTO_ROUTES } from './pto.routes';

describe('PTO routes', () => {
  beforeEach(async () => {
    // The same router features as the app (see app.config.ts): route data reaches component inputs.
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'pto', children: PTO_ROUTES }], withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    await signInAs(makeMe({ role: 'PTO', unit: null, unit_name: null }));
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function visit(url: string) {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/units/').flush([]);
    return { harness, http, el: harness.fixture.nativeElement as HTMLElement };
  }

  const heading = (el: HTMLElement) => el.querySelector('h1')?.textContent?.trim();
  const title = () => TestBed.inject(Title).getTitle();

  it('/pto/vehicles watches every office’s vehicles', async () => {
    const { harness, http, el } = await visit('/pto/vehicles');
    http.expectOne('/api/monitor/vehicles/').flush(monitorPage([]));
    await harness.fixture.whenStable();
    expect(heading(el)).toBe('Vehicles');
    expect(title()).toBe('Vehicles');
  });

  it('/pto/officers and /pto/drivers watch every office’s people', async () => {
    const officers = await visit('/pto/officers');
    officers.http.expectOne('/api/monitor/officers/').flush(monitorPage([]));
    await officers.harness.fixture.whenStable();
    expect(heading(officers.el)).toBe('Officers');
    expect(title()).toBe('Officers');

    await officers.harness.navigateByUrl('/pto/drivers');
    officers.http.expectOne('/api/units/').flush([]);
    officers.http.expectOne('/api/monitor/drivers/').flush(monitorPage([]));
    await officers.harness.fixture.whenStable();
    expect(heading(officers.el)).toBe('Drivers');
    expect(title()).toBe('Drivers');
  });

  it('/pto/statement is the fuel statement of every office', async () => {
    const { harness, http, el } = await visit('/pto/statement');
    http
      .expectOne((r) => r.url === '/api/fuel/statement/')
      .flush(makeFuelStatement({ by_unit: [] }));
    await harness.fixture.whenStable();
    expect(heading(el)).toBe('Fuel statement');
    expect(title()).toBe('Fuel statement');
  });

  it('/pto/bunk-statements reads every office’s bunk statements', async () => {
    const { harness, http, el } = await visit('/pto/bunk-statements');
    http.expectOne('/api/fuel/bunk-statement/pumps/').flush([]);
    await harness.fixture.whenStable();
    expect(heading(el)).toBe('Bunk statements');
    expect(title()).toBe('Bunk statements');
  });
});
