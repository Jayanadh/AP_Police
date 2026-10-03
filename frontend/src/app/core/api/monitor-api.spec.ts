import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MonitorApi, MonitorPage, MonitorVehicle } from './monitor-api';

const EMPTY = { count: 0, page: 1, pages: 1, page_size: 50, results: [] };

describe('MonitorApi', () => {
  let api: MonitorApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(MonitorApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads a page of every office’s vehicles with the filters it is given', () => {
    let result: MonitorPage<MonitorVehicle> | undefined;
    api
      .vehicles({ unit: 2, status: 'PAUSED', search: 'AP39', page: 3 })
      .subscribe((page) => (result = page));
    const req = http.expectOne((r) => r.url === '/api/monitor/vehicles/');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('unit')).toBe('2');
    expect(req.request.params.get('status')).toBe('PAUSED');
    expect(req.request.params.get('search')).toBe('AP39');
    expect(req.request.params.get('page')).toBe('3');
    req.flush(EMPTY);
    expect(result?.pages).toBe(1);
  });

  it('leaves empty filters and the first page out', () => {
    api.vehicles({ unit: undefined, status: '', search: '  ', page: 1 }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/monitor/vehicles/');
    expect(req.request.params.keys()).toEqual([]);
    req.flush(EMPTY);
  });

  it('reads officers and drivers from their own lists', () => {
    api.people('officers', { search: 'Rao' }).subscribe();
    const officers = http.expectOne((r) => r.url === '/api/monitor/officers/');
    expect(officers.request.params.get('search')).toBe('Rao');
    officers.flush(EMPTY);

    api.people('drivers').subscribe();
    http.expectOne('/api/monitor/drivers/').flush(EMPTY);
  });
});
