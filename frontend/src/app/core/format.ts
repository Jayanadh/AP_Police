const LOCALE = 'en-IN';
const TIME_ZONE = 'Asia/Kolkata';
const NO_VALUE = '—';

const LITRES_FORMAT = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });

const KM_FORMAT = new Intl.NumberFormat(LOCALE);

const DATE_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: TIME_ZONE,
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: TIME_ZONE,
});

const TIME_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: TIME_ZONE,
});

const MONTH_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const KOLKATA_YEAR_MONTH = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  timeZone: TIME_ZONE,
});

/** Formats litres, e.g. "12.50" -> "12.5 L". */
export function litres(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return NO_VALUE;
  }
  const amount = Number(value);
  return Number.isFinite(amount) ? `${LITRES_FORMAT.format(amount)} L` : NO_VALUE;
}

/** Formats a distance, e.g. 12480 -> "12,480 km". */
export function km(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return NO_VALUE;
  }
  return `${KM_FORMAT.format(value)} km`;
}

function parse(iso: string | null): Date | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parts(format: Intl.DateTimeFormat, date: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of format.formatToParts(date)) {
    out[part.type] = part.value;
  }
  // Some ICU versions spell September "Sept"; keep every month to three letters.
  if (out['month'] === 'Sept') {
    out['month'] = 'Sep';
  }
  return out;
}

/** "02 Oct 2026" in Asia/Kolkata. */
export function formatDate(iso: string | null): string {
  const date = parse(iso);
  if (date === null) {
    return NO_VALUE;
  }
  const p = parts(DATE_FORMAT, date);
  return `${p['day']} ${p['month']} ${p['year']}`;
}

/** "02 Oct 2026, 2:05 pm" in Asia/Kolkata. */
export function formatDateTime(iso: string | null): string {
  const date = parse(iso);
  if (date === null) {
    return NO_VALUE;
  }
  const p = parts(DATE_TIME_FORMAT, date);
  return `${p['day']} ${p['month']} ${p['year']}, ${p['hour']}:${p['minute']} ${p['dayPeriod'].toLowerCase()}`;
}

/** "2:05 pm" in Asia/Kolkata. */
export function formatTime(iso: string | null): string {
  const date = parse(iso);
  if (date === null) {
    return NO_VALUE;
  }
  const p = parts(TIME_FORMAT, date);
  return `${p['hour']}:${p['minute']} ${p['dayPeriod'].toLowerCase()}`;
}

/**
 * How long ago a moment was, for live locations: "just now", "12 mins ago", "2 h 1 min ago"; from a day back the
 * date and time. A moment a little ahead (a phone's clock running fast) counts as just now.
 */
export function timeAgo(iso: string | null, now: Date): string {
  const date = parse(iso);
  if (date === null) {
    return NO_VALUE;
  }
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  const mins = (count: number) => `${count} ${count === 1 ? 'min' : 'mins'}`;
  if (minutes < 60) {
    return `${mins(minutes)} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h ago` : `${hours} h ${mins(rest)} ago`;
  }
  return formatDateTime(iso);
}

function splitMonth(month: string): { year: number; index: number } {
  const [year, number] = month.split('-').map(Number);
  return { year, index: number - 1 };
}

function joinMonth(year: number, index: number): string {
  return `${year}-${String(index + 1).padStart(2, '0')}`;
}

/** "2026-10" -> "October 2026". */
export function monthLabel(month: string): string {
  const { year, index } = splitMonth(month);
  return MONTH_FORMAT.format(new Date(Date.UTC(year, index, 15)));
}

/** The current calendar month, "YYYY-MM", in Asia/Kolkata. */
export function currentMonth(now: Date = new Date()): string {
  const p = parts(KOLKATA_YEAR_MONTH, now);
  return `${p['year']}-${p['month']}`;
}

/** Moves a "YYYY-MM" month forwards (or backwards for a negative n). */
export function addMonths(month: string, n: number): string {
  const { year, index } = splitMonth(month);
  const total = year * 12 + index + n;
  return joinMonth(Math.floor(total / 12), ((total % 12) + 12) % 12);
}
