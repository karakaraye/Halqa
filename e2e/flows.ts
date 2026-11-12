import { expect, Page } from '@playwright/test';

/** Clicks through the real screens, one care step at a time. Fixtures only; no product code. */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Opens a patient from My work, from the Accepted list on Referrals, or from Approvals. */
export async function openCase(page: Page, name: string) {
  await page.getByRole('button', { name: new RegExp(`^(Open|View) ${escapeRe(name)}$`) }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

export async function backToMyWork(page: Page) {
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'My work' }).click();
  await expect(page.getByRole('heading', { name: /Good .*, / })).toBeVisible();
}

export async function goToTab(page: Page, tab: 'My work' | 'Referrals' | 'Overview' | 'Approvals' | 'Accounts') {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: tab, exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: tab, exact: true })).toHaveAttribute('aria-current', 'page');
}

/** A step in the "What has happened" list. */
export const timelineItem = (page: Page, label: string) => page.getByRole('listitem').filter({ hasText: label });

/** Navigator records a phone call that reached the patient: the patient is now told. */
export async function callPatientReached(page: Page, first: string) {
  await page.getByRole('button', { name: `Call ${first}` }).click();
  await page.getByRole('button', { name: 'Reached', exact: true }).click();
  await expect(timelineItem(page, 'Result shared')).toContainText('done');
}

/** Doctor writes the consultation note. */
export async function recordConsult(page: Page, note: string) {
  await page.getByLabel('What did you agree?').fill(note);
  await page.getByRole('button', { name: 'Mark as done' }).click();
  await expect(timelineItem(page, 'Talk with the doctor')).toContainText('done');
}

/** Doctor sends the referral to a service (the first one for the programme unless named). */
export async function sendReferral(page: Page, first: string, note: string, facility?: string) {
  if (facility) await page.getByLabel('Send to').selectOption(facility);
  await page.getByLabel(`Why does ${first} need to be seen?`).fill(note);
  await page.getByRole('button', { name: /^Send referral( again)?$/ }).click();
  await expect(page.getByText(/has the referral\. Nothing for you to do until they accept|Waiting for the specialist to accept/).first()).toBeVisible();
}

/** Specialist accepts the referral from the Referrals screen. */
export async function acceptReferral(page: Page, name: string) {
  const card = page.getByRole('article', { name: `Referral for ${name}` });
  await card.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(card).toHaveCount(0);
}

/** Books a date and time (the value is a date-time-input string). */
export async function bookAppointment(page: Page, value: string) {
  await page.getByLabel('Date and time').fill(value);
  await page.getByRole('button', { name: 'Book appointment' }).click();
  await expect(timelineItem(page, 'Specialist appointment')).toContainText('done');
}

/** Writes a note into a labelled box and presses the named button. */
export async function writeAndSave(page: Page, label: string, note: string, button: string) {
  await page.getByLabel(label).fill(note);
  await page.getByRole('button', { name: button, exact: true }).click();
}

/** Doctor closes the case with a test report from the close pop-up. */
export async function closeWithEvidence(page: Page, outcome: string, report: string, plan: string) {
  await page.getByRole('button', { name: 'Close case', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Close this case?' });
  await dialog.getByLabel('What did the test show?').fill(outcome);
  await dialog.getByLabel('Where is the report?').fill(report);
  await dialog.getByLabel('What is the plan now?').fill(plan);
  await dialog.getByRole('button', { name: 'Close case', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** Patient answers the quick check by clicking. `wrong` picks a wrong first answer. */
export async function answerQuickCheck(page: Page, opts: { wrong?: boolean } = {}) {
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'A quick check' })).toBeVisible();
  await page.getByText(opts.wrong ? 'It is a final answer about my health.' : 'It means we need a closer check. It is not a diagnosis.').click();
  await page.getByText('Follow the next step with my care team.').click();
  await page.getByRole('button', { name: opts.wrong ? '2' : '4', exact: true }).click();
  await page.getByRole('button', { name: 'Send my answers' }).click();
  await expect(page.getByText('Thank you', { exact: true })).toBeVisible();
}
