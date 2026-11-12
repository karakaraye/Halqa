import { expect } from '@playwright/test';
import { test } from './helpers';
import {
  disableMadeAccounts, rememberAccount,
  PATIENT_WIDTHS, STAFF_WIDTHS, acceptAndBook, apiLogin, checkAxeAt, createPatientAccount, createStaffAccount, intakeCase, login,
  patientSignIn, releaseByPhone, sendToSpecialist, session, shot, shotDialog,
} from './helpers';
import { goToTab, openCase } from './flows';

/*
 * Every screen and every dialog is checked with axe (colour contrast included) at two widths
 * (staff 1440 and 390, patient 390 and 320), and a screenshot is taken at each width.
 * Screenshots only go to docs/design/compare when SAVE_SCREENSHOTS=1.
 * This file runs before the others so the pictures show a workspace with few test patients in it.
 */

/** Axe and a screenshot at each width, for a screen or dialog that is open now. */
async function review(page: import('@playwright/test').Page, label: string, file: string, widths: readonly number[], popup = false) {
  for (const width of widths) {
    if (popup) await shotDialog(page, `${file}-${width}`, width);
    else await shot(page, `${file}-${width}`, width);
  }
  await checkAxeAt(page, label, widths);
}

test.afterEach(async ({ browser }) => { await disableMadeAccounts(browser); });

test('S0. the accessibility check really does fail on poor colour contrast', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'contrast-probe';
    p.textContent = 'Pale grey words on white';
    p.setAttribute('style', 'color:#c8c8c8;background:#ffffff;font-size:16px;padding:8px');
    document.querySelector('main')!.appendChild(p);
  });
  await expect(checkAxeAt(page, 'Contrast probe', [1440])).rejects.toThrow(/color-contrast/);
});

test('S1. sign-in, forced change-password screen and the change-password dialog', async ({ browser, page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await review(page, 'Sign in', '11-2-sign-in', STAFF_WIDTHS);

  const lead = await apiLogin(browser, 'lead_fatima');
  const account = await createStaffAccount(lead, { name: 'Nadia Hamdan', role: 'NAVIGATOR', org: 'Preventive Screening Hub' });
  await lead.close();

  await login(page, account.email, account.temporaryPassword);
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await review(page, 'Set a new password (forced)', 'set-password', STAFF_WIDTHS);

  const next = `Staff-${Date.now()}-fixture`;
  await page.getByLabel('Current password').fill(account.temporaryPassword);
  await page.getByLabel('New password (at least 12 characters)').fill(next);
  await page.getByLabel('Confirm new password').fill(next);
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByRole('heading', { name: /Good .*, Nadia/ })).toBeVisible();

  await page.getByRole('button', { name: 'Password', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Change your password' })).toBeVisible();
  await review(page, 'Change password dialog', 'change-password-dialog', STAFF_WIDTHS, true);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('S2. lead screens: Overview, Approvals, Accounts and the two account dialogs', async ({ browser }) => {
  const { context, page } = await session(browser, 'lead_fatima');
  await expect(page.getByRole('heading', { name: 'How we are doing' })).toBeVisible();
  await review(page, 'Overview', '14-203-overview', STAFF_WIDTHS);

  await goToTab(page, 'Approvals');
  await expect(page.getByRole('heading', { name: 'Approvals', level: 1 })).toBeVisible();
  await review(page, 'Approvals', '14-296-approvals', STAFF_WIDTHS);

  await goToTab(page, 'Accounts');
  await expect(page.getByRole('heading', { name: 'User accounts' })).toBeVisible();
  await review(page, 'Accounts', 'accounts', STAFF_WIDTHS);

  await page.getByRole('button', { name: 'Create new account' }).click();
  await expect(page.getByRole('dialog', { name: 'Create new account' })).toBeVisible();
  await review(page, 'Create account dialog', 'create-account-dialog', STAFF_WIDTHS, true);
  const email = `screens_${Date.now()}@halqa.test`;
  await page.getByLabel('Full name').fill('Omar Rashed');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Organisation or clinic').fill('Preventive Screening Hub');
  rememberAccount(email);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('dialog', { name: 'Account created' })).toBeVisible();
  await checkAxeAt(page, 'Account created dialog', STAFF_WIDTHS);
  await page.getByRole('button', { name: 'Done' }).click();

  await page.setViewportSize({ width: 1440, height: 900 });
  const row = page.locator('li').filter({ hasText: email });
  await row.getByRole('button', { name: 'Disable' }).click();
  await expect(page.getByRole('dialog', { name: 'Disable account' })).toBeVisible();
  await review(page, 'Disable account dialog', 'disable-account-dialog', STAFF_WIDTHS, true);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await context.close();
});

test('S3. navigator, doctor and specialist screens with the close, hand-over and send-back dialogs', async ({ browser, request }) => {
  const name = 'Huda Karimi';
  const caseId = await intakeCase(request, { name, pcpId: 'pcp_mariam' });

  // Navigator: My work and the case page, while the patient has not been told yet.
  const nav = await session(browser, 'nav_reem');
  await expect(nav.page.getByRole('heading', { name: /Good .*, Reem/ })).toBeVisible();
  await expect(nav.page.getByRole('button', { name: new RegExp(`^(Open|View) ${name}$`) })).toBeVisible({ timeout: 15000 });
  await review(nav.page, 'My work', '11-22-my-work', STAFF_WIDTHS);
  await openCase(nav.page, name);
  await review(nav.page, 'Case page', '13-2-case-page', STAFF_WIDTHS);
  await nav.context.close();
  await releaseByPhone(browser, caseId);
  await sendToSpecialist(browser, caseId);

  // Doctor: the close and hand-over pop-ups.
  const doc = await session(browser, 'pcp_mariam');
  await openCase(doc.page, name);
  await doc.page.getByRole('button', { name: /^Close case/ }).first().click();
  await expect(doc.page.getByRole('dialog', { name: 'Close this case?' })).toBeVisible();
  await review(doc.page, 'Close dialog', '13-233-close-dialog', STAFF_WIDTHS, true);
  await doc.page.keyboard.press('Escape');
  await expect(doc.page.getByRole('dialog')).toHaveCount(0);
  await doc.page.setViewportSize({ width: 1440, height: 900 });
  await doc.page.getByRole('button', { name: 'Hand over this patient' }).click();
  await expect(doc.page.getByRole('dialog', { name: 'Hand over this patient' })).toBeVisible();
  await review(doc.page, 'Hand-over dialog', '13-284-hand-over-dialog', STAFF_WIDTHS, true);
  await doc.page.keyboard.press('Escape');
  await doc.context.close();

  // Specialist: Referrals and the send-back pop-up.
  const sp = await session(browser, 'sp_tariq');
  await expect(sp.page.getByRole('article', { name: `Referral for ${name}` })).toBeVisible();
  await review(sp.page, 'Referrals', '13-138-referrals', STAFF_WIDTHS);
  await sp.page.setViewportSize({ width: 1440, height: 900 });
  await sp.page.getByRole('article', { name: `Referral for ${name}` }).getByRole('button', { name: 'Send back', exact: true }).click();
  await expect(sp.page.getByRole('dialog', { name: 'Send this referral back?' })).toBeVisible();
  await review(sp.page, 'Send-back dialog', '13-324-send-back-dialog', STAFF_WIDTHS, true);
  await sp.page.keyboard.press('Escape');
  await sp.context.close();
});

test('S4. patient screens: waiting, result, Arabic result, quick check, all done, steps, booked and help', async ({ browser, request }) => {
  const name = 'Maryam Qasim';
  const caseId = await intakeCase(request, { name, pcpId: 'pcp_mariam' });
  const lead = await apiLogin(browser, 'lead_fatima');
  const account = await createPatientAccount(lead, caseId, name);
  await lead.close();

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await context.newPage();
  await patientSignIn(p, account.email, account.temporaryPassword);

  // Waiting (P8).
  await expect(p.getByRole('heading', { name: 'Your result is on its way' })).toBeVisible();
  await review(p, 'Patient waiting', 'P8-waiting', PATIENT_WIDTHS);

  // Result (P1) once the care team has told the patient by phone.
  await releaseByPhone(browser, caseId);
  await expect(p.getByRole('heading', { name: 'Your screening result' })).toBeVisible({ timeout: 15000 });
  await review(p, 'Patient result', 'P1-result', PATIENT_WIDTHS);

  // The same result in Arabic, right to left (P9).
  await p.locator('header select').selectOption('ar');
  await expect(p.getByRole('heading', { name: 'نتيجتك في الفحص' })).toBeVisible();
  await expect(p.locator('div[dir="rtl"]')).toBeVisible();
  await review(p, 'Patient result in Arabic', 'P9-arabic', PATIENT_WIDTHS);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator('header select').selectOption('en');
  await expect(p.getByRole('heading', { name: 'Your screening result' })).toBeVisible();

  // Quick check (P2) and all done (P3).
  await p.getByRole('button', { name: 'Continue' }).click();
  await expect(p.getByRole('heading', { name: 'A quick check' })).toBeVisible();
  await review(p, 'Patient quick check', 'P2-quick-check', PATIENT_WIDTHS);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.getByText('It means we need a closer check. It is not a diagnosis.').click();
  await p.getByText('Follow the next step with my care team.').click();
  await p.getByRole('button', { name: '4', exact: true }).click();
  await p.getByRole('button', { name: 'Send my answers' }).click();
  await expect(p.getByText('Thank you', { exact: true })).toBeVisible();
  await review(p, 'Patient all done', 'P3-all-done', PATIENT_WIDTHS);

  // Steps (P4) and help (P6).
  await p.setViewportSize({ width: 390, height: 844 });
  await p.getByRole('button', { name: 'Your steps' }).click();
  await expect(p.getByRole('heading', { name: 'Your steps', level: 1 })).toBeVisible();
  await review(p, 'Patient steps', 'P4-steps', PATIENT_WIDTHS);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.getByRole('button', { name: 'Help' }).click();
  await expect(p.getByRole('heading', { name: 'How can we help?' })).toBeVisible();
  await review(p, 'Patient help', 'P6-help', PATIENT_WIDTHS);

  // Booked (P5): the staff book a real date and time.
  await sendToSpecialist(browser, caseId, { staffAck: false });
  await acceptAndBook(browser, caseId);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.getByRole('button', { name: 'Your steps' }).click();
  await expect(p.getByRole('heading', { name: 'You are booked' })).toBeVisible({ timeout: 15000 });
  await review(p, 'Patient booked', 'P5-booked', PATIENT_WIDTHS);
  await context.close();
});

