import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BunkStatementApi } from './bunk-statement-api';

describe('BunkStatementApi', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it("reads one pump's fills for a period", () => {
    TestBed.inject(BunkStatementApi).get({ from: '2026-09-01', to: '2026-09-30' }, 4).subscribe();

    TestBed.inject(HttpTestingController)
      .expectOne('/api/fuel/bunk-statement/?from=2026-09-01&to=2026-09-30&pump=4')
      .flush({});
  });

  it('leaves the pump out for pump staff, who get their own', () => {
    TestBed.inject(BunkStatementApi).get({ from: '2026-10-01', to: '2026-10-03' }).subscribe();

    TestBed.inject(HttpTestingController)
      .expectOne('/api/fuel/bunk-statement/?from=2026-10-01&to=2026-10-03')
      .flush({});
  });

  it('lists the pumps a statement can be drawn up for, for one office when given', () => {
    const api = TestBed.inject(BunkStatementApi);
    const http = TestBed.inject(HttpTestingController);
    api.pumps().subscribe();
    http.expectOne('/api/fuel/bunk-statement/pumps/').flush([]);
    api.pumps(2).subscribe();
    http.expectOne('/api/fuel/bunk-statement/pumps/?unit=2').flush([]);
  });
});
