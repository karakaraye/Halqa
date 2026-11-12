/**
 * Dates and times as people read them. One time zone is used everywhere on screen: the one named
 * by NEXT_PUBLIC_HALQA_TIME_ZONE when it is set and valid, otherwise the browser's own time zone.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function valid(zone: string | undefined): zone is string {
  if (!zone) return false;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: zone }); return true; } catch { return false; }
}

/** The time zone used to show dates and times. */
export function timeZone(): string | undefined {
  const named = process.env.NEXT_PUBLIC_HALQA_TIME_ZONE?.trim();
  return valid(named) ? named : undefined; // undefined = the browser's own time zone
}

/** A date and time formatter in the shared time zone; falls back to English when the locale is unknown. */
export function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const timeZoneName = timeZone();
  const withZone = timeZoneName ? { timeZone: timeZoneName, ...options } : options;
  try { return new Intl.DateTimeFormat(locale, withZone); }
  catch { return new Intl.DateTimeFormat('en-GB', withZone); }
}

/** "12 Nov, 10:30" */
export const fmtDateTime = (t: number) => formatter('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t));
/** "12 Nov 2026" */
export const fmtDate = (t: number) => formatter('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(t));
/** "12 Nov" */
export const fmtDay = (t: number) => formatter('en-GB', { day: 'numeric', month: 'short' }).format(new Date(t));

/** The hour of the day (0 to 23) in the shared time zone. */
export const hourOfDay = (t: number) => Number(formatter('en-GB', { hour: 'numeric', hour12: false }).format(new Date(t))) % 24;

/** A length of time in plain words: "40 minutes", "3 hours", "1 day 6 hours". */
export function friendlyDuration(ms: number): string {
  const abs = Math.abs(ms);
  const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (abs < HOUR) return count(Math.max(1, Math.round(abs / MINUTE)), 'minute');
  if (abs < DAY) {
    const hours = Math.round(abs / HOUR);
    return hours === 24 ? count(1, 'day') : count(hours, 'hour');
  }
  let days = Math.floor(abs / DAY);
  let hours = Math.round((abs - days * DAY) / HOUR);
  if (hours === 24) { days += 1; hours = 0; }
  if (days >= 7 || hours === 0) return count(days, 'day');
  return `${count(days, 'day')} ${count(hours, 'hour')}`;
}

/** The wall-clock reading in the shared time zone, as the parts of a date. */
function wallParts(t: number) {
  const parts = formatter('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

/** A moment as the text a date-and-time input expects ("2026-11-12T10:30"), read in the shared time zone. */
export function toInputValue(t: number): string {
  const { y, mo, d, h, mi } = wallParts(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
}

/** The moment (epoch ms) that a date-and-time input value means in the shared time zone; NaN when empty or invalid. */
export function fromInputValue(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return NaN;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let guess = wall;
  for (let i = 0; i < 3; i += 1) {
    const p = wallParts(guess);
    guess = wall - (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - guess);
  }
  return guess;
}
