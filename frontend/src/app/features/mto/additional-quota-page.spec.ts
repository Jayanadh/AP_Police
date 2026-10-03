import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Grant } from '../../core/api/grants-api';
import { Quota } from '../../core/api/quota-api';
import { Vehicle } from '../../core/api/vehicles-api';
import { addMonths, currentMonth, monthLabel } from '../../core/format';
import { ToastService } from '../../ui/toast';
import { AdditionalQuotaPage } from './additional-quota-page';

const THIS_MONTH = currentMonth();
const NEXT_MONTH = addMonths(THIS_MONTH, 1);
const MB = 1024 * 1024;

const vehicle = (overrides: Partial<Vehicle> = {}): Vehicle => ({
  id: 5,
  registration_number: 'AP39PA1234',
  vehicle_type: 'JEEP',
  make: 'Mahindra',
  model: 'Bolero',
  year_of_manufacture: 2022,
  fuel_type: 'DIESEL',
  tank_capacity_litres: '60.00',
  chassis_number: 'CH123',
  engine_number: 'EN456',
  odometer_at_onboarding_km: 1200,
  monthly_fuel_limit_litres: '120.00',
  service_interval_km: 5000,
  service_interval_days: 180,
  status: 'ACTIVE',
  status_label: 'Active',
  current_officer: null,
  current_driver: null,
  created_at: '2026-09-01T10:00:00+05:30',
  ...overrides,
});

const BOLERO = vehicle();
const SWIFT = vehicle({ id: 6, registration_number: 'AP39PB5678', make: 'Maruti', model: 'Swift' });
const SCRAPPED = vehicle({ id: 7, registration_number: 'AP39PC9999', status: 'TERMINATED' });

const quota = (overrides: Partial<Quota> = {}): Quota => ({
  month: THIS_MONTH,
  base_litres: '120.00',
  additional_litres: '30.00',
  limit_litres: '150.00',
  used_litres: '90.00',
  remaining_litres: '60.00',
  emergency_used_litres: '0.00',
  emergency_remaining_litres: '10.00',
  additional_balance_litres: '30.00',
  ...overrides,
});

const grant = (overrides: Partial<Grant> = {}): Grant => ({
  id: 9,
  vehicle: 5,
  registration_number: 'AP39PA1234',
  month: THIS_MONTH,
  litres: '20.00',
  approved_by: 'SP Nellore',
  note: 'Election duty',
  letter_url: 'http://localhost:4200/api/fuel/grants/9/letter/',
  created_by_name: 'MTO Nellore',
  created_at: '2026-10-02T10:15:00+05:30',
  ...overrides,
});

const pdf = (name = 'sp-letter.pdf') => new File(['%PDF-1.4'], name, { type: 'application/pdf' });

const QUOTA_URL = '/api/fuel/vehicles/5/quota/';

describe('AdditionalQuotaPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(preselect?: string) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AdditionalQuotaPage);
    if (preselect !== undefined) {
      fixture.componentRef.setInput('vehicle', preselect);
    }
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();

    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const button = (label: string, scope: ParentNode = el) =>
      Array.from(scope.querySelectorAll('button')).find((b) => text(b) === label) as
        HTMLButtonElement | undefined;
    const fill = (selector: string, value: string) => {
      const input = el.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const pick = async (file: File | null) => {
      const input = el.querySelector('#grant-letter') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true });
      input.dispatchEvent(new Event('change'));
      await fixture.whenStable();
    };
    const search = async (term: string, rows: Vehicle[] | 'fail') => {
      fill('#vehicle-search', term);
      button('Search')!.click();
      const req = http.expectOne((r) => r.url === '/api/vehicles/');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('search')).toBe(term.trim());
      if (rows === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(rows);
      }
      await fixture.whenStable();
    };
    /** Answers the quota and the grants of the vehicle that was just selected. */
    const answerSelected = async (q: Quota = quota(), grants: Grant[] = [grant()], id = 5) => {
      http.expectOne(`/api/fuel/vehicles/${id}/quota/`).flush(q);
      const req = http.expectOne((r) => r.url === '/api/fuel/grants/');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('vehicle')).toBe(String(id));
      expect(req.request.params.get('month')).toBe(THIS_MONTH);
      req.flush(grants);
      await fixture.whenStable();
    };
    const select = async (registration: string, q?: Quota, grants?: Grant[], id?: number) => {
      const chip = Array.from(el.querySelectorAll<HTMLButtonElement>('.vehicle-chips .chip')).find(
        (c) => text(c)?.startsWith(registration),
      );
      chip!.click();
      await fixture.whenStable();
      await answerSelected(q, grants, id);
    };
    const toasts = () => TestBed.inject(ToastService).messages();
    const submit = () => button('Add quota')!.click();
    /** Fills the form with a valid grant, apart from what the test overrides. */
    const fillForm = async (letter: File | null = pdf()) => {
      fill('#grant-litres', '20');
      fill('#grant-approved-by', 'SP Nellore');
      fill('#grant-note', 'Election duty');
      await pick(letter);
    };
    return {
      fixture,
      el,
      http,
      text,
      button,
      fill,
      pick,
      search,
      select,
      answerSelected,
      toasts,
      submit,
      fillForm,
    };
  }

  it('starts with a large search field and sends nothing until a search is made', async () => {
    const { el, text } = await setup();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Additional quota');
    expect(text(el.querySelector('label[for="vehicle-search"]'))).toBe('Search vehicle number');
    expect(el.querySelector('#vehicle-search')).not.toBeNull();
    expect(el.querySelector('#grant-litres')).toBeNull();
    expect(text(el)).toContain('Search for a vehicle to add quota to it.');
  });

  it('lists the vehicles found as chips, leaving out terminated ones', async () => {
    const { el, search, text } = await setup();
    await search(' AP39 ', [BOLERO, SWIFT, SCRAPPED]);
    const chips = Array.from(el.querySelectorAll('.vehicle-chips .chip')).map((c) => text(c));
    expect(chips).toEqual(['AP39PA1234', 'AP39PB5678']);
  });

  it('says so when no vehicle matches and shows the error with a retry when the search fails', async () => {
    const { el, http, fixture, search, text, button } = await setup();
    await search('XX', []);
    expect(text(el.querySelector('.search-card'))).toContain('No vehicles match “XX”.');
    await search('AP39', 'fail');
    expect(text(el.querySelector('.search-card .error'))).toBe('Not available.');
    button('Try again')!.click();
    http.expectOne((r) => r.url === '/api/vehicles/').flush([BOLERO]);
    await fixture.whenStable();
    expect(el.querySelectorAll('.vehicle-chips .chip')).toHaveLength(1);
  });

  it('loads the quota and this month’s grants of the vehicle that is selected', async () => {
    const { el, search, select, text } = await setup();
    await search('AP39', [BOLERO, SWIFT]);
    await select('AP39PA1234');
    const card = el.querySelector('#quota-card');
    expect(text(card)).toContain('AP39PA1234');
    expect(text(card)).toContain(monthLabel(THIS_MONTH));
    expect(text(card)).toContain('150 L');
    expect(text(card)).toContain('90 L');
    expect(text(card)).toContain('60 L');
    expect(text(card)).toContain('30 L');
    const rows = Array.from(el.querySelectorAll('#grants .grant'));
    expect(rows).toHaveLength(1);
    expect(text(rows[0])).toContain('20 L');
    expect(text(rows[0])).toContain('SP Nellore');
    expect(text(rows[0])).toContain('MTO Nellore');
    expect(text(rows[0])).toContain('02 Oct 2026');
    expect(text(rows[0])).toContain('Election duty');
    expect(el.querySelector('.vehicle-chips .chip.active')?.textContent?.trim()).toBe('AP39PA1234');
  });

  it('opens each letter in a new tab from its own address', async () => {
    const { el, search, select } = await setup();
    await search('AP39', [BOLERO]);
    await select('AP39PA1234');
    const link = el.querySelector('#grants .grant a') as HTMLAnchorElement;
    expect(link.textContent?.trim()).toBe('View letter');
    expect(link.getAttribute('href')).toBe('/api/fuel/grants/9/letter/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('says so when the vehicle has no grants this month', async () => {
    const { el, search, select, text } = await setup();
    await search('AP39', [BOLERO]);
    await select('AP39PA1234', quota(), []);
    expect(text(el.querySelector('#grants'))).toContain('No additional quota added this month.');
  });

  it('shows a failing card with its own retry while the rest stays', async () => {
    const { el, http, fixture, search, text, button } = await setup();
    await search('AP39', [BOLERO]);
    el.querySelector<HTMLButtonElement>('.vehicle-chips .chip')!.click();
    await fixture.whenStable();
    http
      .expectOne(QUOTA_URL)
      .flush({ detail: 'Quota is not available.' }, { status: 500, statusText: 'Server' });
    http.expectOne((r) => r.url === '/api/fuel/grants/').flush([grant()]);
    await fixture.whenStable();
    expect(text(el.querySelector('#quota-card .error'))).toBe('Quota is not available.');
    expect(el.querySelectorAll('#grants .grant')).toHaveLength(1);
    expect(el.querySelector('#grant-litres')).not.toBeNull();
    button('Try again', el.querySelector('#quota-card')!)!.click();
    http.expectOne(QUOTA_URL).flush(quota());
    await fixture.whenStable();
    expect(el.querySelector('#quota-card .error')).toBeNull();
  });

  it('preselects the vehicle of ?vehicle=<id>', async () => {
    const { el, http, fixture, answerSelected, text } = await setup('5');
    http.expectOne('/api/vehicles/5/').flush(BOLERO);
    await fixture.whenStable();
    await answerSelected();
    expect(text(el.querySelector('#quota-card'))).toContain('AP39PA1234');
    expect(el.querySelector('#grant-litres')).not.toBeNull();
    expect(el.querySelector('.vehicle-chips .chip.active')?.textContent?.trim()).toBe('AP39PA1234');
  });

  it('says so when the preselected vehicle cannot be found', async () => {
    const { el, http, fixture, text } = await setup('999');
    http
      .expectOne('/api/vehicles/999/')
      .flush({ detail: 'Not found.' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(text(el.querySelector('.search-card .error'))).toBe('Not found.');
    expect(el.querySelector('#grant-litres')).toBeNull();
  });

  it('labels every control of the form and offers this month and next month', async () => {
    const { el, search, select, text } = await setup();
    await search('AP39', [BOLERO]);
    await select('AP39PA1234');
    const label = (id: string) => text(el.querySelector(`label[for="${id}"]`));
    expect(label('grant-litres')).toContain('Quantity (L)');
    expect(label('grant-approved-by')).toContain('Approved by');
    expect(label('grant-note')).toBe('Note');
    expect(text(el.querySelector('#grant-letter-label'))).toContain('Approval letter');
    const letter = el.querySelector('#grant-letter') as HTMLInputElement;
    expect(letter.getAttribute('accept')).toBe('.jpg,.jpeg,.png,.pdf');
    const chips = Array.from(el.querySelectorAll('.month-chips .chip'));
    expect(chips.map((c) => text(c))).toEqual(['This month', 'Next month']);
    expect(chips[0].classList.contains('active')).toBe(true);
    expect(text(el.querySelector('.month-hint'))).toContain(monthLabel(THIS_MONTH));
  });

  it('shows the name of the chosen letter', async () => {
    const { el, search, select, pick, text } = await setup();
    await search('AP39', [BOLERO]);
    await select('AP39PA1234');
    expect(text(el.querySelector('.file-input-name'))).toBe('No file chosen');
    await pick(pdf('sp-letter.pdf'));
    expect(text(el.querySelector('.file-input-name'))).toBe('sp-letter.pdf');
  });

  it('takes a letter dropped on the drop zone', async () => {
    const { el, fixture, search, select, text } = await setup();
    await search('AP39', [BOLERO]);
    await select('AP39PA1234');
    const zone = el.querySelector('.drop-zone') as HTMLElement;
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    zone.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [pdf('dropped.pdf')] } });
    zone.dispatchEvent(drop);
    await fixture.whenStable();
    expect(drop.defaultPrevented).toBe(true);
    expect(text(el.querySelector('.file-input-name'))).toBe('dropped.pdf');
  });

  it('refuses a .exe letter on the spot and sends nothing', async () => {
    const { el, http, fixture, search, select, fillForm, submit, text } = await setup();
    await search('AP39', [BOLERO]);
    await select('AP39PA1234');
    await fillForm(new File(['MZ'], 'virus.exe', { type: 'application/octet-stream' }));
    expect(text(el.querySelector('#grant-letter-error'))).toBe(
      'Upload the letter as JPG, PNG or PDF.',
    );
    expect(text(el.querySelector('.file-input-name'))).toBe('No file chosen');
    submit();
    await fixture.whenStable();
    http.expectNone('/api/fuel/grants/');
    expect(text(el.querySelector('#grant-letter-error'))).toBe(
      'Upload the letter as JPG, PNG or PDF.',
    );
  });

  it('accepts letters in capitals such as SCAN.JPG', async () => {
    const { el, search, select, pick, text } = await setup();
    await search('AP39', [BOLERO]);
    await select('AP39PA1234');
    await pick(new File(['x'], 'SCAN.JPG', { type: 'image/jpeg' }));
    expect(el.querySelector('#grant-letter-error')).toBeNull();
    expect(text(el.querySelector('.file-input-name'))).toBe('SCAN.JPG');
  });

  it('refuses a letter over 5 MB on the spot and sends nothing', async () => {
    const { el, http, fixture, search, select, fillForm, submit, text } = await setup();
    await search('AP39', [BOLERO]);
    await select('AP39PA1234');
    const big = pdf('big.pdf');
    Object.defineProperty(big, 'size', { value: 5 * MB + 1 });
    await fillForm(big);
    expect(text(el.querySelector('#grant-letter-error'))).toBe(
      'The letter must be 5 MB or smaller.',
    );
    submit();
    await fixture.whenStable();
    http.expectNone('/api/fuel/grants/');
  });

  it('takes a letter of exactly 5 MB', async () => {
    const { el, search, select, pick } = await setup();
    await search('AP39', [BOLERO]);
    await select('AP39PA1234');
    const exact = pdf('exact.pdf');
    Object.defineProperty(exact, 'size', { value: 5 * MB });
    await pick(exact);
    expect(el.querySelector('#grant-letter-error')).toBeNull();
  });

  it('asks for the letter when none is chosen and sends nothing', async () => {
    const { el, http, fixture, search, select, fillForm, submit, text } = await setup();
    await search('AP39', [BOLERO]);
    await select('AP39PA1234');
    await fillForm(null);
    submit();
    await fixture.whenStable();
    http.expectNone('/api/fuel/grants/');
    expect(text(el.querySelector('#grant-letter-error'))).toBe('Upload the approval letter.');
  });

  it('asks for the quantity and who approved it', async () => {
    const { el, http, fixture, search, select, pick, submit, text } = await setup();
    await search('AP39', [BOLERO]);
    await select('AP39PA1234');
    await pick(pdf());
    submit();
    await fixture.whenStable();
    http.expectNone('/api/fuel/grants/');
    expect(text(el.querySelector('#grant-litres-error'))).toBe('Enter the quantity in litres.');
    expect(text(el.querySelector('#grant-approved-by-error'))).toBe('Enter who approved it.');
    expect(el.querySelector('#grant-letter-error')).toBeNull();
  });

  it('refuses a quantity of zero or less', async () => {
    const { el, http, fixture, search, select, fillForm, fill, submit, text } = await setup();
    await search('AP39', [BOLERO]);
    await select('AP39PA1234');
    await fillForm();
    fill('#grant-litres', '0');
    submit();
    await fixture.whenStable();
    http.expectNone('/api/fuel/grants/');
    expect(text(el.querySelector('#grant-litres-error'))).toBe('Enter the quantity in litres.');
  });

  it('posts the grant as form data, then toasts, clears the form and reloads quota and grants', async () => {
    const { el, http, fixture, search, select, fillForm, submit, answerSelected, toasts, text } =
      await setup();
    await search('AP39', [BOLERO]);
    await select('AP39PA1234');
    await fillForm(pdf('sp-letter.pdf'));
    submit();
    const req = http.expectOne('/api/fuel/grants/');
    expect(req.request.method).toBe('POST');
    const body = req.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('vehicle')).toBe('5');
    expect(body.get('month')).toBe(THIS_MONTH);
    expect(body.get('litres')).toBe('20');
    expect(body.get('approved_by')).toBe('SP Nellore');
    expect(body.get('note')).toBe('Election duty');
    expect((body.get('letter') as File).name).toBe('sp-letter.pdf');
    req.flush(grant({ id: 10 }), { status: 201, statusText: 'Created' });
    await fixture.whenStable();
    expect(toasts()[0]).toMatchObject({
      text: `Added 20 L to AP39PA1234 for ${monthLabel(THIS_MONTH)}.`,
      tone: 'success',
    });
    // The quota and the list are read again, and the form starts over.
    await answerSelected(quota({ additional_litres: '50.00' }), [grant({ id: 10 }), grant()]);
    expect(el.querySelectorAll('#grants .grant')).toHaveLength(2);
    expect(text(el.querySelector('#quota-card'))).toContain('50 L');
    expect((el.querySelector('#grant-litres') as HTMLInputElement).value).toBe('');
    expect((el.querySelector('#grant-approved-by') as HTMLInputElement).value).toBe('');
    expect(text(el.querySelector('.file-input-name'))).toBe('No file chosen');
  });

  it('adds quota for next month when that chip is chosen', async () => {
    const { el, http, fixture, search, select, fillForm, button, submit, answerSelected, text } =
      await setup();
    await search('AP39', [BOLERO]);
    await select('AP39PA1234');
    button('Next month')!.click();
    await fixture.whenStable();
    expect(text(el.querySelector('.month-hint'))).toContain(monthLabel(NEXT_MONTH));
    expect(button('Next month')!.classList.contains('active')).toBe(true);
    await fillForm();
    submit();
    const req = http.expectOne('/api/fuel/grants/');
    expect((req.request.body as FormData).get('month')).toBe(NEXT_MONTH);
    req.flush(grant({ month: NEXT_MONTH }), { status: 201, statusText: 'Created' });
    await fixture.whenStable();
    await answerSelected();
  });

  it('shows the API message when the grant is refused and keeps what was typed', async () => {
    const { el, http, fixture, search, select, fillForm, submit, toasts, text } = await setup();
    await search('AP39', [BOLERO]);
    await select('AP39PA1234');
    await fillForm();
    submit();
    http
      .expectOne('/api/fuel/grants/')
      .flush(
        { letter: ['Upload the letter as JPG, PNG or PDF.'] },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(text(el.querySelector('.grant-form .error'))).toBe(
      'letter: Upload the letter as JPG, PNG or PDF.',
    );
    expect(toasts()).toHaveLength(0);
    expect((el.querySelector('#grant-litres') as HTMLInputElement).value).toBe('20');
    expect(text(el.querySelector('.file-input-name'))).toBe('sp-letter.pdf');
    http.expectNone((r) => r.method === 'GET');
  });

  it('starts the form over when another vehicle is selected', async () => {
    const { el, search, select, fillForm, text } = await setup();
    await search('AP39', [BOLERO, SWIFT]);
    await select('AP39PA1234');
    await fillForm();
    await select('AP39PB5678', quota(), [], 6);
    expect(text(el.querySelector('#quota-card'))).toContain('AP39PB5678');
    expect((el.querySelector('#grant-litres') as HTMLInputElement).value).toBe('');
    expect(text(el.querySelector('.file-input-name'))).toBe('No file chosen');
  });
});
