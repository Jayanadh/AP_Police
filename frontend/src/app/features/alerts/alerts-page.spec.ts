import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { AppNotification } from '../../core/api/notifications-api';
import { formatDateTime } from '../../core/format';
import { ToastService } from '../../ui/toast';
import { AlertsPage } from './alerts-page';

const LIST_URL = '/api/notifications/';

const alert = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: 1,
  title: 'Emergency fill requested',
  body: 'AP39 TA 1234 asked for 8 L beyond its quota.',
  link: '/mto/emergencies',
  created_at: '2026-10-02T08:30:00+05:30',
  read_at: null,
  ...overrides,
});

describe('AlertsPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  async function setup(rows: AppNotification[] | 'fail' = []) {
    const http = TestBed.inject(HttpTestingController);
    const urls: string[] = [];
    TestBed.inject(Router).navigateByUrl = async (url: string | UrlTree) => {
      urls.push(String(url));
      return true;
    };
    const fixture = TestBed.createComponent(AlertsPage);
    const req = http.expectOne(LIST_URL);
    if (rows === 'fail') {
      req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
    } else {
      req.flush(rows);
    }
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const items = () => Array.from(el.querySelectorAll<HTMLElement>('.alert-item'));
    const markAll = () =>
      Array.from(el.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Mark all as read'),
      ) as HTMLButtonElement | undefined;
    return { fixture, el, http, urls, items, markAll };
  }

  it('lists the alerts with their body and time, unread ones marked', async () => {
    const { el, items } = await setup([
      alert({ id: 2, title: 'Odometer reading missing: AP39 TA 1234', body: '', link: '' }),
      alert({ id: 1, read_at: '2026-10-02T09:00:00+05:30' }),
    ]);
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Alerts');
    const [unread, read] = items();
    expect(unread.classList.contains('unread')).toBe(true);
    expect(unread.querySelector('.alert-title')?.textContent?.trim()).toBe(
      'Odometer reading missing: AP39 TA 1234',
    );
    expect(unread.querySelector('.alert-body')).toBeNull();
    expect(read.classList.contains('unread')).toBe(false);
    expect(read.querySelector('.alert-body')?.textContent).toContain('asked for 8 L');
    expect(read.querySelector('time')?.textContent?.trim()).toBe(
      formatDateTime('2026-10-02T08:30:00+05:30'),
    );
  });

  it('shows an empty state when there are no alerts', async () => {
    const { el, markAll } = await setup([]);
    expect(el.querySelector('app-empty-state')?.textContent).toContain('No alerts yet');
    expect(el.querySelectorAll('.alert-item')).toHaveLength(0);
    expect(markAll()).toBeUndefined();
  });

  it('shows the error and retries on request', async () => {
    const { fixture, el, http } = await setup('fail');
    expect(el.querySelector('.error')?.textContent?.trim()).toBe('Not available.');
    (el.querySelector('button.retry') as HTMLButtonElement).click();
    http.expectOne(LIST_URL).flush([alert()]);
    await fixture.whenStable();
    expect(el.querySelector('.error')).toBeNull();
    expect(el.querySelectorAll('.alert-item')).toHaveLength(1);
  });

  it('marks an unread alert read, then opens its link', async () => {
    const { fixture, http, urls, items } = await setup([alert({ id: 5 })]);
    items()[0].click();
    const req = http.expectOne('/api/notifications/5/read/');
    expect(req.request.method).toBe('POST');
    expect(urls).toEqual([]);
    req.flush(alert({ id: 5, read_at: '2026-10-02T09:00:00+05:30' }));
    await fixture.whenStable();
    expect(urls).toEqual(['/mto/emergencies']);
    expect(items()[0].classList.contains('unread')).toBe(false);
  });

  it('marks an alert without a link read and stays on the page', async () => {
    const { fixture, http, urls, items } = await setup([alert({ id: 6, link: '' })]);
    items()[0].click();
    http
      .expectOne('/api/notifications/6/read/')
      .flush(alert({ id: 6, link: '', read_at: '2026-10-02T09:00:00+05:30' }));
    await fixture.whenStable();
    expect(urls).toEqual([]);
    expect(items()[0].classList.contains('unread')).toBe(false);
  });

  it('opens the link of an alert that is already read without another request', async () => {
    const { http, urls, items } = await setup([
      alert({ id: 7, read_at: '2026-10-02T09:00:00+05:30', link: '/mto/pumps/3' }),
    ]);
    items()[0].click();
    http.expectNone('/api/notifications/7/read/');
    expect(urls).toEqual(['/mto/pumps/3']);
  });

  it('stays put and says why when marking read fails', async () => {
    const { fixture, http, urls, items } = await setup([alert({ id: 8 })]);
    items()[0].click();
    http
      .expectOne('/api/notifications/8/read/')
      .flush({ detail: 'Not found.' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(urls).toEqual([]);
    expect(items()[0].classList.contains('unread')).toBe(true);
    expect(TestBed.inject(ToastService).messages()[0]).toMatchObject({
      text: 'Not found.',
      tone: 'danger',
    });
  });

  it('marks everything read with "Mark all as read"', async () => {
    const { fixture, http, items, markAll } = await setup([
      alert({ id: 2 }),
      alert({ id: 1 }),
      alert({ id: 3, read_at: '2026-10-01T09:00:00+05:30' }),
    ]);
    expect(markAll()?.disabled).toBe(false);
    markAll()?.click();
    const req = http.expectOne('/api/notifications/read-all/');
    expect(req.request.method).toBe('POST');
    req.flush({ updated: 2 });
    await fixture.whenStable();
    expect(items().some((item) => item.classList.contains('unread'))).toBe(false);
    expect(markAll()?.disabled).toBe(true);
  });

  it('disables "Mark all as read" when everything is already read', async () => {
    const { markAll } = await setup([alert({ read_at: '2026-10-02T09:00:00+05:30' })]);
    expect(markAll()?.disabled).toBe(true);
  });
});
