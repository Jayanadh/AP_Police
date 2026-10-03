import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CheckedRequest, FuelRequest, IncomingRequest } from '../../core/api/fuel-requests-api';
import { fixedClock, makeFuelRequest } from '../../core/test-data';
import { FillPage, INCOMING_POLL_MS } from './fill-page';

const INCOMING_URL = '/api/fuel/incoming/';
/** Today's fills: the page asks for today's date in India. */
const FILLS_URL = '/api/fuel/pump-fills/?from=2026-10-15&to=2026-10-15';

// The page reads "today" from the clock, so the specs fix it: noon on 15 Oct 2026, Kolkata time.
const NOON = '2026-10-15T12:00:00+05:30';
let now = NOON;

const BOLERO: IncomingRequest = {
  id: 14,
  vehicle: 3,
  registration_number: 'AP39PA1234',
  vehicle_name: 'Mahindra Bolero',
  driver_name: 'Ravi Kumar',
  driver_mobile: '9876543210',
  fuel_type: 'DIESEL',
  is_emergency: false,
  issued_at: '2026-10-15T11:40:00+05:30',
  expires_at: '2026-10-16T11:40:00+05:30',
};
const SWIFT: IncomingRequest = {
  ...BOLERO,
  id: 15,
  vehicle: 4,
  registration_number: 'AP07PB2001',
  vehicle_name: 'Maruti Suzuki Swift',
  driver_name: 'G. Prasad',
  driver_mobile: '',
  fuel_type: 'PETROL',
  is_emergency: true,
};
const CHECKED: CheckedRequest = { ...BOLERO, litres_requested: '20.00', emergency_reason: '' };

const TODAY_ONE = makeFuelRequest({
  id: 30,
  registration_number: 'AP39PB5678',
  driver_name: 'Gopal Rao',
  litres_filled: '25.50',
  filled_at: '2026-10-15T10:55:00+05:30',
});
const TODAY_EMERGENCY = makeFuelRequest({
  id: 31,
  litres_filled: '34.00',
  emergency_litres: '4.00',
  emergency_status: 'PENDING',
  is_emergency: true,
  filled_at: '2026-10-15T10:00:00+05:30',
});

describe('FillPage', () => {
  beforeEach(() => {
    now = NOON;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        fixedClock(() => now),
        { provide: INCOMING_POLL_MS, useValue: 3_600_000 },
      ],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(
    waiting: IncomingRequest[] | 'fail' = [BOLERO, SWIFT],
    fills: FuelRequest[] | 'fail' = [TODAY_ONE, TODAY_EMERGENCY],
  ) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(FillPage);
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    const answer = async (url: string, body: unknown) => {
      const req = http.expectOne(url);
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body as object);
      }
      await fixture.whenStable();
    };
    await answer(INCOMING_URL, waiting);
    await answer(FILLS_URL, fills);

    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const rows = () => Array.from(el.querySelectorAll('#incoming .incoming-row'));
    const pinBox = () => el.querySelector<HTMLInputElement>('#fill-pin')!;
    const choose = async (index: number) => {
      rows()[index].querySelector('button')!.click();
      await fixture.whenStable();
    };
    const typePin = async (value: string) => {
      pinBox().value = value;
      pinBox().dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const button = (label: string) =>
      Array.from(el.querySelectorAll('button')).find((b) => text(b)?.startsWith(label));
    const press = async (label: string) => {
      button(label)!.click();
      await fixture.whenStable();
    };
    const checkPin = async (pin = '482917', reply: CheckedRequest | string = CHECKED) => {
      await choose(0);
      await typePin(pin);
      await press('Check PIN');
      const req = http.expectOne(`${INCOMING_URL}14/check-pin/`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ pin });
      if (typeof reply === 'string') {
        req.flush({ detail: reply }, { status: 400, statusText: 'Bad Request' });
      } else {
        req.flush(reply);
      }
      await fixture.whenStable();
    };
    return {
      fixture,
      el,
      http,
      text,
      rows,
      pinBox,
      choose,
      typePin,
      button,
      press,
      checkPin,
      answer,
    };
  }

  describe('the vehicles waiting at this pump', () => {
    it('lists who is coming, oldest first, without the litres', async () => {
      const { rows, text } = await setup();
      expect(rows().length).toBe(2);
      expect(text(rows()[0])).toContain('AP39PA1234');
      expect(text(rows()[0])).toContain('Mahindra Bolero');
      expect(text(rows()[0])).toContain('Ravi Kumar');
      expect(text(rows()[0])).toContain('Diesel');
      expect(text(rows()[0])).not.toContain('L ');
      expect(rows()[0].querySelector('a[href="tel:9876543210"]')).not.toBeNull();
      expect(text(rows()[1].querySelector('.emergency-badge'))).toBe('Emergency');
    });

    it('says so when nobody is waiting', async () => {
      const { el, text } = await setup([]);
      expect(text(el.querySelector('#incoming'))).toContain('No vehicles waiting');
    });

    it('can be read again', async () => {
      const { press, answer, rows } = await setup([]);
      await press('Refresh');
      await answer(INCOMING_URL, [BOLERO]);
      expect(rows().length).toBe(1);
    });

    it('shows the error with a way to try again', async () => {
      const { el, text, answer, rows } = await setup('fail');
      expect(text(el.querySelector('#incoming .error'))).toBe('Not available.');
      el.querySelector<HTMLButtonElement>('#incoming button.retry')!.click();
      await answer(INCOMING_URL, [BOLERO]);
      expect(rows().length).toBe(1);
    });
  });

  describe('filling one', () => {
    it('asks for the PIN of the chosen vehicle', async () => {
      const { el, choose, text, pinBox } = await setup();
      await choose(1);
      expect(text(el.querySelector('#fill-card'))).toContain('AP07PB2001');
      expect(text(el.querySelector('#fill-card'))).toContain('G. Prasad');
      expect(pinBox()).not.toBeNull();
      expect(el.querySelector('#fill-litres')).toBeNull();
    });

    it('keeps only digits in the PIN, at most six of them', async () => {
      const { choose, typePin, pinBox } = await setup();
      await choose(0);
      await typePin('48a2-9 17');
      expect(pinBox().value).toBe('482917');
      await typePin('1234 5678');
      expect(pinBox().value).toBe('123456');
    });

    it('does not send a short PIN: the server would count it as wrong', async () => {
      const { el, choose, typePin, press, text } = await setup();
      await choose(0);
      await typePin('4829');
      await press('Check PIN');
      expect(text(el.querySelector('#fill-card .form-error'))).toBe('Enter the 6-digit PIN.');
    });

    it('shows the litres once the PIN is right, and offers to fill exactly those', async () => {
      const { el, checkPin, text, button } = await setup();
      await checkPin();
      expect(text(el.querySelector('#fill-litres'))).toBe('20 L');
      expect(text(button('Fill 20 L'))).toBe('Fill 20 L');
    });

    it("shows the server's message when the PIN is wrong, and lets them try again", async () => {
      const { el, checkPin, text, pinBox } = await setup();
      await checkPin('000000', 'Wrong PIN. 4 attempt(s) left.');
      expect(text(el.querySelector('#fill-card .form-error'))).toBe(
        'Wrong PIN. 4 attempt(s) left.',
      );
      expect(el.querySelector('#fill-litres')).toBeNull();
      expect(pinBox()).not.toBeNull();
    });

    it('fills, shows a green result, and reads the waiting list and the day again', async () => {
      const { el, http, checkPin, press, text, answer, rows } = await setup();
      await checkPin();

      await press('Fill 20 L');
      const req = http.expectOne(`${INCOMING_URL}14/fill/`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ pin: '482917' });
      const filled = makeFuelRequest({
        id: 14,
        registration_number: 'AP39PA1234',
        driver_name: 'Ravi Kumar',
        litres_filled: '20.00',
      });
      req.flush(filled);
      await answer(INCOMING_URL, [SWIFT]);
      await answer(FILLS_URL, [filled, TODAY_ONE]);

      const result = el.querySelector('#fill-result.result-ok');
      expect(text(result)).toContain('Filled');
      expect(text(result)).toContain('AP39PA1234');
      expect(text(result)).toContain('20 L');
      expect(el.querySelector('#fill-card')).toBeNull();
      expect(rows().length).toBe(1);
    });

    it('shows a refused fill in a red card', async () => {
      const { el, http, checkPin, press, text, answer } = await setup();
      await checkPin();

      await press('Fill 20 L');
      http
        .expectOne(`${INCOMING_URL}14/fill/`)
        .flush(
          { detail: 'Only 12.00 L of diesel in stock.' },
          { status: 400, statusText: 'Bad Request' },
        );
      await answer(INCOMING_URL, [BOLERO]);

      expect(text(el.querySelector('#fill-result.result-error'))).toContain(
        'Only 12.00 L of diesel in stock.',
      );
    });

    it('goes back to the list without filling', async () => {
      const { el, choose, press } = await setup();
      await choose(0);
      await press('Back');
      expect(el.querySelector('#fill-card')).toBeNull();
    });
  });

  describe('today’s fills at this pump', () => {
    it('lists today’s fills, newest first as the server sent them', async () => {
      const { el, text } = await setup();
      const rows = Array.from(el.querySelectorAll('.fills li'));
      expect(rows.length).toBe(2);
      expect(text(rows[0])).toContain('AP39PB5678');
      expect(text(rows[0])).toContain('Gopal Rao');
      expect(text(rows[0])).toContain('25.5 L');
      expect(text(rows[1])).toContain('34 L');
      expect(text(rows[1].querySelector('.emergency-badge'))).toBe('Emergency 4 L');
    });

    it('asks for the date in India just after midnight, when the date in UTC is still yesterday', async () => {
      now = '2026-10-15T00:30:00+05:30'; // 2026-10-14 19:00 UTC
      const { el } = await setup(
        [],
        [makeFuelRequest({ id: 40, filled_at: '2026-10-15T00:10:00+05:30' })],
      );
      expect(el.querySelectorAll('.fills li').length).toBe(1);
    });

    it('says so when nothing was filled today', async () => {
      const { el, text } = await setup([], []);
      expect(el.querySelectorAll('.fills li').length).toBe(0);
      expect(text(el.querySelector('#fills-card'))).toContain('No fills today yet');
    });

    it('shows the error with a way to try again', async () => {
      const { el, text, answer } = await setup([], 'fail');
      expect(text(el.querySelector('#fills-card .error'))).toBe('Not available.');
      el.querySelector<HTMLButtonElement>('#fills-card button')!.click();
      await answer(FILLS_URL, [TODAY_ONE]);
      expect(el.querySelectorAll('.fills li').length).toBe(1);
    });
  });
});
