import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { AuthStore } from '../../core/auth-store';
import { makeMe, signInAs } from '../../core/test-data';
import { ToastService } from '../../ui/toast';
import { ChangePasswordPage } from './change-password-page';

const URL = '/api/auth/change-password/';

describe('ChangePasswordPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  async function setup(forced = false) {
    await signInAs(makeMe({ must_change_password: forced }));
    const http = TestBed.inject(HttpTestingController);
    const urls: string[] = [];
    TestBed.inject(Router).navigateByUrl = async (url: string | UrlTree) => {
      urls.push(String(url));
      return true;
    };
    const fixture = TestBed.createComponent(ChangePasswordPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const fill = (id: string, value: string) => {
      const input = el.querySelector(`#${id}`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const fillAll = (current: string, next: string, confirm: string) => {
      fill('cp-current', current);
      fill('cp-new', next);
      fill('cp-confirm', confirm);
    };
    const submit = () => (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    return { fixture, el, http, urls, fillAll, submit };
  }

  it('asks for the current password, a new one and a confirmation', async () => {
    const { el } = await setup();
    const label = (id: string) => el.querySelector(`label[for="${id}"]`)?.textContent?.trim();
    expect(label('cp-current')).toBe('Current password');
    expect(label('cp-new')).toBe('New password');
    expect(label('cp-confirm')).toBe('Confirm new password');
    expect(el.querySelector('#cp-new')?.getAttribute('autocomplete')).toBe('new-password');
    expect(el.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Change password');
  });

  it('explains why when the change is compulsory', async () => {
    const forced = await setup(true);
    expect(forced.el.querySelector('.notice')?.textContent).toContain(
      'You need to set a new password before you continue.',
    );
  });

  it('says nothing about it when the change is voluntary', async () => {
    const { el } = await setup(false);
    expect(el.querySelector('.notice')).toBeNull();
  });

  it('refuses a mismatch without sending anything', async () => {
    const { fixture, el, http, urls, fillAll, submit } = await setup();
    fillAll('old-pass-1', 'new-pass-77', 'new-pass-78');
    submit();
    await fixture.whenStable();
    http.expectNone(URL);
    expect(el.querySelector('.error')?.textContent?.trim()).toBe('The new passwords do not match.');
    expect(urls).toEqual([]);
  });

  it('asks for every field and sends nothing while one is empty', async () => {
    const { fixture, el, http, fillAll, submit } = await setup();
    fillAll('old-pass-1', '', '');
    submit();
    await fixture.whenStable();
    http.expectNone(URL);
    expect(el.querySelector('.error')?.textContent?.trim()).toBe(
      'Enter your current password, a new password and the confirmation.',
    );
  });

  it('posts the passwords, confirms with a toast and goes to /', async () => {
    const { fixture, http, urls, fillAll, submit } = await setup(true);
    fillAll('old-pass-1', 'new-pass-77', 'new-pass-77');
    submit();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ old_password: 'old-pass-1', new_password: 'new-pass-77' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(urls).toEqual(['/']);
    expect(TestBed.inject(AuthStore).user()?.must_change_password).toBe(false);
    expect(TestBed.inject(ToastService).messages()[0]).toMatchObject({
      text: 'Password changed.',
      tone: 'success',
    });
  });

  it('shows what the server says and stays on the page', async () => {
    const { fixture, el, http, urls, fillAll, submit } = await setup();
    fillAll('wrong', 'new-pass-77', 'new-pass-77');
    submit();
    http
      .expectOne(URL)
      .flush({ detail: 'Current password is incorrect.' }, { status: 400, statusText: 'Bad' });
    await fixture.whenStable();
    expect(el.querySelector('.error')?.textContent?.trim()).toBe('Current password is incorrect.');
    expect(urls).toEqual([]);
  });
});
