import { expect, Page } from '@playwright/test';
import { test } from './helpers';
import {
  SERVICE_PREFIX, STAFF_WIDTHS, apiLogin, checkAxeAt, command, disableTestServices, intakeCase, loginAs, navigatorOf, releaseByPhone, session,
} from './helpers';
import { goToTab, openCase } from './flows';

/*
 * The clinic lead's Receiving services section (a part of the Accounts screen). Every test adds its own services with a
 * name only that test uses, and the services are disabled afterwards so later tests are not offered them.
 */

test.afterEach(async ({ browser }) => { await disableTestServices(browser); });

const unique = (label: string) => `${SERVICE_PREFIX} ${label} ${Date.now() % 1000000}`;

async function openServices(page: Page) {
  await goToTab(page, 'Accounts');
  await page.getByRole('tab', { name: 'Receiving services' }).click();
  await expect(page.getByRole('heading', { name: 'Receiving services', level: 1 })).toBeVisible();
}

/** Opens the add dialog and fills it in. The specialist is chosen by account id. */
async function fillAdd(page: Page, facility: string, programme = 'Bowel screening', specialistId = 'sp_tariq') {
  await page.getByRole('button', { name: 'Add a receiving service' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a receiving service' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name of the unit').fill(facility);
  await dialog.getByLabel('Specialty').fill('Gastroenterology');
  await dialog.getByLabel('Care programme').selectOption({ label: programme });
  await dialog.getByLabel('Specialist who answers').selectOption(specialistId);
  return dialog;
}

/** The empty list, whatever the shared database holds. */
async function stubEmptyList(page: Page) {
  await page.route('**/api/admin/services', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ services: [] }) });
  });
}

test('R1. a lead adds a receiving service, doctors are offered it, and after it is disabled they are not', async ({ browser, request }) => {
  const facility = unique('Endoscopy');
  const patient = `Rana Fixture ${Date.now() % 100000}`;

  // A case that is waiting for the doctor to send a referral.
  const caseId = await intakeCase(request, { name: patient, pcpId: 'pcp_mariam' });
  await releaseByPhone(browser, caseId);
  const nav = await apiLogin(browser, await navigatorOf(browser, caseId));
  await command(nav, { type: 'STAFF_ACK', id: caseId, note: 'Patient repeated the explanation by phone.' });
  await nav.close();
  const docApi = await apiLogin(browser, 'pcp_mariam');
  await command(docApi, { type: 'COMPLETE_STEP', id: caseId, step: 'CONSULT', note: 'Talked it through and agreed a specialist visit.' });
  await docApi.close();

  // The lead adds the service.
  const lead = await session(browser, 'lead_fatima');
  await openServices(lead.page);
  const dialog = await fillAdd(lead.page, facility);
  const specialistName = (await dialog.getByLabel('Specialist who answers').locator('option[value="sp_tariq"]').innerText()).trim();
  await dialog.getByRole('button', { name: 'Add service' }).click();
  await expect(lead.page.getByRole('dialog')).toHaveCount(0);
  const card = lead.page.getByRole('article', { name: `${facility}, Bowel screening` });
  await expect(card).toBeVisible();
  await expect(card.getByText('Active', { exact: true })).toBeVisible();
  await expect(card).toContainText(`Answered by ${specialistName}`);
  await expect(card).toContainText('Gastroenterology');

  // The doctor is offered it in the referral form.
  const doc = await session(browser, 'pcp_mariam');
  await openCase(doc.page, patient);
  const sendTo = doc.page.getByLabel('Send to');
  await expect(sendTo.locator('option', { hasText: facility })).toHaveCount(1, { timeout: 15000 });

  // The lead disables it; the doctor's form drops it after the next refresh.
  await card.getByRole('button', { name: /^Disable/ }).click();
  const confirm = lead.page.getByRole('dialog', { name: 'Disable this service?' });
  await expect(confirm).toContainText(`New referrals to ${facility} will be refused. Referrals already sent stay as they are.`);
  await confirm.getByRole('button', { name: 'Disable service' }).click();
  await expect(lead.page.getByRole('dialog')).toHaveCount(0);
  await expect(card.getByText('Disabled', { exact: true })).toBeVisible();
  await expect(card.getByRole('button')).toHaveCount(0);
  await expect(sendTo.locator('option', { hasText: facility })).toHaveCount(0, { timeout: 15000 });

  await lead.context.close();
  await doc.context.close();
});

test('R2. the empty state names the problem and offers the one button that fixes it', async ({ browser }) => {
  const lead = await session(browser, 'lead_fatima');
  await stubEmptyList(lead.page);
  await openServices(lead.page);
  await expect(lead.page.getByText('No receiving services yet')).toBeVisible();
  await expect(lead.page.getByText('Doctors cannot send referrals until you add one.')).toBeVisible();
  await expect(lead.page.getByRole('button', { name: 'Add a receiving service' })).toHaveCount(1);
  await lead.context.close();
});

test('R3. a list that cannot be loaded says so and can be tried again', async ({ browser }) => {
  const lead = await session(browser, 'lead_fatima');
  let fail = true;
  await lead.page.route('**/api/admin/services', async (route) => {
    if (route.request().method() !== 'GET' || !fail) return route.continue();
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });
  await openServices(lead.page);
  await expect(lead.page.locator('main').getByRole('alert')).toContainText('We could not save this change. Please try again.');
  fail = false;
  await lead.page.getByRole('button', { name: 'Try again' }).click();
  await expect(lead.page.locator('main').getByRole('alert')).toHaveCount(0);
  await expect(lead.page.getByRole('article').first()).toBeVisible();
  await lead.context.close();
});

test('R4. adding the same unit for the same programme twice keeps the dialog open with a plain sentence', async ({ browser }) => {
  const facility = unique('Duplicate');
  const lead = await session(browser, 'lead_fatima');
  await openServices(lead.page);
  const first = await fillAdd(lead.page, facility);
  await first.getByRole('button', { name: 'Add service' }).click();
  await expect(lead.page.getByRole('dialog')).toHaveCount(0);
  await expect(lead.page.getByRole('article', { name: `${facility}, Bowel screening` })).toBeVisible();

  const second = await fillAdd(lead.page, facility);
  await second.getByRole('button', { name: 'Add service' }).click();
  await expect(second.getByRole('alert')).toHaveText('This unit already has a service for that programme.');
  await expect(second).toBeVisible();
  await expect(lead.page.getByRole('article', { name: `${facility}, Bowel screening` })).toHaveCount(1);
  await lead.context.close();
});

test('R5. a refused specialist is explained, and a network with no specialist is told to add one first', async ({ browser }) => {
  const lead = await session(browser, 'lead_fatima');
  await openServices(lead.page);
  // The server says 422: the person chosen is not an active specialist any more.
  await lead.page.route('**/api/admin/services', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'Choose an active specialist in this network.' }) });
  });
  const dialog = await fillAdd(lead.page, unique('Refused'));
  await dialog.getByRole('button', { name: 'Add service' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Check the details. The specialist must be an active specialist account.');
  await lead.context.close();

  // A workspace whose directory lists no specialist.
  const bare = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await bare.newPage();
  await page.route('**/api/workspace', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const headers = { ...route.request().headers() };
    delete headers['if-none-match'];
    const real = await route.fetch({ headers });
    const body = await real.json();
    if (body.directory) body.directory.people = body.directory.people.filter((p: { role: string }) => p.role !== 'SPECIALIST');
    await route.fulfill({ response: real, json: body, headers: { ...real.headers(), etag: '' } });
  });
  await loginAs(page, 'lead_fatima');
  await openServices(page);
  await page.getByRole('button', { name: 'Add a receiving service' }).click();
  const empty = page.getByRole('dialog', { name: 'Add a receiving service' });
  await expect(empty.getByText('Add a specialist account first (People tab), then come back here.')).toBeVisible();
  await expect(empty.getByLabel('Specialist who answers')).toHaveCount(0);
  await expect(empty.getByRole('button', { name: 'Add service' })).toBeDisabled();
  await bare.close();
});

test('R6. the section and its dialogs pass the accessibility check at 1440 and 390', async ({ browser }) => {
  const lead = await session(browser, 'lead_fatima');
  const page = lead.page;

  // Empty list.
  await stubEmptyList(page);
  await openServices(page);
  await expect(page.getByText('No receiving services yet')).toBeVisible();
  await checkAxeAt(page, 'Receiving services (empty)', STAFF_WIDTHS);
  await page.unroute('**/api/admin/services');

  // With items (reopen the section so the real list is shown).
  await page.getByRole('tab', { name: 'People' }).click();
  await page.getByRole('tab', { name: 'Receiving services' }).click();
  await expect(page.getByRole('article').first()).toBeVisible();
  await checkAxeAt(page, 'Receiving services (with items)', STAFF_WIDTHS);

  // Add dialog.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Add a receiving service' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a receiving service' })).toBeVisible();
  await checkAxeAt(page, 'Add a receiving service dialog', STAFF_WIDTHS);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Disable dialog.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('article').filter({ has: page.getByRole('button', { name: /^Disable/ }) }).first().getByRole('button', { name: /^Disable/ }).click();
  await expect(page.getByRole('dialog', { name: 'Disable this service?' })).toBeVisible();
  await checkAxeAt(page, 'Disable this service dialog', STAFF_WIDTHS);
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await lead.context.close();
});
