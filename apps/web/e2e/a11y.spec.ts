import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { quickAdd, signIn, uniqueEmail } from './helpers';

/** WCAG 2.1 AA audit of the main screens (dark theme, light theme and mobile width). */
const PAGES = ['/app/today', '/app/inbox', '/app/upcoming', '/app/calendar', '/app/focus', '/app/habits', '/app/analytics', '/app/countdowns', '/app/matrix', '/app/settings', '/app/settings/notifications', '/app/settings/devices', '/app/settings/billing'];

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = serious.map((v) => `${label} ${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n  ')}`);
  return summary;
}

test('login page has no serious accessibility violations', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').waitFor();
  expect(await audit(page, '/login')).toEqual([]);
});

test('about page has no serious accessibility violations', async ({ page }) => {
  await page.goto('/about');
  await page.getByRole('heading', { name: 'Jonathan Sakafu' }).waitFor();
  expect(await audit(page, '/about')).toEqual([]);
});

test('main screens have no serious accessibility violations', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail('a11y'));
  await quickAdd(page, 'Review pull requests tomorrow 10am #eng !high');
  const problems: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    problems.push(...(await audit(page, path)));
  }
  // Task detail panel.
  await page.goto('/app/upcoming');
  await page.getByRole('button', { name: /^Review pull requests/ }).click();
  await page.getByLabel('Task title').waitFor();
  problems.push(...(await audit(page, 'task-detail')));
  // Light theme.
  await page.evaluate(() => (document.documentElement.dataset.theme = 'daybreak'));
  await page.goto('/app/today');
  await page.evaluate(() => (document.documentElement.dataset.theme = 'daybreak'));
  await page.waitForTimeout(300);
  problems.push(...(await audit(page, 'daybreak/today')));
  expect(problems, problems.join('\n')).toEqual([]);
});

test('mobile layout has no serious accessibility violations', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await signIn(page, uniqueEmail('a11y-m'));
  await page.waitForTimeout(800);
  expect(await audit(page, 'mobile/today')).toEqual([]);
});
