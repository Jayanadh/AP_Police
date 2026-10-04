import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DeviceToken, deviceTokenInterceptor, TOKEN_VAULT, TokenVault } from './device-token';

/** Stands in for the phone's secure storage (Keychain, Keystore). */
class FakeVault implements TokenVault {
  stored: string | null = null;
  async read() {
    return this.stored;
  }
  async write(token: string) {
    this.stored = token;
  }
  async clear() {
    this.stored = null;
  }
}

describe('DeviceToken', () => {
  let vault: FakeVault;

  beforeEach(() => {
    vault = new FakeVault();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([deviceTokenInterceptor])),
        provideHttpClientTesting(),
        { provide: TOKEN_VAULT, useValue: vault },
      ],
    });
  });

  it('keeps the token in the phone’s secure storage, and reads it back after a restart', async () => {
    await TestBed.inject(DeviceToken).keep('abc123');
    expect(vault.stored).toBe('abc123');

    const afterRestart = TestBed.runInInjectionContext(() => new DeviceToken());
    expect(afterRestart.current()).toBeNull();
    await afterRestart.restore();
    expect(afterRestart.current()).toBe('abc123');
  });

  it('forgets the token on this phone', async () => {
    const tokens = TestBed.inject(DeviceToken);
    await tokens.keep('abc123');
    await tokens.forget();
    expect(tokens.current()).toBeNull();
    expect(vault.stored).toBeNull();
  });

  it('signs API calls in with the token, and sends it nowhere else', async () => {
    await TestBed.inject(DeviceToken).keep('abc123');
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);

    http.get('/api/tracking/trips/current/').subscribe();
    http.get('https://tile.openstreetmap.org/1/1/1.png').subscribe();

    expect(
      backend.expectOne('/api/tracking/trips/current/').request.headers.get('Authorization'),
    ).toBe('Bearer abc123');
    expect(
      backend
        .expectOne('https://tile.openstreetmap.org/1/1/1.png')
        .request.headers.has('Authorization'),
    ).toBe(false);
  });

  it('adds nothing when there is no token, as in the web app', () => {
    const http = TestBed.inject(HttpClient);
    http.get('/api/auth/session/').subscribe();
    expect(
      TestBed.inject(HttpTestingController)
        .expectOne('/api/auth/session/')
        .request.headers.has('Authorization'),
    ).toBe(false);
  });
});
