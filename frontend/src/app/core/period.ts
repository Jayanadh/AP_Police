import { monthLabel } from './format';

/**
 * Statements are drawn up for whole days, both ends included: a day, a week (Monday to Sunday), a month, a year
 * (the financial year, April to March) or any custom range of at most a year. Days are "YYYY-MM-DD" in India.
 */
export type PeriodKind = 'day' | 'week' | 'month' | 'year' | 'custom';

export type Period = {
  kind: PeriodKind;
  /** The first day, "YYYY-MM-DD". */
  from: string;
  /** The last day, "YYYY-MM-DD". */
  to: string;
};

export const PERIOD_KINDS: readonly { kind: PeriodKind; label: string }[] = [
  { kind: 'day', label: 'Day' },
  { kind: 'week', label: 'Week' },
  { kind: 'month', label: 'Month' },
  { kind: 'year', label: 'Year' },
  { kind: 'custom', label: 'Custom' },
];

/** The longest period a statement covers: a financial year with 29 February in it. */
const MAX_PERIOD_DAYS = 366;

const DAY_MS = 86_400_000;

const KOLKATA_DAY = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Kolkata',
});

const DAY_PARTS = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Today's date in India, "YYYY-MM-DD". */
export function todayIso(now: Date = new Date()): string {
  return KOLKATA_DAY.format(now);
}

// Days are handled as UTC midnights, so no time zone or clock change can move them.
function toDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  return toIso(new Date(toDate(day).getTime() + days * DAY_MS));
}

function dayParts(day: string): { day: string; month: string; year: string } {
  const out: Record<string, string> = {};
  for (const part of DAY_PARTS.formatToParts(toDate(day))) {
    out[part.type] = part.value;
  }
  // Some ICU versions spell September "Sept"; keep every month to three letters.
  return {
    day: out['day'],
    month: out['month'] === 'Sept' ? 'Sep' : out['month'],
    year: out['year'],
  };
}

/** "03 Oct 2026". */
function longDay(day: string): string {
  const p = dayParts(day);
  return `${p.day} ${p.month} ${p.year}`;
}

/** The day, week, month or financial year that `day` falls in. */
export function periodOf(kind: Exclude<PeriodKind, 'custom'>, day: string): Period {
  const date = toDate(day);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  switch (kind) {
    case 'day':
      return { kind, from: day, to: day };
    case 'week': {
      const sinceMonday = (date.getUTCDay() + 6) % 7;
      const monday = addDays(day, -sinceMonday);
      return { kind, from: monday, to: addDays(monday, 6) };
    }
    case 'month':
      return {
        kind,
        from: toIso(new Date(Date.UTC(year, month, 1))),
        to: toIso(new Date(Date.UTC(year, month + 1, 0))),
      };
    case 'year': {
      const first = month >= 3 ? year : year - 1; // April is month 3
      return { kind, from: `${first}-04-01`, to: `${first + 1}-03-31` };
    }
  }
}

export function customPeriod(from: string, to: string): Period {
  return { kind: 'custom', from, to };
}

/** The period `steps` days, weeks, months or years later (earlier for a negative number). Custom ones stay put. */
export function shiftPeriod(period: Period, steps: number): Period {
  const start = toDate(period.from);
  switch (period.kind) {
    case 'day':
      return periodOf('day', addDays(period.from, steps));
    case 'week':
      return periodOf('week', addDays(period.from, steps * 7));
    case 'month':
      return periodOf(
        'month',
        toIso(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + steps, 1))),
      );
    case 'year':
      return periodOf('year', `${start.getUTCFullYear() + steps}-04-01`);
    case 'custom':
      return period;
  }
}

/** How the period is said: "03 Oct 2026", "28 Sep – 04 Oct 2026", "September 2026" or "FY 2026–27". */
export function periodLabel(period: Period): string {
  if (period.kind === 'month') {
    return monthLabel(period.from.slice(0, 7));
  }
  if (period.kind === 'year') {
    const first = Number(period.from.slice(0, 4));
    return `FY ${first}–${String((first + 1) % 100).padStart(2, '0')}`;
  }
  if (period.from === period.to) {
    return longDay(period.from);
  }
  const from = dayParts(period.from);
  const to = dayParts(period.to);
  const start = from.year === to.year ? `${from.day} ${from.month}` : longDay(period.from);
  return `${start} – ${longDay(period.to)}`;
}

/** The first and last day written out: "01 Oct 2026 – 31 Oct 2026", or the one day. */
export function periodRange(period: Period): string {
  return period.from === period.to
    ? longDay(period.from)
    : `${longDay(period.from)} – ${longDay(period.to)}`;
}

export function periodDays(period: Period): number {
  return Math.round((toDate(period.to).getTime() - toDate(period.from).getTime()) / DAY_MS) + 1;
}

/** Which kind two dates make: a day, a Monday-to-Sunday week, a month, a financial year, or custom. */
export function kindOf(from: string, to: string): PeriodKind {
  const kinds: Exclude<PeriodKind, 'custom'>[] = ['day', 'week', 'month', 'year'];
  for (const kind of kinds) {
    const candidate = periodOf(kind, from);
    if (candidate.from === from && candidate.to === to) {
      return kind;
    }
  }
  return 'custom';
}

/** Two dates as a period of the kind they make. */
export function periodFor(from: string, to: string): Period {
  return { kind: kindOf(from, to), from, to };
}

/** What is wrong with a custom range, or an empty string when it is fine. */
export function checkCustomPeriod(from: string, to: string): string {
  if (!from || !to) {
    return 'Choose the first and the last day.';
  }
  if (from > to) {
    return 'The first day must be on or before the last day.';
  }
  if (periodDays(customPeriod(from, to)) > MAX_PERIOD_DAYS) {
    return 'Pick a period of at most a year.';
  }
  return '';
}
