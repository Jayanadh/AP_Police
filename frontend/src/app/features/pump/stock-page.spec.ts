import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { StockEntry, Tank } from '../../core/api/tanks-api';
import { currentMonth } from '../../core/format';
import { makeTank } from '../../core/test-data';
import { ToastService } from '../../ui/toast';
import { StockPage } from './stock-page';

const MONTH = currentMonth();
const entriesUrl = (tank: number) => `/api/tanks/${tank}/entries/?month=${MONTH}`;

const PETROL = makeTank({
  id: 1,
  fuel_type: 'PETROL',
  current_stock_litres: '80.00',
  is_low: true,
  capacity_litres: '3000.00',
  last_measured_at: null,
});
const DIESEL = makeTank({ id: 2 });

const entry = (overrides: Partial<StockEntry> = {}): StockEntry => ({
  id: 70,
  kind: 'MEASUREMENT',
  kind_label: 'Measurement',
  litres: '640.00',
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
      providers: [provideHttpClient(), provideHttpClientTesting()],
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

  describe('Morning measurement', () => {
    it('offers a chip for each fuel, the first chosen', async () => {
      const { chip } = await setup();
      expect(chip('measure-form', 'Petrol').getAttribute('aria-pressed')).toBe('true');
      expect(chip('measure-form', 'Diesel').getAttribute('aria-pressed')).toBe('false');
    });

    it('posts the litres to the chosen tank, shows the new stock and reads the entries again', async () => {
      const { el, http, text, type, chip, submit, fixture } = await setup();
      chip('measure-form', 'Diesel').click();
      await fixture.whenStable();
      type('#measure-litres', '640.5');
      await submit('measure-form');

      const req = http.expectOne('/api/tanks/2/measure/');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ litres: 640.5, note: '' });
      req.flush({ ...DIESEL, current_stock_litres: '640.50' });
      await fixture.whenStable();
      http.expectOne(entriesUrl(2)).flush(DIESEL_ENTRIES);
      await fixture.whenStable();

      expect(
        TestBed.inject(ToastService)
          .messages()
          .map((toast) => toast.text),
      ).toEqual(['Diesel stock set to 640.5 L.']);
      const diesel = el.querySelectorAll('#tanks-card app-tank-level')[1];
      expect(text(diesel.querySelector('.figure'))).toBe('640.5 L');
      expect(el.querySelector<HTMLInputElement>('#measure-litres')!.value).toBe('');
    });

    it('accepts a reading of zero', async () => {
      const { http, type, submit, fixture } = await setup();
      type('#measure-litres', '0');
      await submit('measure-form');
      const req = http.expectOne('/api/tanks/1/measure/');
      expect(req.request.body).toEqual({ litres: 0, note: '' });
      req.flush({ ...PETROL, current_stock_litres: '0.00' });
      await fixture.whenStable();
      http.expectOne(entriesUrl(1)).flush([]);
    });

    it.each([
      ['', 'Enter the litres in the tank.'],
      ['-3', 'The stock cannot be negative.'],
    ])('does not send %j', async (litres, message) => {
      const { form, text, type, submit } = await setup();
      type('#measure-litres', litres);
      await submit('measure-form');
      expect(text(form('measure-form').querySelector('.form-error'))).toBe(message);
    });

    it('shows the API message under the form and keeps the litres', async () => {
      const { el, http, text, type, submit, fixture, form } = await setup();
      type('#measure-litres', '640');
      await submit('measure-form');
      http
        .expectOne('/api/tanks/1/measure/')
        .flush({ detail: "Stock can't be negative." }, { status: 400, statusText: 'Bad Request' });
      await fixture.whenStable();
      expect(text(form('measure-form').querySelector('.form-error'))).toBe(
        "Stock can't be negative.",
      );
      expect(el.querySelector<HTMLInputElement>('#measure-litres')!.value).toBe('640');
      expect(TestBed.inject(ToastService).messages()).toEqual([]);
    });
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

    it('chooses its fuel on its own, apart from the measurement', async () => {
      const { chip, fixture, http, type, submit } = await setup();
      chip('receipt-form', 'Diesel').click();
      await fixture.whenStable();
      expect(chip('receipt-form', 'Diesel').getAttribute('aria-pressed')).toBe('true');
      expect(chip('measure-form', 'Petrol').getAttribute('aria-pressed')).toBe('true');
      type('#receipt-litres', '100');
      await submit('receipt-form');
      http.expectOne('/api/tanks/2/receive/').flush(DIESEL);
      await fixture.whenStable();
      http.expectOne(entriesUrl(2)).flush([]);
    });

    it.each([
      ['', 'Enter the litres received.'],
      ['0', 'Enter the litres received.'],
      ['-10', 'Enter the litres received.'],
    ])('does not send %j', async (litres, message) => {
      const { form, text, type, submit } = await setup();
      type('#receipt-litres', litres);
      await submit('receipt-form');
      expect(text(form('receipt-form').querySelector('.form-error'))).toBe(message);
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
      expect(text(sections[0].querySelector('h3'))).toBe('Petrol entries this month');
      expect(text(sections[0])).toContain('No stock entries this month.');
      expect(text(sections[1].querySelector('h3'))).toBe('Diesel entries this month');
      const rows = Array.from(sections[1].querySelectorAll('tbody tr'));
      expect(rows.length).toBe(2);
      expect(text(rows[0])).toContain('Measurement');
      expect(text(rows[0])).toContain('640 L');
      expect(text(rows[0])).toContain('655 L → 640 L');
      expect(text(rows[0])).toContain('Suresh Kumar');
      expect(text(rows[0])).toContain('03 Oct 2026, 7:10 am');
      expect(text(rows[1])).toContain('Tanker receipt');
      expect(text(rows[1])).toContain('Tanker TN-1234');
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
