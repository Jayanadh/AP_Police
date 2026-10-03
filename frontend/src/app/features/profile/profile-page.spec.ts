import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { Me } from '../../core/auth-store';
import { makeMe, signInAs } from '../../core/test-data';
import { ProfilePage } from './profile-page';

describe('ProfilePage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  async function setup(user: Me = makeMe()) {
    await signInAs(user);
    const http = TestBed.inject(HttpTestingController);
    const urls: string[] = [];
    TestBed.inject(Router).navigateByUrl = async (url: string | UrlTree) => {
      urls.push(String(url));
      return true;
    };
    const fixture = TestBed.createComponent(ProfilePage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const rows = () =>
      Array.from(el.querySelectorAll('.list-row')).map((row) => [
        row.children[0].textContent?.trim(),
        row.children[1].textContent?.trim(),
      ]);
    const button = (text: string) =>
      Array.from(el.querySelectorAll('button, a')).find((node) =>
        node.textContent?.includes(text),
      ) as HTMLElement | undefined;
    return { fixture, el, http, urls, rows, button };
  }

  it('lists the details of a police officer', async () => {
    const { rows } = await setup(makeMe({ role: 'OFFICER', unit_name: 'MTO Guntur' }));
    expect(rows()).toEqual([
      ['Name', 'Ravi Kumar'],
      ['Emp ID', 'AP1001'],
      ['Designation', 'Inspector'],
      ['District', 'NTR'],
      ['Cadre', 'Civil'],
      ['MTO office', 'MTO Guntur'],
      ['Mobile', '9876543210'],
    ]);
  });

  it('hides the details that are empty', async () => {
    const { rows } = await setup(
      makeMe({
        role: 'PUMP_OPERATOR',
        full_name: 'Lakshmi Devi',
        emp_id: null,
        designation_name: null,
        district_name: null,
        cadre_name: null,
        unit: null,
        unit_name: null,
        mobile: '',
        pump: 4,
        pump_name: 'Nellore Police Pump',
        pump_kind: 'POLICE',
      }),
    );
    expect(rows()).toEqual([
      ['Name', 'Lakshmi Devi'],
      ['Pump', 'Nellore Police Pump'],
    ]);
  });

  it('shows the role under the title', async () => {
    const { el } = await setup(makeMe({ role: 'PUMP_OPERATOR', pump_kind: 'TIE_UP' }));
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Profile');
    expect(el.querySelector('.page-header')?.textContent).toContain('Pump operator');
  });

  it('links to the change-password page', async () => {
    const { button } = await setup();
    const change = button('Change password') as HTMLAnchorElement;
    expect(change.getAttribute('href')).toBe('/change-password');
  });

  it('has no Log out button: logging out is in the menu', async () => {
    const { button } = await setup();
    expect(button('Log out')).toBeUndefined();
  });
});
