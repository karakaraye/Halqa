import { expect, Page, BrowserContext, Route } from '@playwright/test';
import { test } from './helpers';
import { randomUUID } from 'node:crypto';

/*
 * Browser store behaviour: sign-out clears the previous user's state, retries resend the
 * original request, plain error text, offline saving, the not-on-your-list screen and the
 * new-result banner. Runs after shared-workflow.spec.ts on the same database.
 */

type CaseLike = { id: string; patient: { name: string }; closure?: unknown; pendingTransfer?: unknown; pathwayId: string; team: { SPECIALIST?: { id: string } }; audit: { at: number }[]; delayReasons?: { note?: string }[] };

async function login(page: Page, id: string) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(`${id}@halqa.test`);
  await page.getByLabel('Password', { exact: true }).fill(process.env.HALQA_E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

async function state(context: BrowserContext) {
  const r = await context.request.get('/api/workspace');
  expect(r.ok()).toBeTruthy();
  return r.json();
}

async function command(context: BrowserContext, action: unknown) {
  const s = await state(context);
  const r = await context.request.post('/api/workspace', {
    headers: { origin: `http://localhost:${process.env.HALQA_E2E_PORT || '3001'}`, 'x-halqa-csrf': s.csrf },
    data: { requestId: randomUUID(), revision: s.revision, action },
  });
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}

const isRead = (r: { url(): string; request(): { method(): string } }) => r.url().endsWith('/api/workspace') && r.request().method() === 'GET';

/** Waits until the page has finished two more workspace polls. */
async function twoPolls(page: Page) {
  await page.waitForResponse(isRead, { timeout: 15000 });
  await page.waitForResponse(isRead, { timeout: 15000 });
}

const newResult = (page: Page) => page.getByText(/^New result for /);
// The store's error banner (Next.js also renders an empty route announcer with role=alert).
const errorBanner = (page: Page) => page.locator('div.sticky[role="alert"]');

async function openFirstCase(page: Page) {
  await page.getByRole('button', { name: /^Open /i }).first().click();
  await expect(page.getByText('Your next step', { exact: true })).toBeVisible();
}

async function startDelayReason(page: Page, note: string) {
  await page.getByRole('button', { name: 'Record a delay reason' }).click();
  await page.getByLabel('What is causing the delay?').selectOption('PATIENT_TRAVEL');
  await page.getByPlaceholder('Additional context about this delay').fill(note);
}

test('06. signing out clears the previous user\'s new-result banner and failed action', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'lead_fatima');
  await expect(page.getByRole('heading', { name: 'How we are doing' })).toBeVisible();

  // A new result arrives; the lead opens it and a save fails on the way.
  await command(context, { type: 'INGEST' });
  await expect(newResult(page)).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByText('Your next step', { exact: true })).toBeVisible();
  await page.route('**/api/workspace', (route: Route) => (route.request().method() === 'POST' ? route.abort('failed') : route.continue()));
  await startDelayReason(page, 'Patient is away until next week.');
  await page.getByRole('button', { name: 'Save reason' }).click();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.unroute('**/api/workspace');

  // Another result arrives, so the lead has a banner waiting too.
  await command(context, { type: 'INGEST' });
  await expect(newResult(page)).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(newResult(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);

  // The next person on this browser sees none of it, even after polling.
  await login(page, 'nav_reem');
  await expect(page.getByRole('heading', { name: /Good .*, Reem/ })).toBeVisible();
  await twoPolls(page);
  await expect(newResult(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(errorBanner(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('07. two new results are queued and announced one after the other', async ({ page, context }) => {
  await login(page, 'lead_fatima');
  await expect(page.getByRole('heading', { name: 'How we are doing' })).toBeVisible();
  const before = new Set((await state(context)).state.cases.map((c: CaseLike) => c.id));
  await command(context, { type: 'INGEST' });
  await command(context, { type: 'INGEST' });
  const fresh = ((await state(context)).state.cases as CaseLike[])
    .filter((c) => !before.has(c.id))
    .sort((a, b) => a.audit[0].at - b.audit[0].at);
  expect(fresh).toHaveLength(2);

  await expect(newResult(page)).toContainText(`New result for ${fresh[0].patient.name}. Open it?`, { timeout: 15000 });
  await expect(page.getByText('1 more new result after this one.')).toBeVisible();
  await page.getByRole('button', { name: 'Later', exact: true }).click();
  await expect(newResult(page)).toContainText(`New result for ${fresh[1].patient.name}. Open it?`);
  await expect(page.getByText(/more new result/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('heading', { name: fresh[1].patient.name, level: 1 })).toBeVisible();
  await expect(newResult(page)).toHaveCount(0);
});

test('08. a case that arrives through a hand-over does not show the new-result banner', async ({ page, context, browser }) => {
  await login(page, 'sp_khaled');
  await expect(page.getByRole('heading', { name: 'Referrals' })).toBeVisible();
  const visible = new Set((await state(context)).state.cases.map((c: CaseLike) => c.id));

  const leadCtx = await browser.newContext();
  const lead = await leadCtx.newPage();
  await login(lead, 'lead_fatima');
  const target = ((await state(leadCtx)).state.cases as CaseLike[])
    .find((c) => !c.closure && !c.pendingTransfer && !visible.has(c.id) && c.pathwayId !== 'DIABETES_HBA1C');
  expect(target, 'an open case the specialist cannot see yet').toBeTruthy();
  await command(leadCtx, { type: 'REQUEST_TRANSFER', id: target!.id, personId: 'sp_khaled', reason: 'Covering this clinic for the week.' });
  await leadCtx.close();

  await expect.poll(async () => (await state(context)).state.cases.some((c: CaseLike) => c.id === target!.id)).toBe(true);
  await twoPolls(page);
  await expect(newResult(page)).toHaveCount(0);
});

test('09. a lost reply is retried with the same request id and original revision, with plain error text', async ({ page, context }) => {
  await login(page, 'nav_reem');
  await openFirstCase(page);
  const note = `Travelling, back in ten days (${Date.now()}).`;

  const bodies: { requestId: string; revision: number }[] = [];
  await page.route('**/api/workspace', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      // The server saves the change, but the reply never reaches the browser.
      await route.fetch();
      return route.abort('failed');
    }
    return route.continue();
  });

  await startDelayReason(page, note);
  await page.getByRole('button', { name: 'Save reason' }).click();
  const alert = errorBanner(page);
  await expect(alert).toContainText('We could not reach the server. Check your connection and try again.');
  await expect(alert).not.toContainText(/Failed to fetch|JSON|TypeError/);

  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(errorBanner(page)).toHaveCount(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[1].requestId).toBe(bodies[0].requestId);
  expect(bodies[1].revision).toBe(bodies[0].revision);

  // Saved exactly once.
  const caseId = ((await state(context)).state.cases as CaseLike[]).find((c) => c.delayReasons?.some((r) => r.note === note))!.id;
  const saved = ((await state(context)).state.cases as CaseLike[]).find((c) => c.id === caseId)!;
  expect(saved.delayReasons!.filter((r) => r.note === note)).toHaveLength(1);
  await expect(page.getByRole('complementary').getByText(note)).toHaveCount(1);
  await page.unroute('**/api/workspace');
});

test('10. offline: the banner shows and saving is turned off with the reason', async ({ page, context, browser }) => {
  await login(page, 'nav_reem');
  await openFirstCase(page);
  await startDelayReason(page, 'Waiting for the patient to return.');
  const save = page.getByRole('button', { name: 'Save reason' });
  await expect(save).toBeEnabled();

  await context.setOffline(true);
  await expect(page.getByText('You are offline. Halqa will reconnect automatically when your connection returns.')).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(save).toHaveAccessibleDescription('You are offline');
  await expect(save).toHaveAttribute('title', 'You are offline');

  await context.setOffline(false);
  await expect(page.getByText(/^You are offline\./)).toHaveCount(0);
  await expect(save).toBeEnabled();

  // Patients read the same banner in their language.
  const patientCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await patientCtx.newPage();
  await p.goto('/');
  await p.getByLabel('Email', { exact: true }).fill('patient_hq-1003@halqa.test');
  await p.getByLabel('Password', { exact: true }).fill(process.env.HALQA_E2E_PASSWORD!);
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.locator('header select').selectOption('ar');
  await patientCtx.setOffline(true);
  await expect(p.getByText('أنت غير متصل بالإنترنت. سيعيد حلقة الاتصال تلقائيًا عند عودة الاتصال.')).toBeVisible();
  await patientCtx.setOffline(false);
  await patientCtx.close();
});

test('11. a 404 from the server shows the not-on-your-list screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'nav_reem');
  await openFirstCase(page);
  await page.route('**/api/workspace', (route: Route) => (route.request().method() === 'POST'
    ? route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Case not found.' }) })
    : route.continue()));
  await startDelayReason(page, 'Patient asked to wait.');
  await page.getByRole('button', { name: 'Save reason' }).click();

  await expect(page.getByText('This patient is not on your list')).toBeVisible();
  await expect(page.getByText('They may have been handed over to someone else.')).toBeVisible();
  await expect(errorBanner(page)).toHaveCount(0);
  await page.unroute('**/api/workspace');
  await page.getByRole('button', { name: 'Back to My work' }).click();
  await expect(page.getByRole('heading', { name: /Good .*, Reem/ })).toBeVisible();
  expect(errors).toEqual([]);
});
