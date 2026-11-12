import { expect } from '@playwright/test';
import { test } from './helpers';
import {
  advanceClock, caseById, checkAxe, createPatientAccount, inputValueAfter, intakeCase, login, patientSignIn,
  serverNow, session, shot, state,
} from './helpers';
import {
  acceptReferral, answerQuickCheck, bookAppointment, callPatientReached, closeWithEvidence,
  openCase, recordConsult, sendReferral, timelineItem, writeAndSave,
} from './flows';

test('01. sign-in, wrong password, lead navigation, account creation and forced password change', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. Invalid login shows designed error message
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('lead_fatima@halqa.test');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Email or password is incorrect');

  // Axe on sign in
  await checkAxe(page, 'Sign in screen');
  await page.setViewportSize({ width: 1280, height: 850 });

  // 2. Sign in as Clinic Lead -> default view is Overview
  await page.getByLabel('Password', { exact: true }).fill(process.env.HALQA_E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  // Overview tab is active by default for lead
  await expect(page.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'How we are doing' })).toBeVisible();

  // 3. Lead navigates to Accounts tab
  await page.getByRole('button', { name: 'Accounts' }).click();
  await expect(page.getByRole('heading', { name: 'User accounts' })).toBeVisible();
  await checkAxe(page, 'Accounts screen');

  // 4. Lead creates a new account with temporary password
  const newEmail = `samira_${Date.now()}@halqa.test`;
  await page.getByRole('button', { name: 'Create new account' }).click();
  await page.getByLabel('Full name').fill('Samira Al Blooshi');
  await page.getByLabel('Email').fill(newEmail);
  await page.getByLabel('Role').selectOption('NAVIGATOR');
  await page.getByLabel('Organisation or clinic').fill('Al Bateen Healthcare');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Dialog shows the temporary password once
  await expect(page.getByText('Account for Samira Al Blooshi is ready')).toBeVisible();
  const tempPasswordElem = page.locator('.select-all');
  await expect(tempPasswordElem).toBeVisible();
  const tempPassword = (await tempPasswordElem.textContent())?.trim() || '';
  expect(tempPassword.length).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Done' }).click();

  // Verify account appears in list
  await expect(page.getByText(newEmail)).toBeVisible();

  // Sign out
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  // 5. Newly created user signs in with temporary password -> forced to set new password
  await login(page, newEmail, tempPassword);
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();

  // Trying too short password
  await page.getByLabel('Current password').fill(tempPassword);
  await page.getByLabel('New password (at least 12 characters)').fill('short');
  await page.getByLabel('Confirm new password').fill('short');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('at least 12 characters');

  // Setting valid new password >= 12 characters
  const realPassword = 'HalqaSecurePass2026!';
  await page.getByLabel('New password (at least 12 characters)').fill(realPassword);
  await page.getByLabel('Confirm new password').fill(realPassword);
  await page.getByRole('button', { name: 'Save new password' }).click();

  // Enters My Work!
  await expect(page.getByRole('heading', { name: /Good .*, Samira/ })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  // 6. Lead disables account and disabled account cannot log in
  await login(page, 'lead_fatima');
  await page.getByRole('button', { name: 'Accounts' }).click();
  const row = page.locator('li').filter({ hasText: newEmail });
  await row.getByRole('button', { name: 'Disable' }).click();
  await page.getByRole('button', { name: 'Disable account' }).click();
  await expect(row.getByText('Disabled')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  // Disabled user cannot sign in. The server gives the same answer as a wrong
  // password so sign-in never reveals which accounts exist or are disabled.
  await page.getByLabel('Email').fill(newEmail);
  await page.getByLabel('Password').fill(realPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Email or password is incorrect.');

  expect(errors).toEqual([]);
});

test('02. navigator my work, case page, interpreter toggle, delay reason, and responsive checks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Sign in as Navigator Reem
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'nav_reem');

  // 1. My work screen check
  await expect(page.getByRole('button', { name: 'My work' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: /Good .*, Reem/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Summary' }).getByText('Needs you now')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Summary' }).getByText('Late')).toBeVisible();

  await checkAxe(page, 'My work 1440px');

  // Tablet 768px
  await page.setViewportSize({ width: 768, height: 1024 });
  await shot(page, '11-22-my-work-768', 768);

  // 2. Open Case HQ-1003
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: /^Open /i }).first().click();

  // Case page elements
  await expect(page.getByText('Your next step', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^About /i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Something is slowing this down/i })).toBeVisible();

  // Toggle interpreter
  await page.getByRole('button', { name: 'Request', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Turn off', exact: true })).toBeVisible();

  // Record delay reason
  await page.getByRole('button', { name: 'Record a delay reason' }).click();
  await page.getByLabel('What is causing the delay?').selectOption('PATIENT_TRAVEL');
  await page.getByPlaceholder('Additional context about this delay').fill('Patient is travelling abroad until next month.');
  await page.getByRole('button', { name: 'Save reason' }).click();
  await expect(page.getByRole('complementary', { name: 'About Aisha' }).getByText('Patient is travelling abroad until next month.')).toBeVisible();

  await checkAxe(page, 'Case page 1440px');

  // Tablet 768px
  await page.setViewportSize({ width: 768, height: 1024 });
  await shot(page, '13-2-case-page-768', 768);

  await page.getByRole('button', { name: 'Sign out' }).click();
  expect(errors).toEqual([]);
});

test('03. specialist referrals, send back, overview, and approvals', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. Specialist Tariq
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'sp_tariq');
  await expect(page.getByRole('button', { name: 'Referrals' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Referrals' })).toBeVisible();

  await checkAxe(page, 'Referrals 1440px');

  // Tablet 768px
  await page.setViewportSize({ width: 768, height: 1024 });
  await shot(page, '13-138-referrals-768', 768);

  // 2. Sign out and sign in as Clinic Lead Fatima
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await login(page, 'lead_fatima');

  // Overview screen
  await expect(page.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'How we are doing' })).toBeVisible();
  await expect(page.getByText('Tests done on time')).toBeVisible();

  await checkAxe(page, 'Overview 1440px');

  // Tablet 768px
  await page.setViewportSize({ width: 768, height: 1024 });
  await shot(page, '14-203-overview-768', 768);

  // Approvals screen
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Approvals' }).click();
  await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible();
  await expect(page.getByText(/Waiting for your decision/)).toBeVisible();

  await checkAxe(page, 'Approvals 1440px');

  // Tablet 768px
  await page.setViewportSize({ width: 768, height: 1024 });
  await shot(page, '14-296-approvals-768', 768);

  await page.getByRole('button', { name: 'Sign out' }).click();
  expect(errors).toEqual([]);
});

test('04. patient phone portal at 390 and 320 px, quick check, steps, help and RTL Arabic', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await context.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));

  await login(p, 'patient_hq-1003');
  await p.locator('header select').selectOption('en');

  // 1. Result screen (P1)
  await expect(p.getByRole('heading', { name: 'Your screening result' })).toBeVisible();
  await expect(p.getByText('This is not a diagnosis.')).toBeVisible();
  await checkAxe(p, 'Patient result screen 390px');

  // 320px width
  await p.setViewportSize({ width: 320, height: 568 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  // The same result screen in Arabic, laid out right to left (P9), at both widths.
  await p.locator('header select').selectOption('ar');
  await expect(p.locator('div[dir="rtl"]')).toBeVisible();
  await expect(p.getByRole('heading', { name: 'نتيجتك في الفحص' })).toBeVisible();
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await p.setViewportSize({ width: 390, height: 844 });
  await expect(p.getByRole('heading', { name: 'نتيجتك في الفحص' })).toBeVisible();
  await p.locator('header select').selectOption('en');
  await expect(p.getByRole('heading', { name: 'Your screening result' })).toBeVisible();

  // 2. Quick check screen (P2)
  await p.setViewportSize({ width: 390, height: 844 });
  await p.getByRole('button', { name: 'Continue' }).click();
  await expect(p.getByRole('heading', { name: 'A quick check' })).toBeVisible();
  await checkAxe(p, 'Patient quick check 390px');

  // 320px width
  await p.setViewportSize({ width: 320, height: 568 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  // Complete quick check with correct answers (q1b, q2a, confidence 4)
  await p.getByText('It means we need a closer check. It is not a diagnosis.').click();
  await p.getByText('Follow the next step with my care team.').click();
  await p.getByRole('button', { name: '4', exact: true }).click();
  await p.getByRole('button', { name: 'Send my answers' }).click();

  // 3. All done screen (P3)
  await expect(p.getByText('Thank you')).toBeVisible();

  // 4. Steps screen (P4)
  await p.getByRole('button', { name: 'Your steps' }).click();
  await expect(p.getByRole('heading', { name: 'Your steps', level: 1 })).toBeVisible();
  await checkAxe(p, 'Patient steps 390px');

  // 5. Help screen (P6)
  await p.getByRole('button', { name: 'Help' }).click();
  await expect(p.getByRole('heading', { name: 'How can we help?' })).toBeVisible();
  await expect(p.getByRole('button', { name: 'Ask for a call back' })).toBeVisible();
  await p.getByRole('button', { name: 'Ask for a call back' }).click();
  await expect(p.getByRole('button', { name: 'Call requested' })).toBeVisible();
  await checkAxe(p, 'Patient help 390px');

  // 6. Switch to Arabic RTL (P9)
  await p.locator('header select').selectOption('ar');
  await expect(p.locator('div[dir="rtl"]')).toBeVisible();
  await expect(p.getByRole('heading', { name: 'كيف يمكننا مساعدتك؟' })).toBeVisible();
  await p.setViewportSize({ width: 320, height: 568 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  // 7. Security: Patient summary cannot see audit, other patients, or clinicians' messages
  const snap = await state(context);
  expect(snap.state.cases).toEqual([]);
  expect(JSON.stringify(snap.patient)).not.toContain('ECONSULT');

  await context.close();
  expect(errors).toEqual([]);
});


test('05. a new result goes through every step by clicking: call, quick check, consult, referral, booking, test, plan and close', async ({ browser, request }) => {
  const name = `Layla Fixture ${Date.now() % 100000}`;
  const first = name.split(' ')[0];
  const caseId = await intakeCase(request, { name, pcpId: 'pcp_mariam', pathwayId: 'CRC_FIT' });

  const lead = await session(browser, 'lead_fatima');
  const assigned = (await caseById(lead.context, caseId)).team.NAVIGATOR!.id;
  const patientAccount = await createPatientAccount(lead.context, caseId, name);

  const nav = await session(browser, assigned);
  const doc = await session(browser, 'pcp_mariam');
  const sp = await session(browser, 'sp_tariq');
  const patient = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await patient.newPage();
  await patientSignIn(p, patientAccount.email, patientAccount.temporaryPassword);

  // Until the care team tells the patient, the phone shows the waiting screen.
  await expect(p.getByRole('heading', { name: 'Your result is on its way' })).toBeVisible();

  // 1. The navigator phones the patient and records that the call got through.
  await nav.page.reload();
  await openCase(nav.page, name);
  await callPatientReached(nav.page, first);

  // 2. The patient now sees the result and answers the quick check.
  await expect(p.getByRole('heading', { name: 'Your screening result' })).toBeVisible({ timeout: 15000 });
  await answerQuickCheck(p);

  // 3. The doctor writes the consultation note and sends the referral.
  await doc.page.reload();
  await openCase(doc.page, name);
  await recordConsult(doc.page, 'We talked it through in person and agreed on a specialist visit.');
  await sendReferral(doc.page, first, 'A positive test needs a look inside the bowel.');

  // 4. The specialist accepts it on the Referrals screen.
  await sp.page.reload();
  await acceptReferral(sp.page, name);

  // 5. Staff book a real date and time. Patients do not choose a slot.
  await p.getByRole('button', { name: 'Your steps' }).click();
  await expect(p.getByText('Your navigator will call you to book a time.')).toBeVisible({ timeout: 15000 });
  await nav.page.reload();
  await openCase(nav.page, name);
  await bookAppointment(nav.page, await inputValueAfter(nav.page, await serverNow(lead.context), 30));
  await expect(p.getByRole('heading', { name: 'You are booked' })).toBeVisible({ timeout: 15000 });
  await expect(p.getByRole('button', { name: 'Add to my calendar' })).toBeVisible();

  // 6. The appointment day comes; the navigator records that the patient went.
  await advanceClock(lead.context, 1);
  await expect(nav.page.getByLabel('Note about the visit')).toBeVisible({ timeout: 15000 });
  await writeAndSave(nav.page, 'Note about the visit', 'Attended the colonoscopy appointment.', 'Mark as attended');
  await expect(timelineItem(nav.page, 'Test done')).toContainText('done');

  // 7. The specialist writes the test result and the care plan.
  await sp.page.reload();
  await sp.page.getByRole('button', { name: `Open ${name}` }).click();
  await writeAndSave(sp.page, 'What did the test show?', 'No growths found. Report RPT-FIXTURE-05.', 'Mark as done');
  await expect(timelineItem(sp.page, 'Test result written down')).toContainText('done');
  await writeAndSave(sp.page, 'What is the plan?', 'Back to routine screening in five years.', 'Mark as done');
  await expect(timelineItem(sp.page, 'Plan agreed')).toContainText('done');

  // 8. The doctor closes the case with the report as evidence.
  await doc.page.reload();
  await openCase(doc.page, name);
  await closeWithEvidence(doc.page, 'No growths found', 'RPT-FIXTURE-05', 'Back to routine screening in five years.');
  await expect(doc.page.getByRole('heading', { name: 'Closed', exact: true })).toBeVisible();

  // 9. The patient sees that every step is done and the case is reviewed.
  await expect.poll(async () => (await state(patient)).patient?.reviewed, { timeout: 15000 }).toBe(true);
  await p.getByRole('button', { name: 'Your steps' }).click();
  await expect(p.getByText('All your steps are done.')).toBeVisible({ timeout: 15000 });
  expect((await caseById(lead.context, caseId)).closure?.status).toBe('CLOSED');

  for (const who of [lead, nav, doc, sp]) await who.context.close();
  await patient.close();
});
