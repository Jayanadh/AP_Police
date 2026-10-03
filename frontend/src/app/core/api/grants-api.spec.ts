import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Grant, GrantsApi } from './grants-api';

const GRANT: Grant = {
  id: 9,
  vehicle: 5,
  registration_number: 'AP39PA1234',
  month: '2026-10',
  litres: '20.00',
  approved_by: 'SP Nellore',
  note: 'Election duty',
  letter_url: 'http://localhost:4200/api/fuel/grants/9/letter/',
  created_by_name: 'MTO Nellore',
  created_at: '2026-10-02T10:15:00+05:30',
};

describe('GrantsApi', () => {
  let api: GrantsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(GrantsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists every grant when no filter is given', () => {
    let result: Grant[] | undefined;
    api.list().subscribe((rows) => (result = rows));
    const req = http.expectOne('/api/fuel/grants/');
    expect(req.request.method).toBe('GET');
    req.flush([GRANT]);
    expect(result?.[0].letter_url).toBe(GRANT.letter_url);
  });

  it('narrows the list by vehicle and month, leaving empty filters out', () => {
    api.list({ vehicle: 5, month: '2026-10' }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/fuel/grants/');
    expect(req.request.params.get('vehicle')).toBe('5');
    expect(req.request.params.get('month')).toBe('2026-10');
    req.flush([]);

    api.list({ vehicle: undefined, month: '' }).subscribe();
    const bare = http.expectOne((r) => r.url === '/api/fuel/grants/');
    expect(bare.request.params.keys()).toEqual([]);
    bare.flush([]);
  });

  it('sends a new grant as multipart FormData with every field and the letter file', () => {
    const letter = new File(['%PDF-1.4'], 'sp-letter.pdf', { type: 'application/pdf' });
    let created: Grant | undefined;
    api
      .create({
        vehicle: 5,
        month: '2026-10',
        litres: 20.5,
        approved_by: 'SP Nellore',
        note: 'Election duty',
        letter,
      })
      .subscribe((grant) => (created = grant));
    const req = http.expectOne('/api/fuel/grants/');
    expect(req.request.method).toBe('POST');
    const body = req.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('vehicle')).toBe('5');
    expect(body.get('month')).toBe('2026-10');
    expect(body.get('litres')).toBe('20.5');
    expect(body.get('approved_by')).toBe('SP Nellore');
    expect(body.get('note')).toBe('Election duty');
    const sent = body.get('letter') as File;
    expect(sent).toBeInstanceOf(File);
    expect(sent.name).toBe('sp-letter.pdf');
    req.flush(GRANT, { status: 201, statusText: 'Created' });
    expect(created?.id).toBe(9);
  });

  it('sends an empty note as an empty field', () => {
    const letter = new File(['x'], 'scan.png', { type: 'image/png' });
    api
      .create({ vehicle: 5, month: '2026-11', litres: 10, approved_by: 'DIG', note: '', letter })
      .subscribe();
    const req = http.expectOne('/api/fuel/grants/');
    expect((req.request.body as FormData).get('note')).toBe('');
    req.flush(GRANT, { status: 201, statusText: 'Created' });
  });

  it('builds the address of a letter from the grant id', () => {
    expect(api.letterUrl(9)).toBe('/api/fuel/grants/9/letter/');
  });
});
