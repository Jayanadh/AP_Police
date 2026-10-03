import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Approval } from '../../core/api/approvals-api';
import { formatDateTime } from '../../core/format';
import { ToastService } from '../../ui/toast';
import { ApprovalsPage } from './approvals-page';

const PENDING = '/api/approvals/?status=PENDING';

const officerRequest = (overrides: Partial<Approval> = {}): Approval => ({
  id: 11,
  kind: 'OFFICER_CREATE',
  kind_label: 'New officer',
  unit: 3,
  unit_name: 'MTO Vijayawada',
  status: 'PENDING',
  officer: {
    id: 21,
    full_name: 'Lakshmi Devi',
    emp_id: 'AP3001',
    designation_name: 'Inspector',
    mobile: '9000000003',
  },
  vehicle: null,
  request_note: 'Joined this month.',
  requested_by_name: 'Ravi Kumar',
  requested_at: '2026-10-02T08:30:00+05:30',
  decision_note: '',
  decided_by_name: null,
  decided_at: null,
  ...overrides,
});

const vehicleRequest = (overrides: Partial<Approval> = {}): Approval => ({
  ...officerRequest(),
  id: 12,
  kind: 'VEHICLE_TERMINATE',
  kind_label: 'Vehicle termination',
  officer: null,
  vehicle: {
    id: 31,
    registration_number: 'AP39TA1234',
    vehicle_type: 'JEEP',
    make: 'Mahindra',
    model: 'Bolero',
  },
  request_note: '',
  ...overrides,
});

describe('ApprovalsPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(rows: Approval[] | 'fail' = [officerRequest(), vehicleRequest()]) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ApprovalsPage);
    const el = fixture.nativeElement as HTMLElement;
    const answer = async (url: string, body: Approval[] | 'fail') => {
      const req = http.expectOne(url);
      expect(req.request.method).toBe('GET');
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
    };
    await answer(PENDING, rows);
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const cards = () => Array.from(el.querySelectorAll<HTMLElement>('.request'));
    const button = (label: string, scope: ParentNode = el) =>
      Array.from(scope.querySelectorAll('button')).find((b) => text(b) === label) as
        HTMLButtonElement | undefined;
    const chips = () => Array.from(el.querySelectorAll<HTMLButtonElement>('button.chip'));
    const note = (card: HTMLElement, value: string) => {
      const input = card.querySelector('input') as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    return { fixture, el, http, answer, text, cards, button, chips, note };
  }

  it('loads the pending requests first, with the four status chips', async () => {
    const { el, chips, text, cards } = await setup();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Approvals');
    expect(chips().map((chip) => text(chip))).toEqual(['Pending', 'Approved', 'Rejected', 'All']);
    expect(chips().map((chip) => chip.classList.contains('active'))).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(chips().map((chip) => chip.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(cards()).toHaveLength(2);
  });

  it('shows an officer request with the person and the MTO note', async () => {
    const { cards, text } = await setup();
    const card = cards()[0];
    expect(text(card.querySelector('.badge'))).toBe('New officer');
    expect(text(card)).toContain('MTO Vijayawada');
    expect(text(card)).toContain('Lakshmi Devi');
    expect(text(card)).toContain('AP3001');
    expect(text(card)).toContain('Inspector');
    expect(text(card)).toContain('9000000003');
    expect(text(card)).toContain('Joined this month.');
    expect(text(card)).toContain(formatDateTime('2026-10-02T08:30:00+05:30'));
    expect(text(card)).toContain('Ravi Kumar');
  });

  it('shows a termination request with the vehicle', async () => {
    const { cards, text } = await setup();
    const card = cards()[1];
    expect(text(card.querySelector('.badge'))).toBe('Vehicle termination');
    expect(text(card)).toContain('AP39TA1234');
    expect(text(card)).toContain('Mahindra Bolero');
    expect(text(card)).not.toContain("MTO's note");
  });

  it('shows an empty state when nothing is pending', async () => {
    const { el, cards } = await setup([]);
    expect(el.querySelector('app-empty-state')?.textContent).toContain('Nothing waiting');
    expect(cards()).toHaveLength(0);
  });

  it('shows the error and retries on request', async () => {
    const { fixture, el, answer, cards } = await setup('fail');
    expect(el.querySelector('.error')?.textContent?.trim()).toBe('Not available.');
    (el.querySelector('button.retry') as HTMLButtonElement).click();
    await answer(PENDING, [officerRequest()]);
    await fixture.whenStable();
    expect(el.querySelector('.error')).toBeNull();
    expect(cards()).toHaveLength(1);
  });

  it('reloads for the chosen status, and for every status with All', async () => {
    const { fixture, answer, chips, cards, text } = await setup();
    chips()[1].click();
    await answer('/api/approvals/?status=APPROVED', [
      officerRequest({
        id: 5,
        status: 'APPROVED',
        decision_note: 'Verified.',
        decided_by_name: 'PTO Admin',
        decided_at: '2026-10-02T10:00:00+05:30',
      }),
    ]);
    expect(chips()[1].classList.contains('active')).toBe(true);
    expect(chips()[0].classList.contains('active')).toBe(false);
    const decided = cards()[0];
    expect(text(decided.querySelector('app-status-badge'))).toBe('Approved');
    expect(text(decided)).toContain('Verified.');
    expect(text(decided)).toContain('PTO Admin');
    expect(decided.querySelector('button')).toBeNull();
    expect(decided.querySelector('input')).toBeNull();

    chips()[2].click();
    await answer('/api/approvals/?status=REJECTED', []);
    chips()[3].click();
    await answer('/api/approvals/', [officerRequest(), vehicleRequest({ status: 'REJECTED' })]);
    await fixture.whenStable();
    expect(cards()).toHaveLength(2);
    expect(chips()[3].classList.contains('active')).toBe(true);
  });

  it('approves with the note, toasts and reloads the list', async () => {
    const { fixture, http, answer, cards, button, note, text } = await setup();
    const card = cards()[0];
    expect(card.querySelector('label')?.textContent?.trim()).toBe('Note');
    note(card, 'Verified with the district.');
    button('Approve', card)!.click();
    const req = http.expectOne('/api/approvals/11/approve/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ note: 'Verified with the district.' });
    req.flush(officerRequest({ status: 'APPROVED' }));
    await fixture.whenStable();
    expect(TestBed.inject(ToastService).messages()[0]).toMatchObject({
      text: 'Request approved.',
      tone: 'success',
    });
    await answer(PENDING, [vehicleRequest()]);
    expect(cards()).toHaveLength(1);
    expect(text(cards()[0])).toContain('AP39TA1234');
  });

  it('approves without a note', async () => {
    const { http, cards, button } = await setup();
    button('Approve', cards()[0])!.click();
    const req = http.expectOne('/api/approvals/11/approve/');
    expect(req.request.body).toEqual({ note: '' });
  });

  it('rejects with a reason, toasts and reloads the list', async () => {
    const { fixture, http, answer, cards, button, note } = await setup();
    note(cards()[1], '  Not needed.  ');
    button('Reject', cards()[1])!.click();
    const req = http.expectOne('/api/approvals/12/reject/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ note: 'Not needed.' });
    req.flush(vehicleRequest({ status: 'REJECTED' }));
    await fixture.whenStable();
    expect(TestBed.inject(ToastService).messages()[0]).toMatchObject({
      text: 'Request rejected.',
      tone: 'success',
    });
    await answer(PENDING, [officerRequest()]);
  });

  it('sends nothing when rejecting without a reason', async () => {
    const { fixture, http, cards, button, note, text } = await setup();
    button('Reject', cards()[0])!.click();
    await fixture.whenStable();
    http.expectNone('/api/approvals/11/reject/');
    expect(text(cards()[0].querySelector('.error'))).toBe('Give a reason for rejecting.');
    expect(cards()[1].querySelector('.error')).toBeNull();
    // A note made only of spaces is no reason either.
    note(cards()[0], '   ');
    button('Reject', cards()[0])!.click();
    await fixture.whenStable();
    http.expectNone('/api/approvals/11/reject/');
    expect(text(cards()[0].querySelector('.error'))).toBe('Give a reason for rejecting.');
  });

  it('shows an API error on the request it belongs to and keeps the note', async () => {
    const { fixture, http, cards, button, note, text } = await setup();
    note(cards()[0], 'Fine.');
    button('Approve', cards()[0])!.click();
    http
      .expectOne('/api/approvals/11/approve/')
      .flush(
        { detail: 'This request was already decided.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(text(cards()[0].querySelector('.error'))).toBe('This request was already decided.');
    expect((cards()[0].querySelector('input') as HTMLInputElement).value).toBe('Fine.');
    expect(TestBed.inject(ToastService).messages()).toHaveLength(0);
    http.expectNone(PENDING);
  });
});
