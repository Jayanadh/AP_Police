import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { AuthStore } from './auth-store';
import { sessionInterceptor } from './session-interceptor';
import { makeMe, signInAs } from './test-data';

const SESSION_URL = '/api/auth/session/';
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('sessionInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let urls: string[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([sessionInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    urls = [];
    TestBed.inject(Router).navigateByUrl = async (url: string | UrlTree) => {
      urls.push(String(url));
      return true;
    };
  });

  /** Makes an API call and answers it with the given status. Returns what the caller saw. */
  function refused(url: string, status: number): { failure: () => unknown } {
    let failure: unknown;
    client.get(url).subscribe({ error: (err) => (failure = err) });
    http.expectOne(url).flush({ detail: 'Refused.' }, { status, statusText: 'Refused' });
    return { failure: () => failure };
  }

  for (const status of [401, 403]) {
    it(`sends the user to /login when a ${status} turns out to be an expired session`, async () => {
      await signInAs(makeMe());
      const call = refused('/api/notifications/unread-count/', status);
      http.expectOne(SESSION_URL).flush({ user: null });
      await settle();
      expect(TestBed.inject(AuthStore).user()).toBeNull();
      expect(urls).toEqual(['/login']);
      expect((call.failure() as { status: number }).status).toBe(status);
      http.verify();
    });
  }

  it('goes home when the session now belongs to someone else, signed in from another tab', async () => {
    await signInAs(makeMe({ id: 7, role: 'OFFICER' }));
    refused('/api/vehicles/', 403);
    http.expectOne(SESSION_URL).flush({ user: makeMe({ id: 8, role: 'MTO' }) });
    await settle();
    expect(TestBed.inject(AuthStore).user()?.id).toBe(8);
    expect(urls).toEqual(['/']);
    http.verify();
  });

  it('keeps the user where they are when a 403 is only a refusal and the session is alive', async () => {
    const me = makeMe({ role: 'DRIVER' });
    await signInAs(me);
    const call = refused('/api/mto/vehicles/', 403);
    http.expectOne(SESSION_URL).flush({ user: me });
    await settle();
    expect(TestBed.inject(AuthStore).user()).toEqual(me);
    expect(urls).toEqual([]);
    expect((call.failure() as { status: number }).status).toBe(403);
    http.verify();
  });

  it('checks the session only once while a check is in flight', async () => {
    await signInAs(makeMe());
    refused('/api/notifications/unread-count/', 403);
    refused('/api/notifications/', 403);
    http.expectOne(SESSION_URL).flush({ user: null });
    await settle();
    expect(urls).toEqual(['/login']);
    http.verify();
  });

  it('can check again after an earlier check has finished', async () => {
    const me = makeMe();
    await signInAs(me);
    refused('/api/notifications/', 403);
    http.expectOne(SESSION_URL).flush({ user: me });
    await settle();
    refused('/api/notifications/', 403);
    http.expectOne(SESSION_URL).flush({ user: null });
    await settle();
    expect(urls).toEqual(['/login']);
    http.verify();
  });

  it('leaves the auth endpoints alone', async () => {
    await signInAs(makeMe());
    refused('/api/auth/change-password/', 403);
    refused('/api/auth/logout/', 403);
    refused('/api/auth/login/', 403);
    await settle();
    http.expectNone(SESSION_URL);
    expect(urls).toEqual([]);
    http.verify();
  });

  it('ignores other failures', async () => {
    await signInAs(makeMe());
    refused('/api/notifications/', 500);
    refused('/api/notifications/', 404);
    refused('/api/notifications/', 400);
    await settle();
    http.expectNone(SESSION_URL);
    expect(urls).toEqual([]);
    http.verify();
  });

  it('does nothing when nobody is signed in', async () => {
    await signInAs(null);
    refused('/api/notifications/', 403);
    await settle();
    http.expectNone(SESSION_URL);
    expect(urls).toEqual([]);
    http.verify();
  });

  it('passes successful responses straight through', async () => {
    await signInAs(makeMe());
    let body: unknown;
    client.get('/api/notifications/').subscribe((value) => (body = value));
    http.expectOne('/api/notifications/').flush([{ id: 1 }]);
    expect(body).toEqual([{ id: 1 }]);
    http.expectNone(SESSION_URL);
    http.verify();
  });
});
