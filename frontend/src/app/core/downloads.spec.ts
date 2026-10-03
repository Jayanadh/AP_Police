import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Downloads } from './downloads';

describe('Downloads', () => {
  let saved: { href: string; name: string }[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    saved = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:file-1',
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push({ href: this.href, name: this.download });
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks for the file with the given filters and saves it under the name the server gives', () => {
    const names: string[] = [];
    TestBed.inject(Downloads)
      .save('/api/fuel/statement/export/', {
        from: '2026-09-01',
        to: '2026-09-30',
        unit: undefined,
      })
      .subscribe((name) => names.push(name));

    const request = TestBed.inject(HttpTestingController).expectOne(
      '/api/fuel/statement/export/?from=2026-09-01&to=2026-09-30',
    );
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['xlsx']), {
      headers: { 'Content-Disposition': 'attachment; filename="fuel-statement-2026-09.xlsx"' },
    });

    expect(saved).toEqual([{ href: 'blob:file-1', name: 'fuel-statement-2026-09.xlsx' }]);
    expect(names).toEqual(['fuel-statement-2026-09.xlsx']);
  });

  it('falls back to a plain name when the server gives none', () => {
    TestBed.inject(Downloads).save('/api/monitor/vehicles/export/').subscribe();

    TestBed.inject(HttpTestingController)
      .expectOne('/api/monitor/vehicles/export/')
      .flush(new Blob(['xlsx']));

    expect(saved.map((file) => file.name)).toEqual(['download.xlsx']);
  });

  it("turns the server's refusal back into its message", async () => {
    let failure: HttpErrorResponse | undefined;
    TestBed.inject(Downloads)
      .save('/api/fuel/bunk-statement/export/', { pump: 3 })
      .subscribe({ error: (err: HttpErrorResponse) => (failure = err) });

    TestBed.inject(HttpTestingController)
      .expectOne('/api/fuel/bunk-statement/export/?pump=3')
      .flush(new Blob([JSON.stringify({ detail: 'Pick a period of at most a year.' })]), {
        status: 400,
        statusText: 'Bad Request',
      });
    await vi.waitFor(() => expect(failure).toBeDefined());

    expect(failure!.status).toBe(400);
    expect(failure!.error).toEqual({ detail: 'Pick a period of at most a year.' });
    expect(saved).toEqual([]);
  });
});
