import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MonitorPage, MonitorVehicle } from '../../core/api/monitor-api';
import { Unit } from '../../core/api/units-api';
import { makeMonitorVehicle, monitorPage, stubFileSaving } from '../../core/test-data';
import { MonitorVehiclesPage } from './monitor-vehicles-page';

const URL = '/api/monitor/vehicles/';
const BOLERO = makeMonitorVehicle();
const SWIFT = makeMonitorVehicle({
  id: 2,
  registration_number: 'AP07PB2001',
  make: 'Maruti Suzuki',
  model: 'Swift',
  unit: 4,
  unit_name: 'Guntur MTO',
  status: 'PAUSED',
  status_label: 'Paused',
  driver: null,
  officer: null,
  limit_litres: '80.00',
  used_litres: '90.00',
  remaining_litres: '-10.00',
  last_odometer_km: null,
  last_odometer_week: null,
  service_due: false,
});

describe('MonitorVehiclesPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(first: MonitorPage<MonitorVehicle> | 'fail' = monitorPage([BOLERO, SWIFT])) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MonitorVehiclesPage);
    const el = fixture.nativeElement as HTMLElement;
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
    http.expectOne('/api/units/').flush([
      { id: 4, name: 'Guntur MTO' },
      { id: 3, name: 'SPSR Nellore MTO' },
    ] as Unit[]);
    await answer(URL, first);
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const cards = () => Array.from(el.querySelectorAll<HTMLElement>('.vehicle'));
    const button = (name: string) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => text(b) === name);
    const settle = () => fixture.whenStable();
    return { fixture, el, http, answer, text, cards, button, settle };
  }

  it('is a read-only view of every office’s vehicles', async () => {
    const { el, text } = await setup();
    expect(text(el.querySelector('h1'))).toBe('Vehicles');
    expect(text(el.querySelector('.page-header'))).toContain('read only');
  });

  it('shows each vehicle with its office, status, people, this month’s fuel, odometer and service', async () => {
    const { cards, text } = await setup();
    const bolero = cards()[0];
    expect(text(bolero.querySelector('.registration'))).toBe('AP39PA1001');
    expect(text(bolero)).toContain('Mahindra Bolero');
    expect(text(bolero)).toContain('SPSR Nellore MTO');
    expect(text(bolero.querySelector('app-status-badge'))).toBe('Active');
    expect(text(bolero.querySelector('.driver'))).toBe('Driver Ravi Kumar · 9876543210');
    expect(text(bolero.querySelector('.officer'))).toBe('Officer S. Venkata Rao');
    expect(text(bolero.querySelector('.fuel'))).toContain('40 L of 180 L');
    expect(text(bolero.querySelector('.fuel'))).toContain('140 L left');
    expect(bolero.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('22');
    expect(text(bolero.querySelector('.odometer'))).toBe('Odometer 12,480 km, week of 27 Sep 2026');
    expect(text(bolero.querySelector('.service-badge'))).toBe('Service due');
  });

  it('shows what is missing and an emergency overdraw plainly', async () => {
    const { cards, text } = await setup();
    const swift = cards()[1];
    expect(text(swift.querySelector('app-status-badge'))).toBe('Paused');
    expect(text(swift.querySelector('.driver'))).toBe('Driver None linked');
    expect(text(swift.querySelector('.officer'))).toBe('Officer None linked');
    expect(text(swift.querySelector('.fuel'))).toContain('10 L over');
    expect(swift.querySelector('.progress')?.classList.contains('danger')).toBe(true);
    expect(text(swift.querySelector('.odometer'))).toBe('Odometer No reading yet');
    expect(swift.querySelector('.service-badge')).toBeNull();
  });

  it('offers no actions on a vehicle', async () => {
    const { cards } = await setup();
    expect(cards()[0].querySelector('button, a')).toBeNull();
  });

  it('narrows the list by office, status and registration, back on the first page', async () => {
    const { el, answer, button, settle } = await setup();
    const office = el.querySelector('#monitor-unit') as HTMLSelectElement;
    office.value = '3';
    office.dispatchEvent(new Event('change'));
    await settle();
    await answer(`${URL}?unit=3`, monitorPage([BOLERO]));

    button('Paused')!.click();
    await settle();
    await answer(`${URL}?unit=3&status=PAUSED`, monitorPage([]));

    const search = el.querySelector('#monitor-search') as HTMLInputElement;
    expect(el.querySelector('label[for="monitor-search"]')?.textContent?.trim()).toBe(
      'Registration',
    );
    search.value = 'ap39';
    search.dispatchEvent(new Event('input'));
    el.querySelector('form.search')!.dispatchEvent(new Event('submit'));
    await settle();
    await answer(`${URL}?unit=3&status=PAUSED&search=ap39`, monitorPage([]));
  });

  it('downloads every vehicle the filters find, not just this page, as Excel', async () => {
    const { el, answer, http, settle } = await setup();
    const office = el.querySelector('#monitor-unit') as HTMLSelectElement;
    office.value = '3';
    office.dispatchEvent(new Event('change'));
    await settle();
    await answer(`${URL}?unit=3`, monitorPage([BOLERO]));
    stubFileSaving();

    el.querySelector<HTMLButtonElement>('app-download-button button')!.click();
    await settle();

    http.expectOne('/api/monitor/vehicles/export/?unit=3').flush(new Blob(['x']));
  });

  it('pages through the vehicles fifty at a time', async () => {
    const full = Array.from({ length: 50 }, (_, i) => makeMonitorVehicle({ id: i + 1 }));
    const { el, text, button, answer, settle } = await setup(
      monitorPage(full, { count: 51, pages: 2 }),
    );
    expect(text(el.querySelector('.count'))).toBe('Showing 1–50 of 51');
    expect(button('Previous')!.disabled).toBe(true);
    button('Next')!.click();
    await settle();
    await answer(`${URL}?page=2`, monitorPage([SWIFT], { count: 51, page: 2, pages: 2 }));
    expect(text(el.querySelector('.count'))).toBe('Showing 51–51 of 51');
    expect(button('Next')!.disabled).toBe(true);
    expect(button('Previous')!.disabled).toBe(false);
  });

  it('says so when no vehicle matches', async () => {
    const { el, text } = await setup(monitorPage([]));
    expect(text(el.querySelector('app-empty-state'))).toContain('No vehicles match.');
    expect(el.querySelector('.pager')).toBeNull();
  });

  it('shows a load error with a retry', async () => {
    const { el, text, button, answer, settle, cards } = await setup('fail');
    expect(text(el.querySelector('.error'))).toBe('Not available.');
    button('Try again')!.click();
    await settle();
    await answer(URL, monitorPage([BOLERO]));
    expect(cards()).toHaveLength(1);
  });
});
