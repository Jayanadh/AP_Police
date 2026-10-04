import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { ToastService } from '../ui/toast';
import { AuthStore, Me } from './auth-store';
import { deviceTokenInterceptor, TOKEN_VAULT } from './device-token';
import { DEVICE_NAME, NATIVE_APP } from './native';
import { makeMe, signInAs } from './test-data';

describe('AuthStore', () => {
  let store: AuthStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(AuthStore);
    http = TestBed.inject(HttpTestingController);
  });

  it('starts with nobody signed in', () => {
    expect(store.user()).toBeNull();
    expect(store.role()).toBeNull();
    http.verify();
  });

  it('restores the session from the server', async () => {
    const me = makeMe({ role: 'OFFICER' });
    const loaded = store.loadSession();
    const req = http.expectOne('/api/auth/session/');
    expect(req.request.method).toBe('GET');
    req.flush({ user: me });
    await loaded;
    expect(store.user()).toEqual(me);
    expect(store.role()).toBe('OFFICER');
    http.verify();
  });

  it('stays signed out when the server reports no session', async () => {
    await signInAs(null);
    expect(store.user()).toBeNull();
    http.verify();
  });

  it('treats a failed session call as logged out and still resolves', async () => {
    await signInAs(makeMe());
    const loaded = store.loadSession();
    http.expectOne('/api/auth/session/').flush('Bad gateway', { status: 502, statusText: 'x' });
    await loaded;
    expect(store.user()).toBeNull();
    http.verify();
  });

  it('logs in with the credentials and keeps the user', async () => {
    const me = makeMe({ role: 'DRIVER' });
    let result;
    store.login('d.ramu', 'secret').subscribe((user) => (result = user));
    const req = http.expectOne('/api/auth/login/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'd.ramu', password: 'secret' });
    req.flush({ user: me });
    expect(result).toEqual(me);
    expect(store.user()).toEqual(me);
    expect(store.role()).toBe('DRIVER');
    http.verify();
  });

  it('keeps nobody signed in when the login is refused', () => {
    let failure: unknown;
    store.login('d.ramu', 'nope').subscribe({ error: (err) => (failure = err) });
    http
      .expectOne('/api/auth/login/')
      .flush({ detail: 'Invalid username or password.' }, { status: 400, statusText: 'Bad' });
    expect(failure).toBeTruthy();
    expect(store.user()).toBeNull();
    http.verify();
  });

  it('logs out through the API and forgets the user', async () => {
    await signInAs(makeMe());
    let done = false;
    store.logout().subscribe(() => (done = true));
    const req = http.expectOne('/api/auth/logout/');
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(done).toBe(true);
    expect(store.user()).toBeNull();
    http.verify();
  });

  it('keeps the user signed in when logging out fails', async () => {
    const me = makeMe();
    await signInAs(me);
    let failure: unknown;
    store.logout().subscribe({ error: (err) => (failure = err) });
    http.expectOne('/api/auth/logout/').flush('x', { status: 500, statusText: 'Server' });
    expect(failure).toBeTruthy();
    expect(store.user()).toEqual(me);
    http.verify();
  });

  for (const status of [401, 403]) {
    it(`treats a ${status} on logout as an expired session: the user is cleared`, async () => {
      await signInAs(makeMe());
      let done = false;
      store.logout().subscribe(() => (done = true));
      http.expectOne('/api/auth/logout/').flush('x', { status, statusText: 'Refused' });
      expect(done).toBe(true);
      expect(store.user()).toBeNull();
      http.verify();
    });
  }

  it('keeps the user signed in when the server cannot be reached to log out', async () => {
    const me = makeMe();
    await signInAs(me);
    let failure: unknown;
    store.logout().subscribe({ error: (err) => (failure = err) });
    http.expectOne('/api/auth/logout/').error(new ProgressEvent('error'), { status: 0 });
    expect(failure).toBeTruthy();
    expect(store.user()).toEqual(me);
    http.verify();
  });

  describe('signOut', () => {
    /** Replaces Router.navigateByUrl so the test can see where the app tried to go. */
    function recordNavigation(): string[] {
      const urls: string[] = [];
      TestBed.inject(Router).navigateByUrl = async (url: string | UrlTree) => {
        urls.push(String(url));
        return true;
      };
      return urls;
    }

    it('logs out and goes to /login', async () => {
      await signInAs(makeMe());
      const urls = recordNavigation();
      store.signOut();
      const req = http.expectOne('/api/auth/logout/');
      expect(req.request.method).toBe('POST');
      req.flush(null, { status: 204, statusText: 'No Content' });
      expect(store.user()).toBeNull();
      expect(urls).toEqual(['/login']);
      http.verify();
    });

    it('first finishes what was asked to happen before signing out, such as stopping live location', async () => {
      await signInAs(makeMe());
      const urls = recordNavigation();
      let finish = () => {};
      const steps: string[] = [];
      store.beforeSignOut(
        () =>
          new Promise<void>((resolve) => {
            steps.push('started');
            finish = resolve;
          }),
      );

      store.signOut();
      expect(steps).toEqual(['started']);
      http.expectNone('/api/auth/logout/');

      finish();
      await new Promise((resolve) => setTimeout(resolve));
      http.expectOne('/api/auth/logout/').flush(null, { status: 204, statusText: 'No Content' });
      expect(urls).toEqual(['/login']);
    });

    it('signs out even when a step before it fails', async () => {
      await signInAs(makeMe());
      recordNavigation();
      store.beforeSignOut(() => Promise.reject(new Error('offline')));

      store.signOut();
      await new Promise((resolve) => setTimeout(resolve));

      http.expectOne('/api/auth/logout/').flush(null, { status: 204, statusText: 'No Content' });
      expect(store.user()).toBeNull();
    });

    it('forgets a step once it is no longer wanted', async () => {
      await signInAs(makeMe());
      recordNavigation();
      let ran = false;
      const forget = store.beforeSignOut(async () => {
        ran = true;
      });
      forget();

      store.signOut();

      http.expectOne('/api/auth/logout/').flush(null, { status: 204, statusText: 'No Content' });
      expect(ran).toBe(false);
    });

    it('still reaches /login when the session had already expired (403)', async () => {
      await signInAs(makeMe());
      const urls = recordNavigation();
      store.signOut();
      http
        .expectOne('/api/auth/logout/')
        .flush(
          { detail: 'Authentication credentials were not provided.' },
          { status: 403, statusText: 'Forbidden' },
        );
      expect(store.user()).toBeNull();
      expect(urls).toEqual(['/login']);
      expect(TestBed.inject(ToastService).messages()).toEqual([]);
      http.verify();
    });

    it('stays signed in and says so when the server cannot be reached', async () => {
      await signInAs(makeMe());
      const urls = recordNavigation();
      store.signOut();
      http.expectOne('/api/auth/logout/').error(new ProgressEvent('error'), { status: 0 });
      expect(store.user()).not.toBeNull();
      expect(urls).toEqual([]);
      expect(TestBed.inject(ToastService).messages()[0]).toMatchObject({
        text: 'Cannot reach the server. Check your connection.',
        tone: 'danger',
      });
      http.verify();
    });

    it('stays signed in and says so on a server error', async () => {
      await signInAs(makeMe());
      const urls = recordNavigation();
      store.signOut();
      http
        .expectOne('/api/auth/logout/')
        .flush({ detail: 'Server error.' }, { status: 500, statusText: 'Server' });
      expect(store.user()).not.toBeNull();
      expect(urls).toEqual([]);
      expect(TestBed.inject(ToastService).messages()[0]).toMatchObject({
        text: 'Server error.',
        tone: 'danger',
      });
      http.verify();
    });
  });

  it('clears must_change_password after a password change', async () => {
    await signInAs(makeMe({ must_change_password: true }));
    expect(store.user()?.must_change_password).toBe(true);
    let done = false;
    store.changePassword('old-pass', 'new-pass-1').subscribe(() => (done = true));
    const req = http.expectOne('/api/auth/change-password/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ old_password: 'old-pass', new_password: 'new-pass-1' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(done).toBe(true);
    expect(store.user()?.must_change_password).toBe(false);
    expect(store.user()?.full_name).toBe('Ravi Kumar');
    http.verify();
  });

  it('keeps must_change_password when the change is refused', async () => {
    await signInAs(makeMe({ must_change_password: true }));
    let failure: unknown;
    store.changePassword('wrong', 'new-pass-1').subscribe({ error: (err) => (failure = err) });
    http
      .expectOne('/api/auth/change-password/')
      .flush({ detail: 'Current password is incorrect.' }, { status: 400, statusText: 'Bad' });
    expect(failure).toBeTruthy();
    expect(store.user()?.must_change_password).toBe(true);
    http.verify();
  });
});

describe('AuthStore in the phone apps', () => {
  let vault: {
    stored: string | null;
    read(): Promise<string | null>;
    write(t: string): Promise<void>;
    clear(): Promise<void>;
  };
  let http: HttpTestingController;

  beforeEach(() => {
    vault = {
      stored: null,
      async read() {
        return this.stored;
      },
      async write(token: string) {
        this.stored = token;
      },
      async clear() {
        this.stored = null;
      },
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([deviceTokenInterceptor])),
        provideHttpClientTesting(),
        { provide: NATIVE_APP, useValue: true },
        { provide: DEVICE_NAME, useValue: 'Android phone' },
        { provide: TOKEN_VAULT, useValue: vault },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve));

  it('signs in for a device token and keeps it on the phone', async () => {
    const store = TestBed.inject(AuthStore);
    const driver = makeMe({ role: 'DRIVER' });
    let signedIn: Me | undefined;

    store.login('ap4001', 'secret').subscribe((user) => (signedIn = user));
    const req = http.expectOne('/api/auth/token/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      username: 'ap4001',
      password: 'secret',
      device_name: 'Android phone',
    });
    req.flush({ token: 'tok-1', expires_at: '2026-11-03T10:00:00+05:30', user: driver });
    await settle();

    expect(signedIn).toEqual(driver);
    expect(store.user()).toEqual(driver);
    expect(vault.stored).toBe('tok-1');
    http.expectNone('/api/auth/login/');
  });

  it('picks the sign-in up again at start-up from the token kept on the phone', async () => {
    vault.stored = 'tok-1';
    const store = TestBed.inject(AuthStore);

    const loaded = store.loadSession();
    await settle();
    const req = http.expectOne('/api/auth/session/');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok-1');
    req.flush({ user: makeMe({ role: 'DRIVER' }) });
    await loaded;

    expect(store.role()).toBe('DRIVER');
  });

  it('forgets a token the server no longer takes', async () => {
    vault.stored = 'tok-old';
    const store = TestBed.inject(AuthStore);

    const loaded = store.loadSession();
    await settle();
    http
      .expectOne('/api/auth/session/')
      .flush({ detail: 'Sign in again.' }, { status: 403, statusText: 'Forbidden' });
    await loaded;

    expect(store.user()).toBeNull();
    expect(vault.stored).toBeNull();
  });

  it('keeps the token when the server cannot be reached at start-up', async () => {
    vault.stored = 'tok-1';
    const store = TestBed.inject(AuthStore);

    const loaded = store.loadSession();
    await settle();
    http.expectOne('/api/auth/session/').error(new ProgressEvent('error'), { status: 0 });
    await loaded;

    expect(store.user()).toBeNull();
    expect(vault.stored).toBe('tok-1');
  });

  it('logging out ends the token on the server, then forgets it on the phone', async () => {
    vault.stored = 'tok-1';
    const store = TestBed.inject(AuthStore);
    const loaded = store.loadSession();
    await settle();
    http.expectOne('/api/auth/session/').flush({ user: makeMe({ role: 'DRIVER' }) });
    await loaded;

    let done = false;
    store.logout().subscribe(() => (done = true));
    const req = http.expectOne('/api/auth/logout/');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok-1');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(done).toBe(true);
    expect(store.user()).toBeNull();
    expect(vault.stored).toBeNull();
  });
});
