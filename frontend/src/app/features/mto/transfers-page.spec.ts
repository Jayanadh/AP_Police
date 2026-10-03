import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { OfficerLookup, Transfer } from '../../core/api/transfers-api';
import { ToastService } from '../../ui/toast';
import { TransfersPage } from './transfers-page';

const OUTGOING = '/api/transfers/?direction=outgoing';
const INCOMING = '/api/transfers/?direction=incoming';

const transfer = (overrides: Partial<Transfer> = {}): Transfer => ({
  id: 8,
  officer: 21,
  officer_name: 'Suresh Reddy',
  officer_emp_id: 'AP3001',
  from_unit: 1,
  from_unit_name: 'MTO Nellore',
  to_unit: 2,
  to_unit_name: 'MTO Guntur',
  note: 'Needed for the new range.',
  status: 'PENDING',
  requested_at: '2026-10-01T09:30:00+05:30',
  decided_at: null,
  ...overrides,
});

const OFFICER: OfficerLookup = {
  id: 21,
  full_name: 'Suresh Reddy',
  emp_id: 'AP3001',
  designation_name: 'Inspector',
  unit: 1,
  unit_name: 'MTO Nellore',
};

const LEAVING = transfer({
  id: 8,
  from_unit: 2,
  from_unit_name: 'MTO Guntur',
  to_unit: 1,
  to_unit_name: 'MTO Nellore',
});
const DONE = transfer({
  id: 9,
  officer_name: 'Anil Kumar',
  officer_emp_id: 'AP3002',
  status: 'ACCEPTED',
  decided_at: '2026-10-02T10:00:00+05:30',
});
const SENT = transfer({ id: 15, officer_name: 'Ravi Teja', officer_emp_id: 'AP3010' });
const SENT_DONE = transfer({
  id: 16,
  officer_name: 'Kiran Rao',
  officer_emp_id: 'AP3011',
  status: 'REJECTED',
});

describe('TransfersPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(
    outgoing: Transfer[] | 'fail' = [LEAVING, DONE],
    incoming: Transfer[] | 'fail' = [SENT, SENT_DONE],
  ) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(TransfersPage);
    const el = fixture.nativeElement as HTMLElement;
    const load = async (url: string, rows: Transfer[] | 'fail') => {
      const req = http.expectOne(url);
      expect(req.request.method).toBe('GET');
      if (rows === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(rows);
      }
      await fixture.whenStable();
    };
    await load(OUTGOING, outgoing);
    await load(INCOMING, incoming);

    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const rows = (section: 'to-approve' | 'sent') =>
      Array.from(el.querySelectorAll<HTMLElement>(`#${section} .transfer`));
    const button = (label: string, scope: ParentNode = el) =>
      Array.from(scope.querySelectorAll('button')).find((b) => text(b) === label) as
        HTMLButtonElement | undefined;
    const fill = (selector: string, value: string) => {
      const input = el.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const find = async (empId: string, answer: OfficerLookup | { detail: string }) => {
      fill('#officer-emp', empId);
      button('Find')!.click();
      const req = http.expectOne((r) => r.url === '/api/officers/lookup/');
      expect(req.request.params.get('emp_id')).toBe(empId.trim().toUpperCase());
      if ('detail' in answer) {
        req.flush(answer, { status: 404, statusText: 'Not Found' });
      } else {
        req.flush(answer);
      }
      await fixture.whenStable();
    };
    const toasts = () => TestBed.inject(ToastService).messages();
    return { fixture, el, http, text, rows, button, fill, find, load, toasts };
  }

  it('shows the request card and both lists with their headings', async () => {
    const { el, text } = await setup();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Transfers');
    const headings = Array.from(el.querySelectorAll('h2')).map((h) => text(h));
    expect(headings).toEqual([
      'Request an officer from another office',
      'Requests to approve',
      'Requests I sent',
    ]);
  });

  it('lists each request with the officer, the offices, the note, the status and the date', async () => {
    const { rows, text } = await setup();
    const first = rows('to-approve')[0];
    expect(text(first)).toContain('Suresh Reddy');
    expect(text(first)).toContain('AP3001');
    expect(text(first)).toContain('MTO Guntur → MTO Nellore');
    expect(text(first)).toContain('Needed for the new range.');
    expect(text(first.querySelector('app-status-badge'))).toBe('Pending');
    expect(text(first)).toContain('01 Oct 2026');
    expect(rows('to-approve')).toHaveLength(2);
    expect(rows('sent')).toHaveLength(2);
    expect(text(rows('sent')[0])).toContain('Ravi Teja');
  });

  it('offers Accept and Reject on pending requests to approve only', async () => {
    const { rows, button } = await setup();
    const [pending, decided] = rows('to-approve');
    expect(button('Accept', pending)).toBeDefined();
    expect(button('Reject', pending)).toBeDefined();
    expect(button('Cancel', pending)).toBeUndefined();
    expect(button('Accept', decided)).toBeUndefined();
    expect(button('Reject', decided)).toBeUndefined();
  });

  it('offers Cancel on pending requests I sent only', async () => {
    const { rows, button } = await setup();
    const [pending, decided] = rows('sent');
    expect(button('Cancel', pending)).toBeDefined();
    expect(button('Accept', pending)).toBeUndefined();
    expect(button('Cancel', decided)).toBeUndefined();
  });

  it('says so when a list is empty', async () => {
    const { el, text } = await setup([], []);
    const empties = Array.from(el.querySelectorAll('app-empty-state')).map((e) => text(e));
    expect(empties).toHaveLength(2);
    expect(empties[0]).toContain('No requests to approve');
    expect(empties[1]).toContain('You have not asked for any officers');
  });

  it('shows a list error and retries just that list', async () => {
    const { fixture, el, http, load, rows } = await setup('fail', [SENT]);
    expect(el.querySelector('#to-approve .error')?.textContent?.trim()).toBe('Not available.');
    expect(el.querySelector('#sent .error')).toBeNull();
    expect(rows('sent')).toHaveLength(1);
    (el.querySelector('#to-approve button.retry') as HTMLButtonElement).click();
    await load(OUTGOING, [LEAVING]);
    http.expectNone(INCOMING);
    await fixture.whenStable();
    expect(el.querySelector('#to-approve .error')).toBeNull();
    expect(rows('to-approve')).toHaveLength(1);
  });

  it('looks up an Emp ID and shows the officer found', async () => {
    const { el, find, text } = await setup();
    expect(el.querySelector('#officer-card')).toBeNull();
    await find(' ap3001 ', OFFICER);
    const card = el.querySelector('#officer-card');
    expect(text(card)).toContain('Suresh Reddy');
    expect(text(card)).toContain('AP3001');
    expect(text(card)).toContain('Inspector');
    expect(text(card)).toContain('MTO Nellore');
    expect(el.querySelector('label[for="transfer-note"]')?.textContent?.trim()).toBe('Note');
  });

  it('shows the API message when no officer matches, and no request form', async () => {
    const { el, find, text } = await setup();
    await find('AP9999', { detail: 'No officer with this Emp ID in another MTO office.' });
    expect(text(el.querySelector('.lookup .error'))).toBe(
      'No officer with this Emp ID in another MTO office.',
    );
    expect(el.querySelector('#officer-card')).toBeNull();
    expect(el.querySelector('#transfer-note')).toBeNull();
  });

  it('asks for an Emp ID before looking anything up', async () => {
    const { fixture, el, http, button, text } = await setup();
    button('Find')!.click();
    await fixture.whenStable();
    http.expectNone((r) => r.url === '/api/officers/lookup/');
    expect(text(el.querySelector('.lookup .error'))).toBe('Type the Emp ID of the officer.');
  });

  it('forgets the officer found as soon as the Emp ID is changed', async () => {
    const { fixture, el, find, fill } = await setup();
    await find('AP3001', OFFICER);
    fill('#officer-emp', 'AP30');
    await fixture.whenStable();
    expect(el.querySelector('#officer-card')).toBeNull();
    expect(el.querySelector('#transfer-note')).toBeNull();
  });

  it('sends the request with the officer found and the note, then toasts and reloads the sent list', async () => {
    const { fixture, el, http, find, fill, button, load, rows, toasts } = await setup();
    await find('AP3001', OFFICER);
    fill('#transfer-note', ' Needed for the new range. ');
    button('Send request')!.click();
    const req = http.expectOne('/api/transfers/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ officer: 21, note: 'Needed for the new range.' });
    req.flush(transfer({ id: 20 }), { status: 201, statusText: 'Created' });
    await fixture.whenStable();
    expect(toasts()[0]).toMatchObject({ text: 'Request sent to MTO Nellore.', tone: 'success' });
    expect(el.querySelector('#officer-card')).toBeNull();
    expect((el.querySelector('#officer-emp') as HTMLInputElement).value).toBe('');
    await load(INCOMING, [transfer({ id: 20 }), SENT]);
    http.expectNone(OUTGOING);
    expect(rows('sent')).toHaveLength(2);
  });

  it('shows the API error when the request is refused and keeps the officer', async () => {
    const { fixture, el, http, find, button, text, toasts } = await setup();
    await find('AP3001', OFFICER);
    button('Send request')!.click();
    http
      .expectOne('/api/transfers/')
      .flush(
        { detail: 'A transfer request for this officer is already pending.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(text(el.querySelector('.request-form .error'))).toBe(
      'A transfer request for this officer is already pending.',
    );
    expect(el.querySelector('#officer-card')).not.toBeNull();
    expect(toasts()).toHaveLength(0);
  });

  it('accepts a request to approve, then toasts and reloads that list', async () => {
    const { fixture, http, rows, button, load, toasts } = await setup();
    button('Accept', rows('to-approve')[0])!.click();
    const req = http.expectOne('/api/transfers/8/accept/');
    expect(req.request.method).toBe('POST');
    req.flush({ ...LEAVING, status: 'ACCEPTED' });
    await fixture.whenStable();
    expect(toasts()[0]).toMatchObject({
      text: 'Suresh Reddy will move to MTO Nellore.',
      tone: 'success',
    });
    await load(OUTGOING, [{ ...LEAVING, status: 'ACCEPTED' }, DONE]);
    http.expectNone(INCOMING);
    expect(button('Accept', rows('to-approve')[0])).toBeUndefined();
  });

  it('rejects a request to approve', async () => {
    const { http, rows, button, load, toasts } = await setup();
    button('Reject', rows('to-approve')[0])!.click();
    const req = http.expectOne('/api/transfers/8/reject/');
    expect(req.request.method).toBe('POST');
    req.flush({ ...LEAVING, status: 'REJECTED' });
    await load(OUTGOING, [{ ...LEAVING, status: 'REJECTED' }, DONE]);
    expect(toasts()[0]).toMatchObject({ text: 'Request rejected.', tone: 'success' });
  });

  it('shows the reason in a toast when a decision is refused', async () => {
    const { fixture, http, rows, button, toasts } = await setup();
    button('Accept', rows('to-approve')[0])!.click();
    http
      .expectOne('/api/transfers/8/accept/')
      .flush(
        { detail: 'This request is no longer pending.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(toasts()[0]).toMatchObject({
      text: 'This request is no longer pending.',
      tone: 'danger',
    });
    http.expectNone((r) => r.method === 'GET');
  });

  it('cancels a request I sent, then toasts and reloads the sent list', async () => {
    const { fixture, http, rows, button, load, toasts } = await setup();
    button('Cancel', rows('sent')[0])!.click();
    const req = http.expectOne('/api/transfers/15/cancel/');
    expect(req.request.method).toBe('POST');
    req.flush({ ...SENT, status: 'CANCELLED' });
    await fixture.whenStable();
    expect(toasts()[0]).toMatchObject({ text: 'Request cancelled.', tone: 'success' });
    await load(INCOMING, [{ ...SENT, status: 'CANCELLED' }, SENT_DONE]);
    http.expectNone(OUTGOING);
    expect(button('Cancel', rows('sent')[0])).toBeUndefined();
  });
});
