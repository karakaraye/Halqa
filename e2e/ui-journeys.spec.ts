import { expect } from '@playwright/test';
import { test } from './helpers';
import {
  apiLogin, caseById, createPatientAccount, createStaffAccount, disableMadeAccounts, errorBanner, intakeCase, patientSignIn,
  releaseByPhone, reportDelivery, sendToSpecialist, session, signOut,
} from './helpers';
import { acceptReferral, answerQuickCheck, openCase, sendReferral, timelineItem, writeAndSave } from './flows';

/*
 * Journeys through the real screens. Every test opens its own cases through the intake route and creates
 * its own accounts, so none of them depends on what another one left behind.
 */

const unique = (label: string) => `${label} ${Date.now() % 100000}`;

test.afterEach(async ({ browser }) => { await disableMadeAccounts(browser); });

test('J2. a referral sent back with a reason reaches the doctor, who sends it to another service', async ({ browser, request }) => {
  const name = unique('Basma Fixture');
  const caseId = await intakeCase(request, { name, pcpId: 'pcp_mariam' });
  await releaseByPhone(browser, caseId);
  await sendToSpecialist(browser, caseId);
  const sp = await session(browser, 'sp_tariq');
  const doc = await session(browser, 'pcp_mariam');
  const first = name.split(' ')[0];

  // The specialist sends it back and picks a reason.
  const card = sp.page.getByRole('article', { name: `Referral for ${name}` });
  await card.getByRole('button', { name: 'Send back', exact: true }).click();
  const dialog = sp.page.getByRole('dialog', { name: 'Send this referral back?' });
  await dialog.getByText('Outside our area').click();
  await dialog.getByRole('button', { name: 'Send back', exact: true }).click();
  await expect(card).toHaveCount(0);

  // The doctor sees the reason and the referral form again.
  await openCase(doc.page, name);
  await expect(doc.page.getByRole('status').getByText('The referral came back')).toBeVisible({ timeout: 15000 });
  await expect(doc.page.getByText('Reason: Outside our area')).toBeVisible();
  await expect(doc.page.getByRole('heading', { name: 'Send the referral again' })).toBeVisible();

  // The doctor sends it to the other service. It shows on the specialist's screen as sent back once.
  await sendReferral(doc.page, first, 'Sending to the regional unit instead, as asked.', 'Regional Hospital — Endoscopy Unit');
  await expect(sp.page.getByRole('article', { name: `Referral for ${name}` })).toContainText('Sent back once', { timeout: 15000 });
  const lead = await apiLogin(browser, 'lead_fatima');
  expect((await caseById(lead, caseId)).referral?.facility).toBe('Regional Hospital — Endoscopy Unit');
  await acceptReferral(sp.page, name);
  await lead.close();
  await sp.context.close();
  await doc.context.close();
});

test('J3. a wrong quick-check answer raises an alert for the navigator, who records the call, and the alert clears', async ({ browser, request }) => {
  const name = unique('Rania Fixture');
  const first = name.split(' ')[0];
  const caseId = await intakeCase(request, { name, pcpId: 'pcp_mariam' });
  const lead = await apiLogin(browser, 'lead_fatima');
  const account = await createPatientAccount(lead, caseId, name);
  const assigned = (await caseById(lead, caseId)).team.NAVIGATOR!.id;
  await releaseByPhone(browser, caseId);

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await context.newPage();
  await patientSignIn(p, account.email, account.temporaryPassword);
  await expect(p.getByRole('heading', { name: 'Your screening result' })).toBeVisible({ timeout: 15000 });
  await answerQuickCheck(p, { wrong: true });

  const nav = await session(browser, assigned);
  await openCase(nav.page, name);
  const alert = 'The patient may not understand the result';
  await expect(nav.page.getByRole('heading', { name: 'Needs a decision' })).toBeVisible();
  await expect(nav.page.getByText(alert, { exact: true })).toBeVisible();
  await expect(nav.page.getByText(`${first} was not sure, so a call is needed`)).toBeVisible();
  expect((await caseById(lead, caseId)).escalations.some((e) => e.ruleId === 'R6_LOW_UNDERSTANDING' && !e.resolvedAt)).toBe(true);

  // The navigator phones, writes what the patient said back, and marks it done.
  await writeAndSave(nav.page, `What did ${first} say back to you?`, 'Said it back correctly after a second explanation.', 'Mark as done');
  await expect(timelineItem(nav.page, 'Quick check')).toContainText('done');
  await expect(nav.page.getByText(alert, { exact: true })).toHaveCount(0);
  expect((await caseById(lead, caseId)).escalations.some((e) => e.ruleId === 'R6_LOW_UNDERSTANDING' && !e.resolvedAt)).toBe(false);

  await nav.context.close();
  await context.close();
  await lead.close();
});

test('J4. hand-over: one request is accepted, another is declined', async ({ browser, request }) => {
  const accepted = unique('Hana Fixture');
  const declined = unique('Iman Fixture');
  const acceptedId = await intakeCase(request, { name: accepted, pcpId: 'pcp_mariam' });
  const declinedId = await intakeCase(request, { name: declined, pcpId: 'pcp_mariam' });
  const lead = await apiLogin(browser, 'lead_fatima');
  const doc = await session(browser, 'pcp_mariam');
  const arjun = await session(browser, 'pcp_arjun');
  const sara = await session(browser, 'pcp_sara');

  async function requestHandOver(name: string, who: string, reason: string) {
    await openCase(doc.page, name);
    await doc.page.getByRole('button', { name: 'Hand over this patient' }).click();
    const dialog = doc.page.getByRole('dialog', { name: 'Hand over this patient' });
    await dialog.locator('label').filter({ hasText: who }).click();
    await dialog.getByLabel('Why are you handing over?').fill(reason);
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(doc.page.getByText(/^Waiting for .* to accept the hand-over\.$/)).toBeVisible();
    await doc.page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'My work' }).click();
  }
  await requestHandOver(accepted, 'Dr. Arjun Menon', 'Covering another clinic this month.');
  await requestHandOver(declined, 'Dr. Sara Haddad', 'Patient lives nearer your clinic.');

  // Accept.
  await arjun.page.reload();
  await openCase(arjun.page, accepted);
  await expect(arjun.page.getByText('Dr. Mariam Al Zaabi wants to hand this patient to you')).toBeVisible();
  await expect(arjun.page.getByText('Reason: Covering another clinic this month.')).toBeVisible();
  await arjun.page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(arjun.page.getByText(/wants to hand this patient to you/)).toHaveCount(0);
  await expect(arjun.page.getByRole('complementary')).toContainText('Responsible for this case');
  const handed = await caseById(lead, acceptedId);
  expect(handed.accountable?.id).toBe('pcp_arjun');
  expect(handed.pendingTransfer).toBeUndefined();

  // Decline: nothing changes and the request is gone.
  await sara.page.reload();
  await openCase(sara.page, declined);
  await expect(sara.page.getByText('Dr. Mariam Al Zaabi wants to hand this patient to you')).toBeVisible();
  await sara.page.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(sara.page.getByText(/wants to hand this patient to you/)).toHaveCount(0);
  const kept = await caseById(lead, declinedId);
  expect(kept.accountable?.id).toBe('pcp_mariam');
  expect(kept.pendingTransfer).toBeUndefined();
  await openCase(doc.page, declined);
  await expect(doc.page.getByText(/^Waiting for .* to accept the hand-over\.$/)).toHaveCount(0);
  await expect(doc.page.getByRole('button', { name: 'Hand over this patient' })).toBeVisible();

  for (const who of [doc, arjun, sara]) await who.context.close();
  await lead.close();
});

test('J5. a case closed without a test result needs the lead: one is approved, one is sent back and reopens', async ({ browser, request }) => {
  const approved = unique('Yasmin Fixture');
  const returned = unique('Zahra Fixture');
  const approvedId = await intakeCase(request, { name: approved, pcpId: 'pcp_mariam' });
  const returnedId = await intakeCase(request, { name: returned, pcpId: 'pcp_mariam' });
  const doc = await session(browser, 'pcp_mariam');
  const lead = await session(browser, 'lead_fatima');

  async function submitException(name: string) {
    await openCase(doc.page, name);
    await doc.page.getByRole('button', { name: /^Close case/ }).first().click();
    const dialog = doc.page.getByRole('dialog', { name: 'Close this case?' });
    await dialog.getByLabel('How is this case ending?').selectOption('DECLINED_INFORMED');
    await dialog.getByLabel('What did the test show?').fill('No test done');
    await dialog.getByLabel('Where is the report?').fill('Phone note');
    await dialog.getByLabel('What is the plan now?').fill('Check again at the next routine screening.');
    await dialog.getByLabel(/^Why are you closing without a test/).fill('The patient heard the risks twice and said no, and wrote to confirm it.');
    await dialog.getByRole('button', { name: 'Close case', exact: true }).click();
    const sent = doc.page.getByRole('dialog', { name: 'Sent for a second check' });
    await expect(sent).toBeVisible();
    await sent.getByRole('button', { name: 'Done' }).click();
    await expect(doc.page.getByText('Sent to the clinic lead for a second check.').first()).toBeVisible();
    await doc.page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'My work' }).click();
  }
  await submitException(approved);
  await submitException(returned);

  // The lead sees both and decides.
  await lead.page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Approvals' }).click();
  const one = lead.page.getByRole('article', { name: `Closure for ${approved}` });
  await expect(one).toBeVisible({ timeout: 15000 });
  await expect(one).toContainText('Declined after a clear talk');
  await expect(one.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await one.getByLabel('Your decision note (at least 5 characters)').fill('The doctor documented a clear talk.');
  await one.getByRole('button', { name: 'Approve' }).click();
  await expect(one).toHaveCount(0);

  const two = lead.page.getByRole('article', { name: `Closure for ${returned}` });
  await two.getByLabel('Your decision note (at least 5 characters)').fill('Please talk to the patient once more first.');
  await two.getByRole('button', { name: 'Send back to the doctor' }).click();
  await expect(two).toHaveCount(0);

  const check = await apiLogin(browser, 'lead_fatima');
  expect((await caseById(check, approvedId)).closure?.status).toBe('CLOSED');
  expect((await caseById(check, returnedId)).closure).toBeUndefined();

  // The doctor sees the second open again, with nothing waiting for the lead.
  await openCase(doc.page, returned);
  await expect(doc.page.getByRole('heading', { name: 'Close this case' })).toBeVisible();
  await expect(doc.page.getByText('Sent to the clinic lead for a second check.')).toHaveCount(0);
  await doc.context.close();
  await lead.context.close();
  await check.close();
});

test('J6. a written message stays "waiting to be delivered" until the delivery report arrives, then the patient sees the result', async ({ browser, request }) => {
  const name = unique('Sara Fixture');
  const first = name.split(' ')[0];
  const caseId = await intakeCase(request, { name, pcpId: 'pcp_mariam' });
  const lead = await apiLogin(browser, 'lead_fatima');
  const account = await createPatientAccount(lead, caseId, name);
  const assigned = (await caseById(lead, caseId)).team.NAVIGATOR!.id;

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await context.newPage();
  await patientSignIn(p, account.email, account.temporaryPassword);
  await expect(p.getByRole('heading', { name: 'Your result is on its way' })).toBeVisible();

  const nav = await session(browser, assigned);
  await openCase(nav.page, name);
  await nav.page.getByRole('button', { name: `Message ${first}` }).click();
  await expect(nav.page.getByText('Message is waiting to be delivered.').first()).toBeVisible();
  await expect(nav.page.getByRole('button', { name: `Message ${first}` })).toBeDisabled();
  await expect(timelineItem(nav.page, 'Result shared')).toHaveCount(0);

  // Still waiting on the phone after a poll.
  await p.waitForTimeout(4000);
  await expect(p.getByRole('heading', { name: 'Your result is on its way' })).toBeVisible();
  const queued = (await caseById(lead, caseId)).notifications.find((n) => n.status === 'QUEUED' || n.status === 'SENT');
  expect(queued?.id).toBeTruthy();

  // A report with a wrong key is refused; the right key completes the step.
  expect((await reportDelivery(request, queued!.id!, 'DELIVERED', 'not-the-key')).status()).toBe(401);
  const done = await reportDelivery(request, queued!.id!, 'DELIVERED');
  expect(done.status(), await done.text()).toBe(200);
  await expect(timelineItem(nav.page, 'Result shared')).toContainText('done', { timeout: 15000 });
  await expect(p.getByRole('heading', { name: 'Your screening result' })).toBeVisible({ timeout: 15000 });
  expect((await reportDelivery(request, queued!.id!, 'DELIVERED')).status()).toBe(200);

  await nav.context.close();
  await context.close();
  await lead.close();
});

test('J7. a person changes their own password from the top bar, and only the new one works', async ({ browser }) => {
  const lead = await apiLogin(browser, 'lead_fatima');
  const account = await createStaffAccount(lead, { name: 'Tamara Fixture', role: 'PCP', org: 'Al Bateen Healthcare Centre' });
  await lead.close();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const forced = `Forced-${Date.now()}-fixture`;
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.temporaryPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await page.getByLabel('Current password').fill(account.temporaryPassword);
  await page.getByLabel('New password (at least 12 characters)').fill(forced);
  await page.getByLabel('Confirm new password').fill(forced);
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByRole('heading', { name: /Good .*, Tamara/ })).toBeVisible();

  // The dialog refuses a wrong current password, then a short one, then accepts a good one.
  const later = `Changed-${Date.now()}-fixture`;
  await page.getByRole('button', { name: 'Password', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Change your password' });
  await dialog.getByLabel('Current password').fill('not-my-password');
  await dialog.getByLabel('New password (at least 12 characters)').fill(later);
  await dialog.getByLabel('Confirm new password').fill(later);
  await dialog.getByRole('button', { name: 'Save new password' }).click();
  await expect(dialog.locator('p[role="alert"]')).toBeVisible();
  await dialog.getByLabel('Current password').fill(forced);
  await dialog.getByLabel('New password (at least 12 characters)').fill('short');
  await dialog.getByLabel('Confirm new password').fill('short');
  await dialog.getByRole('button', { name: 'Save new password' }).click();
  await expect(dialog.locator('p[role="alert"]')).toContainText('at least 12 characters');
  await dialog.getByLabel('New password (at least 12 characters)').fill(later);
  await dialog.getByLabel('Confirm new password').fill(later);
  await dialog.getByRole('button', { name: 'Save new password' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(errorBanner(page)).toHaveCount(0);

  await signOut(page);
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(forced);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Email or password is incorrect');
  await page.getByLabel('Password', { exact: true }).fill(later);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good .*, Tamara/ })).toBeVisible();
  await context.close();
});

