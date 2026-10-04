import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardTank, PumpDashboard as PumpSummary } from '../../core/api/dashboard-api';
import { PumpKind } from '../../core/auth-store';
import { makeMe, signInAs } from '../../core/test-data';
import { PumpDashboard } from './pump-dashboard';

const tank = (overrides: Partial<DashboardTank> = {}): DashboardTank => ({
  id: 2,
  pump_name: 'Nellore Police Pump',
  fuel_type: 'DIESEL',
  current_stock_litres: '640.00',
  low_stock_threshold_litres: '100.00',
  capacity_litres: '5000.00',
  is_low: false,
  ...overrides,
});
const PETROL = tank({
  id: 1,
  fuel_type: 'PETROL',
  current_stock_litres: '80.00',
  is_low: true,
  capacity_litres: null,
});
const DIESEL = tank();

const POLICE_SUMMARY: PumpSummary = {
  role: 'PUMP_OPERATOR',
  month: '2026-10',
  pump: { id: 3, name: 'Nellore Police Pump', kind: 'POLICE' },
  tanks: [PETROL, DIESEL],
  waiting: 2,
  today_fills: { count: 4, litres: '96.50' },
};

const TIE_UP_SUMMARY: PumpSummary = {
  ...POLICE_SUMMARY,
  pump: { id: 4, name: 'Kavali Bunk', kind: 'TIE_UP' },
  tanks: [],
};

describe('PumpDashboard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(options: { kind?: PumpKind; summary?: PumpSummary | 'fail' } = {}) {
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

  it('has a big amber button to fill a vehicle, under the three figures', async () => {
    const { el, text } = await setup({ kind: 'TIE_UP' });
    const button = el.querySelector<HTMLAnchorElement>('a.fill-button')!;
    expect(text(button)).toBe('Fill a vehicle');
    expect(button.classList.contains('btn-primary')).toBe(true);
    expect(button.getAttribute('href')).toBe('/pump/fill');
    const figures = el.querySelector('.today')!;
    expect(figures.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

    it('asks for no morning stock: receipts and fills keep the stock', async () => {
      const { el } = await setup();
      expect(el.querySelector('#measure-warning')).toBeNull();
      expect(el.textContent).not.toContain('morning');
    });

    it('says so when the pump has no tanks yet', async () => {
      const { el, text } = await setup({ summary: { ...POLICE_SUMMARY, tanks: [] } });
      expect(text(el.querySelector('#tanks-card'))).toContain('No tanks');
    });
  });

  describe('a tie-up bunk', () => {
    it('shows no month’s litres: every fill is in the fuel statement', async () => {
      const { el } = await setup({ kind: 'TIE_UP' });
      expect(el.querySelector('#month-card')).toBeNull();
      expect(el.textContent).not.toContain('This month');
    });

    it('does not show tanks', async () => {
      const { el } = await setup({ kind: 'TIE_UP' });
      expect(el.querySelector('#tanks-card')).toBeNull();
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
