/**
 * End-to-end checks for the M8 beta page in a real browser (no world, device-only store).
 * X12 touch only, X13 a full day in under 10 s, X16 keyboard only, X17 every control named,
 * tap to stored under 100 ms, reload keeps the record, Setup flows, phone width.
 *
 * Run: npm run test:e2e   (builds first; uses CHROMIUM_PATH or /opt/pw-browsers/chromium)
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const html = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
let failures = 0;
const results = [];
async function test(name, fn) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Fonts cannot load in the sandbox; abort them so tests do not wait.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  try {
    await page.goto(url);
    await fn(page, ctx);
    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
    results.push(`  ok   ${name}`);
  } catch (e) {
    failures++;
    results.push(`  FAIL ${name}\n       ${String(e.message ?? e).split('\n').join('\n       ')}`);
    await page.screenshot({ path: `dist/e2e-fail-${name.replace(/\W+/g, '-')}.png`, fullPage: true }).catch(() => {});
  }
  await ctx.close();
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function start(page) {
  await page.getByRole('button', { name: 'Begin the climb' }).click();
  await page.getByRole('checkbox', { name: /Review mistakes/ }).waitFor();
}

await test('first launch to a working checklist', async (page) => {
  await page.getByRole('heading', { name: 'A year on the mountain' }).waitFor();
  await start(page);
  assert(await page.getByLabel(/Qbank, questions, target 50/).isVisible(), 'Qbank amount input missing');
});

await test('X12, X13: a full day by touch in under 10 s; tap to stored under 100 ms', async (page) => {
  await start(page);
  const t0 = Date.now();
  await page.getByRole('checkbox', { name: /Review mistakes/ }).tap();
  await page.getByRole('button', { name: /Set Qbank to the full 50/ }).tap();
  const elapsed = Date.now() - t0;
  assert(elapsed < 10_000, `took ${elapsed} ms`);
  assert((await page.getByRole('checkbox', { name: /Review mistakes/ }).getAttribute('aria-checked')) === 'true', 'Review mistakes not checked');
  assert((await page.locator('.habit[data-state="fulfilled"]').count()) === 2, 'not both fulfilled');
  const ms = await page.evaluate(() => window.__ascent.tapToStored);
  assert(ms.length >= 2 && Math.max(...ms) < 100, `tap to stored: ${ms.map((x) => x.toFixed(1)).join(', ')} ms`);
  assert((await page.locator('.coach').textContent()).includes('Camp is made'), 'coach line did not settle');
});

await test('X16: keyboard only: log both, change a value, reach Setup and back', async (page) => {
  await page.locator('#w-identity').focus();
  // Tab to the Begin button and press Enter.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if ((await page.evaluate(() => document.activeElement?.textContent)) === 'Begin the climb') break;
  }
  await page.keyboard.press('Enter');
  await page.getByRole('checkbox', { name: /Review mistakes/ }).waitFor();
  const focusOn = async (pred, label) => {
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(pred)) return;
    }
    throw new Error(`could not tab to ${label}`);
  };
  await focusOn(() => document.activeElement?.getAttribute('role') === 'checkbox', 'Review mistakes');
  await page.keyboard.press(' ');
  assert((await page.getByRole('checkbox', { name: /Review mistakes/ }).getAttribute('aria-checked')) === 'true', 'space did not log');
  await page.keyboard.press('Enter');
  assert((await page.getByRole('checkbox', { name: /Review mistakes/ }).getAttribute('aria-checked')) === 'false', 'enter did not undo');
  await page.keyboard.press(' ');
  await page.locator('body').click({ position: { x: 1, y: 1 } }).catch(() => {});
  await page.keyboard.press('Home');
  await focusOn(() => document.activeElement?.classList.contains('amount'), 'Qbank amount');
  await page.keyboard.type('30');
  await page.keyboard.press('Enter');
  assert((await page.locator('.habit[data-state="held"] .value').textContent()).startsWith('30 / 50'), 'typed value not held');
  // Skip menu by keyboard, Escape closes and returns focus.
  await focusOn(() => document.activeElement?.getAttribute('aria-label') === 'More options for Qbank', 'More for Qbank');
  await page.keyboard.press('Enter');
  assert(await page.getByRole('button', { name: 'Sick' }).first().isVisible(), 'skip menu did not open');
  await page.keyboard.press('Escape');
  assert((await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'More options for Qbank', 'focus not returned');
  // Setup and back with Escape.
  await focusOn(() => document.activeElement?.textContent === 'Setup', 'Setup link');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Setup', level: 1 }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: /Review mistakes/ }).waitFor();
});

await test('X17: every control has an accessible name; state is not colour alone', async (page) => {
  await start(page);
  for (const hash of ['#today', '#setup']) {
    await page.evaluate((h) => (location.hash = h), hash);
    await page.waitForTimeout(100);
    const unnamed = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('button, input, select, textarea, a[href]')) {
        if (el.closest('[hidden]') || el.type === 'hidden') continue;
        const name = (el.getAttribute('aria-label') || el.textContent || '').trim() || (el.labels && el.labels.length ? 'label' : '') || el.getAttribute('aria-labelledby');
        if (!name) bad.push(el.outerHTML.slice(0, 80));
      }
      return bad;
    });
    assert(unnamed.length === 0, `unnamed on ${hash}: ${unnamed.join(' | ')}`);
  }
  await page.evaluate(() => (location.hash = '#today'));
  await page.getByRole('checkbox', { name: /Review mistakes/ }).tap();
  const shape = await page.locator('.habit[data-state="fulfilled"] svg.g-fulfilled path').count();
  assert(shape === 1, 'fulfilled glyph has no tick shape');
});

await test('reload keeps the record, and the chosen day', async (page) => {
  await start(page);
  await page.getByRole('checkbox', { name: /Review mistakes/ }).tap();
  await page.getByLabel(/Qbank, questions/).fill('40');
  await page.getByLabel(/Qbank, questions/).press('Enter');
  await page.waitForTimeout(150);
  await page.reload();
  await page.getByRole('checkbox', { name: /Review mistakes/ }).waitFor();
  assert((await page.getByRole('checkbox', { name: /Review mistakes/ }).getAttribute('aria-checked')) === 'true', 'tick lost on reload');
  assert((await page.getByLabel(/Qbank, questions/).inputValue()) === '40', 'value lost on reload');
});

await test('yesterday can be logged from the day chips; older days point to Setup', async (page) => {
  await start(page);
  await page.getByRole('button', { name: /^Yesterday/ }).tap();
  assert((await page.locator('.logging-for').textContent()).startsWith('Logging for'), 'no logging-for line');
  // Habits created today are not due yesterday.
  assert((await page.locator('.habits .habit').count()) === 0, 'habits shown before they existed');
  await page.getByRole('button', { name: /^Today/ }).tap();
  assert((await page.locator('.habits .habit').count()) === 2, 'today rows missing');
});

await test('Setup: add, edit, archive, restore, correct the record', async (page) => {
  await start(page);
  await page.getByRole('link', { name: 'Setup' }).tap();
  await page.locator('details.add > summary').tap();
  const form = page.locator('details.add fieldset');
  await form.getByLabel('Name').fill('Anki');
  await form.getByLabel('Kind').selectOption('numeric');
  await form.getByLabel('Daily target').fill('100');
  await form.getByLabel('Unit').fill('cards');
  await form.getByLabel('When').selectOption('perWeek');
  await form.getByLabel('Times').fill('5');
  await page.getByRole('button', { name: 'Add habit' }).tap();
  await page.getByRole('button', { name: 'Edit Anki' }).waitFor();
  await page.getByRole('button', { name: 'Edit Anki' }).tap();
  await page.locator('.setup-habit fieldset').getByLabel('Daily target').fill('120');
  await page.getByRole('button', { name: 'Save changes' }).tap();
  assert((await page.locator('.setup-habit', { hasText: 'Anki' }).textContent()).includes('120 cards · 5 times a week'), 'edit not shown');
  await page.getByRole('button', { name: 'Archive Anki' }).tap();
  await page.getByRole('button', { name: 'Restore Anki' }).waitFor();
  await page.getByRole('button', { name: 'Restore Anki' }).tap();
  await page.getByRole('button', { name: 'Edit Anki' }).waitFor();
  // Correct the record: a future date is refused.
  await page.locator('#fix-date').fill('2099-01-01');
  await page.locator('#fix-value').fill('1');
  await page.getByRole('button', { name: 'Correct the record' }).tap();
  assert((await page.locator('.toast').textContent()).includes('not started'), 'future correction not refused');
  await page.getByRole('link', { name: 'Back to today' }).tap();
  assert((await page.locator('.habit', { hasText: 'Anki' }).textContent()).includes('0 of 5 this week'), 'quota line missing');
});

await test('phone width: nothing scrolls sideways', async (page) => {
  await start(page);
  for (const hash of ['#today', '#setup']) {
    await page.evaluate((h) => (location.hash = h), hash);
    await page.waitForTimeout(100);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(over <= 0, `${hash} overflows by ${over}px`);
  }
  await page.evaluate(() => (location.hash = '#today'));
  await page.screenshot({ path: 'dist/e2e-today.png', fullPage: true });
  await page.evaluate(() => (location.hash = '#setup'));
  await page.screenshot({ path: 'dist/e2e-setup.png', fullPage: true });
});

await browser.close();
server.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
