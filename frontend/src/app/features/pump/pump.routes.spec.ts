import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { makeFuelStatement, makeMe, signInAs } from '../../core/test-data';
import { PUMP_ROUTES } from './pump.routes';

const SUMMARY = {
  role: 'PUMP_OPERATOR',
  month: '2026-10',
  pump: { id: 4, name: 'Kavali Bunk', kind: 'TIE_UP' },
  tanks: [],
  waiting: 0,
  today_fills: { count: 0, litres: '0.00' },
};

describe('Pump routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'pump', children: PUMP_ROUTES }], withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  const title = () => TestBed.inject(Title).getTitle();

  async function visit(url: string, kind: 'POLICE' | 'TIE_UP' = 'TIE_UP') {
    await signInAs(
      makeMe({ role: 'PUMP_OPERATOR', pump: 4, pump_name: 'Kavali Bunk', pump_kind: kind }),
    );
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return {
      harness,
      el: harness.fixture.nativeElement as HTMLElement,
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('/pump is the dashboard', async () => {
    const { harness, el, http } = await visit('/pump');
    http.expectOne('/api/dashboard/').flush(SUMMARY);
    await harness.fixture.whenStable();
    expect(el.querySelector('app-pump-dashboard h1')?.textContent?.trim()).toBe('Kavali Bunk');
    expect(title()).toBe('Dashboard');
  });

  it('/pump/fill is the fill page', async () => {
    const { harness, el, http } = await visit('/pump/fill');
    http.expectOne('/api/fuel/incoming/').flush([]);
    http.expectOne((r) => r.url === '/api/fuel/pump-fills/').flush([]);
    await harness.fixture.whenStable();
    expect(el.querySelector('app-fill-page h1')?.textContent?.trim()).toBe('Fill a vehicle');
    expect(title()).toBe('Fill');
  });

  it('/pump/stock is the stock page', async () => {
    const { harness, el, http } = await visit('/pump/stock', 'POLICE');
    http.expectOne('/api/tanks/').flush([]);
    await harness.fixture.whenStable();
    expect(el.querySelector('app-stock-page h1')?.textContent?.trim()).toBe('Stock');
    expect(title()).toBe('Stock');
  });

  it('/pump/statement is the fuel statement page', async () => {
    const { harness, el, http } = await visit('/pump/statement', 'POLICE');
    http.expectOne((r) => r.url === '/api/fuel/statement/').flush(makeFuelStatement());
    http.expectOne((r) => r.url === '/api/fuel/pump-fills/').flush([]);
    await harness.fixture.whenStable();
    expect(el.querySelector('app-fuel-statement-page h1')?.textContent?.trim()).toBe(
      'Fuel statement',
    );
    expect(title()).toBe('Fuel statement');
  });
});
