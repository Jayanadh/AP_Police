import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { AuthStore } from '../../core/auth-store';
import { makeMe } from '../../core/test-data';
import { LoginPage } from './login-page';

describe('LoginPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  async function setup() {
    const http = TestBed.inject(HttpTestingController);
    const urls: string[] = [];
    TestBed.inject(Router).navigateByUrl = async (url: string | UrlTree) => {
      urls.push(String(url));
      return true;
    };
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const field = (id: string) => el.querySelector(`#${id}`) as HTMLInputElement;
    const fill = (id: string, value: string) => {
      field(id).value = value;
      field(id).dispatchEvent(new Event('input'));
    };
    const submit = () => (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    return { fixture, el, http, urls, fill, submit };
  }

  it('shows the scene of a digital fill, the two emblems, the title, the subtitle and the form', async () => {
    const { el } = await setup();
    expect(el.querySelector('.hero app-fuel-flow-scene')).not.toBeNull();
    const emblems = Array.from(el.querySelectorAll<HTMLImageElement>('.emblems img'));
    expect(emblems.map((img) => [img.getAttribute('src'), img.alt])).toEqual([
      ['logos/ap-government.webp', 'Emblem of the Government of Andhra Pradesh'],
      ['logos/ap-police.webp', 'Emblem of Andhra Pradesh Police'],
    ]);
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('AP Police MTO');
    expect(el.textContent).toContain('Vehicles and fuel for Andhra Pradesh Police');
    expect(el.querySelector('label[for="login-username"]')?.textContent?.trim()).toBe(
      'Emp ID or login ID',
    );
    expect(el.querySelector('label[for="login-password"]')?.textContent?.trim()).toBe('Password');
    expect(el.querySelector('#login-password')?.getAttribute('type')).toBe('password');
    const button = el.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('Log in');
    expect(button.classList.contains('btn-primary')).toBe(true);
    expect(button.classList.contains('btn-block')).toBe(true);
  });

  it('posts the credentials and goes to / on success', async () => {
    const { fixture, http, urls, fill, submit } = await setup();
    fill('login-username', ' d.ramu ');
    fill('login-password', 'secret-1');
    submit();
    const req = http.expectOne('/api/auth/login/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'd.ramu', password: 'secret-1' });
    req.flush({ user: makeMe({ role: 'DRIVER' }) });
    await fixture.whenStable();
    expect(urls).toEqual(['/']);
    expect(TestBed.inject(AuthStore).role()).toBe('DRIVER');
  });

  it('goes to /change-password when the password must be changed', async () => {
    const { fixture, http, urls, fill, submit } = await setup();
    fill('login-username', 'new.officer');
    fill('login-password', 'temp-pass');
    submit();
    http.expectOne('/api/auth/login/').flush({ user: makeMe({ must_change_password: true }) });
    await fixture.whenStable();
    expect(urls).toEqual(['/change-password']);
  });

  it('shows the API error under the form and lets the user try again', async () => {
    const { fixture, el, http, urls, fill, submit } = await setup();
    fill('login-username', 'd.ramu');
    fill('login-password', 'wrong');
    submit();
    const button = el.querySelector('button[type="submit"]') as HTMLButtonElement;
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
    http
      .expectOne('/api/auth/login/')
      .flush(
        { detail: 'Invalid username or password.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    const error = el.querySelector('.error') as HTMLElement;
    expect(error.textContent?.trim()).toBe('Invalid username or password.');
    expect(error.getAttribute('role')).toBe('alert');
    expect(button.disabled).toBe(false);
    expect(urls).toEqual([]);
  });

  it('asks for both fields and sends nothing when one is empty', async () => {
    const { fixture, el, http, urls, fill, submit } = await setup();
    fill('login-username', 'd.ramu');
    submit();
    await fixture.whenStable();
    http.expectNone('/api/auth/login/');
    expect(el.querySelector('.error')?.textContent?.trim()).toBe(
      'Enter your login ID and password.',
    );
    expect(urls).toEqual([]);
  });

  it('clears an earlier error when it tries again', async () => {
    const { fixture, el, http, fill, submit } = await setup();
    fill('login-username', 'd.ramu');
    fill('login-password', 'wrong');
    submit();
    http
      .expectOne('/api/auth/login/')
      .flush({ detail: 'Invalid username or password.' }, { status: 400, statusText: 'Bad' });
    await fixture.whenStable();
    expect(el.querySelector('.error')).not.toBeNull();
    submit();
    fixture.detectChanges();
    expect(el.querySelector('.error')).toBeNull();
    http.expectOne('/api/auth/login/');
  });
});
