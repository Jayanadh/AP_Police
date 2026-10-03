import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PtoDashboard, PtoUnitSummary } from '../../core/api/dashboard-api';
import { PtoDashboardPage } from './pto-dashboard';

const URL = '/api/dashboard/';

const office = (overrides: Partial<PtoUnitSummary> = {}): PtoUnitSummary => ({
  id: 3,
  name: 'MTO Vijayawada',
  code: 'VJA',
  vehicles_active: 9,
  vehicles_paused: 2,
  fuel_used_litres: '1000.00',
  fuel_limit_litres: '4000.00',
  low_stock_tanks: 1,
  pending_emergencies: 0,
  ...overrides,
});

const dashboard = (overrides: Partial<PtoDashboard> = {}): PtoDashboard => ({
  role: 'PTO',
  month: '2026-10',
  units: [
    office(),
    office({
      id: 4,
      name: 'MTO Guntur',
      code: 'GNT',
      vehicles_active: 5,
      vehicles_paused: 0,
      fuel_used_litres: '1500.50',
      fuel_limit_litres: '2000.00',
      low_stock_tanks: 1,
      pending_emergencies: 3,
    }),
  ],
  pending_approvals: 3,
  totals: {
    vehicles_active: 14,
    fuel_used_litres: '2500.50',
    fuel_limit_litres: '6000.00',
    low_stock_tanks: 2,
  },
  ...overrides,
});

describe('PtoDashboardPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(data: PtoDashboard | 'fail' = dashboard()) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PtoDashboardPage);
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('GET');
    if (data === 'fail') {
      req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
    } else {
      req.flush(data);
    }
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const text = (node: Element) => node.textContent?.replace(/\s+/g, ' ').trim();
    const rows = () =>
      Array.from(el.querySelectorAll('tbody tr')).map((row) =>
        Array.from(row.children).map((cell) => text(cell)),
      );
    const cards = () => Array.from(el.querySelectorAll('.office-card'));
    return { fixture, el, http, text, rows, cards };
  }

  it('shows the month and the four headline figures', async () => {
    const { el, text } = await setup();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Dashboard');
    expect(el.querySelector('.muted')?.textContent).toContain('October 2026');
    const stats = Array.from(el.querySelectorAll('app-stat-card')).map((card) => [
      text(card.querySelector('.stat-label')!),
      text(card.querySelector('.stat-value')!),
    ]);
    expect(stats).toEqual([
      ['Active vehicles', '14'],
      ['Fuel used this month', '2,500.5 L of 6,000 L'],
      ['Low-stock tanks', '2'],
      ['Pending approvals', '3'],
    ]);
  });

  it('links the pending approvals figure to the approvals page', async () => {
    const { el } = await setup();
    const link = el.querySelector('a.stat-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/pto/approvals');
    expect(link.textContent).toContain('Pending approvals');
  });

  it('lists every office in the table with its figures', async () => {
    const { rows } = await setup();
    expect(rows()).toEqual([
      ['MTO Vijayawada VJA', '9 active · 2 paused', '1,000 L / 4,000 L', '1', '0'],
      ['MTO Guntur GNT', '5 active · 0 paused', '1,500.5 L / 2,000 L', '1', '3'],
    ]);
  });

  it('draws a progress bar for each office, warning near the limit', async () => {
    const { el } = await setup(
      dashboard({
        units: [
          office({ id: 1, name: 'Low', fuel_used_litres: '1000.00', fuel_limit_litres: '4000.00' }),
          office({
            id: 2,
            name: 'Near',
            fuel_used_litres: '3400.00',
            fuel_limit_litres: '4000.00',
          }),
          office({
            id: 3,
            name: 'Over',
            fuel_used_litres: '4200.00',
            fuel_limit_litres: '4000.00',
          }),
          office({ id: 4, name: 'None', fuel_used_litres: '0.00', fuel_limit_litres: '0.00' }),
        ],
      }),
    );
    const bars = Array.from(el.querySelectorAll('table .progress'));
    expect(bars.map((bar) => bar.getAttribute('aria-valuenow'))).toEqual(['25', '85', '100', '0']);
    expect(bars.map((bar) => bar.classList.contains('warning'))).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(bars.map((bar) => bar.classList.contains('danger'))).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect((bars[0].firstElementChild as HTMLElement).style.width).toBe('25%');
    expect(bars[0].getAttribute('aria-label')).toBe('Fuel used this month by Low');
  });

  it('repeats each office as a stacked card for phones', async () => {
    const { cards, text } = await setup();
    expect(cards()).toHaveLength(2);
    const first = cards()[0];
    expect(text(first.querySelector('h3')!)).toBe('MTO Vijayawada');
    const figures = Array.from(first.querySelectorAll('.figure')).map((row) => [
      text(row.children[0]),
      text(row.children[1]),
    ]);
    expect(figures).toEqual([
      ['Vehicles', '9 active · 2 paused'],
      ['Fuel this month', '1,000 L / 4,000 L'],
      ['Low-stock tanks', '1'],
      ['Pending emergencies', '0'],
    ]);
    expect(first.querySelector('.progress')?.getAttribute('aria-valuenow')).toBe('25');
  });

  it('puts the table in a scrolling wrapper', async () => {
    const { el } = await setup();
    expect(el.querySelector('.table-wrap > table.table')).not.toBeNull();
  });

  it('says so when there are no offices yet', async () => {
    const { el, cards } = await setup(dashboard({ units: [] }));
    expect(el.querySelector('app-empty-state')?.textContent).toContain('No MTO offices yet');
    expect(el.querySelector('table')).toBeNull();
    expect(cards()).toHaveLength(0);
  });

  it('shows the error and retries on request', async () => {
    const { fixture, el, http, rows } = await setup('fail');
    expect(el.querySelector('.error')?.textContent?.trim()).toBe('Not available.');
    (el.querySelector('button.retry') as HTMLButtonElement).click();
    http.expectOne(URL).flush(dashboard());
    await fixture.whenStable();
    expect(el.querySelector('.error')).toBeNull();
    expect(rows()).toHaveLength(2);
  });
});
