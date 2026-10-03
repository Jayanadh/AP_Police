import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HandoverPayload, Unit, UnitCreatePayload, UnitsApi } from './units-api';

const unit = (overrides: Partial<Unit> = {}): Unit => ({
  id: 3,
  name: 'MTO Vijayawada',
  code: 'VJA',
  district: 1,
  district_name: 'NTR',
  address: 'Benz Circle',
  phone: '0866 2470000',
  mto: {
    id: 7,
    username: 'mto.vijayawada',
    full_name: 'Ravi Kumar',
    emp_id: 'AP1001',
    mobile: '9876543210',
  },
  ...overrides,
});

describe('UnitsApi', () => {
  let api: UnitsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(UnitsApi);
    http = TestBed.inject(HttpTestingController);
  });

  it('lists the offices', () => {
    let result: Unit[] = [];
    api.list().subscribe((rows) => (result = rows));
    const req = http.expectOne('/api/units/');
    expect(req.request.method).toBe('GET');
    req.flush([unit(), unit({ id: 4, name: 'MTO Guntur', mto: null })]);
    expect(result.map((row) => row.name)).toEqual(['MTO Vijayawada', 'MTO Guntur']);
    expect(result[1].mto).toBeNull();
    http.verify();
  });

  it('creates an office together with its MTO login', () => {
    const payload: UnitCreatePayload = {
      name: 'MTO Nellore',
      code: 'NLR',
      district: 5,
      address: 'Stonehousepet',
      phone: '',
      mto_account: {
        username: 'mto.nellore',
        password: 'First-pass-2026',
        full_name: 'Suresh Reddy',
        emp_id: 'AP2001',
        designation: 2,
        cadre: 3,
        mobile: '9000000001',
      },
    };
    let result: Unit | undefined;
    api.create(payload).subscribe((row) => (result = row));
    const req = http.expectOne('/api/units/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush(unit({ id: 8, name: 'MTO Nellore' }));
    expect(result?.id).toBe(8);
    http.verify();
  });

  it('changes the details of an office with a PATCH', () => {
    let result: Unit | undefined;
    api.update(3, { phone: '0866 2470001' }).subscribe((row) => (result = row));
    const req = http.expectOne('/api/units/3/');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ phone: '0866 2470001' });
    req.flush(unit({ phone: '0866 2470001' }));
    expect(result?.phone).toBe('0866 2470001');
    http.verify();
  });

  it('hands the chair over to a new holder', () => {
    const payload: HandoverPayload = {
      full_name: 'Anil Kumar',
      emp_id: 'AP3003',
      designation: 2,
      cadre: 3,
      mobile: '9000000002',
      password: 'Second-pass-2026',
    };
    let result: Unit | undefined;
    api.handover(3, payload).subscribe((row) => (result = row));
    const req = http.expectOne('/api/units/3/handover/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush(unit({ mto: { ...unit().mto!, full_name: 'Anil Kumar' } }));
    expect(result?.mto?.full_name).toBe('Anil Kumar');
    http.verify();
  });
});
