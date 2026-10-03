import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MonitorPage, MonitorPeopleKind, MonitorPerson } from '../../core/api/monitor-api';
import { Unit } from '../../core/api/units-api';
import {
  makeMonitorDriver,
  makeMonitorPerson,
  monitorPage,
  stubFileSaving,
} from '../../core/test-data';
import { MonitorPeoplePage } from './monitor-people-page';

const OFFICER = makeMonitorPerson();
const NEW_OFFICER = makeMonitorPerson({
  id: 9,
  full_name: 'K. Lakshmi',
  emp_id: 'AP3105',
  unit: 4,
  unit_name: 'Guntur MTO',
  status: 'PENDING_APPROVAL',
  status_label: 'Waiting for PTO approval',
  mobile: '',
  current_vehicles: [],
});
const DRIVER = makeMonitorDriver();
const CAREFUL_DRIVER = makeMonitorDriver({
  id: 6,
  full_name: 'Shaik Imran',
  emp_id: 'AP4002',
  licence_number: '',
  licence_valid_till: null,
  fills_this_month: 0,
  litres_this_month: '0.00',
  overdue_duty: 0,
  current_vehicles: [
    { id: 2, registration_number: 'AP39PA1002' },
    { id: 7, registration_number: 'AP39PA1007' },
  ],
});

describe('MonitorPeoplePage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(kind: MonitorPeopleKind, first: MonitorPage<MonitorPerson> | 'fail') {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MonitorPeoplePage);
    fixture.componentRef.setInput('kind', kind);
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    const answer = async (url: string, body: object | 'fail') => {
      const req = http.expectOne(url);
      expect(req.request.method).toBe('GET');
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
    };
    http.expectOne('/api/units/').flush([
      { id: 4, name: 'Guntur MTO' },
      { id: 3, name: 'SPSR Nellore MTO' },
    ] as Unit[]);
    await answer(`/api/monitor/${kind}/`, first);
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const cards = () => Array.from(el.querySelectorAll<HTMLElement>('.person'));
    const button = (name: string) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => text(b) === name);
    return { fixture, el, http, answer, text, cards, button };
  }

  describe('officers', () => {
    it('shows every office’s officers with their details and vehicles, read only', async () => {
      const { el, text, cards } = await setup('officers', monitorPage([OFFICER, NEW_OFFICER]));
      expect(text(el.querySelector('h1'))).toBe('Officers');
      expect(text(el.querySelector('.page-header'))).toContain('read only');
      const first = cards()[0];
      expect(text(first.querySelector('.name'))).toBe('S. Venkata Rao');
      expect(text(first.querySelector('app-status-badge'))).toBe('Active');
      expect(text(first.querySelector('.meta'))).toBe('AP3001 · Inspector of Police');
      expect(text(first.querySelector('.office-line'))).toBe('SPSR Nellore MTO');
      expect(text(first.querySelector('.mobile'))).toBe('Mobile 9876543210');
      expect(text(first.querySelector('.vehicles'))).toBe('Vehicle AP39PA1001');
      expect(first.querySelector('.licence')).toBeNull();
      expect(first.querySelector('button, a')).toBeNull();
    });

    it('shows what is missing plainly', async () => {
      const { cards, text } = await setup('officers', monitorPage([NEW_OFFICER]));
      expect(text(cards()[0].querySelector('app-status-badge'))).toBe('Waiting for PTO approval');
      expect(text(cards()[0].querySelector('.mobile'))).toBe('Mobile Not given');
      expect(text(cards()[0].querySelector('.vehicles'))).toBe('Vehicle None linked');
    });

    it('offers the officer statuses and narrows by one', async () => {
      const { el, text, button, answer, fixture } = await setup('officers', monitorPage([OFFICER]));
      expect(Array.from(el.querySelectorAll('.chips .chip')).map((c) => text(c))).toEqual([
        'All',
        'Active',
        'Waiting for PTO',
        'Paused',
        'Terminated',
      ]);
      button('Waiting for PTO')!.click();
      await fixture.whenStable();
      await answer('/api/monitor/officers/?status=PENDING_APPROVAL', monitorPage([NEW_OFFICER]));
    });

    it('narrows by office and by name or Emp ID', async () => {
      const { el, answer, fixture } = await setup('officers', monitorPage([OFFICER]));
      const office = el.querySelector('#monitor-unit') as HTMLSelectElement;
      office.value = '3';
      office.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      await answer('/api/monitor/officers/?unit=3', monitorPage([OFFICER]));

      expect(el.querySelector('label[for="monitor-search"]')?.textContent?.trim()).toBe(
        'Name or Emp ID',
      );
      (el.querySelector('#monitor-search') as HTMLInputElement).value = ' rao ';
      el.querySelector('form.search')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      await answer('/api/monitor/officers/?unit=3&search=rao', monitorPage([OFFICER]));
    });

    it('downloads every officer the filters find as Excel', async () => {
      const { el, answer, http, fixture } = await setup('officers', monitorPage([OFFICER]));
      (el.querySelector('#monitor-search') as HTMLInputElement).value = 'rao';
      el.querySelector('form.search')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      await answer('/api/monitor/officers/?search=rao', monitorPage([OFFICER]));
      stubFileSaving();

      el.querySelector<HTMLButtonElement>('app-download-button button')!.click();
      await fixture.whenStable();

      http.expectOne('/api/monitor/officers/export/?search=rao').flush(new Blob(['x']));
    });

    it('says so when no officer matches', async () => {
      const { el, text } = await setup('officers', monitorPage([]));
      expect(text(el.querySelector('app-empty-state'))).toContain('No officers match.');
    });

    it('shows a load error with a retry', async () => {
      const { el, text, button, answer, fixture, cards } = await setup('officers', 'fail');
      expect(text(el.querySelector('.error'))).toBe('Not available.');
      button('Try again')!.click();
      await fixture.whenStable();
      await answer('/api/monitor/officers/', monitorPage([OFFICER]));
      expect(cards()).toHaveLength(1);
    });
  });

  describe('drivers', () => {
    it('also shows the licence, this month’s fills and overdue duty particulars', async () => {
      const { el, text, cards } = await setup('drivers', monitorPage([DRIVER, CAREFUL_DRIVER]));
      expect(text(el.querySelector('h1'))).toBe('Drivers');
      const first = cards()[0];
      expect(text(first.querySelector('.licence'))).toBe(
        'Licence AP0420190012345, valid till 31 May 2029',
      );
      expect(text(first.querySelector('.month'))).toBe('This month 2 fills · 48 L');
      expect(text(first.querySelector('.overdue-badge'))).toBe('1 fill without duty particulars');
      const second = cards()[1];
      expect(text(second.querySelector('.licence'))).toBe('Licence Not given');
      expect(text(second.querySelector('.month'))).toBe('This month No fills');
      expect(second.querySelector('.overdue-badge')).toBeNull();
      expect(text(second.querySelector('.vehicles'))).toBe('Vehicles AP39PA1002, AP39PA1007');
    });

    it('offers no Waiting for PTO status: drivers need no approval', async () => {
      const { el, text } = await setup('drivers', monitorPage([DRIVER]));
      expect(Array.from(el.querySelectorAll('.chips .chip')).map((c) => text(c))).toEqual([
        'All',
        'Active',
        'Paused',
        'Terminated',
      ]);
    });

    it('pages through the drivers', async () => {
      const { button, answer, fixture } = await setup(
        'drivers',
        monitorPage([DRIVER], { count: 51, pages: 2 }),
      );
      button('Next')!.click();
      await fixture.whenStable();
      await answer(
        '/api/monitor/drivers/?page=2',
        monitorPage([CAREFUL_DRIVER], { count: 51, page: 2, pages: 2 }),
      );
    });
  });
});
