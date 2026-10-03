import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Quota, QuotaApi } from './quota-api';

const QUOTA: Quota = {
  month: '2026-10',
  base_litres: '120.00',
  additional_litres: '30.00',
  limit_litres: '150.00',
  used_litres: '90.00',
  remaining_litres: '60.00',
  emergency_used_litres: '0.00',
  emergency_remaining_litres: '10.00',
  additional_balance_litres: '30.00',
};

describe('QuotaApi', () => {
  let api: QuotaApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(QuotaApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the quota of this month when no month is given', () => {
    let result: Quota | undefined;
    api.forVehicle(5).subscribe((row) => (result = row));
    const req = http.expectOne('/api/fuel/vehicles/5/quota/');
    expect(req.request.method).toBe('GET');
    req.flush(QUOTA);
    expect(result?.remaining_litres).toBe('60.00');
  });

  it('asks for a given month', () => {
    api.forVehicle(5, '2026-09').subscribe();
    const req = http.expectOne((r) => r.url === '/api/fuel/vehicles/5/quota/');
    expect(req.request.params.get('month')).toBe('2026-09');
    req.flush(QUOTA);
  });
});
