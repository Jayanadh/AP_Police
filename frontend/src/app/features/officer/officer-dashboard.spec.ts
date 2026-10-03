import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OfficerDashboard as OfficerSummary } from '../../core/api/dashboard-api';
import { MyVehicles } from '../../core/api/vehicles-api';
import { makeMe, makeVehicle, signInAs } from '../../core/test-data';
import { OfficerDashboard } from './officer-dashboard';

const SUMMARY: OfficerSummary = {
  role: 'OFFICER',
  month: '2026-10',
  vehicles: [
    {
      id: 5,
      registration_number: 'AP39PA1234',
      make: 'Mahindra',
      model: 'Bolero',
      driver_name: 'Ramesh Babu',
      limit_litres: '120.00',
      used_litres: '45.50',
      remaining_litres: '74.50',
    },
    {
      id: 6,
      registration_number: 'AP39PB5678',
      make: 'Toyota',
      model: 'Innova',
      driver_name: null,
      limit_litres: '100.00',
      used_litres: '85.00',
      remaining_litres: '15.00',
    },
  ],
  recent_fills: [
    {
      id: 14,
      registration_number: 'AP39PA1234',
      litres_filled: '20.00',
      filled_at: '2026-10-02T14:05:00+05:30',
      pump_name: 'Nellore Police Pump',
      duty_particulars: 'Escort duty, Nellore to Kavali',
    },
    {
      id: 13,
      registration_number: 'AP39PB5678',
      litres_filled: '35.50',
      filled_at: '2026-10-01T09:30:00+05:30',
      pump_name: 'Kavali Bunk',
      duty_particulars: '',
    },
  ],
};

const MINE: MyVehicles = {
  vehicles: [
    makeVehicle({
      id: 5,
      current_driver: {
        assignment_id: 11,
        id: 31,
        full_name: 'Ramesh Babu',
        emp_id: null,
        mobile: '9123456780',
      },
    }),
    makeVehicle({ id: 6, registration_number: 'AP39PB5678' }),
  ],
  mto: { unit_name: 'MTO Nellore', full_name: 'Ravi Kumar', mobile: '9876543210' },
};

describe('OfficerDashboard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(
    options: { summary?: OfficerSummary | 'fail'; mine?: MyVehicles | 'fail' } = {},
  ) {
    await signInAs(makeMe({ role: 'OFFICER', full_name: 'Anil Reddy', unit_name: 'MTO Nellore' }));
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(OfficerDashboard);
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
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
    await answer('/api/dashboard/', options.summary ?? SUMMARY);
    await answer('/api/me/vehicles/', options.mine ?? MINE);
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const cards = () => Array.from(el.querySelectorAll<HTMLElement>('.vehicle'));
    return { fixture, el, answer, text, cards };
  }

  it('greets the officer and names the office and month', async () => {
    const { el, text } = await setup();
    expect(text(el.querySelector('h1'))).toBe('Welcome, Anil Reddy');
    expect(text(el.querySelector('.page-header p'))).toBe('MTO Nellore · October 2026');
  });

  describe('the MTO contact card', () => {
    it('shows the office, the MTO and a phone link', async () => {
      const { el, text } = await setup();
      const card = el.querySelector('#mto-card')!;
      expect(text(card)).toContain('MTO Nellore');
      expect(text(card)).toContain('Ravi Kumar');
      const call = card.querySelector<HTMLAnchorElement>('a[href^="tel:"]')!;
      expect(call.getAttribute('href')).toBe('tel:9876543210');
      expect(text(call)).toContain('9876543210');
    });

    it('has no phone link when the MTO has no number on file', async () => {
      const { el, text } = await setup({
        mine: { ...MINE, mto: { unit_name: 'MTO Nellore', full_name: null, mobile: null } },
      });
      const card = el.querySelector('#mto-card')!;
      expect(card.querySelector('a[href^="tel:"]')).toBeNull();
      expect(text(card)).toContain('No contact number on file');
    });

    it('shows its own error with a way to try again, and the vehicles still show', async () => {
      const { el, text, answer, cards } = await setup({ mine: 'fail' });
      expect(text(el.querySelector('#mto-card .error'))).toBe('Not available.');
      expect(cards().length).toBe(2);
      el.querySelector<HTMLButtonElement>('#mto-card button')!.click();
      await answer('/api/me/vehicles/', MINE);
      expect(el.querySelector('#mto-card .error')).toBeNull();
      expect(el.querySelector('#mto-card a[href^="tel:"]')).not.toBeNull();
    });
  });

  describe('the vehicle cards', () => {
    it('shows one card for each vehicle with its make, model and driver', async () => {
      const { cards, text } = await setup();
      expect(cards().length).toBe(2);
      expect(text(cards()[0].querySelector('.registration'))).toBe('AP39PA1234');
      expect(text(cards()[0].querySelector('.model'))).toBe('Mahindra Bolero');
      expect(text(cards()[0].querySelector('.driver'))).toContain('Ramesh Babu');
      expect(text(cards()[1].querySelector('.driver'))).toBe('No driver linked');
    });

    it('lets the officer call the driver', async () => {
      const { cards } = await setup();
      expect(cards()[0].querySelector('.driver a')?.getAttribute('href')).toBe('tel:9123456780');
      expect(cards()[1].querySelector('.driver a')).toBeNull();
    });

    it('shows the limit, what was used and what is left, with a bar', async () => {
      const { cards, text } = await setup();
      const first = cards()[0];
      expect(text(first.querySelector('.limit'))).toBe('Limit 120 L');
      expect(text(first.querySelector('.used'))).toBe('Used 45.5 L');
      expect(text(first.querySelector('.remaining'))).toBe('Left 74.5 L');
      const bar = first.querySelector<HTMLElement>('[role="progressbar"]')!;
      expect(bar.getAttribute('aria-valuenow')).toBe('38');
      expect(bar.getAttribute('aria-label')).toBe('Fuel used this month by AP39PA1234');
      expect(bar.querySelector<HTMLElement>('span')!.style.width).toBe('38%');
      expect(bar.classList.contains('warning')).toBe(false);
    });

    it('turns the bar amber when most of the limit is used', async () => {
      const { cards } = await setup();
      expect(cards()[1].querySelector('.progress')!.classList.contains('warning')).toBe(true);
    });

    it('says so when no vehicle is linked', async () => {
      const { el, text } = await setup({ summary: { ...SUMMARY, vehicles: [], recent_fills: [] } });
      expect(el.querySelectorAll('.vehicle').length).toBe(0);
      expect(text(el.querySelector('.empty'))).toContain('No vehicle is linked to you yet');
    });
  });

  describe('recent fills', () => {
    it('shows each fill with its pump, time and duty particulars', async () => {
      const { el, text } = await setup();
      const rows = Array.from(el.querySelectorAll('#fills-card li'));
      expect(rows.length).toBe(2);
      expect(text(rows[0])).toContain('AP39PA1234');
      expect(text(rows[0])).toContain('20 L');
      expect(text(rows[0])).toContain('Nellore Police Pump');
      expect(text(rows[0])).toContain('02 Oct 2026, 2:05 pm');
      expect(text(rows[0].querySelector('.duty'))).toBe('Escort duty, Nellore to Kavali');
    });

    it('says when the driver has not entered the duty particulars', async () => {
      const { el, text } = await setup();
      const rows = Array.from(el.querySelectorAll('#fills-card li'));
      expect(text(rows[1].querySelector('.duty'))).toBe('Duty particulars not entered yet');
    });

    it('links to the fuel statement', async () => {
      const { el } = await setup();
      expect(el.querySelector('#fills-card a.btn')?.getAttribute('href')).toBe('/officer/fuel');
    });

    it('says so when there are no fills yet', async () => {
      const { el, text } = await setup({ summary: { ...SUMMARY, recent_fills: [] } });
      expect(text(el.querySelector('#fills-card'))).toContain('No fills yet');
    });
  });

  it('shows the error with a way to try again when the dashboard cannot be read', async () => {
    const { el, text, answer } = await setup({ summary: 'fail' });
    expect(text(el.querySelector('.notice .error'))).toBe('Not available.');
    el.querySelector<HTMLButtonElement>('.notice button.retry')!.click();
    await answer('/api/dashboard/', SUMMARY);
    expect(el.querySelectorAll('.vehicle').length).toBe(2);
  });
});
