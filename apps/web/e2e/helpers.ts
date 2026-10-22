import { expect, type Page } from '@playwright/test';
import Redis from 'ioredis';
import { E2E_ENV } from '../playwright.config';

const redis = new Redis(E2E_ENV.REDIS_URL!, { lazyConnect: true });

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@e2e.test`;
}

/** Reads the latest sign-in code mailed to `email` (test-only mail sink in Redis). */
export async function latestCode(email: string): Promise<string> {
  if (redis.status === 'wait') await redis.connect();
  for (let i = 0; i < 50; i++) {
    const raw = await redis.lindex(`test:mail:${email}`, 0);
    const code = raw ? (JSON.parse(raw) as { text: string }).text.match(/\b(\d{6})\b/)?.[1] : undefined;
    if (code) return code;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no code for ${email}`);
}

export async function startSignIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: /email me a sign-in code/i }).click();
  await expect(page.getByLabel('Verification code')).toBeVisible();
  await page.getByLabel('Verification code').fill(await latestCode(email));
}

export async function signIn(page: Page, email: string) {
  await startSignIn(page, email);
  await page.waitForURL('**/app/today');
}

export async function quickAdd(page: Page, text: string) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^add task/i }).first().click();
  await page.getByLabel('Describe the task').fill(text);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Describe the task')).toBeHidden();
}
