import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const PROOF = path.join(ROOT, 'proof');

/** Loads the app in test mode (no render loop) and waits for window.__app. */
export async function openApp(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/?test=1');
  await page.waitForFunction(() => (window as unknown as { __app?: { ready: boolean } }).__app?.ready, null, { timeout: 120_000 });
  return errors;
}

export function saveDataUrl(file: string, dataUrl: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

// Untyped handle to the in-page driver; tests call it inside page.evaluate.
export type App = Record<string, (...args: any[]) => any> & { [k: string]: any };
