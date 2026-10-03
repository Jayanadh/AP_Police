import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MasterItem } from '../../core/api/masters-api';
import { ToastService } from '../../ui/toast';
import { MastersPage } from './masters-page';

const item = (id: number, name: string, is_active = true): MasterItem => ({ id, name, is_active });

describe('MastersPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup() {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MastersPage);
    fixture.detectChanges(); // the cards ask for their lists once their inputs are set
    const flushList = (kind: string, rows: MasterItem[]) => {
      const req = http.expectOne(`/api/masters/${kind}/`);
      expect(req.request.method).toBe('GET');
      req.flush(rows);
    };
    flushList('districts', [item(1, 'Guntur'), item(2, 'Krishna', false)]);
    flushList('designations', [item(4, 'Inspector')]);
    flushList('cadres', []);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const card = (title: string) =>
      Array.from(el.querySelectorAll<HTMLElement>('app-master-card')).find(
        (c) => text(c.querySelector('h2')) === title,
      )!;
    const rows = (title: string) =>
      Array.from(card(title).querySelectorAll('.master-row')).map((row) => [
        text(row.querySelector('.master-name')),
        text(row.querySelector('button[role="switch"]')),
      ]);
    const type = (title: string, value: string) => {
      const input = card(title).querySelector('input.add-input') as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const add = (title: string) =>
      (card(title).querySelector('form button[type="submit"]') as HTMLButtonElement).click();
    const toggle = (title: string, name: string) =>
      (
        Array.from(card(title).querySelectorAll('.master-row'))
          .find((row) => text(row.querySelector('.master-name')) === name)!
          .querySelector('button[role="switch"]') as HTMLButtonElement
      ).click();
    return { fixture, el, http, text, card, rows, type, add, toggle };
  }

  it('shows Districts, Designations and Cadres, each with its items and their state', async () => {
    const { el, text, rows, card } = await setup();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Master lists');
    expect(Array.from(el.querySelectorAll('app-master-card h2')).map((h) => text(h))).toEqual([
      'Districts',
      'Designations',
      'Cadres',
    ]);
    expect(rows('Districts')).toEqual([
      ['Guntur', 'Active'],
      ['Krishna', 'Inactive'],
    ]);
    expect(rows('Designations')).toEqual([['Inspector', 'Active']]);
    expect(rows('Cadres')).toEqual([]);
    expect(text(card('Cadres'))).toContain('No cadres yet');
  });

  it('marks the toggle as a switch with the item name and its state', async () => {
    const { card } = await setup();
    const [guntur, krishna] = Array.from(
      card('Districts').querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
    );
    expect(guntur.getAttribute('aria-checked')).toBe('true');
    expect(krishna.getAttribute('aria-checked')).toBe('false');
    const nameId = guntur.getAttribute('aria-labelledby')!.split(' ')[0];
    expect(card('Districts').querySelector(`#${nameId}`)?.textContent?.trim()).toBe('Guntur');
  });

  it('labels each add input', async () => {
    const { card } = await setup();
    const label = (title: string) => card(title).querySelector('form label')?.textContent?.trim();
    expect(label('Districts')).toBe('New district');
    expect(label('Designations')).toBe('New designation');
    expect(label('Cadres')).toBe('New cadre');
  });

  it('adds an item, keeps the list sorted and clears the input', async () => {
    const { fixture, http, rows, type, add, card } = await setup();
    type('Districts', '  Chittoor ');
    add('Districts');
    const req = http.expectOne('/api/masters/districts/');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Chittoor' });
    req.flush(item(7, 'Chittoor'), { status: 201, statusText: 'Created' });
    await fixture.whenStable();
    expect(rows('Districts')).toEqual([
      ['Chittoor', 'Active'],
      ['Guntur', 'Active'],
      ['Krishna', 'Inactive'],
    ]);
    expect((card('Districts').querySelector('input.add-input') as HTMLInputElement).value).toBe('');
    expect(TestBed.inject(ToastService).messages()[0]).toMatchObject({
      text: 'District added.',
      tone: 'success',
    });
  });

  it('sends nothing when the name is empty', async () => {
    const { fixture, http, type, add, card, text } = await setup();
    type('Cadres', '   ');
    add('Cadres');
    await fixture.whenStable();
    http.expectNone('/api/masters/cadres/');
    expect(text(card('Cadres').querySelector('.error'))).toBe('Enter a name to add.');
  });

  it('shows the API error, such as a duplicate name, and keeps the text', async () => {
    const { fixture, http, type, add, card, text, rows } = await setup();
    type('Districts', 'Guntur');
    add('Districts');
    http
      .expectOne('/api/masters/districts/')
      .flush(
        { name: ['district with this name already exists.'] },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(text(card('Districts').querySelector('.error'))).toBe(
      'name: district with this name already exists.',
    );
    expect((card('Districts').querySelector('input.add-input') as HTMLInputElement).value).toBe(
      'Guntur',
    );
    expect(rows('Districts')).toHaveLength(2);
  });

  it('turns an item inactive and active again', async () => {
    const { fixture, http, rows, toggle } = await setup();
    toggle('Districts', 'Guntur');
    let req = http.expectOne('/api/masters/districts/1/');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ is_active: false });
    req.flush(item(1, 'Guntur', false));
    await fixture.whenStable();
    expect(rows('Districts')[0]).toEqual(['Guntur', 'Inactive']);

    toggle('Districts', 'Krishna');
    req = http.expectOne('/api/masters/districts/2/');
    expect(req.request.body).toEqual({ is_active: true });
    req.flush(item(2, 'Krishna', true));
    await fixture.whenStable();
    expect(rows('Districts')[1]).toEqual(['Krishna', 'Active']);
  });

  it('shows an error and leaves the state alone when a toggle fails', async () => {
    const { fixture, http, rows, toggle, card, text } = await setup();
    toggle('Designations', 'Inspector');
    http
      .expectOne('/api/masters/designations/4/')
      .flush({ detail: 'Not allowed.' }, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    expect(rows('Designations')).toEqual([['Inspector', 'Active']]);
    expect(text(card('Designations').querySelector('.error'))).toBe('Not allowed.');
  });

  describe('renaming', () => {
    const edit = async (
      card: (title: string) => HTMLElement,
      fixture: { whenStable: () => Promise<unknown> },
      title: string,
      name: string,
    ) => {
      card(title).querySelector<HTMLButtonElement>(`button[aria-label="Edit ${name}"]`)!.click();
      await fixture.whenStable();
    };
    const typeName = async (
      box: HTMLInputElement,
      fixture: { whenStable: () => Promise<unknown> },
      value: string,
    ) => {
      box.value = value;
      box.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };

    it('opens the name, saves the new one and keeps the list sorted', async () => {
      const { fixture, http, card, rows, el } = await setup();
      await edit(card, fixture, 'Districts', 'Guntur');
      const box = el.querySelector<HTMLInputElement>('#master-districts-1-edit')!;
      expect(box.value).toBe('Guntur');
      expect(el.querySelector('label[for="master-districts-1-edit"]')?.textContent?.trim()).toBe(
        'New name for Guntur',
      );
      await typeName(box, fixture, ' Palnadu ');

      card('Districts')
        .querySelector<HTMLButtonElement>('form.rename button[type="submit"]')!
        .click();
      const req = http.expectOne('/api/masters/districts/1/');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ name: 'Palnadu' });
      req.flush(item(1, 'Palnadu'));
      await fixture.whenStable();

      expect(rows('Districts')).toEqual([
        ['Krishna', 'Inactive'],
        ['Palnadu', 'Active'],
      ]);
      expect(card('Districts').querySelector('form.rename')).toBeNull();
      expect(
        TestBed.inject(ToastService)
          .messages()
          .map((t) => t.text),
      ).toContain('Renamed to Palnadu.');
    });

    it('leaves the name alone on Cancel', async () => {
      const { fixture, card, rows, text } = await setup();
      await edit(card, fixture, 'Designations', 'Inspector');
      const cancel = Array.from(card('Designations').querySelectorAll('form.rename button')).find(
        (b) => text(b) === 'Cancel',
      ) as HTMLButtonElement;
      cancel.click();
      await fixture.whenStable();
      expect(rows('Designations')).toEqual([['Inspector', 'Active']]);
    });

    it('sends nothing for an empty name', async () => {
      const { fixture, card, el, text } = await setup();
      await edit(card, fixture, 'Designations', 'Inspector');
      await typeName(
        el.querySelector<HTMLInputElement>('#master-designations-4-edit')!,
        fixture,
        ' ',
      );
      card('Designations')
        .querySelector<HTMLButtonElement>('form.rename button[type="submit"]')!
        .click();
      await fixture.whenStable();
      expect(text(card('Designations').querySelector('.error'))).toBe('Enter a name.');
    });

    it('shows the API error, such as a name already taken, and stays open', async () => {
      const { fixture, http, card, el, text } = await setup();
      await edit(card, fixture, 'Districts', 'Guntur');
      await typeName(
        el.querySelector<HTMLInputElement>('#master-districts-1-edit')!,
        fixture,
        'Krishna',
      );
      card('Districts')
        .querySelector<HTMLButtonElement>('form.rename button[type="submit"]')!
        .click();
      http
        .expectOne('/api/masters/districts/1/')
        .flush(
          { name: ['district with this name already exists.'] },
          { status: 400, statusText: 'Bad Request' },
        );
      await fixture.whenStable();
      expect(text(card('Districts').querySelector('.error'))).toContain('already exists');
      expect(el.querySelector('#master-districts-1-edit')).not.toBeNull();
    });
  });

  it('shows a load error with a retry for the card that failed, not the others', async () => {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MastersPage);
    fixture.detectChanges();
    http.expectOne('/api/masters/districts/').flush([item(1, 'Guntur')]);
    http
      .expectOne('/api/masters/designations/')
      .flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
    http.expectOne('/api/masters/cadres/').flush([]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.error')).toHaveLength(1);
    (el.querySelector('button.retry') as HTMLButtonElement).click();
    http.expectOne('/api/masters/designations/').flush([item(4, 'Inspector')]);
    await fixture.whenStable();
    expect(el.querySelector('.error')).toBeNull();
    expect(el.textContent).toContain('Inspector');
  });
});
