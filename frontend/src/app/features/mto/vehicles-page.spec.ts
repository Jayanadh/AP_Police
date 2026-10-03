import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Vehicle } from '../../core/api/vehicles-api';
import { ToastService } from '../../ui/toast';
import { VehiclesPage } from './vehicles-page';

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
  current_officer: {
    assignment_id: 11,
    id: 21,
    full_name: 'Suresh Reddy',
    emp_id: 'AP3001',
    mobile: '9000000021',
  },
  current_driver: {
    assignment_id: 12,
    id: 31,
    full_name: 'Ramesh Babu',
    emp_id: 'AP4001',
    mobile: '9000000031',
  },
  created_at: '2026-09-01T10:00:00+05:30',
  ...overrides,
});

const BOLERO = vehicle();
const SWIFT = vehicle({
  id: 6,
  registration_number: 'AP39PB5678',
  make: 'Maruti',
  model: 'Swift',
  fuel_type: 'PETROL',
  monthly_fuel_limit_litres: '45.50',
  status: 'PAUSED',
  status_label: 'Paused',
  current_officer: null,
  current_driver: null,
});

describe('VehiclesPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(rows: Vehicle[] | 'fail' = [BOLERO, SWIFT]) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(VehiclesPage);
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();

    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    /** Answers the next list request whatever its filters, and returns its parameters. */
    const replyList = async (body: Vehicle[] | 'fail') => {
      const req = http.expectOne((r) => r.url === '/api/vehicles/' && r.method === 'GET');
      const params = Object.fromEntries(
        req.request.params.keys().map((k) => [k, req.request.params.get(k)]),
      );
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
      return params;
    };
    await replyList(rows);

    const cards = () => Array.from(el.querySelectorAll<HTMLElement>('a.vehicle'));
    const button = (label: string) =>
      Array.from(el.querySelectorAll('button')).find((b) => text(b) === label) as
        HTMLButtonElement | undefined;
    const fill = (selector: string, value: string) => {
      const input = el.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const toasts = () => TestBed.inject(ToastService).messages();
    return { fixture, el, http, text, replyList, cards, button, fill, toasts };
  }

  it('lists the vehicles with their details', async () => {
    const { el, cards, text } = await setup();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Vehicles');
    expect(cards()).toHaveLength(2);
    const first = cards()[0];
    expect(text(first.querySelector('.registration'))).toBe('AP39PA1234');
    expect(text(first)).toContain('Mahindra Bolero');
    expect(text(first.querySelector('.chip'))).toBe('Diesel');
    expect(text(first)).toContain('Suresh Reddy');
    expect(text(first)).toContain('Ramesh Babu');
    expect(text(first.querySelector('app-status-badge'))).toBe('Active');
    expect(text(first)).toContain('120 L');
  });

  it('says "Not linked" when a vehicle has no officer or driver', async () => {
    const { cards, text } = await setup();
    const second = cards()[1];
    expect(text(second.querySelector('.chip'))).toBe('Petrol');
    expect(text(second.querySelector('app-status-badge'))).toBe('Paused');
    expect(text(second)).toContain('45.5 L');
    expect(text(second.querySelector('[data-role="officer"]'))).toContain('Not linked');
    expect(text(second.querySelector('[data-role="driver"]'))).toContain('Not linked');
  });

  it('opens a vehicle on its own page', async () => {
    const { cards } = await setup();
    expect(cards().map((card) => card.getAttribute('href'))).toEqual([
      '/mto/vehicles/5',
      '/mto/vehicles/6',
    ]);
  });

  it('has a chip for every status', async () => {
    const { el, text } = await setup();
    const chips = Array.from(el.querySelectorAll('.chips .chip')).map((c) => text(c));
    expect(chips).toEqual(['All', 'Active', 'Paused', 'Termination pending', 'Terminated']);
  });

  it('searches by registration number when the search is submitted', async () => {
    const { fixture, el, fill, replyList, cards } = await setup();
    fill('input[type="search"]', 'pb56');
    await fixture.whenStable();
    (el.querySelector('form[role="search"] button[type="submit"]') as HTMLButtonElement).click();
    const params = await replyList([SWIFT]);
    expect(params).toEqual({ search: 'pb56' });
    expect(cards()).toHaveLength(1);
  });

  it('shows every vehicle again when the search is cleared', async () => {
    const { fixture, el, fill, replyList, cards } = await setup();
    fill('input[type="search"]', 'pb56');
    (el.querySelector('form[role="search"] button[type="submit"]') as HTMLButtonElement).click();
    await replyList([SWIFT]);
    fill('input[type="search"]', '');
    await fixture.whenStable();
    expect(await replyList([BOLERO, SWIFT])).toEqual({});
    expect(cards()).toHaveLength(2);
  });

  it('filters by status with the chips and keeps the search', async () => {
    const { fixture, el, fill, button, replyList, cards } = await setup();
    fill('input[type="search"]', 'ap39');
    (el.querySelector('form[role="search"] button[type="submit"]') as HTMLButtonElement).click();
    await replyList([BOLERO, SWIFT]);
    button('Paused')!.click();
    expect(await replyList([SWIFT])).toEqual({ search: 'ap39', status: 'PAUSED' });
    expect(cards()).toHaveLength(1);
    expect(button('Paused')!.getAttribute('aria-pressed')).toBe('true');
    button('All')!.click();
    expect(await replyList([BOLERO, SWIFT])).toEqual({ search: 'ap39' });
    await fixture.whenStable();
  });

  it('says so when no vehicle matches', async () => {
    const { fixture, el, fill, replyList, text } = await setup();
    fill('input[type="search"]', 'zz');
    (el.querySelector('form[role="search"] button[type="submit"]') as HTMLButtonElement).click();
    await replyList([]);
    await fixture.whenStable();
    expect(text(el.querySelector('app-empty-state'))).toContain('No vehicles match');
  });

  it('invites the first vehicle when there are none', async () => {
    const { el, text } = await setup([]);
    expect(text(el.querySelector('app-empty-state'))).toContain('No vehicles yet');
  });

  it('shows the error and tries again', async () => {
    const { fixture, el, button, replyList, cards, text } = await setup('fail');
    expect(text(el.querySelector('[role="alert"]'))).toBe('Not available.');
    button('Try again')!.click();
    await replyList([BOLERO]);
    await fixture.whenStable();
    expect(cards()).toHaveLength(1);
  });

  it('adds a vehicle: opens the form, posts it, closes it and shows the list again', async () => {
    const { fixture, el, http, button, replyList, toasts, text, cards } = await setup();
    expect(el.querySelector('app-vehicle-form')).toBeNull();
    button('Add vehicle')!.click();
    await fixture.whenStable();
    expect(el.querySelector('app-vehicle-form')).not.toBeNull();

    const set = (id: string, value: string) => {
      const input = el.querySelector(`#${id}`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    set('vehicle-registration', 'ap39pc9999');
    const type = el.querySelector('#vehicle-type') as HTMLSelectElement;
    type.value = Array.from(type.options).find((o) => text(o) === 'Car')!.value;
    type.dispatchEvent(new Event('change'));
    set('vehicle-make', 'Maruti');
    set('vehicle-model', 'Ertiga');
    (
      Array.from(el.querySelectorAll('app-vehicle-form button')).find(
        (b) => text(b) === 'Petrol',
      ) as HTMLButtonElement
    ).click();
    set('vehicle-tank', '45');
    set('vehicle-limit', '90');
    await fixture.whenStable();
    (el.querySelector('app-vehicle-form button[type="submit"]') as HTMLButtonElement).click();

    const post = http.expectOne((r) => r.url === '/api/vehicles/' && r.method === 'POST');
    expect(post.request.body['registration_number']).toBe('AP39PC9999');
    expect(post.request.body['fuel_type']).toBe('PETROL');
    post.flush(vehicle({ id: 7, registration_number: 'AP39PC9999' }));
    await fixture.whenStable();

    expect(el.querySelector('app-vehicle-form')).toBeNull();
    expect(toasts().map((t) => t.text)).toEqual(['Vehicle added.']);
    await replyList([BOLERO, SWIFT, vehicle({ id: 7, registration_number: 'AP39PC9999' })]);
    expect(cards()).toHaveLength(3);
  });

  it('closes the form when it is cancelled', async () => {
    const { fixture, el, button } = await setup();
    button('Add vehicle')!.click();
    await fixture.whenStable();
    button('Cancel')!.click();
    await fixture.whenStable();
    expect(el.querySelector('app-vehicle-form')).toBeNull();
  });
});
