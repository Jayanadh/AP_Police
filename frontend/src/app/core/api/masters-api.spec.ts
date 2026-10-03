import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MasterItem, MastersApi } from './masters-api';

const item = (overrides: Partial<MasterItem> = {}): MasterItem => ({
  id: 1,
  name: 'Guntur',
  is_active: true,
  ...overrides,
});

describe('MastersApi', () => {
  let api: MastersApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(MastersApi);
    http = TestBed.inject(HttpTestingController);
  });

  it('lists only the active items by default, for a dropdown', () => {
    let result: MasterItem[] = [];
    api.list('districts').subscribe((rows) => (result = rows));
    const req = http.expectOne('/api/masters/districts/?active=1');
    expect(req.request.method).toBe('GET');
    req.flush([item({ id: 2, name: 'Krishna' })]);
    expect(result.map((row) => row.name)).toEqual(['Krishna']);
    http.verify();
  });

  it('lists every item, inactive ones too, when asked', () => {
    api.list('designations', false).subscribe();
    const req = http.expectOne('/api/masters/designations/');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    req.flush([]);
    http.verify();
  });

  it('adds an item by name', () => {
    let result: MasterItem | undefined;
    api.create('cadres', 'Armed Reserve').subscribe((row) => (result = row));
    const req = http.expectOne('/api/masters/cadres/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Armed Reserve' });
    req.flush(item({ id: 9, name: 'Armed Reserve' }));
    expect(result?.id).toBe(9);
    http.verify();
  });

  it('renames or deactivates an item with a PATCH', () => {
    let result: MasterItem | undefined;
    api.update('districts', 4, { is_active: false }).subscribe((row) => (result = row));
    const req = http.expectOne('/api/masters/districts/4/');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ is_active: false });
    req.flush(item({ id: 4, is_active: false }));
    expect(result?.is_active).toBe(false);
    http.verify();
  });
});
