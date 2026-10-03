import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Vehicle } from '../../core/api/vehicles-api';
import { VehicleForm } from './vehicle-form';

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

describe('VehicleForm', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(existing: Vehicle | null = null) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(VehicleForm);
    if (existing) {
      fixture.componentRef.setInput('vehicle', existing);
    }
    const saved: Vehicle[] = [];
    let cancelled = 0;
    fixture.componentInstance.saved.subscribe((row) => saved.push(row));
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const field = (id: string) => el.querySelector(`#${id}`) as HTMLInputElement | null;
    const label = (id: string) => text(el.querySelector(`label[for="${id}"]`));
    const fill = (id: string, value: string) => {
      const input = field(id)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const choose = (id: string, optionLabel: string) => {
      const select = el.querySelector(`#${id}`) as HTMLSelectElement;
      const option = Array.from(select.options).find((o) => text(o) === optionLabel)!;
      select.value = option.value;
      select.dispatchEvent(new Event('change'));
    };
    const button = (name: string) =>
      Array.from(el.querySelectorAll('button')).find((b) => text(b) === name) as
        HTMLButtonElement | undefined;
    const fillAll = async () => {
      fill('vehicle-registration', 'ap39pa1234');
      choose('vehicle-type', 'Jeep');
      fill('vehicle-make', ' Mahindra ');
      fill('vehicle-model', 'Bolero');
      fill('vehicle-year', '2022');
      button('Diesel')!.click();
      fill('vehicle-tank', '60');
      fill('vehicle-chassis', 'CH123');
      fill('vehicle-engine', 'EN456');
      fill('vehicle-odometer', '1200');
      fill('vehicle-limit', '120');
      fill('vehicle-service-km', '5000');
      fill('vehicle-service-days', '180');
      await fixture.whenStable();
    };
    const submit = () => (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    return {
      fixture,
      el,
      http,
      saved,
      cancelled: () => cancelled,
      text,
      field,
      label,
      fill,
      choose,
      button,
      fillAll,
      submit,
    };
  }

  it('asks for the registration, type, make, model, year, fuel, tank, chassis, engine, odometer, limit and service intervals', async () => {
    const { label, button, el, text } = await setup();
    expect(label('vehicle-registration')).toBe('Registration number');
    expect(label('vehicle-type')).toBe('Type');
    expect(label('vehicle-make')).toBe('Make');
    expect(label('vehicle-model')).toBe('Model');
    expect(label('vehicle-year')).toBe('Year');
    expect(text(el.querySelector('#vehicle-fuel-label'))).toBe('Fuel type');
    expect(label('vehicle-tank')).toBe('Tank capacity (L)');
    expect(label('vehicle-chassis')).toBe('Chassis no.');
    expect(label('vehicle-engine')).toBe('Engine no.');
    expect(label('vehicle-odometer')).toBe('Odometer at onboarding (km)');
    expect(label('vehicle-limit')).toBe('Monthly fuel limit (L)');
    expect(label('vehicle-service-km')).toBe('Service every (km)');
    expect(label('vehicle-service-days')).toBe('Service every (days)');
    expect(button('Petrol')).toBeTruthy();
    expect(button('Diesel')).toBeTruthy();
    expect(button('Add vehicle')).toBeTruthy();
    expect(text(el.querySelector('h2'))).toBe('Add vehicle');
  });

  it('offers the vehicle types', async () => {
    const { el, text } = await setup();
    const options = Array.from(el.querySelectorAll('#vehicle-type option')).map((o) => text(o));
    expect(options).toEqual([
      'Select type',
      'Car',
      'Jeep',
      'Motorcycle',
      'Van',
      'Bus',
      'Truck',
      'Other',
    ]);
  });

  it('uppercases the registration number as it is typed', async () => {
    const { field, fill, fixture } = await setup();
    fill('vehicle-registration', 'ap39pa1234');
    await fixture.whenStable();
    expect(field('vehicle-registration')!.value).toBe('AP39PA1234');
  });

  it('shows which fuel is chosen, one at a time', async () => {
    const { button, fixture } = await setup();
    const petrol = button('Petrol')!;
    const diesel = button('Diesel')!;
    expect(petrol.getAttribute('aria-pressed')).toBe('false');
    expect(diesel.getAttribute('aria-pressed')).toBe('false');
    petrol.click();
    await fixture.whenStable();
    expect(petrol.getAttribute('aria-pressed')).toBe('true');
    expect(petrol.classList.contains('active')).toBe(true);
    diesel.click();
    await fixture.whenStable();
    expect(petrol.getAttribute('aria-pressed')).toBe('false');
    expect(diesel.getAttribute('aria-pressed')).toBe('true');
  });

  it('sends the whole vehicle with an uppercased registration and emits what the server saved', async () => {
    const { http, fixture, saved, fillAll, submit } = await setup();
    await fillAll();
    submit();
    const req = http.expectOne('/api/vehicles/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      registration_number: 'AP39PA1234',
      vehicle_type: 'JEEP',
      make: 'Mahindra',
      model: 'Bolero',
      year_of_manufacture: 2022,
      fuel_type: 'DIESEL',
      tank_capacity_litres: 60,
      chassis_number: 'CH123',
      engine_number: 'EN456',
      odometer_at_onboarding_km: 1200,
      monthly_fuel_limit_litres: 120,
      service_interval_km: 5000,
      service_interval_days: 180,
    });
    req.flush(vehicle());
    await fixture.whenStable();
    expect(saved.map((row) => row.id)).toEqual([5]);
  });

  it('sends empty optional fields as nothing: no year or interval, an odometer of 0', async () => {
    const { http, fill, choose, button, fixture, submit } = await setup();
    fill('vehicle-registration', 'AP39PA1234');
    choose('vehicle-type', 'Car');
    fill('vehicle-make', 'Maruti');
    fill('vehicle-model', 'Ertiga');
    button('Petrol')!.click();
    fill('vehicle-tank', '45.5');
    fill('vehicle-limit', '90');
    await fixture.whenStable();
    submit();
    const req = http.expectOne('/api/vehicles/');
    expect(req.request.body).toEqual({
      registration_number: 'AP39PA1234',
      vehicle_type: 'CAR',
      make: 'Maruti',
      model: 'Ertiga',
      year_of_manufacture: null,
      fuel_type: 'PETROL',
      tank_capacity_litres: 45.5,
      chassis_number: '',
      engine_number: '',
      odometer_at_onboarding_km: 0,
      monthly_fuel_limit_litres: 90,
      service_interval_km: null,
      service_interval_days: null,
    });
    req.flush(vehicle());
  });

  it('does not send a vehicle that misses a required detail', async () => {
    const { el, fixture, fill, submit, text } = await setup();
    fill('vehicle-registration', 'AP39PA1234');
    await fixture.whenStable();
    submit();
    await fixture.whenStable();
    expect(text(el.querySelector('[role="alert"]'))).toBe(
      'Fill in the registration number, type, make, model, fuel type, tank capacity and monthly fuel limit.',
    );
  });

  it('shows what the server refuses and keeps the form open', async () => {
    const { http, el, fixture, saved, fillAll, submit, text } = await setup();
    await fillAll();
    submit();
    http
      .expectOne('/api/vehicles/')
      .flush(
        { registration_number: ['A vehicle with this registration number already exists.'] },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(text(el.querySelector('[role="alert"]'))).toBe(
      'registration number: A vehicle with this registration number already exists.',
    );
    expect(saved).toEqual([]);
    expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('leaves judging the numbers to the server, so its reason is what the user reads', async () => {
    const { http, el, fill, fillAll, fixture, submit, text } = await setup();
    await fillAll();
    fill('vehicle-tank', '-5');
    await fixture.whenStable();
    submit();
    const req = http.expectOne('/api/vehicles/');
    expect(req.request.body['tank_capacity_litres']).toBe(-5);
    req.flush(
      { tank_capacity_litres: ['Tank capacity must be more than 0.'] },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();
    expect(text(el.querySelector('[role="alert"]'))).toBe(
      'tank capacity litres: Tank capacity must be more than 0.',
    );
  });

  it('does not send twice while the first answer is awaited', async () => {
    const { http, fillAll, submit, fixture } = await setup();
    await fillAll();
    submit();
    submit();
    http.expectOne('/api/vehicles/').flush(vehicle());
    await fixture.whenStable();
  });

  it('is filled in when changing a vehicle, and sends a PATCH', async () => {
    const { http, el, field, text, selectedType, submit, fixture, saved } = await changing();
    expect(text(el.querySelector('h2'))).toBe('Edit AP39PA1234');
    expect(field('vehicle-registration')!.value).toBe('AP39PA1234');
    expect(selectedType()).toBe('Jeep');
    expect(field('vehicle-make')!.value).toBe('Mahindra');
    expect(field('vehicle-year')!.value).toBe('2022');
    expect(field('vehicle-tank')!.value).toBe('60');
    expect(field('vehicle-limit')!.value).toBe('120');
    expect(field('vehicle-service-km')!.value).toBe('5000');
    expect(Array.from(el.querySelectorAll('.chip.active')).map((chip) => text(chip))).toEqual([
      'Diesel',
    ]);
    submit();
    const req = http.expectOne('/api/vehicles/5/');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body['registration_number']).toBe('AP39PA1234');
    expect(req.request.body['monthly_fuel_limit_litres']).toBe(120);
    req.flush(vehicle());
    await fixture.whenStable();
    expect(saved).toHaveLength(1);
  });

  it('shows the intervals of a vehicle that has none as empty', async () => {
    const { field } = await changing(
      vehicle({
        service_interval_km: null,
        service_interval_days: null,
        year_of_manufacture: null,
      }),
    );
    expect(field('vehicle-service-km')!.value).toBe('');
    expect(field('vehicle-service-days')!.value).toBe('');
    expect(field('vehicle-year')!.value).toBe('');
  });

  it('tells the page when it is cancelled', async () => {
    const { button, cancelled } = await setup();
    button('Cancel')!.click();
    expect(cancelled()).toBe(1);
  });

  async function changing(existing: Vehicle = vehicle()) {
    const base = await setup(existing);
    const selectedType = () => {
      const select = base.el.querySelector('#vehicle-type') as HTMLSelectElement;
      return base.text(select.selectedOptions[0]);
    };
    return { ...base, selectedType };
  }
});
