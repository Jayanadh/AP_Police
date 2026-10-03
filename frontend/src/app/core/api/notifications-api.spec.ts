import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AppNotification, NotificationsApi } from './notifications-api';

const alert = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: 1,
  title: 'Emergency fill requested',
  body: 'AP39 TA 1234 needs 8 L.',
  link: '/mto/emergencies',
  created_at: '2026-10-02T08:30:00+05:30',
  read_at: null,
  ...overrides,
});

describe('NotificationsApi', () => {
  let api: NotificationsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(NotificationsApi);
    http = TestBed.inject(HttpTestingController);
  });

  it('lists the alerts', () => {
    let result: AppNotification[] = [];
    api.list().subscribe((rows) => (result = rows));
    const req = http.expectOne('/api/notifications/');
    expect(req.request.method).toBe('GET');
    req.flush([alert({ id: 2 }), alert({ id: 1 })]);
    expect(result.map((row) => row.id)).toEqual([2, 1]);
    http.verify();
  });

  it('unwraps the unread count', () => {
    let count = -1;
    api.unreadCount().subscribe((value) => (count = value));
    const req = http.expectOne('/api/notifications/unread-count/');
    expect(req.request.method).toBe('GET');
    req.flush({ count: 4 });
    expect(count).toBe(4);
    http.verify();
  });

  it('marks one alert read', () => {
    let result: AppNotification | undefined;
    api.markRead(12).subscribe((row) => (result = row));
    const req = http.expectOne('/api/notifications/12/read/');
    expect(req.request.method).toBe('POST');
    req.flush(alert({ id: 12, read_at: '2026-10-02T09:00:00+05:30' }));
    expect(result?.read_at).toBe('2026-10-02T09:00:00+05:30');
    http.verify();
  });

  it('marks every alert read', () => {
    let done = false;
    api.markAllRead().subscribe(() => (done = true));
    const req = http.expectOne('/api/notifications/read-all/');
    expect(req.request.method).toBe('POST');
    req.flush({ updated: 3 });
    expect(done).toBe(true);
    http.verify();
  });

  it('announces a change after alerts are marked read, so the badge can refresh', () => {
    let changes = 0;
    api.changes$.subscribe(() => changes++);
    api.markRead(1).subscribe();
    http.expectOne('/api/notifications/1/read/').flush(alert({ read_at: '2026-10-02T09:00:00Z' }));
    expect(changes).toBe(1);
    api.markAllRead().subscribe();
    http.expectOne('/api/notifications/read-all/').flush({ updated: 2 });
    expect(changes).toBe(2);
    http.verify();
  });

  it('announces nothing when marking read fails', () => {
    let changes = 0;
    api.changes$.subscribe(() => changes++);
    api.markRead(1).subscribe({ error: () => undefined });
    http.expectOne('/api/notifications/1/read/').flush('x', { status: 500, statusText: 'Server' });
    expect(changes).toBe(0);
    http.verify();
  });
});
