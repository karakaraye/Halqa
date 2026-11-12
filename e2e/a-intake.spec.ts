import { expect } from '@playwright/test';
import { test } from './helpers';
import { apiLogin, caseById, postResult, session } from './helpers';

/*
 * Runs before the other files on purpose. The new-result banner compares each case's opening time with the
 * workspace clock, and other journeys move that clock forward; the intake route stamps cases with real time.
 */


test('I1. a result sent to the intake route reaches the right navigator and the doctor within one poll', async ({ browser, request }) => {
  const reem = await session(browser, 'nav_reem');
  const joseph = await session(browser, 'nav_joseph');
  const doctor = await session(browser, 'pcp_mariam');
  const name = 'Amal Saleh';
  const newResult = (page: typeof reem.page) => page.getByText(`New result for ${name}. Open it?`);

  // A wrong key and a missing key are refused; nothing is created.
  expect((await postResult(request, { name }, 'not-the-key')).status()).toBe(401);
  expect((await request.post('/api/intake/results', { data: {} })).status()).toBe(401);

  const externalId = `LAB-${Date.now()}`;
  const first = await postResult(request, { name, externalId, pcpId: 'pcp_mariam' });
  expect(first.status()).toBe(201);
  const caseId = (await first.json()).caseId as string;

  // The case names its navigator; that navigator's screen announces it within a poll (3 seconds, with room to spare).
  const lead = await apiLogin(browser, 'lead_fatima');
  const opened = await caseById(lead, caseId);
  const assigned = opened.team.NAVIGATOR!;
  const mine = assigned.id === 'nav_reem' ? reem : assigned.id === 'nav_joseph' ? joseph : undefined;
  expect(mine, `the case went to ${assigned.name}, who is a signed-in navigator`).toBeTruthy();
  await expect(newResult(mine!.page)).toBeVisible({ timeout: 8000 });
  await expect(newResult(doctor.page)).toBeVisible({ timeout: 8000 });

  // It is on My work for the navigator and for the doctor.
  await mine!.page.getByRole('button', { name: 'Later', exact: true }).click();
  await expect(mine!.page.getByRole('button', { name: new RegExp(`^(Open|View) ${name}$`) })).toBeVisible();
  await expect(doctor.page.getByRole('button', { name: new RegExp(`^(Open|View) ${name}$`) })).toBeVisible();

  // "Open" in the banner goes straight to the case, which shows its navigator, doctor and the next step.
  await doctor.page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(doctor.page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(doctor.page.getByText('Your next step', { exact: true })).toBeVisible();
  await expect(doctor.page.getByRole('complementary')).toContainText(assigned.name);
  await expect(doctor.page.getByRole('complementary')).toContainText('Dr. Mariam Al Zaabi');
  expect(opened.steps.NOTIFY?.completedAt, 'the patient is not marked as told').toBeUndefined();

  // The same result sent again opens nothing new.
  const again = await postResult(request, { name, externalId, pcpId: 'pcp_mariam' });
  expect(again.status()).toBe(200);
  expect(await again.json()).toEqual({ caseId, created: false });

  for (const who of [reem, joseph, doctor]) await who.context.close();
  await lead.close();
});

