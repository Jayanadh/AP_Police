import { TestBed } from '@angular/core/testing';
import { Period, customPeriod, periodOf } from '../core/period';
import { fixedClock } from '../core/test-data';
import { PeriodPicker } from './period-picker';

/** 3 October 2026, mid-morning in India. */
const NOW = '2026-10-03T05:00:00Z';

describe('PeriodPicker', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PeriodPicker],
      providers: [fixedClock(() => NOW)],
    });
  });

  async function setup(period: Period = periodOf('month', '2026-10-03')) {
    const fixture = TestBed.createComponent(PeriodPicker);
    fixture.componentRef.setInput('period', period);
    const emitted: Period[] = [];
    fixture.componentInstance.period.subscribe((value) => emitted.push(value));
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const chip = (label: string) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('.kinds button')).find(
        (b) => text(b) === label,
      )!;
    const byLabel = (label: string) =>
      el.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
    const input = (label: string) => {
      const found = Array.from(el.querySelectorAll('label')).find((l) => text(l) === label)!;
      return el.querySelector(`#${found.htmlFor}`) as HTMLInputElement;
    };
    const settle = () => fixture.whenStable();
    return { fixture, el, text, chip, byLabel, input, emitted, settle };
  }

  it('offers a day, a week, a month, a year or a custom period, with the current one pressed', async () => {
    const { el, text, chip } = await setup();
    const group = el.querySelector('.kinds') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Period');
    expect(Array.from(group.querySelectorAll('button')).map((b) => text(b))).toEqual([
      'Day',
      'Week',
      'Month',
      'Year',
      'Custom',
    ]);
    expect(chip('Month').getAttribute('aria-pressed')).toBe('true');
    expect(chip('Week').getAttribute('aria-pressed')).toBe('false');
  });

  it('names the period and spells out its first and last day', async () => {
    const { el, text } = await setup();
    expect(text(el.querySelector('.label'))).toBe('October 2026');
    expect(text(el.querySelector('.range'))).toBe('01 Oct 2026 – 31 Oct 2026');
  });

  it('steps back a month, and forward again but not beyond the current one', async () => {
    const { byLabel, emitted, settle, fixture } = await setup();
    expect(byLabel('Next month').disabled).toBe(true);

    byLabel('Previous month').click();
    await settle();
    expect(emitted).toEqual([periodOf('month', '2026-09-01')]);
    expect(byLabel('Next month').disabled).toBe(false);

    byLabel('Next month').click();
    await settle();
    expect(emitted.at(-1)).toEqual(periodOf('month', '2026-10-01'));
    expect(fixture.componentInstance.period()).toEqual(periodOf('month', '2026-10-01'));
  });

  it('steps by the kind chosen', async () => {
    const { byLabel, emitted, settle } = await setup(periodOf('week', '2026-10-03'));
    byLabel('Previous week').click();
    await settle();
    expect(emitted).toEqual([periodOf('week', '2026-09-21')]);
  });

  it('switches kind around the last day shown, or around today for the current period', async () => {
    const { chip, emitted, settle } = await setup(periodOf('month', '2026-08-15'));
    chip('Week').click();
    await settle();
    expect(emitted.at(-1)).toEqual(periodOf('week', '2026-08-31'));

    chip('Day').click();
    await settle();
    expect(emitted.at(-1)).toEqual(periodOf('day', '2026-09-06')); // the week's Sunday

    chip('Year').click();
    await settle();
    expect(emitted.at(-1)).toEqual(periodOf('year', '2026-09-06'));

    chip('Month').click();
    await settle();
    expect(emitted.at(-1)).toEqual(periodOf('month', '2026-10-03')); // the year runs past today: today's month
  });

  it('does nothing when the kind already chosen is pressed', async () => {
    const { chip, emitted, settle } = await setup();
    chip('Month').click();
    await settle();
    expect(emitted).toEqual([]);
  });

  it('turns the period into a custom one with two labelled dates to change', async () => {
    const { el, chip, input, emitted, settle } = await setup(periodOf('week', '2026-10-03'));
    chip('Custom').click();
    await settle();
    expect(emitted).toEqual([customPeriod('2026-09-28', '2026-10-04')]);
    expect(el.querySelector('[aria-label="Previous week"]')).toBeNull();
    expect(input('From').type).toBe('date');
    expect(input('From').value).toBe('2026-09-28');
    expect(input('To').value).toBe('2026-10-04');

    input('From').value = '2026-09-01';
    input('From').dispatchEvent(new Event('change'));
    await settle();
    expect(emitted.at(-1)).toEqual(customPeriod('2026-09-01', '2026-10-04'));
  });

  it('says what is wrong with a custom period and keeps the last good one', async () => {
    const { el, text, input, emitted, settle } = await setup(
      customPeriod('2026-09-01', '2026-09-30'),
    );
    input('To').value = '2026-08-01';
    input('To').dispatchEvent(new Event('change'));
    await settle();
    expect(emitted).toEqual([]);
    expect(text(el.querySelector('[role="alert"]'))).toBe(
      'The first day must be on or before the last day.',
    );

    input('To').value = '2026-09-15';
    input('To').dispatchEvent(new Event('change'));
    await settle();
    expect(emitted).toEqual([customPeriod('2026-09-01', '2026-09-15')]);
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('does not let a custom date go past today', async () => {
    const { input } = await setup(customPeriod('2026-09-01', '2026-09-30'));
    expect(input('From').max).toBe('2026-10-03');
    expect(input('To').max).toBe('2026-10-03');
  });
});
