import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DashboardApi, MtoDashboard, PtoDashboard } from './dashboard-api';

describe('DashboardApi', () => {
  let api: DashboardApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(DashboardApi);
    http = TestBed.inject(HttpTestingController);
  });

  it("reads the signed-in role's own dashboard", () => {
    let result: PtoDashboard | undefined;
    api.get<PtoDashboard>().subscribe((value) => (result = value));
    const req = http.expectOne('/api/dashboard/');
    expect(req.request.method).toBe('GET');
    req.flush({
      role: 'PTO',
      month: '2026-10',
      units: [],
      pending_approvals: 2,
      totals: {
        vehicles_active: 0,
        fuel_used_litres: '0.00',
        fuel_limit_litres: '0.00',
        low_stock_tanks: 0,
      },
    });
    expect(result?.pending_approvals).toBe(2);
    expect(result?.month).toBe('2026-10');
    http.verify();
  });

  it("types the other roles' payloads from the same call", () => {
    let result: MtoDashboard | undefined;
    api.get<MtoDashboard>().subscribe((value) => (result = value));
    http.expectOne('/api/dashboard/').flush({
      role: 'MTO',
      month: '2026-10',
      vehicles: { active: 4, paused: 1, termination_pending: 0 },
      fuel: { used_litres: '120.00', limit_litres: '600.00' },
      top_vehicles: [],
      tanks: [],
      pending_emergencies: 1,
      overdue_duty: 0,
      missing_odometer: 2,
      services_due: 0,
      transfers_to_decide: 1,
    });
    expect(result?.vehicles.active).toBe(4);
    expect(result?.transfers_to_decide).toBe(1);
    http.verify();
  });
});
