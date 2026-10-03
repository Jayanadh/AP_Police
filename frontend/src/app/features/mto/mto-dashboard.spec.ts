import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MtoDashboard as MtoSummary } from '../../core/api/dashboard-api';
import { makeMe, signInAs } from '../../core/test-data';
import { MtoDashboard } from './mto-dashboard';

const DASHBOARD_URL = '/api/dashboard/';

const summary = (overrides: Partial<MtoSummary> = {}): MtoSummary => ({
  role: 'MTO',
  month: '2026-10',
  vehicles: { active: 12, paused: 2, termination_pending: 1 },
  fuel: { used_litres: '640.50', limit_litres: '1500.00' },
  top_vehicles: [
    {
      id: 5,
      registration_number: 'AP39PA1234',
      used_litres: '110.00',
      limit_litres: '120.00',
    },
    {
      id: 6,
      registration_number: 'AP39PB5678',
      used_litres: '45.50',
      limit_litres: '90.00',
    },
  ],
  tanks: [
    {
      id: 1,
      pump_name: 'Nellore Police Pump',
      fuel_type: 'PETROL',
      current_stock_litres: '80.00',
      low_stock_threshold_litres: '100.00',
      capacity_litres: null,
      is_low: true,
    },
    {
      id: 2,
      pump_name: 'Nellore Police Pump',
      fuel_type: 'DIESEL',
      current_stock_litres: '640.00',
      low_stock_threshold_litres: '100.00',
      capacity_litres: '5000.00',
      is_low: false,
    },
  ],
  pending_emergencies: 3,
  overdue_duty: 2,
  missing_odometer: 4,
  services_due: 1,
  transfers_to_decide: 5,
  ...overrides,
});

describe('MtoDashboard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(body: MtoSummary | 'fail' = summary()) {
    await signInAs(makeMe({ full_name: 'Ravi Kumar', unit_name: 'MTO Vijayawada' }));
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MtoDashboard);
    const el = fixture.nativeElement as HTMLElement;
    const answer = async (response: MtoSummary | 'fail') => {
      const req = http.expectOne(DASHBOARD_URL);
      expect(req.request.method).toBe('GET');
      if (response === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(response);
      }
      await fixture.whenStable();
    };
    await answer(body);
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const tile = (label: string) =>
      Array.from(el.querySelectorAll<HTMLAnchorElement>('a.stat-link')).find((a) =>
        text(a)?.startsWith(label),
      )!;
    const card = (id: string) => el.querySelector<HTMLElement>(`#${id}`)!;
    return { fixture, el, http, text, tile, card, answer };
  }

  it('greets the chair with the office name', async () => {
    const { el, text } = await setup();
    expect(text(el.querySelector('h1'))).toBe('Welcome, Ravi Kumar');
    expect(text(el.querySelector('app-page-header'))).toContain('MTO Vijayawada');
    expect(text(el.querySelector('app-page-header'))).toContain('October 2026');
  });

  it('shows each count as a tile that links to its page', async () => {
    const { tile, text } = await setup();
    const expected: [string, string, string][] = [
      ['Pending emergencies', '3', '/mto/emergencies'],
      ['Overdue duty particulars', '2', '/mto/fuel'],
      ['Missing odometer', '4', '/mto/odometer'],
      ['Services due', '1', '/mto/servicing'],
      ['Transfers to decide', '5', '/mto/transfers'],
    ];
    for (const [label, count, link] of expected) {
      const anchor = tile(label);
      expect(anchor, label).toBeTruthy();
      expect(text(anchor.querySelector('.stat-label'))).toBe(label);
      expect(text(anchor.querySelector('.stat-value'))).toBe(count);
      expect(anchor.getAttribute('href')).toBe(link);
    }
  });

  it('turns a tile amber or red when there is something to do, and leaves it calm at zero', async () => {
    const { tile } = await setup();
    expect(tile('Pending emergencies').querySelector('.stat-danger')).not.toBeNull();
    expect(tile('Overdue duty particulars').querySelector('.stat-danger')).not.toBeNull();
    expect(tile('Missing odometer').querySelector('.stat-warning')).not.toBeNull();
    expect(tile('Services due').querySelector('.stat-warning')).not.toBeNull();
    expect(tile('Transfers to decide').querySelector('.stat-warning')).not.toBeNull();
  });

  it('keeps every tile calm when nothing is waiting', async () => {
    const { el } = await setup(
      summary({
        pending_emergencies: 0,
        overdue_duty: 0,
        missing_odometer: 0,
        services_due: 0,
        transfers_to_decide: 0,
      }),
    );
    expect(el.querySelectorAll('a.stat-link .stat-default').length).toBe(5);
    expect(el.querySelector('a.stat-link .stat-warning, a.stat-link .stat-danger')).toBeNull();
  });

  it('shows this month’s fuel against the limit with a bar', async () => {
    const { card, text } = await setup();
    const fuel = card('fuel-card');
    expect(text(fuel.querySelector('h2'))).toBe('Fuel this month');
    expect(text(fuel)).toContain('640.5 L of 1,500 L');
    const bar = fuel.querySelector<HTMLElement>('.fuel-total [role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('43');
    expect(bar.querySelector<HTMLElement>('span')!.style.width).toBe('43%');
    expect(bar.classList.contains('warning')).toBe(false);
    expect(bar.classList.contains('danger')).toBe(false);
  });

  it('turns the fuel bar amber from 80% of the limit and red at the limit', async () => {
    const amber = await setup(
      summary({ fuel: { used_litres: '1250.00', limit_litres: '1500.00' } }),
    );
    expect(
      amber.card('fuel-card').querySelector('.fuel-total .progress')!.classList.contains('warning'),
    ).toBe(true);
  });

  it('caps the bar at 100% and shows a red bar when the limit is passed', async () => {
    const { card } = await setup(
      summary({ fuel: { used_litres: '1600.00', limit_litres: '1500.00' } }),
    );
    const bar = card('fuel-card').querySelector<HTMLElement>('.fuel-total .progress')!;
    expect(bar.classList.contains('danger')).toBe(true);
    expect(bar.querySelector<HTMLElement>('span')!.style.width).toBe('100%');
  });

  it('lists the top vehicles with their use, each linking to the vehicle', async () => {
    const { card, text } = await setup();
    const rows = Array.from(card('fuel-card').querySelectorAll<HTMLElement>('.top-vehicle'));
    expect(rows.map((row) => text(row))).toEqual([
      'AP39PA1234 110 L of 120 L',
      'AP39PB5678 45.5 L of 90 L',
    ]);
    expect(rows.map((row) => row.querySelector('a')!.getAttribute('href'))).toEqual([
      '/mto/vehicles/5',
      '/mto/vehicles/6',
    ]);
    const bar = rows[0].querySelector<HTMLElement>('.progress')!;
    expect(bar.classList.contains('warning')).toBe(true);
  });

  it('says so when there are no vehicles to rank', async () => {
    const { card, text } = await setup(summary({ top_vehicles: [] }));
    expect(card('fuel-card').querySelector('.top-vehicle')).toBeNull();
    expect(text(card('fuel-card'))).toContain('No vehicles yet.');
  });

  it('shows each police tank with its level bar, and the Low badge only on a low one', async () => {
    const { card, text } = await setup();
    const tanks = Array.from(card('stock-card').querySelectorAll<HTMLElement>('.tank'));
    expect(tanks.length).toBe(2);

    expect(text(tanks[0])).toContain('Nellore Police Pump');
    expect(text(tanks[0])).toContain('Petrol');
    expect(text(tanks[0])).toContain('80 L');
    expect(text(tanks[0].querySelector('.badge'))).toBe('Low');
    const lowBar = tanks[0].querySelector<HTMLElement>('[role="meter"]')!;
    expect(lowBar.classList.contains('danger')).toBe(true);
    expect(lowBar.getAttribute('aria-label')).toBe('Nellore Police Pump Petrol level');
    expect(lowBar.getAttribute('aria-valuenow')).toBe('8');

    expect(text(tanks[1])).toContain('Diesel');
    expect(text(tanks[1])).toContain('640 L');
    expect(tanks[1].querySelector('.badge')).toBeNull();
    expect(tanks[1].querySelector('[role="meter"]')!.classList.contains('danger')).toBe(false);
  });

  it('measures a tank against its real capacity, as the pumps page does', async () => {
    const { card, text } = await setup(
      summary({
        tanks: [
          {
            id: 3,
            pump_name: 'Nellore Police Pump',
            fuel_type: 'DIESEL',
            current_stock_litres: '2000.00',
            low_stock_threshold_litres: '100.00',
            capacity_litres: '5000.00',
            is_low: false,
          },
        ],
      }),
    );
    const bar = card('stock-card').querySelector<HTMLElement>('.tank [role="meter"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.querySelector<HTMLElement>('span')!.style.width).toBe('40%');
    expect(bar.getAttribute('aria-valuetext')).toBe('2,000 L');
    expect(text(card('stock-card'))).not.toContain('No capacity set');
  });

  it('says "No capacity set" on a tank without one, and keeps a rough bar for it', async () => {
    const { card, text } = await setup();
    const [unset, sized] = Array.from(card('stock-card').querySelectorAll<HTMLElement>('.tank'));
    expect(text(unset.querySelector('.hint'))).toBe('No capacity set');
    // 80 L against ten times the 100 L alert level.
    expect(unset.querySelector('[role="meter"]')!.getAttribute('aria-valuenow')).toBe('8');
    expect(sized.querySelector('.hint')).toBeNull();
    // 640 L of a 5,000 L tank.
    expect(sized.querySelector('[role="meter"]')!.getAttribute('aria-valuenow')).toBe('13');
  });

  it('says so when no police pump has a tank', async () => {
    const { card, text } = await setup(summary({ tanks: [] }));
    expect(card('stock-card').querySelector('.tank')).toBeNull();
    expect(text(card('stock-card'))).toContain('No police pump tanks yet.');
  });

  it('counts the vehicles by status', async () => {
    const { card, text } = await setup();
    const status = card('status-card');
    expect(text(status.querySelector('h2'))).toBe('Vehicles by status');
    const rows = Array.from(status.querySelectorAll<HTMLElement>('.status-row'));
    expect(
      rows.map((row) => [text(row.querySelector('.badge')), text(row.querySelector('strong'))]),
    ).toEqual([
      ['Active', '12'],
      ['Paused', '2'],
      ['Termination pending', '1'],
    ]);
  });

  it('shows the error and reads again on Try again', async () => {
    const { el, text, answer } = await setup('fail');
    expect(text(el.querySelector('[role="alert"]'))).toBe('Not available.');
    expect(el.querySelector('a.stat-link')).toBeNull();
    const retry = Array.from(el.querySelectorAll('button')).find((b) => text(b) === 'Try again')!;
    retry.click();
    await answer(summary());
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelectorAll('a.stat-link').length).toBe(5);
  });
});
