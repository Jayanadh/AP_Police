import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
} from '@angular/router';
import { authGuard, roleGuard } from './auth-guards';
import { makeMe, signInAs } from './test-data';

const route = {} as ActivatedRouteSnapshot;
const at = (url: string) => ({ url }) as RouterStateSnapshot;

describe('auth guards', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    router = TestBed.inject(Router);
  });

  /** Runs a guard and returns true, or the URL it redirects to. */
  function run(guard: typeof authGuard, url: string): string | true {
    const result = TestBed.runInInjectionContext(() => guard(route, at(url)));
    return result === true ? true : router.serializeUrl(result as ReturnType<Router['parseUrl']>);
  }

  describe('authGuard', () => {
    it('sends an anonymous visitor to /login', async () => {
      await signInAs(null);
      expect(run(authGuard, '/mto')).toBe('/login');
    });

    it('sends a user who must change the password to /change-password', async () => {
      await signInAs(makeMe({ must_change_password: true }));
      expect(run(authGuard, '/mto')).toBe('/change-password');
      expect(run(authGuard, '/profile?tab=1')).toBe('/change-password');
    });

    it('lets that user reach /change-password itself', async () => {
      await signInAs(makeMe({ must_change_password: true }));
      expect(run(authGuard, '/change-password')).toBe(true);
      expect(run(authGuard, '/change-password?x=1')).toBe(true);
    });

    it('lets a signed-in user through', async () => {
      await signInAs(makeMe());
      expect(run(authGuard, '/mto/vehicles')).toBe(true);
    });
  });

  describe('roleGuard', () => {
    it('lets a listed role through', async () => {
      await signInAs(makeMe({ role: 'MTO' }));
      expect(run(roleGuard('MTO'), '/mto')).toBe(true);
      expect(run(roleGuard('PTO', 'MTO'), '/mto')).toBe(true);
    });

    it('sends any other role to /', async () => {
      await signInAs(makeMe({ role: 'DRIVER' }));
      expect(run(roleGuard('MTO'), '/mto')).toBe('/');
      expect(run(roleGuard('PTO', 'MTO'), '/pto')).toBe('/');
    });

    it('sends an anonymous visitor to /', async () => {
      await signInAs(null);
      expect(run(roleGuard('MTO'), '/mto')).toBe('/');
    });
  });
});
