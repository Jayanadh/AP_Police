import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FuelRequest } from '../../core/api/fuel-requests-api';
import { FuelStatement } from '../../core/api/fuel-statement-api';
import { Unit } from '../../core/api/units-api';
import { Vehicle } from '../../core/api/vehicles-api';
import { Me } from '../../core/auth-store';
import {
  fixedClock,
  makeFuelRequest,
  makeFuelStatement,
  makeMe,
  signInAs,
  stubFileSaving,
} from '../../core/test-data';
import { FuelStatementPage } from './fuel-statement-page';

/** 15 October 2026 in India: the page opens on October. */
const NOW = '2026-10-15T06:00:00Z';
const OCTOBER = 'from=2026-10-01&to=2026-10-31';
const SEPTEMBER = 'from=2026-09-01&to=2026-09-30';

const statementUrl = (period: string, unit?: number) =>
  `/api/fuel/statement/?${period}${unit ? `&unit=${unit}` : ''}`;
const fillsUrl = (period: string, extra = '') =>
  `/api/fuel/requests/?${period}${extra}&status=FILLED`;

const WITH_DUTY = makeFuelRequest({
  id: 1,
  litres_filled: '40.00',
  duty_particulars: 'Escort duty, Nellore to Kavali',
  duty_submitted_at: '2026-10-02T18:00:00+05:30',
});
const DUE = makeFuelRequest({
  id: 2,
  registration_number: 'AP39PB5678',
  vehicle: 6,
  litres_filled: '25.50',
});
const OVERDUE = makeFuelRequest({
  id: 3,
  litres_filled: '10.25',
  is_emergency: true,
  emergency_litres: '4.00',
  emergency_status: 'PENDING',
  duty_overdue: true,
});

const vehicle = (id: number, registration: string): Vehicle =>
  ({ id, registration_number: registration }) as Vehicle;

const unit = (id: number, name: string): Unit => ({ id, name }) as Unit;

describe('FuelStatementPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), fixedClock(() => NOW)],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  type Answer = object | 'fail';

  async function setup(
    user: Me,
    first: { statement?: FuelStatement | 'fail'; fills?: FuelRequest[] | 'fail' } = {},
  ) {
    await signInAs(user);
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(FuelStatementPage);
    const el = fixture.nativeElement as HTMLElement;
    const answer = async (url: string, body: Answer) => {
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
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const rows = (section: string) =>
      Array.from(el.querySelectorAll(`#${section} tbody tr`)).map((row) =>
        Array.from(row.querySelectorAll('th, td')).map((cell) => text(cell)),
      );
    /** The value on the totals tile with this label. */
    const tile = (label: string) =>
      text(
        Array.from(el.querySelectorAll('.totals .stat'))
          .find((card) => text(card.querySelector('.stat-label')) === label)
          ?.querySelector('.stat-value'),
      );
    const fills = () => Array.from(el.querySelectorAll<HTMLElement>('.fill'));
    const button = (name: string) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => text(b) === name || b.getAttribute('aria-label') === name,
      )!;
    const choose = async (id: string, value: string) => {
      const select = el.querySelector(`#${id}`) as HTMLSelectElement;
      select.value = value;
      select.dispatchEvent(new Event('change'));
      await fixture.whenStable();
    };
    return { fixture, el, http, answer, text, rows, tile, fills, button, choose, first };
  }

  describe('for the MTO', () => {
    async function mto(
      first: { statement?: FuelStatement | 'fail'; fills?: FuelRequest[] | 'fail' } = {},
    ) {
      const s = await setup(makeMe({ role: 'MTO' }), first);
      s.http
        .expectOne('/api/vehicles/')
        .flush([vehicle(5, 'AP39PA1234'), vehicle(6, 'AP39PB5678')]);
      await s.answer(statementUrl(OCTOBER), first.statement ?? makeFuelStatement());
      await s.answer(fillsUrl(OCTOBER), first.fills ?? [WITH_DUTY, DUE, OVERDUE]);
      return s;
    }

    it('opens on this month and says what the page is', async () => {
      const { el, text } = await mto();
      expect(text(el.querySelector('h1'))).toBe('Fuel statement');
      expect(text(el.querySelector('app-period-picker .label'))).toBe('October 2026');
    });

    it('shows the totals: litres, fills, petrol, diesel and emergency', async () => {
      const { tile } = await mto();
      expect(tile('Litres filled')).toBe('60 L');
      expect(tile('Fills')).toBe('3');
      expect(tile('Petrol')).toBe('30 L');
      expect(tile('Diesel')).toBe('30 L');
      expect(tile('Emergency')).toBe('4 L');
    });

    it('shows the litres by vehicle and by pump, and no offices or stock', async () => {
      const { el, rows } = await mto();
      expect(rows('by-vehicle')).toEqual([
        ['AP39PA1001', 'Petrol', '2', '30 L', '4 L'],
        ['AP39PA1002', 'Diesel', '1', '30 L', '—'],
      ]);
      expect(rows('by-pump')).toEqual([
        ['Trunk Road Bunk', 'Tie-up bunk', '2', '40 L'],
        ['Nellore Police Pump', 'Police pump', '1', '20 L'],
      ]);
      expect(el.querySelector('#by-unit')).toBeNull();
      expect(el.querySelector('#stock')).toBeNull();
    });

    it('lists each fill with vehicle, driver, pump, litres and time', async () => {
      const { fills, text } = await mto();
      expect(fills()).toHaveLength(3);
      const first = text(fills()[0]);
      expect(first).toContain('AP39PA1234');
      expect(first).toContain('Ramesh Babu');
      expect(first).toContain('Nellore Police Pump');
      expect(first).toContain('40 L');
      expect(first).toContain('02 Oct 2026, 2:05 pm');
    });

    it('shows the duty particulars when written, Due while awaited and Overdue past 48 hours', async () => {
      const { fills, text, el } = await mto();
      expect(text(fills()[0].querySelector('.duty'))).toContain('Escort duty, Nellore to Kavali');
      expect(text(fills()[1].querySelector('.duty-badge'))).toBe('Due');
      expect(text(fills()[2].querySelector('.duty-badge'))).toBe('Overdue');
      expect(text(el.querySelector('.overdue-note'))).toBe(
        '1 fill is past 48 hours without duty particulars.',
      );
    });

    it('marks emergency fills', async () => {
      const { fills, text } = await mto();
      expect(text(fills()[2].querySelector('.emergency-badge'))).toBe('Emergency 4 L');
      expect(fills()[0].querySelector('.emergency-badge')).toBeNull();
    });

    it('reads both again for the previous month', async () => {
      const { button, answer, el, text } = await mto();
      button('Previous month').click();
      await answer(statementUrl(SEPTEMBER), makeFuelStatement());
      await answer(fillsUrl(SEPTEMBER), []);
      expect(text(el.querySelector('app-period-picker .label'))).toBe('September 2026');
    });

    it('reads a week when Week is chosen', async () => {
      const { button, answer } = await mto();
      button('Week').click();
      await answer(statementUrl('from=2026-10-12&to=2026-10-18'), makeFuelStatement());
      await answer(fillsUrl('from=2026-10-12&to=2026-10-18'), []);
    });

    it('narrows the fills to one vehicle, and keeps the choice when the period changes', async () => {
      const { el, text, choose, answer, button } = await mto();
      expect(text(el.querySelector('label[for="statement-vehicle"]'))).toBe('Fills of');
      await choose('statement-vehicle', '6');
      await answer(`/api/fuel/requests/?${OCTOBER}&status=FILLED&vehicle=6`, [DUE]);
      button('Previous month').click();
      await answer(statementUrl(SEPTEMBER), makeFuelStatement());
      await answer(`/api/fuel/requests/?${SEPTEMBER}&status=FILLED&vehicle=6`, []);
    });

    it('says so when nothing was filled in the period', async () => {
      const empty = makeFuelStatement({ litres: '0.00', fills: 0, by_vehicle: [], by_pump: [] });
      const { el, text } = await mto({ statement: empty, fills: [] });
      expect(text(el.querySelector('#fills'))).toContain('No fills in this period.');
      expect(el.querySelector('#by-vehicle')).toBeNull();
    });

    it('shows a failed part with its own retry and keeps the other', async () => {
      const { el, text, button, answer, fills } = await mto({ statement: 'fail' });
      expect(text(el.querySelector('#summary .error'))).toBe('Not available.');
      expect(fills()).toHaveLength(3);
      button('Try again').click();
      await answer(statementUrl(OCTOBER), makeFuelStatement());
      expect(el.querySelector('#summary .error')).toBeNull();
    });
  });

  describe('for the PTO', () => {
    const OFFICES = makeFuelStatement({
      litres: '82.00',
      by_unit: [
        {
          unit: 4,
          unit_name: 'Guntur MTO',
          fills: 2,
          litres: '22.00',
          petrol_litres: '0.00',
          diesel_litres: '22.00',
          emergency_litres: '0.00',
        },
        {
          unit: 3,
          unit_name: 'SPSR Nellore MTO',
          fills: 3,
          litres: '60.00',
          petrol_litres: '30.00',
          diesel_litres: '30.00',
          emergency_litres: '4.00',
        },
      ],
      by_vehicle: null,
    });

    async function pto() {
      const s = await setup(makeMe({ role: 'PTO', unit: null, unit_name: null }));
      s.http.expectOne('/api/units/').flush([unit(4, 'Guntur MTO'), unit(3, 'SPSR Nellore MTO')]);
      await s.answer(statementUrl(OCTOBER), OFFICES);
      return s;
    }

    it('shows every office and waits for one to be picked before listing vehicles and fills', async () => {
      const { el, rows, text, fills } = await pto();
      expect(rows('by-unit')).toEqual([
        ['Guntur MTO', '2', '—', '22 L', '22 L', '—'],
        ['SPSR Nellore MTO', '3', '30 L', '30 L', '60 L', '4 L'],
      ]);
      expect(el.querySelector('#by-vehicle')).toBeNull();
      expect(fills()).toHaveLength(0);
      expect(text(el.querySelector('.pick-office'))).toBe(
        'Pick an office to see its vehicles and fills.',
      );
      const options = Array.from(el.querySelectorAll('#statement-unit option')).map((o) => text(o));
      expect(options).toEqual(['All offices', 'Guntur MTO', 'SPSR Nellore MTO']);
    });

    it('downloads the statement shown, for the office picked, as Excel', async () => {
      const { choose, answer, el, http, fixture } = await pto();
      await choose('statement-unit', '3');
      await answer(statementUrl(OCTOBER, 3), makeFuelStatement());
      await answer(fillsUrl(OCTOBER, '&unit=3'), [WITH_DUTY]);
      stubFileSaving();

      el.querySelector<HTMLButtonElement>('app-download-button button')!.click();
      await fixture.whenStable();

      http
        .expectOne('/api/fuel/statement/export/?from=2026-10-01&to=2026-10-31&unit=3')
        .flush(new Blob(['x']));
    });

    it('reads one office’s statement and fills once it is picked', async () => {
      const { choose, answer, rows, fills } = await pto();
      await choose('statement-unit', '3');
      await answer(statementUrl(OCTOBER, 3), makeFuelStatement());
      await answer(fillsUrl(OCTOBER, '&unit=3'), [WITH_DUTY]);
      expect(rows('by-vehicle')).toHaveLength(2);
      expect(fills()).toHaveLength(1);
    });
  });

  it('reads the officer’s statement and fills, with no filters to choose', async () => {
    const s = await setup(makeMe({ role: 'OFFICER' }));
    await s.answer(statementUrl(OCTOBER), makeFuelStatement());
    await s.answer(fillsUrl(OCTOBER), [WITH_DUTY]);
    expect(s.el.querySelector('#statement-vehicle')).toBeNull();
    expect(s.el.querySelector('#statement-unit')).toBeNull();
    expect(s.fills()).toHaveLength(1);
  });

  it('reads the driver’s own statement and fills', async () => {
    const s = await setup(makeMe({ role: 'DRIVER' }));
    await s.answer(statementUrl(OCTOBER), makeFuelStatement());
    await s.answer(fillsUrl(OCTOBER), [DUE]);
    expect(s.text(s.fills()[0].querySelector('.duty-badge'))).toBe('Due');
  });

  it('shows police pump staff each tank’s stock and the fills at the pump, without duty particulars', async () => {
    const s = await setup(
      makeMe({ role: 'PUMP_OPERATOR', pump: 3, pump_kind: 'POLICE', unit: null }),
    );
    await s.answer(
      statementUrl(OCTOBER),
      makeFuelStatement({
        by_pump: null,
        stock: [
          {
            fuel_type: 'PETROL',
            opening_litres: '500.00',
            received_litres: '300.00',
            dispensed_litres: '20.00',
            measured_change_litres: '-10.00',
            closing_litres: '770.00',
          },
        ],
      }),
    );
    await s.answer(`/api/fuel/pump-fills/?${OCTOBER}`, [WITH_DUTY]);
    expect(s.rows('stock')).toEqual([['Petrol', '500 L', '+300 L', '−20 L', '−10 L', '770 L']]);
    expect(s.el.querySelector('#by-pump')).toBeNull();
    expect(s.fills()).toHaveLength(1);
    expect(s.fills()[0].querySelector('.duty')).toBeNull();
  });
});
