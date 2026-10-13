#!/usr/bin/env node
// End-to-end smoke test: boots the production build against a throwaway data dir
// and drives it with the locally installed Chrome. Run `npm run build` first.
//   npm run test:smoke            (HEADED=1 to watch)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright-core';

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-kanban-smoke-'));

const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  env: { ...process.env, DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => /ready|started|Local/i.test(d) && resolve());
  server.on('exit', (c) => reject(new Error(`server exited ${c}`)));
});

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED });
let failed = false;
const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  try { await fn(); console.log('ok'); } catch (e) { failed = true; console.log('FAILED'); throw e; }
};

try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  let boardUrl;

  await step('first run creates admin', async () => {
    await page.goto(BASE);
    await page.waitForURL('**/login');
    await page.getByPlaceholder('Username', { exact: true }).fill('admin');
    await page.getByPlaceholder('Password (8+ characters)').fill('correct-horse');
    await page.getByRole('button', { name: 'Create admin' }).click();
    await page.getByRole('heading', { name: 'Boards' }).waitFor();
  });

  await step('create board with default lists', async () => {
    await page.getByPlaceholder('New board title').fill('Smoke board');
    await page.getByRole('button', { name: 'Create board' }).click();
    await page.waitForURL('**/b/**');
    boardUrl = page.url();
    for (const t of ['To do', 'Doing', 'Done']) await page.locator('.list-head .title', { hasText: t }).waitFor();
  });

  const list = (title) => page.locator('section.list').filter({ has: page.locator('.list-head .title', { hasText: title }) });

  await step('add cards', async () => {
    await list('To do').getByRole('button', { name: '+ Add a card' }).click();
    const box = list('To do').getByPlaceholder('Card title…');
    await box.fill('First card');
    await box.press('Enter');
    await list('To do').locator('.card', { hasText: 'First card' }).waitFor();
    await box.fill('Second card');
    await box.press('Enter');
    await list('To do').locator('.card', { hasText: 'Second card' }).waitFor();
  });

  await step('rename list and add list', async () => {
    await list('Done').locator('.list-head .title').click();
    await page.locator('.list-head input').fill('Shipped');
    await page.locator('.list-head input').press('Enter');
    await list('Shipped').waitFor();
    await page.getByRole('button', { name: '+ Add a list' }).click();
    await page.getByPlaceholder('List title…').fill('Later');
    await page.getByRole('button', { name: 'Add list' }).click();
    await list('Later').waitFor();
  });

  await step('card description renders markdown + checklist badge', async () => {
    await page.locator('.card', { hasText: 'First card' }).click();
    await page.locator('.modal').waitFor();
    await page.locator('.description-view').click();
    await page.locator('.description-input').fill('Some **bold** text\n\n- [x] done item\n- [ ] open item');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('.description-view strong', { hasText: 'bold' }).waitFor();
    await page.locator('.card', { hasText: 'First card' }).getByText('☑ 1/2').waitFor();
  });

  await step('edit card title', async () => {
    const t = page.locator('.card-title-input');
    await t.fill('First card renamed');
    await t.press('Enter');
    await page.locator('.card', { hasText: 'First card renamed' }).waitFor();
  });

  await step('comments: add, edit, delete', async () => {
    await page.getByPlaceholder('Write a comment…').fill('Hello `world`');
    await page.getByRole('button', { name: 'Comment' }).click();
    await page.locator('.comment-text code', { hasText: 'world' }).waitFor();
    await page.locator('.comment').getByRole('button', { name: 'Edit' }).click();
    await page.locator('.comment textarea').fill('Edited comment');
    await page.locator('.comment').getByRole('button', { name: 'Save' }).click();
    await page.locator('.comment-text', { hasText: 'Edited comment' }).waitFor();
    await page.getByPlaceholder('Write a comment…').fill('Second comment');
    await page.getByRole('button', { name: 'Comment' }).click();
    await page.locator('.comment').nth(1).waitFor();
    page.once('dialog', (d) => d.accept());
    await page.locator('.comment', { hasText: 'Second comment' }).getByRole('button', { name: 'Delete' }).click();
    await page.locator('.comment', { hasText: 'Second comment' }).waitFor({ state: 'detached' });
  });

  let fileUrl;
  await step('upload attachment and download it', async () => {
    const pngPath = path.join(dataDir, 'pixel.png');
    fs.writeFileSync(pngPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    await page.locator('.dropzone input[type=file]').setInputFiles([pngPath]);
    await page.locator('.attachment', { hasText: 'pixel.png' }).waitFor();
    fileUrl = await page.locator('.attachment .info a').first().getAttribute('href');
    const res = await page.request.get(BASE + fileUrl);
    assert.equal(res.status(), 200);
    assert.equal(res.headers()['content-type'], 'image/png');
    assert.equal((await res.body()).length, fs.statSync(pngPath).size);
    await page.locator('.card', { hasText: 'First card renamed' }).getByText('📎 1').waitFor();
  });

  await step('due date', async () => {
    await page.locator('.modal input[type=date]').fill('2030-01-31');
    await page.locator('.card', { hasText: 'First card renamed' }).getByText('🗓').waitFor();
  });

  await step('move card via dropdown', async () => {
    await page.locator('.modal select').selectOption({ label: 'Shipped' });
    await list('Shipped').locator('.card', { hasText: 'First card renamed' }).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.modal').waitFor({ state: 'detached' });
  });

  await step('drag card between lists (and it persists)', async () => {
    await list('To do').locator('.card', { hasText: 'Second card' }).dragTo(list('Doing').locator('.list-cards'));
    await list('Doing').locator('.card', { hasText: 'Second card' }).waitFor();
    await page.waitForTimeout(500);
    await page.reload();
    await list('Doing').locator('.card', { hasText: 'Second card' }).waitFor();
  });

  await step('drag list to reorder (and it persists)', async () => {
    await list('Later').locator('.list-head').dragTo(list('To do').locator('.list-head'), { targetPosition: { x: 5, y: 10 } });
    await page.waitForTimeout(500);
    await page.reload();
    const titles = await page.locator('.list-head .title').allTextContents();
    assert.equal(titles[0], 'Later', `list order was ${titles}`);
  });

  await step('archive and restore card', async () => {
    await page.locator('.card', { hasText: 'Second card' }).click();
    await page.getByRole('button', { name: '🗄 Archive' }).click();
    await page.getByRole('button', { name: '↩ Restore' }).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.card', { hasText: 'Second card' }).waitFor({ state: 'detached' });
    await page.getByRole('link', { name: 'Archive (1)' }).click();
    await page.locator('.modal tr', { hasText: 'Second card' }).getByRole('button', { name: 'Restore' }).click();
    await page.getByRole('link', { name: 'Archive (0)' }).waitFor();
    await page.goto(boardUrl);
    await page.locator('.card', { hasText: 'Second card' }).waitFor();
  });

  await step('archive list, delete card forever', async () => {
    await list('Later').getByRole('button', { name: 'List menu' }).click();
    await page.getByRole('button', { name: 'Archive list' }).click();
    await list('Later').waitFor({ state: 'detached' });
    await page.locator('.card', { hasText: 'Second card' }).click();
    await page.getByRole('button', { name: '🗄 Archive' }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '🗑 Delete forever' }).click();
    await page.locator('.modal').waitFor({ state: 'detached' });
    await page.getByRole('link', { name: 'Archive (1)' }).waitFor();
  });

  await step('unauthenticated file access is refused', async () => {
    const anon = await browser.newContext();
    const res = await anon.request.get(BASE + fileUrl);
    assert.equal(res.status(), 404);
    await anon.close();
  });

  await step('admin creates a member; board visibility is per-member', async () => {
    await page.goto(`${BASE}/admin/users`);
    await page.getByPlaceholder('Username').fill('bob');
    await page.getByPlaceholder('Password (8+ characters)').fill('bob-password');
    await page.getByRole('button', { name: 'Create user' }).click();
    await page.getByText('Created bob.').waitFor();

    const bobCtx = await browser.newContext();
    const bob = await bobCtx.newPage();
    await bob.goto(`${BASE}/login`);
    await bob.getByPlaceholder('Username or email').fill('bob');
    await bob.getByPlaceholder('Password').fill('bob-password');
    await bob.getByRole('button', { name: 'Log in' }).click();
    await bob.getByRole('heading', { name: 'Boards' }).waitFor();
    assert.equal(await bob.locator('.board-tile').count(), 0);
    assert.equal((await bob.goto(boardUrl)).status(), 404);

    await page.goto(`${boardUrl}/settings`);
    await page.locator('select[name=username]').selectOption('bob');
    await page.getByRole('button', { name: 'Add member' }).click();
    await page.locator('td', { hasText: '@bob' }).waitFor();

    await bob.goto(BASE);
    await bob.locator('.board-tile', { hasText: 'Smoke board' }).waitFor();
    await bobCtx.close();
  });

  await step('wrong password rejected, logout/login works', async () => {
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.waitForURL('**/login');
    await page.getByPlaceholder('Username or email').fill('admin');
    await page.getByPlaceholder('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByText('Wrong username or password.').waitFor();
    await page.getByPlaceholder('Username or email').fill('admin');
    await page.getByPlaceholder('Password').fill('correct-horse');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('heading', { name: 'Boards' }).waitFor();
  });

  await step('WeKan/Meteor password hash logs in and is upgraded', async () => {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(path.join(dataDir, 'kanban.db'));
    const meteorHash = bcrypt.hashSync(crypto.createHash('sha256').update('wekan-pass').digest('hex'), 10);
    db.prepare("INSERT INTO users (id, username, password_hash, password_algo) VALUES ('m1', 'meteor', ?, 'meteor')").run(meteorHash);
    const c = await browser.newContext();
    const p = await c.newPage();
    await p.goto(`${BASE}/login`);
    await p.getByPlaceholder('Username or email').fill('meteor');
    await p.getByPlaceholder('Password').fill('wekan-pass');
    await p.getByRole('button', { name: 'Log in' }).click();
    await p.getByRole('heading', { name: 'Boards' }).waitFor();
    assert.equal(db.prepare("SELECT password_algo FROM users WHERE id = 'm1'").get().password_algo, 'bcrypt');
    db.close();
    await c.close();
  });
} finally {
  await browser.close();
  server.kill();
  if (!failed) fs.rmSync(dataDir, { recursive: true, force: true });
  else console.log(`data kept for inspection: ${dataDir}`);
}
console.log(failed ? '\nSMOKE TEST FAILED' : '\nAll smoke tests passed.');
process.exit(failed ? 1 : 0);
