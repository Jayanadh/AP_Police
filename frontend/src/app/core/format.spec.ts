import {
  addMonths,
  currentMonth,
  formatDate,
  formatDateTime,
  formatTime,
  isToday,
  km,
  litres,
  monthLabel,
} from './format';

describe('litres', () => {
  it('drops trailing zeros', () => {
    expect(litres('12.50')).toBe('12.5 L');
    expect(litres('100.00')).toBe('100 L');
    expect(litres(7)).toBe('7 L');
  });

  it('keeps two decimals and groups thousands the Indian way', () => {
    expect(litres('0.25')).toBe('0.25 L');
    expect(litres('123456.5')).toBe('1,23,456.5 L');
  });

  it('shows a dash when there is no value', () => {
    expect(litres(null)).toBe('—');
    expect(litres(undefined)).toBe('—');
    expect(litres('abc')).toBe('—');
  });
});

describe('km', () => {
  it('groups thousands the Indian way', () => {
    expect(km(180)).toBe('180 km');
    expect(km(12480)).toBe('12,480 km');
    expect(km(1234567)).toBe('12,34,567 km');
  });

  it('keeps a zero reading', () => {
    expect(km(0)).toBe('0 km');
  });

  it('shows a dash when there is no value', () => {
    expect(km(null)).toBe('—');
    expect(km(undefined)).toBe('—');
    expect(km(Number.NaN)).toBe('—');
  });
});

describe('formatDate', () => {
  it('formats in Asia/Kolkata', () => {
    expect(formatDate('2026-10-02T08:35:00Z')).toBe('02 Oct 2026');
  });

  it('uses the Kolkata calendar day, not UTC', () => {
    expect(formatDate('2026-10-01T20:00:00Z')).toBe('02 Oct 2026');
  });

  it('abbreviates every month to three letters', () => {
    expect(formatDate('2026-09-02T08:35:00Z')).toBe('02 Sep 2026');
  });

  it('shows a dash for null or invalid input', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not a date')).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('formats date and 12-hour time in Asia/Kolkata', () => {
    expect(formatDateTime('2026-10-02T08:35:00Z')).toBe('02 Oct 2026, 2:05 pm');
    expect(formatDateTime('2026-10-02T18:30:00Z')).toBe('03 Oct 2026, 12:00 am');
  });

  it('shows a dash for null', () => {
    expect(formatDateTime(null)).toBe('—');
  });
});

describe('formatTime', () => {
  it('formats the 12-hour time in Asia/Kolkata', () => {
    expect(formatTime('2026-10-02T08:35:00Z')).toBe('2:05 pm');
    expect(formatTime('2026-10-02T18:30:00Z')).toBe('12:00 am');
  });

  it('shows a dash for null or invalid input', () => {
    expect(formatTime(null)).toBe('—');
    expect(formatTime('not a date')).toBe('—');
  });
});

describe('months', () => {
  it('labels a month', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(monthLabel('2026-01')).toBe('January 2026');
  });

  it('steps back across a year boundary', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-10', -1)).toBe('2026-09');
  });

  it('adds and subtracts months', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-02', -14)).toBe('2024-12');
    expect(addMonths('2026-05', 0)).toBe('2026-05');
  });

  it('reads the current month in Asia/Kolkata', () => {
    expect(currentMonth(new Date('2026-10-31T19:00:00Z'))).toBe('2026-11');
    expect(currentMonth(new Date('2026-10-31T17:00:00Z'))).toBe('2026-10');
    expect(currentMonth()).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });
});

describe('isToday', () => {
  const now = new Date('2026-10-02T08:35:00Z');

  it('is true for a moment on the same Kolkata day', () => {
    expect(isToday('2026-10-01T18:31:00Z', now)).toBe(true);
    expect(isToday('2026-10-02T18:29:00Z', now)).toBe(true);
  });

  it('uses the Kolkata calendar day, not UTC', () => {
    expect(isToday('2026-10-01T18:29:00Z', now)).toBe(false);
    expect(isToday('2026-10-02T18:31:00Z', now)).toBe(false);
  });

  it('is false for another day, for null and for invalid input', () => {
    expect(isToday('2026-09-02T08:35:00Z', now)).toBe(false);
    expect(isToday(null, now)).toBe(false);
    expect(isToday('not a date', now)).toBe(false);
  });

  it('compares with the present when no moment is given', () => {
    expect(isToday(new Date().toISOString())).toBe(true);
  });
});
