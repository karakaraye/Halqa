import { expect, Locator, Page } from '@playwright/test';
import { test } from './helpers';
import { apiLogin, createPatientAccount, intakeCase, loginAs, patientSignIn, releaseByPhone, sendToSpecialist, emailOf } from './helpers';

/*
 * Keyboard-only journeys: Tab, Shift+Tab, Enter, Space, Arrow keys and Escape. Pointer clicks are not used to move
 * through a screen. Each stop is also checked for a visible focus outline.
 */

/** True when the focused element (or, for a hidden radio, the label around it) has a visible outline. */
async function hasVisibleFocus(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element | null) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
    };
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    // A hidden radio button shows its focus on the answer around it.
    if (el instanceof HTMLInputElement && el.type === 'radio' && el.className.includes('sr-only')) return visible(el.closest('label'));
    return visible(el);
  });
}

async function isFocused(target: Locator) {
  return target.evaluate((el) => el === document.activeElement);
}

/** Presses Tab (or Shift+Tab) until the target has focus. Every stop on the way must show a focus outline. */
async function tabTo(page: Page, target: Locator, opts: { back?: boolean; max?: number } = {}) {
  const key = opts.back ? 'Shift+Tab' : 'Tab';
  for (let i = 0; i < (opts.max ?? 80); i += 1) {
    await page.keyboard.press(key);
    const seen = await hasVisibleFocus(page);
    const where = seen ? '' : await page.evaluate(() => { const e = document.activeElement as HTMLElement | null; return e ? `${e.tagName} ${e.outerHTML.slice(0, 160)}` : 'nothing'; });
    expect(seen, `focus is visible after ${i + 1} ${key} presses (on ${where})`).toBe(true);
    if (await isFocused(target)) return;
  }
  throw new Error(`Could not reach the control with ${key} in ${opts.max ?? 80} presses.`);
}

const insideDialog = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));

test('K1. sign in using only the keyboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  const email = page.getByLabel('Email', { exact: true });
  await tabTo(page, email);
  await page.keyboard.type(emailOf('nav_reem'));
  await tabTo(page, page.getByLabel('Password', { exact: true }));
  await page.keyboard.type(process.env.HALQA_E2E_PASSWORD!);
  await tabTo(page, page.getByRole('button', { name: 'Sign in', exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Good .*, Reem/ })).toBeVisible();

  // A wrong password is announced, and the form can be corrected and sent again with the keyboard.
  await page.getByRole('button', { name: 'Sign out' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await tabTo(page, email);
  await page.keyboard.type(emailOf('nav_reem'));
  await page.keyboard.press('Tab');
  await page.keyboard.type('not-the-password');
  await page.keyboard.press('Enter');
  await expect(page.locator('p[role="alert"]')).toContainText('Email or password is incorrect');
});

test('K2. a dialog traps focus, closes with Escape and gives focus back to the button that opened it', async ({ browser, request }) => {
  const lead = await loginPage(browser, 'lead_fatima');
  const page = lead.page;

  // Accounts tab, then the create-account dialog.
  await tabTo(page, page.getByRole('button', { name: 'Accounts', exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'User accounts' })).toBeVisible();
  const opener = page.getByRole('button', { name: 'Create new account' });
  await tabTo(page, opener);
  await page.keyboard.press('Space');
  const dialog = page.getByRole('dialog', { name: 'Create new account' });
  await expect(dialog).toBeVisible();
  expect(await insideDialog(page)).toBe(true);
  for (let i = 0; i < 20; i += 1) { await page.keyboard.press('Tab'); expect(await insideDialog(page), `Tab ${i + 1} stays inside`).toBe(true); expect(await hasVisibleFocus(page)).toBe(true); }
  for (let i = 0; i < 20; i += 1) { await page.keyboard.press('Shift+Tab'); expect(await insideDialog(page), `Shift+Tab ${i + 1} stays inside`).toBe(true); }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await isFocused(opener), 'focus returns to Create new account').toBe(true);

  // The same on a case page: the close pop-up opened from the card.
  const name = `Dina Fixture ${Date.now() % 100000}`;
  const caseId = await intakeCase(request, { name, pcpId: 'pcp_mariam' });
  await releaseByPhone(browser, caseId);
  await sendToSpecialist(browser, caseId);
  const doc = await loginPage(browser, 'pcp_mariam');
  const d = doc.page;
  await tabTo(d, d.getByRole('button', { name: new RegExp(`^(Open|View) ${name}$`) }));
  await d.keyboard.press('Enter');
  await expect(d.getByRole('heading', { name, level: 1 })).toBeVisible();
  const closeButton = d.getByRole('button', { name: /^Close case/ }).first();
  await tabTo(d, closeButton);
  await d.keyboard.press('Enter');
  const closeDialog = d.getByRole('dialog', { name: 'Close this case?' });
  await expect(closeDialog).toBeVisible();
  for (let i = 0; i < 25; i += 1) { await d.keyboard.press('Tab'); expect(await insideDialog(d), `Tab ${i + 1} stays in the close pop-up`).toBe(true); }
  await d.keyboard.press('Escape');
  await expect(closeDialog).toHaveCount(0);
  expect(await isFocused(closeButton), 'focus returns to the Close case button').toBe(true);

  await lead.context.close();
  await doc.context.close();
});

test('K3. the patient quick check is completed with the keyboard alone', async ({ browser, request }) => {
  const name = `Salma Fixture ${Date.now() % 100000}`;
  const caseId = await intakeCase(request, { name, pcpId: 'pcp_mariam' });
  const lead = await apiLogin(browser, 'lead_fatima');
  const account = await createPatientAccount(lead, caseId, name);
  await lead.close();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await context.newPage();
  await patientSignIn(p, account.email, account.temporaryPassword);
  await releaseByPhone(browser, caseId);
  await expect(p.getByRole('heading', { name: 'Your screening result' })).toBeVisible({ timeout: 15000 });

  await tabTo(p, p.getByRole('button', { name: 'Continue' }));
  await p.keyboard.press('Enter');
  await expect(p.getByRole('heading', { name: 'A quick check' })).toBeVisible();

  // Question 1: arrow to the second answer. Question 2: Space on the first answer.
  const q1 = p.getByRole('radio', { name: 'I am not sure yet.' });
  await tabTo(p, p.getByRole('radio', { name: 'It is a final answer about my health.' }));
  await p.keyboard.press('ArrowDown');
  await expect(p.getByRole('radio', { name: 'It means we need a closer check. It is not a diagnosis.' })).toBeChecked();
  expect(await q1.isChecked()).toBe(false);
  await tabTo(p, p.getByRole('radio', { name: 'Follow the next step with my care team.' }));
  await p.keyboard.press('Space');
  await expect(p.getByRole('radio', { name: 'Follow the next step with my care team.' })).toBeChecked();

  // Confidence 4, then send.
  const four = p.getByRole('button', { name: '4', exact: true });
  await tabTo(p, four);
  await p.keyboard.press('Enter');
  await expect(four).toHaveAttribute('aria-pressed', 'true');
  await tabTo(p, p.getByRole('button', { name: 'Send my answers' }));
  await p.keyboard.press('Enter');
  await expect(p.getByText('Thank you', { exact: true })).toBeVisible();
  await context.close();
});

test('K4. staff and patient tabs can be reached and used with the keyboard', async ({ browser, request }) => {
  // Staff: the lead moves along the tabs both ways.
  const lead = await loginPage(browser, 'lead_fatima');
  const page = lead.page;
  const tabs = page.getByRole('navigation', { name: 'Main' });
  await expect(tabs.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  await tabTo(page, tabs.getByRole('button', { name: 'Approvals' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Approvals', level: 1 })).toBeVisible();
  await expect(tabs.getByRole('button', { name: 'Approvals' })).toHaveAttribute('aria-current', 'page');
  await tabTo(page, tabs.getByRole('button', { name: 'Accounts' }));
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: 'User accounts' })).toBeVisible();
  await tabTo(page, tabs.getByRole('button', { name: 'Overview' }), { back: true });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'How we are doing' })).toBeVisible();
  await lead.context.close();

  // Patient: the bottom tabs.
  const name = `Reem Fixture ${Date.now() % 100000}`;
  const caseId = await intakeCase(request, { name, pcpId: 'pcp_mariam' });
  const admin = await apiLogin(browser, 'lead_fatima');
  const account = await createPatientAccount(admin, caseId, name);
  await admin.close();
  await releaseByPhone(browser, caseId);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await context.newPage();
  await patientSignIn(p, account.email, account.temporaryPassword);
  const bar = p.getByRole('navigation', { name: 'Patient' });
  await expect(p.getByRole('heading', { name: 'Your screening result' })).toBeVisible({ timeout: 15000 });
  await tabTo(p, bar.getByRole('button', { name: 'Your steps' }));
  await p.keyboard.press('Enter');
  await expect(p.getByRole('heading', { name: 'Your steps', level: 1 })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Your steps' })).toHaveAttribute('aria-current', 'page');
  await tabTo(p, bar.getByRole('button', { name: 'Help' }));
  await p.keyboard.press('Space');
  await expect(p.getByRole('heading', { name: 'How can we help?' })).toBeVisible();
  await tabTo(p, bar.getByRole('button', { name: 'Your result' }), { back: true, max: 20 });
  await p.keyboard.press('Enter');
  await expect(p.getByRole('heading', { name: 'Your screening result' })).toBeVisible();
  await context.close();
});

/** A signed-in page in a new context, 1440 wide. */
async function loginPage(browser: import('@playwright/test').Browser, id: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await loginAs(page, id);
  return { context, page };
}

test('K5. the add-a-receiving-service dialog traps focus and Escape gives focus back to its button', async ({ browser }) => {
  const lead = await loginPage(browser, 'lead_fatima');
  const page = lead.page;
  await tabTo(page, page.getByRole('button', { name: 'Accounts', exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'User accounts' })).toBeVisible();

  // The two sections are tabs: Tab reaches the selected one, an arrow key moves to the other.
  await tabTo(page, page.getByRole('tab', { name: 'People' }));
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Receiving services' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Receiving services', level: 1 })).toBeVisible();

  const opener = page.getByRole('button', { name: 'Add a receiving service' });
  await tabTo(page, opener);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add a receiving service' });
  await expect(dialog).toBeVisible();
  expect(await insideDialog(page)).toBe(true);
  for (let i = 0; i < 20; i += 1) { await page.keyboard.press('Tab'); expect(await insideDialog(page), `Tab ${i + 1} stays inside`).toBe(true); expect(await hasVisibleFocus(page)).toBe(true); }
  for (let i = 0; i < 20; i += 1) { await page.keyboard.press('Shift+Tab'); expect(await insideDialog(page), `Shift+Tab ${i + 1} stays inside`).toBe(true); }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await isFocused(opener), 'focus returns to Add a receiving service').toBe(true);
  await lead.context.close();
});
