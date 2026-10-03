import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { AuthStore, Me } from '../core/auth-store';
import { NotificationsApi } from '../core/api/notifications-api';
import { makeMe, signInAs } from '../core/test-data';
import { ToastService } from '../ui/toast';
import { Shell, UNREAD_POLL_MS } from './shell';

const UNREAD_URL = '/api/notifications/unread-count/';

@Component({ template: '' })
class Blank {}

describe('Shell', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: Blank }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  /** Signs in, creates the shell and answers its first unread-count call. */
  async function setup(user: Me = makeMe(), unread = 0) {
    await signInAs(user);
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Shell);
    http.expectOne(UNREAD_URL).flush({ count: unread });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, http };
  }

  const texts = (nodes: NodeListOf<Element>) =>
    Array.from(nodes).map((node) => node.textContent?.trim());
  const labels = (el: HTMLElement, selector: string) =>
    Array.from(el.querySelectorAll(selector)).map((node) => node.getAttribute('aria-label'));

  /** Replaces Router.navigateByUrl so a test can see where the app tried to go. */
  function recordNavigation(): string[] {
    const urls: string[] = [];
    TestBed.inject(Router).navigateByUrl = async (url: string | UrlTree) => {
      urls.push(String(url));
      return true;
    };
    return urls;
  }

  describe('navigation', () => {
    it('lists every MTO item in the sidebar with the brand', async () => {
      const { el } = await setup(makeMe({ role: 'MTO' }));
      expect(texts(el.querySelectorAll('.side-nav a'))).toEqual([
        'Dashboard',
        'Vehicles',
        'Drivers',
        'Officers',
        'Transfers',
        'Pumps',
        'Additional quota',
        'Emergencies',
        'Fuel statement',
        'Bunk statements',
        'Odometer',
        'Servicing',
      ]);
      expect(el.querySelector('.side-nav a[href="/mto/vehicles"]')).not.toBeNull();
      expect(el.querySelector('.sidebar .brand')?.textContent).toContain('AP Police MTO');
      // The AP Police badge is the brand's mark; the name beside it says what it is.
      const mark = el.querySelector<HTMLImageElement>('.sidebar .brand img.brand-mark')!;
      expect(mark.getAttribute('src')).toBe('logos/ap-police-mark.webp');
      expect(mark.alt).toBe('');
    });

    it('shows the four primary items and a More button in the bottom bar', async () => {
      const { el } = await setup(makeMe({ role: 'MTO' }));
      expect(labels(el, '.bottom-nav a, .bottom-nav button')).toEqual([
        'Dashboard',
        'Vehicles',
        'Emergencies',
        'Fuel statement',
        'More',
      ]);
    });

    it('keeps the More button when every page fits in the bottom bar, for Log out', async () => {
      const { el } = await setup(makeMe({ role: 'OFFICER' }));
      expect(labels(el, '.bottom-nav a, .bottom-nav button')).toEqual([
        'Dashboard',
        'Fuel statement',
        'More',
      ]);
    });

    it('has neither Alerts nor Profile in the sidebar', async () => {
      const { el } = await setup(makeMe({ role: 'MTO' }));
      expect(el.querySelector('.side-nav a[href="/alerts"]')).toBeNull();
      expect(el.querySelector('.side-nav a[href="/profile"]')).toBeNull();
    });

    it("follows the pump kind: a tie-up bunk's staff see no Stock", async () => {
      const { el } = await setup(makeMe({ role: 'PUMP_OPERATOR', pump: 5, pump_kind: 'TIE_UP' }));
      const items = texts(el.querySelectorAll('.side-nav a'));
      expect(items).toContain('Fuel statement');
      expect(items).not.toContain('Stock');
    });

    it('marks the current page, and the dashboard only on its own page', async () => {
      const { fixture, el, http } = await setup(makeMe({ role: 'MTO' }));
      await TestBed.inject(Router).navigateByUrl('/mto/vehicles');
      http.expectOne(UNREAD_URL).flush({ count: 0 });
      await fixture.whenStable();
      const active = (label: string) =>
        Array.from(el.querySelectorAll('.side-nav a')).find((a) => a.textContent?.trim() === label)
          ?.classList;
      expect(active('Vehicles')?.contains('active')).toBe(true);
      expect(active('Dashboard')?.contains('active')).toBe(false);
      expect(
        el.querySelector('.bottom-nav a[aria-label="Vehicles"]')?.classList.contains('active'),
      ).toBe(true);

      await TestBed.inject(Router).navigateByUrl('/mto');
      http.expectOne(UNREAD_URL).flush({ count: 0 });
      await fixture.whenStable();
      expect(active('Dashboard')?.contains('active')).toBe(true);
      expect(active('Vehicles')?.contains('active')).toBe(false);
    });

    it('shows who is signed in', async () => {
      const { el } = await setup(makeMe({ full_name: 'Ravi Kumar', role: 'MTO' }));
      const who = el.querySelector('.side-user')?.textContent ?? '';
      expect(who).toContain('Ravi Kumar');
      expect(who).toContain('MTO');
    });
  });

  describe('More sheet', () => {
    const more = (el: HTMLElement) => el.querySelector('.more-button') as HTMLButtonElement;

    it('opens a sheet with every item and Log out', async () => {
      const { fixture, el } = await setup(makeMe({ role: 'MTO' }));
      expect(el.querySelector('.sheet')).toBeNull();
      more(el).click();
      await fixture.whenStable();
      const sheet = el.querySelector('.sheet') as HTMLElement;
      expect(sheet.getAttribute('role')).toBe('dialog');
      expect(texts(sheet.querySelectorAll('a.more-link'))).toHaveLength(12);
      expect(texts(sheet.querySelectorAll('a.more-link'))).toContain('Additional quota');
      expect(sheet.querySelector('button.logout')?.textContent).toContain('Log out');
      expect(more(el).getAttribute('aria-expanded')).toBe('true');
    });

    it('moves focus into the sheet, and back to the More button when it is dismissed', async () => {
      const { fixture, el } = await setup(makeMe({ role: 'MTO' }));
      more(el).click();
      await fixture.whenStable();
      expect(document.activeElement).toBe(el.querySelector('.sheet'));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await fixture.whenStable();
      expect(document.activeElement).toBe(more(el));
    });

    it('closes when a link in it is clicked, even to the page already open', async () => {
      const { fixture, el, http } = await setup(makeMe({ role: 'MTO' }));
      await TestBed.inject(Router).navigateByUrl('/mto');
      http.expectOne(UNREAD_URL).flush({ count: 0 });
      await fixture.whenStable();

      more(el).click();
      await fixture.whenStable();
      expect(el.querySelector('.sheet')).not.toBeNull();
      // same URL: the router ignores it and fires no NavigationEnd
      (el.querySelector('.sheet a.more-link[href="/mto"]') as HTMLAnchorElement).click();
      await fixture.whenStable();
      http.expectNone(UNREAD_URL);
      expect(el.querySelector('.sheet')).toBeNull();
    });

    it('closes on the backdrop, on Escape and after navigating', async () => {
      const { fixture, el, http } = await setup(makeMe({ role: 'MTO' }));

      more(el).click();
      await fixture.whenStable();
      (el.querySelector('.sheet-backdrop') as HTMLElement).click();
      await fixture.whenStable();
      expect(el.querySelector('.sheet')).toBeNull();

      more(el).click();
      await fixture.whenStable();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await fixture.whenStable();
      expect(el.querySelector('.sheet')).toBeNull();

      more(el).click();
      await fixture.whenStable();
      await TestBed.inject(Router).navigateByUrl('/mto/drivers');
      http.expectOne(UNREAD_URL).flush({ count: 0 });
      await fixture.whenStable();
      expect(el.querySelector('.sheet')).toBeNull();
    });
  });

  describe('top bar', () => {
    it('ends with the Alerts bell and then Profile, the right-most', async () => {
      const { el } = await setup(makeMe({ role: 'MTO' }));
      const actions = Array.from(el.querySelectorAll('.topbar .top-actions > a'));
      expect(actions.map((a) => a.getAttribute('aria-label'))).toEqual(['Alerts', 'Profile']);
      expect(actions.map((a) => a.getAttribute('href'))).toEqual(['/alerts', '/profile']);
      expect(el.querySelector('.topbar')?.lastElementChild?.classList.contains('top-actions')).toBe(
        true,
      );
    });

    it('marks Profile as the current page on the profile page', async () => {
      const { fixture, el, http } = await setup(makeMe({ role: 'DRIVER' }));
      await TestBed.inject(Router).navigateByUrl('/profile');
      http.expectOne(UNREAD_URL).flush({ count: 0 });
      await fixture.whenStable();
      const profile = el.querySelector('.topbar a[href="/profile"]');
      expect(profile?.classList.contains('active')).toBe(true);
      expect(profile?.getAttribute('aria-current')).toBe('page');
    });
  });

  describe('another sign-in in another tab', () => {
    it('checks the session when the window is back in focus, and goes home if someone else is signed in', async () => {
      const { fixture, http } = await setup(makeMe({ id: 7, role: 'OFFICER' }));
      const urls = recordNavigation();
      window.dispatchEvent(new Event('focus'));
      http.expectOne('/api/auth/session/').flush({ user: makeMe({ id: 8, role: 'MTO' }) });
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
      expect(urls).toEqual(['/']);
    });

    it('stays put when the same person is still signed in', async () => {
      const me = makeMe({ id: 7, role: 'OFFICER' });
      const { fixture, http } = await setup(me);
      const urls = recordNavigation();
      window.dispatchEvent(new Event('focus'));
      http.expectOne('/api/auth/session/').flush({ user: me });
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
      expect(urls).toEqual([]);
    });
  });

  describe('unread badge', () => {
    it('shows the count from the server on the bell, which links to /alerts', async () => {
      const { el } = await setup(makeMe(), 3);
      const bell = el.querySelector('a.bell') as HTMLAnchorElement;
      expect(bell.getAttribute('href')).toBe('/alerts');
      expect(bell.querySelector('.bell-badge')?.textContent?.trim()).toBe('3');
      expect(bell.getAttribute('aria-label')).toBe('Alerts, 3 unread');
    });

    it('shows no badge when nothing is unread', async () => {
      const { el } = await setup(makeMe(), 0);
      expect(el.querySelector('.bell-badge')).toBeNull();
      expect(el.querySelector('a.bell')?.getAttribute('aria-label')).toBe('Alerts');
    });

    it('caps the badge at 99+', async () => {
      const { el } = await setup(makeMe(), 140);
      expect(el.querySelector('.bell-badge')?.textContent?.trim()).toBe('99+');
    });

    it('keeps the last count when a refresh fails', async () => {
      const { fixture, el, http } = await setup(makeMe(), 2);
      await TestBed.inject(Router).navigateByUrl('/anywhere');
      http.expectOne(UNREAD_URL).flush('x', { status: 500, statusText: 'Server' });
      await fixture.whenStable();
      expect(el.querySelector('.bell-badge')?.textContent?.trim()).toBe('2');
    });

    it('refreshes after every navigation', async () => {
      const { fixture, el, http } = await setup(makeMe(), 1);
      await TestBed.inject(Router).navigateByUrl('/mto/pumps');
      http.expectOne(UNREAD_URL).flush({ count: 5 });
      await fixture.whenStable();
      expect(el.querySelector('.bell-badge')?.textContent?.trim()).toBe('5');
    });

    it('refreshes after alerts are marked read', async () => {
      const { fixture, el, http } = await setup(makeMe(), 4);
      TestBed.inject(NotificationsApi).markAllRead().subscribe();
      http.expectOne('/api/notifications/read-all/').flush({ updated: 4 });
      http.expectOne(UNREAD_URL).flush({ count: 0 });
      await fixture.whenStable();
      expect(el.querySelector('.bell-badge')).toBeNull();
    });

    it('polls on an interval and stops when the shell is destroyed', async () => {
      TestBed.configureTestingModule({ providers: [{ provide: UNREAD_POLL_MS, useValue: 30 }] });
      const { fixture, http } = await setup(makeMe(), 0);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const polled = http.match(UNREAD_URL);
      expect(polled.length).toBeGreaterThanOrEqual(1);
      // a newer poll cancels the one before it
      polled.filter((req) => !req.cancelled).forEach((req) => req.flush({ count: 0 }));

      fixture.destroy();
      await new Promise((resolve) => setTimeout(resolve, 100));
      http.expectNone(UNREAD_URL);
    });

    it('polls every 60 seconds by default', () => {
      expect(TestBed.inject(UNREAD_POLL_MS)).toBe(60_000);
    });
  });

  describe('Log out', () => {
    it('calls the API, forgets the user and goes to /login', async () => {
      const { fixture, el, http } = await setup();
      const urls = recordNavigation();
      (el.querySelector('.side-user button.logout') as HTMLButtonElement).click();
      const req = http.expectOne('/api/auth/logout/');
      expect(req.request.method).toBe('POST');
      req.flush(null, { status: 204, statusText: 'No Content' });
      await fixture.whenStable();
      expect(TestBed.inject(AuthStore).user()).toBeNull();
      expect(urls).toEqual(['/login']);
    });

    it('works from the More sheet too', async () => {
      const { fixture, el, http } = await setup();
      const urls = recordNavigation();
      (el.querySelector('.more-button') as HTMLButtonElement).click();
      await fixture.whenStable();
      (el.querySelector('.sheet button.logout') as HTMLButtonElement).click();
      http.expectOne('/api/auth/logout/').flush(null, { status: 204, statusText: 'No Content' });
      await fixture.whenStable();
      expect(urls).toEqual(['/login']);
    });

    it('stays signed in and says so when the server cannot be reached', async () => {
      const { fixture, el, http } = await setup();
      const urls = recordNavigation();
      (el.querySelector('.side-user button.logout') as HTMLButtonElement).click();
      http.expectOne('/api/auth/logout/').error(new ProgressEvent('error'), { status: 0 });
      await fixture.whenStable();
      expect(TestBed.inject(AuthStore).user()).not.toBeNull();
      expect(urls).toEqual([]);
      const toast = TestBed.inject(ToastService).messages()[0];
      expect(toast.tone).toBe('danger');
      expect(toast.text).toBe('Cannot reach the server. Check your connection.');
    });
  });
});
