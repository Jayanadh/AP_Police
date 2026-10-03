import {
  checkCustomPeriod,
  customPeriod,
  kindOf,
  periodDays,
  periodFor,
  periodLabel,
  periodOf,
  periodRange,
  shiftPeriod,
  todayIso,
} from './period';

describe('periodOf', () => {
  it('makes a day of the day itself', () => {
    expect(periodOf('day', '2026-10-03')).toEqual({
      kind: 'day',
      from: '2026-10-03',
      to: '2026-10-03',
    });
  });

  it('makes a week from Monday to Sunday', () => {
    expect(periodOf('week', '2026-10-03')).toEqual({
      kind: 'week',
      from: '2026-09-28',
      to: '2026-10-04',
    });
    expect(periodOf('week', '2026-09-28')).toEqual({
      kind: 'week',
      from: '2026-09-28',
      to: '2026-10-04',
    });
    expect(periodOf('week', '2026-10-04')).toEqual({
      kind: 'week',
      from: '2026-09-28',
      to: '2026-10-04',
    });
  });

  it('makes a month from its first to its last day', () => {
    expect(periodOf('month', '2026-10-17')).toEqual({
      kind: 'month',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(periodOf('month', '2028-02-10')).toEqual({
      kind: 'month',
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('makes a year the financial year, April to March', () => {
    expect(periodOf('year', '2026-10-03')).toEqual({
      kind: 'year',
      from: '2026-04-01',
      to: '2027-03-31',
    });
    expect(periodOf('year', '2027-03-31')).toEqual({
      kind: 'year',
      from: '2026-04-01',
      to: '2027-03-31',
    });
    expect(periodOf('year', '2027-04-01')).toEqual({
      kind: 'year',
      from: '2027-04-01',
      to: '2028-03-31',
    });
  });
});

describe('shiftPeriod', () => {
  it('moves a day, a week, a month or a year at a time', () => {
    expect(shiftPeriod(periodOf('day', '2026-10-01'), -1)).toEqual(periodOf('day', '2026-09-30'));
    expect(shiftPeriod(periodOf('week', '2026-10-03'), 1)).toEqual(periodOf('week', '2026-10-05'));
    expect(shiftPeriod(periodOf('month', '2026-01-31'), -1)).toEqual(
      periodOf('month', '2025-12-01'),
    );
    expect(shiftPeriod(periodOf('month', '2026-03-31'), -1)).toEqual(
      periodOf('month', '2026-02-01'),
    );
    expect(shiftPeriod(periodOf('year', '2026-10-03'), -2)).toEqual(periodOf('year', '2024-10-03'));
  });

  it('leaves a custom period where it is', () => {
    const custom = customPeriod('2026-09-03', '2026-09-17');
    expect(shiftPeriod(custom, 1)).toEqual(custom);
  });
});

describe('periodLabel and periodRange', () => {
  it('names each kind the way people say it', () => {
    expect(periodLabel(periodOf('day', '2026-10-03'))).toBe('03 Oct 2026');
    expect(periodLabel(periodOf('week', '2026-10-03'))).toBe('28 Sep – 04 Oct 2026');
    expect(periodLabel(periodOf('week', '2025-12-31'))).toBe('29 Dec 2025 – 04 Jan 2026');
    expect(periodLabel(periodOf('month', '2026-09-03'))).toBe('September 2026');
    expect(periodLabel(periodOf('year', '2026-10-03'))).toBe('FY 2026–27');
    expect(periodLabel(customPeriod('2026-09-03', '2026-09-17'))).toBe('03 Sep – 17 Sep 2026');
    expect(periodLabel(customPeriod('2026-09-03', '2026-09-03'))).toBe('03 Sep 2026');
  });

  it('spells out the first and last day', () => {
    expect(periodRange(periodOf('month', '2026-10-03'))).toBe('01 Oct 2026 – 31 Oct 2026');
    expect(periodRange(periodOf('day', '2026-10-03'))).toBe('03 Oct 2026');
  });
});

describe('kindOf and periodFor', () => {
  it('recognises a day, a Monday-to-Sunday week, a month and a financial year', () => {
    expect(kindOf('2026-10-03', '2026-10-03')).toBe('day');
    expect(kindOf('2026-09-28', '2026-10-04')).toBe('week');
    expect(kindOf('2026-10-01', '2026-10-31')).toBe('month');
    expect(kindOf('2026-04-01', '2027-03-31')).toBe('year');
    expect(kindOf('2026-09-29', '2026-10-05')).toBe('custom'); // seven days, but Tuesday to Monday
    expect(kindOf('2026-01-01', '2026-12-31')).toBe('custom'); // a calendar year
  });

  it('turns two dates back into a period', () => {
    expect(periodFor('2026-10-01', '2026-10-31')).toEqual(periodOf('month', '2026-10-01'));
  });
});

describe('periodDays', () => {
  it('counts both ends', () => {
    expect(periodDays(periodOf('day', '2026-10-03'))).toBe(1);
    expect(periodDays(periodOf('week', '2026-10-03'))).toBe(7);
    expect(periodDays(periodOf('year', '2027-10-03'))).toBe(366);
  });
});

describe('checkCustomPeriod', () => {
  it('accepts two days in order, at most a year apart', () => {
    expect(checkCustomPeriod('2026-09-03', '2026-09-03')).toBe('');
    expect(checkCustomPeriod('2027-04-01', '2028-03-31')).toBe('');
  });

  it('says what is wrong otherwise', () => {
    expect(checkCustomPeriod('', '2026-09-03')).toBe('Choose the first and the last day.');
    expect(checkCustomPeriod('2026-09-04', '2026-09-03')).toBe(
      'The first day must be on or before the last day.',
    );
    expect(checkCustomPeriod('2026-01-01', '2027-01-02')).toBe('Pick a period of at most a year.');
  });
});

describe('todayIso', () => {
  it('is the date in India', () => {
    expect(todayIso(new Date('2026-10-02T19:00:00Z'))).toBe('2026-10-03'); // 00:30 on the 3rd in India
    expect(todayIso(new Date('2026-10-02T18:00:00Z'))).toBe('2026-10-02');
  });
});
