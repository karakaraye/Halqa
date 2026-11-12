import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDate, fmtDateTime, fmtDay, friendlyDuration, fromInputValue, hourOfDay, timeZone, toInputValue } from '../src/lib/time';

const MINUTE = 60_000; const HOUR = 60 * MINUTE; const DAY = 24 * HOUR;
afterEach(() => { delete process.env.NEXT_PUBLIC_HALQA_TIME_ZONE; });

test('time zone: a valid name is used, an unknown or empty one falls back to the browser zone', () => {
  process.env.NEXT_PUBLIC_HALQA_TIME_ZONE = 'Asia/Kolkata';
  assert.equal(timeZone(), 'Asia/Kolkata');
  process.env.NEXT_PUBLIC_HALQA_TIME_ZONE = ' Europe/London ';
  assert.equal(timeZone(), 'Europe/London');
  process.env.NEXT_PUBLIC_HALQA_TIME_ZONE = 'Not/AZone';
  assert.equal(timeZone(), undefined);
  process.env.NEXT_PUBLIC_HALQA_TIME_ZONE = '';
  assert.equal(timeZone(), undefined);
  delete process.env.NEXT_PUBLIC_HALQA_TIME_ZONE;
  assert.equal(timeZone(), undefined);
});

test('friendlyDuration reads as plain words', () => {
  assert.equal(friendlyDuration(0), '1 minute');
  assert.equal(friendlyDuration(40 * MINUTE), '40 minutes');
  assert.equal(friendlyDuration(-40 * MINUTE), '40 minutes', 'the sign is ignored');
  assert.equal(friendlyDuration(HOUR), '1 hour');
  assert.equal(friendlyDuration(3 * HOUR), '3 hours');
  assert.equal(friendlyDuration(23.6 * HOUR), '1 day');
  assert.equal(friendlyDuration(DAY + 6 * HOUR), '1 day 6 hours');
  assert.equal(friendlyDuration(2 * DAY), '2 days');
  assert.equal(friendlyDuration(DAY + 23.7 * HOUR), '2 days');
  assert.equal(friendlyDuration(8 * DAY + 5 * HOUR), '8 days', 'hours are dropped from a week on');
});

test('dates are shown in the configured zone', () => {
  process.env.NEXT_PUBLIC_HALQA_TIME_ZONE = 'Asia/Dubai';
  const t = Date.UTC(2026, 10, 12, 22, 30); // 02:30 on 13 Nov in Dubai (UTC+4)
  assert.equal(fmtDateTime(t), '13 Nov, 02:30');
  assert.equal(fmtDate(t), '13 Nov 2026');
  assert.equal(fmtDay(t), '13 Nov');
  assert.equal(hourOfDay(t), 2);
  process.env.NEXT_PUBLIC_HALQA_TIME_ZONE = 'UTC';
  assert.equal(fmtDateTime(t), '12 Nov, 22:30');
  assert.equal(hourOfDay(Date.UTC(2026, 10, 12, 0, 15)), 0, 'midnight is hour 0, not 24');
});

test('date-and-time input values round-trip in the configured zone', () => {
  process.env.NEXT_PUBLIC_HALQA_TIME_ZONE = 'Asia/Dubai';
  const t = Date.UTC(2026, 10, 12, 6, 30);
  assert.equal(toInputValue(t), '2026-11-12T10:30');
  assert.equal(fromInputValue('2026-11-12T10:30'), t);
  process.env.NEXT_PUBLIC_HALQA_TIME_ZONE = 'Europe/London';
  // Summer time: 10:30 in London on 1 July is 09:30 UTC.
  assert.equal(fromInputValue('2026-07-01T10:30'), Date.UTC(2026, 6, 1, 9, 30));
  assert.equal(toInputValue(Date.UTC(2026, 6, 1, 9, 30)), '2026-07-01T10:30');
  assert.ok(Number.isNaN(fromInputValue('')));
  assert.ok(Number.isNaN(fromInputValue('12/11/2026 10:30')));
});
