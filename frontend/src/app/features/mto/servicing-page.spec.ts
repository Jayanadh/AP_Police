import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ServiceDue } from '../../core/api/servicing-api';
import { ServicingPage } from './servicing-page';

const due = (overrides: Partial<ServiceDue> = {}): ServiceDue => ({
  vehicle: 5,
  registration_number: 'AP39PA1234',
  due: true,
  last_service_date: '2026-04-01',
  last_service_km: 10000,
  km_since: 5200,
  days_since: 184,
  next_due_km: 15000,
  next_due_date: '2026-09-28',
  ...overrides,
});

const BOLERO = due();
const SWIFT = due({
  vehicle: 6,
  registration_number: 'AP39PB5678',
  last_service_date: '2026-08-15',
  last_service_km: 800,
  km_since: 5100,
  days_since: 49,
  next_due_km: 5800,
  next_due_date: null,
});

describe('ServicingPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(rows: ServiceDue[] | 'fail' = [BOLERO, SWIFT]) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ServicingPage);
    const el = fixture.nativeElement as HTMLElement;
    const answer = async (body: ServiceDue[] | 'fail') => {
      const req = http.expectOne('/api/service-due/');
      expect(req.request.method).toBe('GET');
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
    };
    await answer(rows);
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const cards = () => Array.from(el.querySelectorAll<HTMLElement>('.due'));
    const fact = (card: HTMLElement, label: string) =>
      text(
        Array.from(card.querySelectorAll('.facts > div'))
          .find((row) => text(row.querySelector('dt')) === label)
          ?.querySelector('dd'),
      );
    return { fixture, el, text, cards, fact, answer };
  }

  it('lists each vehicle that is due, with its registration linking to the vehicle', async () => {
    const { el, text, cards } = await setup();
    expect(text(el.querySelector('h1'))).toBe('Servicing');
    const links = cards().map((card) => card.querySelector('a')!);
    expect(links.map((a) => text(a))).toEqual(['AP39PA1234', 'AP39PB5678']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/mto/vehicles/5',
      '/mto/vehicles/6',
    ]);
  });

  it('shows the last service, the km and days since, and the next due', async () => {
    const { cards, fact } = await setup();
    const [bolero, swift] = cards();
    expect(fact(bolero, 'Last service')).toBe('01 Apr 2026 at 10,000 km');
    expect(fact(bolero, 'Km since')).toBe('5,200 km');
    expect(fact(bolero, 'Days since')).toBe('184 days');
    expect(fact(bolero, 'Next due')).toBe('15,000 km or 28 Sep 2026');

    expect(fact(swift, 'Last service')).toBe('15 Aug 2026 at 800 km');
    expect(fact(swift, 'Km since')).toBe('5,100 km');
    expect(fact(swift, 'Days since')).toBe('49 days');
    expect(fact(swift, 'Next due')).toBe('5,800 km');
  });

  it('says so when no vehicle is due', async () => {
    const { el, text, cards } = await setup([]);
    expect(cards().length).toBe(0);
    expect(text(el.querySelector('app-empty-state'))).toContain(
      'No vehicles are due for a service.',
    );
  });

  it('shows the error and reads again on Try again', async () => {
    const { el, text, answer, cards } = await setup('fail');
    expect(text(el.querySelector('[role="alert"]'))).toBe('Not available.');
    const retry = Array.from(el.querySelectorAll('button')).find(
      (b) => text(b) === 'Try again',
    ) as HTMLButtonElement;
    retry.click();
    await answer([BOLERO]);
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(cards().length).toBe(1);
  });
});
