import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PumpTank } from '../../core/api/pumps-api';
import { StockEntry, Tank } from '../../core/api/tanks-api';
import { ToastService } from '../../ui/toast';
import { PumpTankCard } from './pump-tank-card';

const PETROL: PumpTank = {
  id: 31,
  fuel_type: 'PETROL',
  current_stock_litres: '450.00',
  low_stock_threshold_litres: '100.00',
  capacity_litres: '1000.00',
  is_low: false,
};

const DIESEL: PumpTank = {
  id: 32,
  fuel_type: 'DIESEL',
  current_stock_litres: '60.00',
  low_stock_threshold_litres: '100.00',
  capacity_litres: null,
  is_low: true,
};

const entry = (overrides: Partial<StockEntry> = {}): StockEntry => ({
  id: 1,
  kind: 'MEASUREMENT',
  kind_label: 'Morning measurement',
  litres: '500.00',
  stock_before: '480.00',
  stock_after: '500.00',
  note: '',
  recorded_by_name: 'Lakshmi Devi',
  recorded_at: '2026-10-02T06:30:00+05:30',
  ...overrides,
});

const asTank = (tank: PumpTank, overrides: Partial<Tank> = {}): Tank => ({
  ...tank,
  pump: 3,
  pump_name: 'Nellore Police Pump',
  last_measured_at: null,
  ...overrides,
});

describe('PumpTankCard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(tank: PumpTank = PETROL, rows: StockEntry[] | 'fail' = [entry()]) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PumpTankCard);
    fixture.componentRef.setInput('tank', tank);
    fixture.componentRef.setInput('month', '2026-10');
    const changed: Tank[] = [];
    fixture.componentInstance.changed.subscribe((t) => changed.push(t));
    await fixture.whenStable();
    const replyEntries = async (body: StockEntry[] | 'fail', month = '2026-10') => {
      const req = http.expectOne(`/api/tanks/${tank.id}/entries/?month=${month}`);
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
    };
    await replyEntries(rows);

    const el = fixture.nativeElement as HTMLElement;
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const field = (name: string) =>
      el.querySelector(`#tank-${tank.id}-${name}`) as HTMLInputElement;
    const fill = (name: string, value: string) => {
      const input = field(name);
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const save = () => (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    const button = (label: string) =>
      Array.from(el.querySelectorAll('button')).find((b) => text(b) === label) as
        HTMLButtonElement | undefined;
    const toasts = () => TestBed.inject(ToastService).messages();
    /** "In stock 450 L": the label and value of each stat tile. */
    const stats = () =>
      Array.from(el.querySelectorAll('.stat')).map(
        (s) => `${text(s.querySelector('.stat-label'))} ${text(s.querySelector('.stat-value'))}`,
      );
    return {
      fixture,
      el,
      http,
      changed,
      text,
      field,
      fill,
      save,
      button,
      replyEntries,
      toasts,
      stats,
    };
  }

  it('shows the fuel, the stock, the alert level and the capacity', async () => {
    const { el, text, stats } = await setup();
    expect(text(el.querySelector('h3'))).toBe('Petrol');
    expect(stats()).toEqual(['In stock 450 L', 'Alert below 100 L', 'Capacity 1,000 L']);
  });

  it('draws the level as a share of the capacity', async () => {
    const { el } = await setup();
    const bar = el.querySelector<HTMLElement>('.progress')!;
    expect(bar.querySelector<HTMLElement>('span')!.style.width).toBe('45%');
    expect(bar.classList.contains('danger')).toBe(false);
    expect(el.querySelector('.badge-danger')).toBeNull();
  });

  it('turns the bar red and shows Low when the stock is below the alert level', async () => {
    const { el, text, stats } = await setup(DIESEL, []);
    expect(el.querySelector('.progress')!.classList.contains('danger')).toBe(true);
    expect(text(el.querySelector('.badge-danger'))).toBe('Low');
    expect(stats()[2]).toBe('Capacity Not set');
  });

  it('lists the stock entries of the month: kind, litres, before and after, who and when', async () => {
    const { el, text } = await setup(PETROL, [
      entry(),
      entry({
        id: 2,
        kind: 'DISPENSE',
        kind_label: 'Fill',
        litres: '30.50',
        stock_before: '500.00',
        stock_after: '469.50',
        recorded_by_name: 'Ravi',
        recorded_at: '2026-10-02T09:15:00+05:30',
      }),
    ]);
    const rows = Array.from(el.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => text(td)),
    );
    expect(rows).toEqual([
      ['Morning measurement', '500 L', '480 L → 500 L', 'Lakshmi Devi', '02 Oct 2026, 6:30 am'],
      ['Fill', '30.5 L', '500 L → 469.5 L', 'Ravi', '02 Oct 2026, 9:15 am'],
    ]);
    expect(Array.from(el.querySelectorAll('th')).map((th) => text(th))).toEqual([
      'Entry',
      'Litres',
      'Before → after',
      'By',
      'When',
    ]);
  });

  it('says when the month has no entries', async () => {
    const { el, text } = await setup(PETROL, []);
    expect(el.querySelector('table')).toBeNull();
    expect(text(el.querySelector('.no-entries'))).toBe('No stock entries this month.');
  });

  it('reads the entries again for another month', async () => {
    const { fixture, el, text, replyEntries } = await setup();
    fixture.componentRef.setInput('month', '2026-09');
    await fixture.whenStable();
    await replyEntries([entry({ id: 9, litres: '70.00' })], '2026-09');
    expect(text(el.querySelector('tbody td:nth-child(2)'))).toBe('70 L');
  });

  it('shows an error for its entries, with a way to try again, and keeps the rest', async () => {
    const { el, http, text, button, fixture, replyEntries } = await setup(PETROL, 'fail');
    expect(text(el.querySelector('[role="alert"]'))).toBe('Not available.');
    expect(text(el.querySelector('h3'))).toBe('Petrol');
    button('Try again')!.click();
    await fixture.whenStable();
    await replyEntries([entry()]);
    expect(el.querySelector('table')).toBeTruthy();
    http.expectNone(() => true);
  });

  it('fills the alert level and capacity boxes from the tank', async () => {
    const { field } = await setup();
    expect(field('threshold').value).toBe('100');
    expect(field('capacity').value).toBe('1000');
  });

  it('saves a new alert level and capacity with a PATCH, and tells the page', async () => {
    const { el, http, fill, save, changed, fixture, text, toasts } = await setup();
    fill('threshold', '150');
    fill('capacity', '1200');
    save();
    const req = http.expectOne('/api/tanks/31/');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ low_stock_threshold_litres: 150, capacity_litres: 1200 });
    const updated = asTank(PETROL, {
      low_stock_threshold_litres: '150.00',
      capacity_litres: '1200.00',
    });
    req.flush(updated);
    await fixture.whenStable();
    expect(changed).toEqual([updated]);
    expect(toasts()[0]).toMatchObject({ text: 'Petrol levels saved.', tone: 'success' });
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(text(el.querySelector('button[type="submit"]'))).toBe('Save levels');
  });

  it('sends no capacity when the box is cleared', async () => {
    const { http, fill, save } = await setup();
    fill('capacity', '');
    save();
    const req = http.expectOne('/api/tanks/31/');
    expect(req.request.body).toEqual({ low_stock_threshold_litres: 100, capacity_litres: null });
    req.flush(asTank(PETROL, { capacity_litres: null }));
  });

  it('allows an alert level of zero', async () => {
    const { http, fill, save } = await setup();
    fill('threshold', '0');
    save();
    const req = http.expectOne('/api/tanks/31/');
    expect(req.request.body.low_stock_threshold_litres).toBe(0);
    req.flush(asTank(PETROL, { low_stock_threshold_litres: '0.00' }));
  });

  it('asks for an alert level before sending anything', async () => {
    const { el, http, fill, save, fixture, text } = await setup();
    fill('threshold', '');
    save();
    await fixture.whenStable();
    http.expectNone('/api/tanks/31/');
    expect(text(el.querySelector('[role="alert"]'))).toBe(
      'Enter the alert level in litres, 0 or more.',
    );
  });

  it('refuses a negative capacity before sending anything', async () => {
    const { el, http, fill, save, fixture, text } = await setup();
    fill('capacity', '-5');
    save();
    await fixture.whenStable();
    http.expectNone('/api/tanks/31/');
    expect(text(el.querySelector('[role="alert"]'))).toBe('The capacity cannot be negative.');
  });

  it('shows what the server says when it refuses the change', async () => {
    const { el, http, save, fill, fixture, text, changed } = await setup();
    fill('threshold', '150');
    save();
    http
      .expectOne('/api/tanks/31/')
      .flush(
        { capacity_litres: ['Ensure this value is greater than or equal to 0.'] },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(text(el.querySelector('[role="alert"]'))).toBe(
      'capacity litres: Ensure this value is greater than or equal to 0.',
    );
    expect(changed).toEqual([]);
    expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps what is being typed when the tank is read again with the same levels', async () => {
    const { fixture, fill, field } = await setup();
    fill('threshold', '175');
    fixture.componentRef.setInput('tank', { ...PETROL, current_stock_litres: '440.00' });
    await fixture.whenStable();
    expect(field('threshold').value).toBe('175');
  });
});
