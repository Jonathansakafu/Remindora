import { expect, test } from '@playwright/test';
import { quickAdd, signIn, startSignIn, uniqueEmail } from './helpers';

test('creates a task with natural-language Quick Add', async ({ page }) => {
  await signIn(page, uniqueEmail('create'));
  await page.goto('/app/inbox');
  await page.keyboard.press('n');
  await page.getByLabel('Describe the task').fill('Submit report every Friday at 4pm #work !high');
  // Live parsing chips before submitting.
  await expect(page.getByText('Every week on Fri')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('high');
  await page.keyboard.press('Enter');
  const row = page.getByRole('button', { name: /^Submit report, due/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('#work')).toBeVisible();
  await row.click();
  await expect(page.getByLabel('Task title')).toHaveValue('Submit report');
  await expect(page.getByRole('combobox', { name: 'Repeat' })).toHaveValue('FREQ=WEEKLY;BYDAY=FR');
});

test('links a second device with approval and syncs changes in real time', async ({ browser }) => {
  const email = uniqueEmail('sync');
  const laptop = await (await browser.newContext()).newPage();
  const phone = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(laptop, email);

  // Second device: sensitive sign-in waits for approval on the first.
  await startSignIn(phone, email);
  await expect(phone.getByText('Approve on your other device')).toBeVisible();
  await expect(laptop.getByText('Approve new sign-in?')).toBeVisible();
  await laptop.getByRole('button', { name: 'Approve' }).click();
  await phone.waitForURL('**/app/today');

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
  await expect(page.getByLabel('Due date', { exact: true })).toHaveValue(/T10:00$/);
});

test('acknowledging a reminder on one device dismisses it on the other', async ({ browser }) => {
  test.setTimeout(180_000);
  const email = uniqueEmail('ack');
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await signIn(a, email);
  await a.goto('/app/settings');
  await a.getByRole('switch', { name: 'Require device approval' }).click();
  await signIn(b, email);

  await a.goto('/app/today');
  await b.goto('/app/today');
  await quickAdd(a, 'Server alarm in 1 minute !critical');

  // The worker fires the critical reminder at its due time; device B gets the alert (toast with one-tap actions).
  await expect(b.getByRole('button', { name: 'Snooze 10m' })).toBeVisible({ timeout: 120_000 });
  await b.getByRole('button', { name: /^Notifications/ }).click();
  const itemOnB = b.getByRole('dialog').getByRole('listitem').filter({ hasText: 'Server alarm' }).filter({ has: b.getByRole('button', { name: /Complete/ }) });
  await expect(itemOnB).toBeVisible();

  await a.getByRole('button', { name: /^Notifications/ }).click();
  await a.getByRole('dialog').getByRole('listitem').filter({ hasText: 'Server alarm' }).first().getByRole('button', { name: /Complete/ }).click();

  // Resolved on A → B's copy loses its actions instantly, and the task is done everywhere.
  await expect(itemOnB).toHaveCount(0);
  await b.keyboard.press('Escape');
  await expect(b.getByRole('button', { name: /^Server alarm, due/ })).toBeHidden();
});
