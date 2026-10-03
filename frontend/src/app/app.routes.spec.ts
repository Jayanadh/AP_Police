import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { Me, Role } from './core/auth-store';
import { makeMe, signInAs } from './core/test-data';

describe('app routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  /** Signs in (or not), navigates, answers the shell's unread-count calls and returns the final URL. */
  async function visit(user: Me | null, url: string) {
    await signInAs(user);
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    const settle = async () => {
      TestBed.inject(HttpTestingController)
        .match('/api/notifications/unread-count/')
        .filter((req) => !req.cancelled)
        .forEach((req) => req.flush({ count: 0 }));
      await harness.fixture.whenStable();
    };
    await settle();
    return { router, el: harness.fixture.nativeElement as HTMLElement, settle };
  }

  // The page each role lands on.
  const homes: [Role, string, string][] = [
    ['PTO', '/pto', 'app-pto-dashboard'],
    ['MTO', '/mto', 'app-mto-dashboard'],
    ['OFFICER', '/officer', 'app-officer-dashboard'],
    ['DRIVER', '/driver', 'app-driver-dashboard'],
    ['PUMP_OPERATOR', '/pump', 'app-pump-dashboard'],
  ];

  for (const [role, home, page] of homes) {
    it(`sends a ${role} from / to ${home}`, async () => {
      const { router, el } = await visit(makeMe({ role, pump_kind: 'POLICE' }), '/');
      expect(router.url).toBe(home);
      expect(el.querySelector('app-shell')).not.toBeNull();
      expect(el.querySelector(page)).not.toBeNull();
    });
  }

  it('sends an anonymous visitor to /login, outside the shell', async () => {
    const { router, el } = await visit(null, '/');
    expect(router.url).toBe('/login');
    expect(el.querySelector('app-login-page')).not.toBeNull();
    expect(el.querySelector('app-shell')).toBeNull();
  });

  for (const url of ['/alerts', '/profile', '/mto']) {
    it(`sends an anonymous visitor who asks for ${url} to /login`, async () => {
      const { router } = await visit(null, url);
      expect(router.url).toBe('/login');
    });
  }

  it("keeps a role out of another role's area", async () => {
    const { router } = await visit(makeMe({ role: 'OFFICER' }), '/mto');
    expect(router.url).toBe('/officer');
  });

  it('lets a role into its own area', async () => {
    const { router } = await visit(makeMe({ role: 'PTO' }), '/pto');
    expect(router.url).toBe('/pto');
  });

  it('shows /alerts and /profile to every signed-in role', async () => {
    const { router, el, settle } = await visit(makeMe({ role: 'DRIVER' }), '/alerts');
    expect(router.url).toBe('/alerts');
    await router.navigateByUrl('/profile');
    await settle();
    expect(router.url).toBe('/profile');
    expect(el.querySelector('app-profile-page')).not.toBeNull();
  });

  it('holds a user who must change the password on /change-password, on every navigation', async () => {
    const { router, el, settle } = await visit(makeMe({ must_change_password: true }), '/mto');
    expect(router.url).toBe('/change-password');
    expect(el.querySelector('app-change-password-page')).not.toBeNull();
    await router.navigateByUrl('/alerts');
    await settle();
    expect(router.url).toBe('/change-password');
  });

  it('sends an unknown URL home', async () => {
    const { router } = await visit(makeMe({ role: 'DRIVER' }), '/no/such/page');
    expect(router.url).toBe('/driver');
  });
});
