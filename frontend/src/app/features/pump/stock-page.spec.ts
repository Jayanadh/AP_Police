import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { StockEntry, Tank } from '../../core/api/tanks-api';
import { fixedClock, makeTank, stubFileSaving } from '../../core/test-data';
import { ToastService } from '../../ui/toast';
import { StockPage } from './stock-page';

/** 15 October 2026 in India: the entries open on October. */
const NOW = '2026-10-15T06:00:00Z';
const OCTOBER = 'from=2026-10-01&to=2026-10-31';
const entriesUrl = (tank: number, period = OCTOBER) => `/api/tanks/${tank}/entries/?${period}`;

const PETROL = makeTank({
  id: 1,
  fuel_type: 'PETROL',
  current_stock_litres: '80.00',
  is_low: true,
  capacity_litres: '3000.00',
});
const DIESEL = makeTank({ id: 2 });

const entry = (overrides: Partial<StockEntry> = {}): StockEntry => ({
  id: 70,
  kind: 'DISPENSE',
  kind_label: 'Fill',
  litres: '15.00',
  stock_before: '655.00',
  stock_after: '640.00',
  note: '',
  recorded_by_name: 'Suresh Kumar',
  recorded_at: '2026-10-03T07:10:00+05:30',
  ...overrides,
});

const DIESEL_ENTRIES = [
  entry(),
  entry({
    id: 69,
    kind: 'TANKER_RECEIPT',
    kind_label: 'Tanker receipt',
    litres: '500.00',
    stock_before: '155.00',
    stock_after: '655.00',
    note: 'Tanker TN-1234',
    recorded_at: '2026-10-02T11:00:00+05:30',
  }),
];

describe('StockPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), fixedClock(() => NOW)],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(tanks: Tank[] | 'fail' = [PETROL, DIESEL]) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StockPage);
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    const answerTanks = async (body: Tank[] | 'fail') => {
      const req = http.expectOne('/api/tanks/');
      expect(req.request.method).toBe('GET');
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
    };
    await answerTanks(tanks);
    if (tanks !== 'fail') {
      for (const tank of tanks) {
        http.expectOne(entriesUrl(tank.id)).flush(tank.id === 2 ? DIESEL_ENTRIES : []);
      }
      await fixture.whenStable();
    }
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const form = (id: string) => el.querySelector<HTMLFormElement>(`#${id}`)!;
    const type = (selector: string, value: string) => {
      const box = el.querySelector<HTMLInputElement>(selector)!;
      box.value = value;
      box.dispatchEvent(new Event('input'));
    };
    const chip = (formId: string, fuel: string) =>
      Array.from(form(formId).querySelectorAll<HTMLButtonElement>('.chip')).find(
        (button) => text(button) === fuel,
      )!;
    const submit = async (formId: string) => {
      form(formId).dispatchEvent(new Event('submit'));
      await fixture.whenStable();
    };
    return { fixture, el, http, text, form, type, chip, submit, answerTanks };
  }

  it('shows each tank’s stock, alert level and level bar', async () => {
    const { el, text } = await setup();
    const tanks = Array.from(el.querySelectorAll('#tanks-card app-tank-level'));
    expect(tanks.length).toBe(2);
    expect(text(tanks[0].querySelector('.fuel'))).toBe('Petrol');
    expect(text(tanks[0].querySelector('.badge-danger'))).toBe('Low');
    expect(text(tanks[0].querySelector('.figure'))).toBe('80 L');
    expect(text(tanks[1].querySelector('.alert-level'))).toBe('Alert below 100 L');
    expect(tanks[1].querySelector('[role="meter"]')).not.toBeNull();
  });

  it('has no way to set the stock by hand: receipts add to it and fills take from it', async () => {
    const { el } = await setup();
    expect(el.querySelector('#measure-form')).toBeNull();
    expect(el.textContent).not.toContain('measurement');
  });

  describe('Tanker receipt', () => {
    it('posts the litres and the note to the chosen tank', async () => {
      const { el, http, text, type, chip, submit, fixture } = await setup();
      chip('receipt-form', 'Petrol').click();
      await fixture.whenStable();
      type('#receipt-litres', '500');
      type('#receipt-note', 'Tanker TN-1234');
      await submit('receipt-form');

      const req = http.expectOne('/api/tanks/1/receive/');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ litres: 500, note: 'Tanker TN-1234' });
      req.flush({ ...PETROL, current_stock_litres: '580.00', is_low: false });
      await fixture.whenStable();
      http.expectOne(entriesUrl(1)).flush([]);
      await fixture.whenStable();

      expect(
        TestBed.inject(ToastService)
          .messages()
          .map((toast) => toast.text),
      ).toEqual(['Received 500 L of petrol.']);
      const petrol = el.querySelectorAll('#tanks-card app-tank-level')[0];
      expect(text(petrol.querySelector('.figure'))).toBe('580 L');
      expect(petrol.querySelector('.badge')).toBeNull();
      expect(el.querySelector<HTMLInputElement>('#receipt-litres')!.value).toBe('');
      expect(el.querySelector<HTMLInputElement>('#receipt-note')!.value).toBe('');
    });

    it('is sent for the fuel chosen with its chips', async () => {
      const { chip, fixture, http, type, submit } = await setup();
      chip('receipt-form', 'Diesel').click();
      await fixture.whenStable();
      expect(chip('receipt-form', 'Diesel').getAttribute('aria-pressed')).toBe('true');
      expect(chip('receipt-form', 'Petrol').getAttribute('aria-pressed')).toBe('false');
      type('#receipt-litres', '100');
      await submit('receipt-form');
      http.expectOne('/api/tanks/2/receive/').flush(DIESEL);
      await fixture.whenStable();
      http.expectOne(entriesUrl(2)).flush([]);
    });

    it.each([
      ['', 'Enter the litres received.'],
      ['0', 'Enter the litres received.'],
    ])('does not send %j', async (litres, message) => {
      const { form, text, type, submit } = await setup();
      type('#receipt-litres', litres);
      await submit('receipt-form');
      expect(text(form('receipt-form').querySelector('.form-error'))).toBe(message);
    });

    it('takes the litres with up to two decimals, never below zero', async () => {
      const { el, type } = await setup();
      const box = el.querySelector<HTMLInputElement>('#receipt-litres')!;
      expect(box.type).toBe('text');
      type('#receipt-litres', '-1500.555');
      expect(box.value).toBe('1500.55');
    });

    it('shows the API message under the form', async () => {
      const { http, text, type, submit, fixture, form } = await setup();
      type('#receipt-litres', '500');
      await submit('receipt-form');
      http
        .expectOne('/api/tanks/1/receive/')
        .flush(
          { detail: 'Enter the litres received.' },
          { status: 400, statusText: 'Bad Request' },
        );
      await fixture.whenStable();
      expect(text(form('receipt-form').querySelector('.form-error'))).toBe(
        'Enter the litres received.',
      );
    });
  });

  describe('Stock entries', () => {
    it('lists this month’s entries of each tank', async () => {
      const { el, text } = await setup();
      const sections = Array.from(el.querySelectorAll('.entries'));
      expect(sections.length).toBe(2);
      expect(text(sections[0].querySelector('h3'))).toBe('Petrol entries');
      expect(text(sections[0])).toContain('No stock entries in this period.');
      expect(text(sections[1].querySelector('h3'))).toBe('Diesel entries');
      const rows = Array.from(sections[1].querySelectorAll('tbody tr'));
      expect(rows.length).toBe(2);
      expect(text(rows[0])).toContain('Fill');
      expect(text(rows[0])).toContain('15 L');
      expect(text(rows[0])).toContain('655 L → 640 L');
      expect(text(rows[0])).toContain('Suresh Kumar');
      expect(text(rows[0])).toContain('03 Oct 2026, 7:10 am');
      expect(text(rows[1])).toContain('Tanker receipt');
      expect(text(rows[1])).toContain('Tanker TN-1234');
    });

    it('reads the entries of another period: a month back, or a year', async () => {
      const { el, http, fixture } = await setup();
      const button = (label: string) =>
        Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(
          (b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label,
        )!;

      button('Previous month').click();
      await fixture.whenStable();
      http.expectOne(entriesUrl(1, 'from=2026-09-01&to=2026-09-30')).flush([]);
      http.expectOne(entriesUrl(2, 'from=2026-09-01&to=2026-09-30')).flush([]);

      button('Year').click();
      await fixture.whenStable();
      http.expectOne(entriesUrl(1, 'from=2026-04-01&to=2027-03-31')).flush([]);
      http.expectOne(entriesUrl(2, 'from=2026-04-01&to=2027-03-31')).flush([]);
    });

    it('downloads the entries of the period as Excel', async () => {
      stubFileSaving();
      const { el, http, fixture } = await setup();
      Array.from(el.querySelectorAll<HTMLButtonElement>('app-download-button button'))[0].click();
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
      http.expectOne(`/api/tanks/entries/export/?${OCTOBER}`).flush(new Blob(['xlsx']));
    });

    it('keeps the table inside a scrolling wrapper for narrow phones', async () => {
      const { el } = await setup();
      expect(el.querySelector('.entries .table-wrap table')).not.toBeNull();
    });
  });

  it('says so when this pump keeps no stock', async () => {
    const { el, text } = await setup([]);
    expect(text(el.querySelector('.empty'))).toContain('No tanks');
    expect(el.querySelector('form')).toBeNull();
  });

  it('shows the error with a way to try again when the tanks cannot be read', async () => {
    const { el, http, text, answerTanks, fixture } = await setup('fail');
    expect(text(el.querySelector('.error'))).toBe('Not available.');
    el.querySelector<HTMLButtonElement>('.card button')!.click();
    await answerTanks([PETROL]);
    http.expectOne(entriesUrl(1)).flush([]);
    await fixture.whenStable();
    expect(el.querySelector('.error')).toBeNull();
    expect(el.querySelectorAll('#tanks-card app-tank-level').length).toBe(1);
  });
});
