import { expect, test } from '@playwright/test';
import { quickAdd, signIn, startSignIn, uniqueEmail } from './helpers';

test('creates a task with natural-language Quick Add', async ({ page }) => {
  await signIn(page, uniqueEmail('create'));
  await page.goto('/app/inbox');
  await page.locator('body').press('q');
  await page.getByLabel('Describe the task').fill('Submit report every Friday at 4pm #work !high');
  // Live parsing chips before submitting.
  await expect(page.getByText('Every week on Fri')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('high');
  await page.keyboard.press('Enter');
  const row = page.getByRole('button', { name: /^Submit report, due/ });
  await expect(row).toBeVisible();
  await expect(page.locator('[data-task-id]').filter({ has: row }).getByText('#work')).toBeVisible();
  await row.click();
  await expect(page.getByLabel('Task title')).toHaveValue('Submit report');
  await expect(page.getByRole('combobox', { name: 'Repeat' })).toHaveValue('FREQ=WEEKLY;BYDAY=FR');
});

test('links a second device with approval and syncs changes in real time', async ({ browser }) => {
  const email = uniqueEmail('sync');
  const laptop = await (await browser.newContext()).newPage();
  const phone = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(laptop, email);
  // Approval of new sign-ins is opt-in.
  await laptop.goto('/app/settings');
  await laptop.getByRole('switch', { name: 'Require device approval' }).click();
  await expect(laptop.getByRole('switch', { name: 'Require device approval' })).toBeChecked();
  await laptop.goto('/app/reminders');

  // Second device: sensitive sign-in waits for approval on the first.
  await startSignIn(phone, email);
  await expect(phone.getByText('Approve on your other device')).toBeVisible();
  await expect(laptop.getByText('Approve new sign-in?')).toBeVisible();
  await laptop.getByRole('button', { name: 'Approve' }).click();
  await phone.waitForURL('**/app/reminders');

  // Both devices appear in Linked devices.
  await laptop.goto('/app/settings/devices');
  await expect(laptop.getByText('This device')).toBeVisible();
  await expect(laptop.locator('li', { hasText: 'Chrome on' })).toHaveCount(2);

  // A task created on the laptop shows up on the phone without reloading.
  await phone.goto('/app/inbox');
  await laptop.goto('/app/inbox');
  await quickAdd(laptop, 'Pack chargers for the trip');
  await expect(phone.getByRole('button', { name: /^Pack chargers for the trip/ })).toBeVisible();

  // Completing it on the phone updates the laptop.
  await phone.getByRole('checkbox', { name: 'Complete Pack chargers for the trip' }).click();
  await expect(laptop.getByRole('button', { name: /^Pack chargers for the trip/ })).toBeHidden();
});

test('schedules a task by dragging it onto the calendar', async ({ page }) => {
  await signIn(page, uniqueEmail('cal'));
  await page.goto('/app/inbox');
  await quickAdd(page, 'Draft quarterly plan');
  await page.goto('/app/calendar');
  const chip = page.getByRole('complementary', { name: 'Unscheduled tasks' }).getByRole('button', { name: 'Draft quarterly plan' });
  await expect(chip).toBeVisible();

  // Drop onto the third day column at 10:00 (48px per hour).
  const columns = page.locator('[class*="border-l"][style*="height: 1152px"]');
  const target = columns.nth(2);
  const box = (await target.boundingBox())!;
  const from = (await chip.boundingBox())!;
  // boundingBox() already reflects the grid's scroll position.
  const y = box.y + 10 * 48 + 4;
  await page.mouse.move(from.x + 20, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 30, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2, y, { steps: 20 });
  await page.mouse.up();

  await expect(chip).toBeHidden();
  const placed = target.getByRole('button', { name: 'Draft quarterly plan at 10:00' });
  await expect(placed).toBeVisible();
  await placed.click();
  // Time-blocking is available to everyone: the drop creates a 1-hour block, so it's due at the block's end.
  await expect(page.getByLabel('Due date', { exact: true })).toHaveValue(/T11:00$/);
});

test('acknowledging a reminder on one device dismisses it on the other', async ({ browser }) => {
  test.setTimeout(180_000);
  const email = uniqueEmail('ack');
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await signIn(a, email);
  await signIn(b, email);

  await a.goto('/app/today');
  await b.goto('/app/today');
  await quickAdd(a, 'Server alarm in 1 minute !critical');

  // The worker fires the reminder at its due time and both devices ring the full-screen alarm.
  const alarmA = a.getByRole('alertdialog');
  const alarmB = b.getByRole('alertdialog');
  await expect(alarmB.getByRole('heading', { name: /Server alarm/ })).toBeVisible({ timeout: 120_000 });
  await expect(alarmA).toBeVisible();

  // Marking it done on A stops the alarm on B instantly, and the task is done everywhere.
  await alarmA.getByRole('button', { name: 'Mark as done' }).click();
  await expect(alarmA).toBeHidden();
  await expect(alarmB).toBeHidden();
  await expect(b.getByRole('button', { name: /^Server alarm, due/ })).toBeHidden();
});

test('reminder form sets a reminder that rings as a full-screen alarm', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, uniqueEmail('alarm'));
  await page.locator('body').click();
  // Two minutes from now in the account's zone (UTC in tests).
  const due = new Date(Date.now() + 120_000);
  await page.getByRole('button', { name: 'New reminder' }).first().click();
  await page.getByLabel('What should I remind you about?').fill('Take medicine');
  await page.getByLabel('Date').fill(due.toISOString().slice(0, 10));
  await page.getByLabel('Time').fill(due.toISOString().slice(11, 16));
  await page.getByLabel('Sound', { exact: true }).selectOption('bell');
  await page.getByRole('button', { name: 'Set reminder' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Take medicine' })).toContainText('Bell');

  const alarm = page.getByRole('alertdialog');
  await expect(alarm).toBeVisible({ timeout: 200_000 });
  await expect(alarm.getByRole('heading', { name: 'Take medicine' })).toBeVisible();
  await alarm.getByRole('button', { name: 'Snooze 10m' }).click();
  await expect(alarm).toBeHidden();
});

test('daily checklist ticks items for today', async ({ page }) => {
  await signIn(page, uniqueEmail('checklist'));
  await page.goto('/app/checklist');
  for (const item of ['Drink water', 'Exercise']) {
    await page.getByLabel('New checklist item').fill(item);
    await page.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByRole('checkbox', { name: item })).toBeVisible();
  }
  await page.getByRole('checkbox', { name: 'Drink water' }).click();
  await expect(page.getByRole('checkbox', { name: 'Drink water' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('1 of 2 done')).toBeVisible();
});

test('reminder form adds early reminders and the list shows a countdown', async ({ page }) => {
  await signIn(page, uniqueEmail('early'));
  const due = new Date(Date.now() + 26 * 3_600_000); // tomorrow, ~26 h ahead (UTC in tests)
  await page.getByRole('button', { name: 'New reminder' }).first().click();
  await page.getByLabel('What should I remind you about?').fill('Doctor appointment');
  await page.getByLabel('Date').fill(due.toISOString().slice(0, 10));
  await page.getByLabel('Time').fill(due.toISOString().slice(11, 16));
  await page.getByRole('checkbox', { name: '1 hour early' }).click();
  await expect(page.getByRole('checkbox', { name: /1 hour early/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Set reminder' }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'Doctor appointment' });
  await expect(row).toContainText('also 1 hour early');
  await expect(row).toContainText(/in 1 day/);
});
