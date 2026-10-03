import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { makeFuelStatement } from '../test-data';
import { FuelStatement, FuelStatementApi } from './fuel-statement-api';

describe('FuelStatementApi', () => {
  let api: FuelStatementApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(FuelStatementApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the statement of a period', () => {
    let result: FuelStatement | undefined;
    api.get({ from: '2026-09-28', to: '2026-10-04' }).subscribe((row) => (result = row));
    const req = http.expectOne((r) => r.url === '/api/fuel/statement/');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('from')).toBe('2026-09-28');
    expect(req.request.params.get('to')).toBe('2026-10-04');
    expect(req.request.params.has('unit')).toBe(false);
    req.flush(makeFuelStatement());
    expect(result?.litres).toBe('60.00');
  });

  it('narrows the PTO’s statement to one office', () => {
    api.get({ from: '2026-10-01', to: '2026-10-31' }, 4).subscribe();
    const req = http.expectOne((r) => r.url === '/api/fuel/statement/');
    expect(req.request.params.get('unit')).toBe('4');
    req.flush(makeFuelStatement());
  });
});
