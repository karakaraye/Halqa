import { expect, Page } from '@playwright/test';
import { test } from './helpers';
import { apiLogin, createPatientAccount, intakeCase, loginAs, patientSignIn, releaseByPhone } from './helpers';
import { goToTab } from './flows';

/** What each role is shown: its tabs, in order, the tab it lands on, and that every tab opens its screen. */

type Tab = 'My work' | 'Referrals' | 'Overview' | 'Approvals' | 'Accounts';
const ALL: Tab[] = ['My work', 'Referrals', 'Overview', 'Approvals', 'Accounts'];

const SCREEN: Record<Tab, (page: Page) => Promise<void>> = {
  'My work': (page) => expect(page.getByRole('heading', { name: /Good .*, /, level: 1 })).toBeVisible(),
  Referrals: (page) => expect(page.getByRole('heading', { name: 'Referrals', level: 1 })).toBeVisible(),
  Overview: (page) => expect(page.getByRole('heading', { name: 'How we are doing', level: 1 })).toBeVisible(),
  Approvals: (page) => expect(page.getByRole('heading', { name: 'Approvals', level: 1 })).toBeVisible(),
  Accounts: (page) => expect(page.getByRole('heading', { name: 'User accounts', level: 1 })).toBeVisible(),
};

const STAFF: { title: string; id: string; tabs: Tab[]; lands: Tab }[] = [
  { title: 'navigator', id: 'nav_reem', tabs: ['My work', 'Overview'], lands: 'My work' },
  { title: 'doctor', id: 'pcp_mariam', tabs: ['My work', 'Overview'], lands: 'My work' },
  { title: 'specialist', id: 'sp_tariq', tabs: ['Referrals', 'Overview'], lands: 'Referrals' },
  { title: 'clinic lead', id: 'lead_fatima', tabs: ['Overview', 'Approvals', 'Accounts'], lands: 'Overview' },
];

for (const role of STAFF) {
  test(`R. ${role.title}: sees ${role.tabs.join(', ')} and lands on ${role.lands}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, role.id);
    const nav = page.getByRole('navigation', { name: 'Main' });

    // Exactly these tabs, in this order, and no others.
    await expect(nav.getByRole('button')).toHaveText(role.tabs);
    for (const other of ALL.filter((t) => !role.tabs.includes(t))) await expect(nav.getByRole('button', { name: other, exact: true })).toHaveCount(0);

    // The landing tab is the current one and its screen is showing.
    await expect(nav.getByRole('button', { name: role.lands, exact: true })).toHaveAttribute('aria-current', 'page');
    await SCREEN[role.lands](page);

    // Every tab opens its own screen and becomes the current one; the others are not current.
    for (const tab of [...role.tabs].reverse().concat(role.tabs)) {
      await goToTab(page, tab);
      await SCREEN[tab](page);
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    }

    // The top bar offers Password and Sign out to every staff role.
    await expect(page.getByRole('button', { name: 'Password', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });
}

test('R. patient: no staff tabs, only Your result, Your steps and Help', async ({ browser, request }) => {
  const name = `Noor Fixture ${Date.now() % 100000}`;
  const caseId = await intakeCase(request, { name, pcpId: 'pcp_mariam' });
  const lead = await apiLogin(browser, 'lead_fatima');
  const account = await createPatientAccount(lead, caseId, name);
  await lead.close();
  await releaseByPhone(browser, caseId);

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await context.newPage();
  await patientSignIn(p, account.email, account.temporaryPassword);
  await expect(p.getByRole('heading', { name: 'Your screening result' })).toBeVisible({ timeout: 15000 });

  await expect(p.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  for (const staffTab of ALL) await expect(p.getByRole('button', { name: staffTab, exact: true })).toHaveCount(0);
  const bar = p.getByRole('navigation', { name: 'Patient' });
  await expect(bar.getByRole('button')).toHaveText(['Your result', 'Your steps', 'Help']);
  await expect(bar.getByRole('button', { name: 'Your result' })).toHaveAttribute('aria-current', 'page');

  await bar.getByRole('button', { name: 'Your steps' }).click();
  await expect(p.getByRole('heading', { name: 'Your steps', level: 1 })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Your steps' })).toHaveAttribute('aria-current', 'page');
  await bar.getByRole('button', { name: 'Help' }).click();
  await expect(p.getByRole('heading', { name: 'How can we help?' })).toBeVisible();
  await bar.getByRole('button', { name: 'Your result' }).click();
  await expect(p.getByRole('heading', { name: 'Your screening result' })).toBeVisible();

  // The patient's own copy of the record holds no staff data.
  const snap = await (await context.request.get('/api/workspace')).json();
  expect(snap.state.cases).toEqual([]);
  expect(snap.directory.people).toEqual([]);
  await context.close();
});
