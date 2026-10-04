import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { StockEntry, Tank, TanksApi, tankLevelPercent } from './tanks-api';

const tank = (overrides: Partial<Tank> = {}): Tank => ({
  id: 31,
  pump: 3,
  pump_name: 'Nellore Police Pump',
  fuel_type: 'PETROL',
  current_stock_litres: '450.00',
  low_stock_threshold_litres: '100.00',
  capacity_litres: '1000.00',
  is_low: false,
  opening_set: true,
  ...overrides,
});

const entry = (overrides: Partial<StockEntry> = {}): StockEntry => ({
  id: 1,
  kind: 'OPENING',
  kind_label: 'Opening stock',
  litres: '500.00',
  stock_before: '480.00',
  stock_after: '500.00',
  note: '',
  recorded_by_name: 'Pump Operator',
  recorded_at: '2026-10-02T06:30:00+05:30',
  ...overrides,
});

describe('TanksApi', () => {
  let api: TanksApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(TanksApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the tanks', () => {
    let rows: Tank[] = [];
    api.list().subscribe((result) => (rows = result));
    const req = http.expectOne('/api/tanks/');
    expect(req.request.method).toBe('GET');
    req.flush([tank()]);
    expect(rows.map((row) => row.id)).toEqual([31]);
  });

  it('reads one tank', () => {
    api.get(31).subscribe();
    const req = http.expectOne('/api/tanks/31/');
    expect(req.request.method).toBe('GET');
    req.flush(tank());
  });

  it('changes the alert level and capacity with a PATCH', () => {
    let saved: Tank | null = null;
    api
      .update(31, { low_stock_threshold_litres: 150, capacity_litres: null })
      .subscribe((t) => (saved = t));
    const req = http.expectOne('/api/tanks/31/');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ low_stock_threshold_litres: 150, capacity_litres: null });
    req.flush(tank({ low_stock_threshold_litres: '150.00', capacity_litres: null }));
    expect(saved!.low_stock_threshold_litres).toBe('150.00');
  });

  it('posts the opening stock with its note', () => {
    api.setOpening(31, 500, 'Dip stick').subscribe();
    const req = http.expectOne('/api/tanks/31/opening/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ litres: 500, note: 'Dip stick' });
    req.flush(tank());
  });

  it('posts a tanker receipt with its note', () => {
    api.receive(31, 1200, 'Tanker AP39X').subscribe();
    const req = http.expectOne('/api/tanks/31/receive/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ litres: 1200, note: 'Tanker AP39X' });
    req.flush(tank());
  });

  it('reads the stock entries of one month', () => {
    let rows: StockEntry[] = [];
    api.entries(31, '2026-10').subscribe((result) => (rows = result));
    const req = http.expectOne('/api/tanks/31/entries/?month=2026-10');
    expect(req.request.method).toBe('GET');
    req.flush([entry()]);
    expect(rows[0].kind_label).toBe('Opening stock');
  });

  describe('tankLevelPercent', () => {
    it('is the stock as a share of the capacity', () => {
      expect(tankLevelPercent(tank({ current_stock_litres: '250.00' }))).toBe(25);
    });

    it('never goes past 100 or below 0', () => {
      expect(tankLevelPercent(tank({ current_stock_litres: '1500.00' }))).toBe(100);
      expect(tankLevelPercent(tank({ current_stock_litres: '-5.00' }))).toBe(0);
    });

    it('measures against ten times the alert level when no capacity is set', () => {
      const open = tank({ capacity_litres: null, low_stock_threshold_litres: '100.00' });
      expect(tankLevelPercent({ ...open, current_stock_litres: '100.00' })).toBe(10);
      expect(tankLevelPercent({ ...open, current_stock_litres: '500.00' })).toBe(50);
      expect(tankLevelPercent({ ...open, current_stock_litres: '1500.00' })).toBe(100);
    });

    it('is full for any stock when neither a capacity nor an alert level is set', () => {
      const bare = tank({ capacity_litres: null, low_stock_threshold_litres: '0.00' });
      expect(tankLevelPercent({ ...bare, current_stock_litres: '5.00' })).toBe(100);
      expect(tankLevelPercent({ ...bare, current_stock_litres: '0.00' })).toBe(0);
    });
  });

  it('reads the stock entries of a period', () => {
    api.entriesIn(31, { from: '2026-04-01', to: '2027-03-31' }).subscribe();
    const req = http.expectOne('/api/tanks/31/entries/?from=2026-04-01&to=2027-03-31');
    expect(req.request.method).toBe('GET');
    req.flush([entry()]);
  });
});
