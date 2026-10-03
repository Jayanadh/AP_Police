import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Unit } from '../core/api/units-api';
import { OfficeSelect } from './office-select';

describe('OfficeSelect', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup() {
    const fixture = TestBed.createComponent(OfficeSelect);
    fixture.componentRef.setInput('inputId', 'report-unit');
    const chosen: (number | undefined)[] = [];
    fixture.componentInstance.officeChange.subscribe((id) => chosen.push(id));
    await fixture.whenStable();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/units/')
      .flush([
        { id: 4, name: 'Guntur MTO' },
        { id: 3, name: 'SPSR Nellore MTO' },
      ] as Unit[]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const select = el.querySelector('#report-unit') as HTMLSelectElement;
    return { el, select, chosen };
  }

  it('offers all offices first, then every office it reads, under an Office label', async () => {
    const { el, select } = await setup();
    expect(el.querySelector('label[for="report-unit"]')?.textContent?.trim()).toBe('Office');
    expect(Array.from(select.options).map((o) => [o.value, o.textContent?.trim()])).toEqual([
      ['', 'All offices'],
      ['4', 'Guntur MTO'],
      ['3', 'SPSR Nellore MTO'],
    ]);
  });

  it('tells the page the chosen office, or no office for all of them', async () => {
    const { select, chosen } = await setup();
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(chosen).toEqual([3, undefined]);
  });
});
