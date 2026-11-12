import { test as base, expect, Page, BrowserContext, APIRequestContext, Browser } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Shared helpers for the browser tests. Fixtures here are made-up people; none of this is product code. */

export const ORIGIN = `http://localhost:${process.env.HALQA_E2E_PORT || '3001'}`;
export const NETWORK = 'halqa-network';

/**
 * The server counts password changes and sign-ins per client address (the first address in X-Forwarded-For).
 * Every test is a different client, as in real use, so one test's password changes do not use up another's allowance.
 */
export const test = base.extend({
  extraHTTPHeaders: async ({}, provide, testInfo) => {
    const h = createHash('sha256').update(`${testInfo.testId}:${testInfo.retry}:${process.env.HALQA_E2E_PASSWORD}`).digest();
    await provide({ 'x-forwarded-for': `10.${h[0]}.${h[1]}.${h[2]}` });
  },
});
export { expect };

/* ------------------------------------------------------------------ accessibility */

export const STAFF_WIDTHS = [1440, 390] as const;
export const PATIENT_WIDTHS = [390, 320] as const;
const HEIGHT: Record<number, number> = { 1440: 900, 768: 1024, 390: 844, 320: 568 };
export const heightFor = (width: number) => HEIGHT[width] ?? 900;

/**
 * Runs axe with the WCAG 2.0 A and AA and 2.1 AA rules, colour contrast included.
 * Critical and serious findings fail the test, and so does any moderate colour-contrast finding.
 */
export async function checkAxe(page: Page, contextName: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const violations = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious' || (v.impact === 'moderate' && v.id === 'color-contrast'),
  );
  const summary = violations.map((v) => ({ rule: v.id, impact: v.impact, nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })) }));
  expect(summary, `${contextName} has accessibility violations: ${JSON.stringify(summary, null, 2)}`).toEqual([]);
}

/** Runs axe at each width in turn (the page is resized, then put back to the first width). */
export async function checkAxeAt(page: Page, contextName: string, widths: readonly number[]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: heightFor(width) });
    await checkAxe(page, `${contextName} at ${width}px`);
  }
  await page.setViewportSize({ width: widths[0], height: heightFor(widths[0]) });
}

/* ------------------------------------------------------------------ screenshots */

/**
 * The folder screenshots go to. Tracked evidence under docs/design/compare is only written when
 * SAVE_SCREENSHOTS=1; every other run writes to test-results/ so the working tree stays clean.
 */
export const SHOT_DIR = process.env.SAVE_SCREENSHOTS === '1' ? 'docs/design/compare' : 'test-results/screens';

/** Sets the viewport explicitly, then saves a full-page screenshot as `<SHOT_DIR>/<name>.png`. */
export async function shot(page: Page, name: string, width: number, height = heightFor(width)) {
  await page.setViewportSize({ width, height });
  const settle = () => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await settle();
  // Make the window as tall as the page, so a bar fixed to the bottom (the patient tabs) sits at the bottom of the picture instead of over the content.
  for (let i = 0; i < 3; i += 1) {
    const full = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    if (full <= height) break;
    height = full;
    await page.setViewportSize({ width, height });
    await settle();
  }
  const path = `${SHOT_DIR}/${name}.png`;
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
}

/** A pop-up picture: the viewport is made tall enough for the whole pop-up and only the visible window is saved. */
export async function shotDialog(page: Page, name: string, width: number) {
  const height = width >= 1000 ? 1500 : 1900;
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const path = `${SHOT_DIR}/${name}.png`;
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

/* ------------------------------------------------------------------ sign-in and the shared record */

export const emailOf = (id: string) => (id.includes('@') ? id : `${id}@halqa.test`);

/** Fills and submits the sign-in form. Does not wait for the next screen. */
export async function login(page: Page, idOrEmail: string, password = process.env.HALQA_E2E_PASSWORD!) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(emailOf(idOrEmail));
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** Signs in and waits until the signed-in screen is showing. */
export async function loginAs(page: Page, idOrEmail: string, password = process.env.HALQA_E2E_PASSWORD!) {
  await login(page, idOrEmail, password);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
}

/** A new browser context signed in as one person, with its own page. */
export async function session(browser: Browser, idOrEmail: string, size = { width: 1440, height: 900 }, password?: string) {
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  await loginAs(page, idOrEmail, password);
  return { context, page };
}

export async function state(context: BrowserContext) {
  const r = await context.request.get('/api/workspace');
  expect(r.ok()).toBeTruthy();
  return r.json();
}

export async function command(context: BrowserContext, action: unknown) {
  const s = await state(context);
  const r = await context.request.post('/api/workspace', {
    headers: { origin: ORIGIN, 'x-halqa-csrf': s.csrf },
    data: { requestId: randomUUID(), revision: s.revision, action },
  });
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}

export type CaseView = {
  id: string; patient: { name: string }; closure?: { status: string; kind: string; signedById?: string }; pathwayId: string;
  team: { NAVIGATOR?: { id: string; name: string }; PCP?: { id: string }; SPECIALIST?: { id: string } };
  notifications: { id?: string; status: string; channel: string }[];
  escalations: { ruleId: string; resolvedAt?: number }[];
  referral?: { status: string; facility: string; rejectReason?: string };
  steps: Record<string, { completedAt?: number } | undefined>;
  accountable?: { id: string }; callbackRequestedAt?: number; callbackDoneAt?: number; pendingTransfer?: { to: { id: string } };
  feedback?: { understoodQ1: boolean; understoodQ2: boolean; confidence: number };
};

export async function caseById(context: BrowserContext, id: string): Promise<CaseView> {
  const s = await state(context);
  const found = (s.state.cases as CaseView[]).find((c) => c.id === id);
  expect(found, `case ${id} is visible to this person`).toBeTruthy();
  return found!;
}

/** The server's clock in milliseconds. It runs ahead of real time after test clock moves. */
export async function serverNow(context: BrowserContext): Promise<number> {
  return (await state(context)).state.now as number;
}

/** Moves the server clock forward by whole hours (test controls only). */
export async function advanceClock(context: BrowserContext, hours: number) {
  await command(context, { type: 'TICK', hours });
}

/* ------------------------------------------------------------------ server-to-server routes */

export interface FixtureResult {
  name: string; externalId?: string; pcpId?: string; pathwayId?: 'CRC_FIT' | 'BREAST_BIRADS' | 'CERVICAL_HPV' | 'DIABETES_HBA1C';
  lang?: 'en' | 'ar' | 'hi' | 'ur'; urgency?: 'CRITICAL' | 'ELEVATED' | 'ROUTINE'; sex?: 'F' | 'M';
}

/** Sends one lab result to the intake route with the bearer key. Returns the response so tests can check codes. */
export async function postResult(request: APIRequestContext, r: FixtureResult, key = process.env.HALQA_E2E_INTAKE_KEY!) {
  const externalId = r.externalId ?? `LAB-${randomUUID()}`;
  const phone = `+9715${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  return request.post('/api/intake/results', {
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    data: {
      externalId, network: NETWORK,
      patient: { id: `P-${randomUUID().slice(0, 8)}`, name: r.name, age: 52, sex: r.sex ?? 'F', phone, lang: r.lang ?? 'en', preferredChannel: 'SMS' },
      pathwayId: r.pathwayId ?? 'CRC_FIT', finding: 'Positive faecal immunochemical test', resultCode: 'FIT+',
      urgency: r.urgency ?? 'ELEVATED', sourceLab: 'Browser test laboratory', issuedAt: Date.now() - 60_000,
      ...(r.pcpId ? { pcpId: r.pcpId } : {}),
    },
  });
}

/** Opens a case through the intake route and returns its id. */
export async function intakeCase(request: APIRequestContext, r: FixtureResult): Promise<string> {
  const res = await postResult(request, r);
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  expect(body.created).toBe(true);
  return body.caseId as string;
}

export async function reportDelivery(request: APIRequestContext, outboxId: string, status: 'DELIVERED' | 'FAILED', key = process.env.HALQA_E2E_DELIVERY_KEY!) {
  return request.post('/api/intake/delivery', {
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    data: { outboxId, status },
  });
}

/* ------------------------------------------------------------------ accounts */

/** Creates a patient account for a case as the signed-in lead; returns the email and temporary password. */
export async function createPatientAccount(leadContext: BrowserContext, caseId: string, name: string) {
  const s = await state(leadContext);
  const email = `patient_${caseId.toLowerCase()}_${randomUUID().slice(0, 6)}@halqa.test`;
  const r = await leadContext.request.post('/api/admin/users', {
    headers: { origin: ORIGIN, 'x-halqa-csrf': s.csrf },
    data: { email, name, role: 'PATIENT', org: 'Patient portal', patientCase: caseId },
  });
  expect(r.status(), await r.text()).toBe(201);
  return { email, temporaryPassword: (await r.json()).temporaryPassword as string };
}

/** Signs a patient in through the screens, including the first-sign-in password change. Returns the password in use. */
export async function patientSignIn(page: Page, email: string, temporaryPassword: string) {
  await login(page, email, temporaryPassword);
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  const next = `Patient-${randomUUID()}`;
  await page.getByLabel('Current password').fill(temporaryPassword);
  await page.getByLabel('New password (at least 12 characters)').fill(next);
  await page.getByLabel('Confirm new password').fill(next);
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByRole('navigation', { name: 'Patient' })).toBeVisible();
  return next;
}

/** A date and time input value ("2026-11-12T10:30") a number of minutes after the server clock, in the browser's time zone. */
export async function inputValueAfter(page: Page, serverNowMs: number, minutes: number) {
  return page.evaluate(([base, mins]) => {
    const d = new Date(base + mins * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, [serverNowMs, minutes] as const);
}

export const errorBanner = (page: Page) => page.locator('div.sticky[role="alert"]');

/* ------------------------------------------------------------------ quick set-up through the server (not the screens) */

/** A browser context signed in through the sign-in route, with no page open. Used to put a case into a state fast. */
export async function apiLogin(browser: Browser, idOrEmail: string, password = process.env.HALQA_E2E_PASSWORD!) {
  const context = await browser.newContext();
  const r = await context.request.post('/api/session', { headers: { origin: ORIGIN }, data: { email: emailOf(idOrEmail), password } });
  expect(r.status(), await r.text()).toBe(200);
  return context;
}

/** The navigator the intake route chose for a case. */
export async function navigatorOf(browser: Browser, caseId: string) {
  const lead = await apiLogin(browser, 'lead_fatima');
  const id = (await caseById(lead, caseId)).team.NAVIGATOR!.id;
  await lead.close();
  return id;
}

/** Records a phone call that reached the patient, so the patient is told and the result is released. */
export async function releaseByPhone(browser: Browser, caseId: string) {
  const nav = await apiLogin(browser, await navigatorOf(browser, caseId));
  await command(nav, { type: 'NOTIFY', id: caseId, channel: 'PHONE', phoneOutcome: 'REACHED' });
  await nav.close();
}

/** Takes a released case to a referral that is waiting for the specialist: staff check, consultation, referral. */
export async function sendToSpecialist(browser: Browser, caseId: string, opts: { facility?: string; staffAck?: boolean } = {}) {
  if (opts.staffAck !== false) {
    const nav = await apiLogin(browser, await navigatorOf(browser, caseId));
    await command(nav, { type: 'STAFF_ACK', id: caseId, note: 'Patient repeated the explanation by phone.' });
    await nav.close();
  }
  const doc = await apiLogin(browser, 'pcp_mariam');
  await command(doc, { type: 'COMPLETE_STEP', id: caseId, step: 'CONSULT', note: 'Talked it through and agreed a specialist visit.' });
  const c = await caseById(doc, caseId);
  await command(doc, { type: 'SEND_REFERRAL', id: caseId, facility: opts.facility ?? 'City Hospital — Gastroenterology', priority: 'SOON', note: `Referral for ${c.patient.name}: a positive test needs a closer look.` });
  await doc.close();
}

/** Creates a staff account as the signed-in lead; returns the email and the temporary password. */
export async function createStaffAccount(leadContext: BrowserContext, a: { name: string; role: 'NAVIGATOR' | 'PCP' | 'SPECIALIST' | 'LEAD'; org: string; licence?: string }) {
  const s = await state(leadContext);
  const email = `staff_${randomUUID().slice(0, 8)}@halqa.test`;
  const r = await leadContext.request.post('/api/admin/users', {
    headers: { origin: ORIGIN, 'x-halqa-csrf': s.csrf },
    data: { email, ...a },
  });
  expect(r.status(), await r.text()).toBe(201);
  rememberAccount(email);
  return { email, temporaryPassword: (await r.json()).temporaryPassword as string };
}

/** Accepts the referral as the named specialist and books the appointment as the case's navigator, `minutes` ahead. */
export async function acceptAndBook(browser: Browser, caseId: string, minutes = 30, specialist = 'sp_tariq') {
  const sp = await apiLogin(browser, specialist);
  await command(sp, { type: 'REFERRAL_RESPOND', id: caseId, decision: 'ACCEPT' });
  const facility = (await caseById(sp, caseId)).referral!.facility;
  await sp.close();
  const nav = await apiLogin(browser, await navigatorOf(browser, caseId));
  const now = await serverNow(nav);
  await command(nav, { type: 'BOOK', id: caseId, at: now + minutes * 60_000, location: facility });
  await nav.close();
}

/** Staff accounts made by a test. Intake gives new cases to the navigator with the fewest cases, so a leftover account would take cases that no test can sign in as. */
const madeAccounts: string[] = [];
export const rememberAccount = (email: string) => { madeAccounts.push(email); };

/** Disables the accounts this test made. Call from afterEach. */
export async function disableMadeAccounts(browser: Browser) {
  if (!madeAccounts.length) return;
  const lead = await apiLogin(browser, 'lead_fatima');
  const s = await state(lead);
  const listed = await lead.request.get('/api/admin/users');
  const accounts = (await listed.json()).accounts as { id: string; email: string; disabled: boolean }[];
  for (const email of madeAccounts.splice(0)) {
    const account = accounts.find((a) => a.email === email);
    if (account && !account.disabled) await lead.request.post(`/api/admin/users/${account.id}/disable`, { headers: { origin: ORIGIN, 'x-halqa-csrf': s.csrf }, data: {} });
  }
  await lead.close();
}
