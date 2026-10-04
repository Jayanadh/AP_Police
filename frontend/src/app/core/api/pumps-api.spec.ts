import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  DirectoryPump,
  Pump,
  PumpPayload,
  PumpsApi,
  pumpFuels,
  pumpToPoint,
  pumpTone,
  pumpWhere,
} from './pumps-api';

const pump = (overrides: Partial<Pump> = {}): Pump => ({
  id: 3,
  name: 'Nellore Police Pump',
  kind: 'POLICE',
  kind_label: 'Police pump',
  address: 'Police Lines, Nellore',
  district: 7,
  district_name: 'Nellore',
  latitude: '14.442600',
  longitude: '79.986500',
  opening_hours: '24/7',
  sells_petrol: true,
  sells_diesel: true,
  is_active: true,
  tanks: [
    {
      id: 31,
      fuel_type: 'PETROL',
      current_stock_litres: '450.00',
      low_stock_threshold_litres: '100.00',
      capacity_litres: '1000.00',
      is_low: false,
      opening_set: true,
    },
  ],
  staff_count: 2,
  ...overrides,
});

const PAYLOAD: PumpPayload = {
  name: 'Nellore Police Pump',
  kind: 'POLICE',
  address: 'Police Lines, Nellore',
  latitude: 14.4426,
  longitude: 79.9865,
  opening_hours: '24/7',
  sells_petrol: true,
  sells_diesel: false,
};

describe('PumpsApi', () => {
  let api: PumpsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(PumpsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the pumps of the office', () => {
    let rows: Pump[] = [];
    api.list().subscribe((result) => (rows = result));
    const req = http.expectOne('/api/pumps/');
    expect(req.request.method).toBe('GET');
    req.flush([pump()]);
    expect(rows.map((row) => row.name)).toEqual(['Nellore Police Pump']);
  });

  it('reads one pump', () => {
    api.get(3).subscribe();
    const req = http.expectOne('/api/pumps/3/');
    expect(req.request.method).toBe('GET');
    req.flush(pump());
  });

  it('creates a pump with a POST of the payload', () => {
    let created: Pump | null = null;
    api.create(PAYLOAD).subscribe((result) => (created = result));
    const req = http.expectOne('/api/pumps/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(PAYLOAD);
    req.flush(pump());
    expect(created!.id).toBe(3);
  });

  it('changes a pump with a PATCH', () => {
    api.update(3, PAYLOAD).subscribe();
    const req = http.expectOne('/api/pumps/3/');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(PAYLOAD);
    req.flush(pump());
  });

  it('activates and deactivates with an empty POST', () => {
    api.activate(3).subscribe();
    const on = http.expectOne('/api/pumps/3/activate/');
    expect(on.request.method).toBe('POST');
    expect(on.request.body).toEqual({});
    on.flush(pump());

    api.deactivate(3).subscribe();
    const off = http.expectOne('/api/pumps/3/deactivate/');
    expect(off.request.method).toBe('POST');
    expect(off.request.body).toEqual({});
    off.flush(pump({ is_active: false }));
  });

  it('reads the directory of every active pump', () => {
    let rows: DirectoryPump[] = [];
    api.directory().subscribe((result) => (rows = result));
    const req = http.expectOne('/api/pump-directory/');
    expect(req.request.method).toBe('GET');
    req.flush([]);
    expect(rows).toEqual([]);
  });

  it('sends the directory search and fuel as query parameters, and leaves empty ones out', () => {
    api.directory({ search: 'nell', fuel: 'DIESEL' }).subscribe();
    const filtered = http.expectOne((r) => r.url === '/api/pump-directory/');
    expect(filtered.request.params.get('search')).toBe('nell');
    expect(filtered.request.params.get('fuel')).toBe('DIESEL');
    filtered.flush([]);

    api.directory({ search: '', fuel: undefined }).subscribe();
    http.expectOne('/api/pump-directory/').flush([]);
  });

  it('turns the string coordinates of a pump into numbers for the map', () => {
    expect(pumpToPoint(pump())).toEqual({ lat: 14.4426, lng: 79.9865 });
  });

  it('turns the string coordinates of a directory pump into numbers too', () => {
    const listed: Pick<DirectoryPump, 'latitude' | 'longitude'> = {
      latitude: '16.306700',
      longitude: '80.436500',
    };
    expect(pumpToPoint(listed)).toEqual({ lat: 16.3067, lng: 80.4365 });
  });
});

describe('pumpFuels', () => {
  it('lists the fuels a pump sells, petrol first', () => {
    expect(pumpFuels(pump())).toEqual(['PETROL', 'DIESEL']);
    expect(pumpFuels(pump({ sells_diesel: false }))).toEqual(['PETROL']);
    expect(pumpFuels(pump({ sells_petrol: false }))).toEqual(['DIESEL']);
  });

  it('is empty for a pump that sells nothing', () => {
    expect(pumpFuels(pump({ sells_petrol: false, sells_diesel: false }))).toEqual([]);
  });

  it('also reads a pump from the directory', () => {
    const listed: Pick<DirectoryPump, 'sells_petrol' | 'sells_diesel'> = {
      sells_petrol: false,
      sells_diesel: true,
    };
    expect(pumpFuels(listed)).toEqual(['DIESEL']);
  });
});

describe('pumpTone', () => {
  it('draws a police pump as police and a tie-up bunk as tie-up', () => {
    expect(pumpTone('POLICE')).toBe('police');
    expect(pumpTone('TIE_UP')).toBe('tieup');
  });

  it('takes the kind of a directory pump too', () => {
    const listed: Pick<DirectoryPump, 'kind'> = { kind: 'TIE_UP' };
    expect(pumpTone(listed.kind)).toBe('tieup');
  });
});

describe('pumpWhere', () => {
  it('adds the district when the address does not name it', () => {
    expect(pumpWhere({ address: 'NH16, Kavali', district_name: 'Nellore' })).toBe(
      'NH16, Kavali, Nellore',
    );
  });

  it('leaves the address alone when it already names the district', () => {
    expect(pumpWhere({ address: 'Police Lines, Nellore', district_name: 'nellore' })).toBe(
      'Police Lines, Nellore',
    );
  });

  it('falls back to the district when there is no address', () => {
    expect(pumpWhere({ address: '  ', district_name: 'Guntur' })).toBe('Guntur');
  });
});
