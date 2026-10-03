import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PumpDashboard as PumpSummary } from '../../core/api/dashboard-api';
import { Tank } from '../../core/api/tanks-api';
import { PumpKind } from '../../core/auth-store';
import { fixedClock, makeMe, makeTank, signInAs } from '../../core/test-data';
import { PumpDashboard } from './pump-dashboard';

// The page reads "today" from the clock, so the specs fix it: noon on 15 Oct 2026, Kolkata time.
const NOON = '2026-10-15T12:00:00+05:30';
let now = NOON;

const MEASURED_TODAY = '2026-10-15T07:10:00+05:30';
const MEASURED_YESTERDAY = '2026-10-14T07:10:00+05:30';
const MEASURED_LAST_WEEK = '2026-10-09T07:10:00+05:30';

const POLICE_SUMMARY: PumpSummary = {
  role: 'PUMP_OPERATOR',
  month: '2026-10',
  pump: { id: 3, name: 'Nellore Police Pump', kind: 'POLICE' },
  tanks: [],
  waiting: 2,
  today_fills: { count: 4, litres: '96.50' },
  month_fills: { petrol_litres: '310.00', diesel_litres: '1200.50' },
};

const TIE_UP_SUMMARY: PumpSummary = {
  ...POLICE_SUMMARY,
  pump: { id: 4, name: 'Kavali Bunk', kind: 'TIE_UP' },
};

const PETROL = makeTank({
  id: 1,
  fuel_type: 'PETROL',
  current_stock_litres: '80.00',
  is_low: true,
  capacity_litres: null,
  last_measured_at: MEASURED_TODAY,
});
const DIESEL = makeTank({ id: 2, last_measured_at: MEASURED_TODAY });

describe('PumpDashboard', () => {
  beforeEach(() => {
    now = NOON;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        fixedClock(() => now),
      ],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(
    options: { kind?: PumpKind; tanks?: Tank[] | 'fail'; summary?: PumpSummary | 'fail' } = {},
  ) {
    const kind = options.kind ?? 'POLICE';
    const summary = options.summary ?? (kind === 'POLICE' ? POLICE_SUMMARY : TIE_UP_SUMMARY);
    await signInAs(
      makeMe({
        role: 'PUMP_OPERATOR',
        full_name: 'Suresh Kumar',
        pump: kind === 'POLICE' ? 3 : 4,
        pump_name: kind === 'POLICE' ? 'Nellore Police Pump' : 'Kavali Bunk',
        pump_kind: kind,
      }),
    );
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PumpDashboard);
    const el = fixture.nativeElement as HTMLElement;
    const answer = async (url: string, body: object | 'fail') => {
      const req = http.expectOne(url);
      expect(req.request.method).toBe('GET');
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
    };
    await fixture.whenStable();
    await answer('/api/dashboard/', summary);
    if (kind === 'POLICE') {
      await answer('/api/tanks/', options.tanks ?? [PETROL, DIESEL]);
    }
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    /** "Fills today 4": a stat card's label and its value. */
    const tile = (card: Element) =>
      `${text(card.querySelector('.stat-label'))} ${text(card.querySelector('.stat-value'))}`;
    return { fixture, el, http, answer, text, tile };
  }

  it('shows the pump name and what kind of pump it is', async () => {
    const { el, text } = await setup();
    expect(text(el.querySelector('h1'))).toBe('Nellore Police Pump');
    expect(text(el.querySelector('.kind-badge'))).toBe('Police pump');
  });

  it('calls a tie-up pump a tie-up bunk', async () => {
    const { el, text } = await setup({ kind: 'TIE_UP' });
    expect(text(el.querySelector('h1'))).toBe('Kavali Bunk');
    expect(text(el.querySelector('.kind-badge'))).toBe('Tie-up bunk');
  });

  it('shows today’s fills: how many and how many litres', async () => {
    const { el, tile } = await setup();
    const tiles = Array.from(el.querySelectorAll('.today app-stat-card')).map(tile);
    expect(tiles).toEqual(['Waiting to fill 2', 'Fills today 4', 'Litres today 96.5 L']);
  });

  it('has a big amber button to fill a vehicle', async () => {
    const { el, text } = await setup();
    const button = el.querySelector<HTMLAnchorElement>('a.fill-button')!;
    expect(text(button)).toBe('Fill a vehicle');
    expect(button.classList.contains('btn-primary')).toBe(true);
    expect(button.getAttribute('href')).toBe('/pump/fill');
  });

  describe('a police pump', () => {
    it('shows a card for each tank with its level and a Low badge', async () => {
      const { el, text } = await setup();
      const tanks = Array.from(el.querySelectorAll('#tanks-card app-tank-level'));
      expect(tanks.map((tank) => text(tank.querySelector('.fuel')))).toEqual(['Petrol', 'Diesel']);
      expect(text(tanks[0].querySelector('.badge-danger'))).toBe('Low');
      expect(tanks[1].querySelector('.badge')).toBeNull();
      expect(text(tanks[1].querySelector('.figure'))).toBe('640 L');
      expect(tanks[1].querySelector('[role="meter"]')).not.toBeNull();
    });

    it('does not show the month’s litres', async () => {
      const { el } = await setup();
      expect(el.querySelector('#month-card')).toBeNull();
    });

    it('warns to record this morning’s stock when a tank was not measured today', async () => {
      const { el, text } = await setup({
        tanks: [PETROL, makeTank({ id: 2, last_measured_at: MEASURED_YESTERDAY })],
      });
      const warning = el.querySelector('#measure-warning')!;
      expect(text(warning.querySelector('h2'))).toBe("Record this morning's stock");
      expect(text(warning)).toContain('Diesel');
      expect(text(warning)).not.toContain('Petrol');
      expect(warning.querySelector('a')?.getAttribute('href')).toBe('/pump/stock');
    });

    it('warns when a tank has never been measured', async () => {
      const { el, text } = await setup({
        tanks: [makeTank({ id: 1, fuel_type: 'PETROL', last_measured_at: null })],
      });
      expect(text(el.querySelector('#measure-warning'))).toContain('Petrol');
    });

    it('names both fuels when neither was measured today', async () => {
      const { el, text } = await setup({
        tanks: [
          makeTank({ id: 1, fuel_type: 'PETROL', last_measured_at: null }),
          makeTank({ id: 2, last_measured_at: MEASURED_LAST_WEEK }),
        ],
      });
      expect(text(el.querySelector('#measure-warning'))).toContain('Petrol and Diesel');
    });

    it('counts a measurement just after midnight as today and one just before as yesterday', async () => {
      now = '2026-10-15T00:30:00+05:30';
      const { el, text } = await setup({
        tanks: [
          makeTank({ id: 1, fuel_type: 'PETROL', last_measured_at: '2026-10-15T00:10:00+05:30' }),
          makeTank({ id: 2, last_measured_at: '2026-10-14T23:50:00+05:30' }),
        ],
      });
      const warning = el.querySelector('#measure-warning')!;
      expect(text(warning)).toContain('Diesel');
      expect(text(warning)).not.toContain('Petrol');
    });

    it('shows no warning once every tank was measured today', async () => {
      const { el } = await setup();
      expect(el.querySelector('#measure-warning')).toBeNull();
    });

    it('says so when the pump has no tanks yet', async () => {
      const { el, text } = await setup({ tanks: [] });
      expect(text(el.querySelector('#tanks-card'))).toContain('No tanks');
      expect(el.querySelector('#measure-warning')).toBeNull();
    });

    it('keeps the rest of the page when the tanks cannot be read, and retries them', async () => {
      const { el, text, answer } = await setup({ tanks: 'fail' });
      expect(text(el.querySelector('.today'))).toContain('Fills today');
      expect(text(el.querySelector('#tanks-card .error'))).toBe('Not available.');
      el.querySelector<HTMLButtonElement>('#tanks-card button')!.click();
      await answer('/api/tanks/', [DIESEL]);
      expect(el.querySelector('#tanks-card .error')).toBeNull();
      expect(el.querySelectorAll('#tanks-card app-tank-level').length).toBe(1);
    });
  });

  describe('a tie-up bunk', () => {
    it('shows this month’s litres, petrol and diesel', async () => {
      const { el, tile } = await setup({ kind: 'TIE_UP' });
      const tiles = Array.from(el.querySelectorAll('#month-card app-stat-card')).map(tile);
      expect(tiles).toEqual(['Petrol 310 L', 'Diesel 1,200.5 L']);
    });

    it('links the month to the fuel statement, where every fill is listed', async () => {
      const { el } = await setup({ kind: 'TIE_UP' });
      expect(el.querySelector('#month-card a.btn')?.getAttribute('href')).toBe('/pump/statement');
    });

    it('does not show tanks or the stock warning', async () => {
      const { el } = await setup({ kind: 'TIE_UP' });
      expect(el.querySelector('#tanks-card')).toBeNull();
      expect(el.querySelector('#measure-warning')).toBeNull();
    });
  });

  it('shows the error with a way to try again when the dashboard cannot be read', async () => {
    const { el, text, answer } = await setup({ summary: 'fail', kind: 'TIE_UP' });
    expect(text(el.querySelector('.error'))).toBe('Not available.');
    el.querySelector<HTMLButtonElement>('.card button')!.click();
    await answer('/api/dashboard/', TIE_UP_SUMMARY);
    expect(el.querySelector('.error')).toBeNull();
    expect(text(el.querySelector('.today'))).toContain('Fills today');
  });
});
