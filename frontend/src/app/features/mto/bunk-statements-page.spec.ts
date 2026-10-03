import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BunkStatement, StatementPump } from '../../core/api/bunk-statement-api';
import {
  fixedClock,
  makeBunkStatement,
  makeMe,
  signInAs,
  stubFileSaving,
} from '../../core/test-data';
import { BunkStatementsPage } from './bunk-statements-page';

const PUMPS_URL = '/api/fuel/bunk-statement/pumps/';
const OCTOBER = 'from=2026-10-01&to=2026-10-31';

const pump = (overrides: Partial<StatementPump> = {}): StatementPump => ({
  id: 4,
  name: 'Kavali Bunk',
  kind: 'TIE_UP',
  kind_label: 'Tie-up bunk',
  unit: 1,
  unit_name: 'MTO Nellore',
  is_active: true,
  ...overrides,
});
const PUMPS = [
  pump(),
  pump({ id: 3, name: 'Nellore Police Pump', kind: 'POLICE', kind_label: 'Police pump' }),
  pump({ id: 9, name: 'Old Road Bunk', is_active: false }),
];

describe('BunkStatementsPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        fixedClock(() => '2026-10-15T12:00:00+05:30'),
      ],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(
    options: {
      role?: 'MTO' | 'PTO';
      pumps?: StatementPump[];
      statement?: BunkStatement | 'fail';
    } = {},
  ) {
    await signInAs(makeMe({ role: options.role ?? 'MTO' }));
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(BunkStatementsPage);
    const el = fixture.nativeElement as HTMLElement;
    const answer = async (url: string, body: unknown) => {
      const req = http.expectOne(url);
      expect(req.request.method).toBe('GET');
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body as object);
      }
      await fixture.whenStable();
    };
    await fixture.whenStable();
    if (options.role === 'PTO') {
      http.expectOne('/api/units/').flush([
        { id: 1, name: 'MTO Nellore' },
        { id: 2, name: 'Guntur MTO' },
      ]);
    }
    const pumps = options.pumps ?? PUMPS;
    await answer(PUMPS_URL, pumps);
    if (pumps.length) {
      await answer(
        `/api/fuel/bunk-statement/?${OCTOBER}&pump=${pumps[0].id}`,
        options.statement ??
          makeBunkStatement({ from: '2026-10-01', to: '2026-10-31', label: 'October 2026' }),
      );
    }
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const select = (id: string) => el.querySelector<HTMLSelectElement>(`#${id}`)!;
    const choose = async (id: string, value: string) => {
      select(id).value = value;
      select(id).dispatchEvent(new Event('change'));
      await fixture.whenStable();
    };
    const tile = (card: Element) =>
      `${text(card.querySelector('.stat-label'))} ${text(card.querySelector('.stat-value'))}`;
    return { fixture, el, http, answer, text, select, choose, tile };
  }

  it("starts on the office's first pump and this month", async () => {
    const { el, select, text } = await setup();
    expect(select('statement-pump').value).toBe('4');
    expect(text(el.querySelector('#statement-title'))).toBe('Kavali Bunk · October 2026');
  });

  it('offers every pump, a closed one marked so', async () => {
    const { select } = await setup();
    expect(Array.from(select('statement-pump').options).map((o) => o.textContent?.trim())).toEqual([
      'Kavali Bunk (Tie-up bunk)',
      'Nellore Police Pump (Police pump)',
      'Old Road Bunk (Tie-up bunk, closed)',
    ]);
  });

  it('shows the totals and every fill in the order they were made, with nothing to verify', async () => {
    const { el, text, tile } = await setup();
    const tiles = Array.from(el.querySelectorAll('.totals app-stat-card')).map(tile);
    expect(tiles).toEqual(['Fills 2', 'Petrol 25.5 L', 'Diesel 40 L', 'Total 65.5 L']);
    const rows = Array.from(el.querySelectorAll('#fills tbody tr')).map((row) =>
      Array.from(row.children).map((cell) => text(cell)),
    );
    expect(rows).toEqual([
      ['03 Sep 2026, 10:00 am', 'AP07PB2001', 'Guntur MTO', 'G. Prasad', 'Petrol', '25.5 L'],
      ['20 Sep 2026, 10:00 am', 'AP39PA1001', 'MTO Nellore', 'Ravi Kumar', 'Diesel', '40 L'],
    ]);
    const buttons = Array.from(el.querySelectorAll('button')).map((b) => text(b));
    expect(buttons).not.toContain('Verify');
    expect(buttons).not.toContain('Dispute');
  });

  it('reads the statement again for another pump', async () => {
    const { choose, answer, el, text } = await setup();
    await choose('statement-pump', '3');
    await answer(
      `/api/fuel/bunk-statement/?${OCTOBER}&pump=3`,
      makeBunkStatement({
        rows: [],
        fills: 0,
        litres: '0.00',
        petrol_litres: '0.00',
        diesel_litres: '0.00',
      }),
    );
    expect(text(el.querySelector('#fills'))).toContain('No fills at this pump in this period.');
  });

  it('reads the statement again for another period', async () => {
    const { el, fixture, answer } = await setup();
    el.querySelector<HTMLButtonElement>('button[aria-label="Previous month"]')!.click();
    await fixture.whenStable();
    await answer(
      '/api/fuel/bunk-statement/?from=2026-09-01&to=2026-09-30&pump=4',
      makeBunkStatement(),
    );
  });

  it('downloads the statement shown as Excel', async () => {
    const { el, http, fixture } = await setup();
    stubFileSaving();
    el.querySelector<HTMLButtonElement>('app-download-button button')!.click();
    await fixture.whenStable();
    http.expectOne(`/api/fuel/bunk-statement/export/?pump=4&${OCTOBER}`).flush(new Blob(['x']));
  });

  it('shows the error with a way to try again', async () => {
    const { el, text, answer } = await setup({ statement: 'fail' });
    expect(text(el.querySelector('#statement .error'))).toBe('Not available.');
    el.querySelector<HTMLButtonElement>('#statement button.retry')!.click();
    await answer(`/api/fuel/bunk-statement/?${OCTOBER}&pump=4`, makeBunkStatement());
    expect(el.querySelector('#statement .error')).toBeNull();
  });

  it('says so when the office has no pumps yet', async () => {
    const { el, text } = await setup({ pumps: [] });
    expect(text(el.querySelector('#statement'))).toContain('No pumps yet.');
    expect(el.querySelector('app-download-button')).toBeNull();
  });

  it("lets the PTO narrow the pumps to one office's", async () => {
    const { choose, answer, select } = await setup({ role: 'PTO' });
    await choose('statements-unit', '2');
    await answer(`${PUMPS_URL}?unit=2`, [pump({ id: 7, name: 'Krishna Fuel Point', unit: 2 })]);
    await answer(`/api/fuel/bunk-statement/?${OCTOBER}&pump=7`, makeBunkStatement());
    expect(select('statement-pump').value).toBe('7');
  });
});
