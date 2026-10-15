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
const base = `http://127.0.0.1:${server.address().port}/`;
// Most tests run on the painted sky: software WebGL is too slow to share the main thread.
const url = `${base}?world=off`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
let failures = 0;
const results = [];
async function test(name, fn, opts = {}) {
  // ONLY=<part of a name> runs just the matching tests.
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  // The HUD hides after 4.5 s idle; most tests act slower than a person would, so a quiet key
  // keeps it awake unless the test is about the hiding itself.
  if (opts.idle !== true) await ctx.addInitScript(() => setInterval(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })), 1500));
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

/** Begin, then open the plain checklist (#list): the M8 contract still holds there. */
async function start(page) {
  await startGame(page);
  await page.evaluate(() => (location.hash = '#list'));
  await page.locator('.habit').first().waitFor();
}

/** Begin and stay on the game screen. */
async function startGame(page) {
  // With the world the opening scene plays first; Skip ends it and shows the card.
  await page.locator('.ob-skip:visible, .ob-card:not([hidden])').first().waitFor();
  if (await page.locator('.ob-skip').isVisible()) await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: 'Begin the climb' }).click();
  await page.locator('.gchip').first().waitFor();
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
  await page.locator('.gchip').first().waitFor();
  // The skip link opens the plain checklist.
  const first = await page.evaluate(() => document.querySelector('a[href], button, input, textarea, select')?.textContent);
  assert(first === 'Open the plain checklist', `first control is ${first}`);
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  await page.locator('.habit').first().waitFor();
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
  await page.locator('.habit').first().waitFor();
  assert((await page.evaluate(() => location.hash)) === '#list', 'Escape did not return to the checklist');
});

await test('X17: every control has an accessible name; state is not colour alone', async (page) => {
  await start(page);
  for (const hash of ['#list', '#camp', '#today', '#week', '#month', '#year', '#setup']) {
    await page.evaluate((h) => (location.hash = h), hash);
    await page.waitForTimeout(150);
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
  await page.evaluate(() => (location.hash = '#list'));
  await page.getByRole('checkbox', { name: /Review mistakes/ }).tap();
  const shape = await page.locator('.habit[data-state="fulfilled"] svg.g-fulfilled path').count();
  assert(shape === 1, 'fulfilled glyph has no tick shape');
});

await test('water: built in, one tap a glass, never moves the story', async (page) => {
  await start(page);
  await page.getByRole('heading', { name: 'Water' }).waitFor();
  await page.getByRole('button', { name: /Add a glass of water/ }).tap();
  await page.getByRole('button', { name: /Add a glass of water/ }).tap();
  assert((await page.locator('.water .val').textContent()) === '2 / 8 glasses', 'glasses not counted');
  assert((await page.locator('.water .cell.on').count()) === 2, 'bar not filled');
  assert((await page.locator('.water-line').textContent()).startsWith('Last glass'), 'no last-glass line');
  // Water alone does not start the story.
  assert((await page.locator('.stat .num').first().textContent()) === '0', 'water advanced the story');
  await page.getByRole('button', { name: 'Remove a glass' }).tap();
  assert((await page.locator('.water .val').textContent()) === '1 / 8 glasses', 'remove did not work');
  // Water is not in the habit list or the editable habits.
  assert((await page.locator('.habits .habit', { hasText: 'Water' }).count()) === 0, 'water listed as a habit');
  await page.getByRole('link', { name: 'Setup' }).tap();
  await page.locator('#water-target').fill('10');
  await page.getByRole('button', { name: 'Save', exact: true }).tap();
  await page.getByRole('link', { name: 'Back to today' }).tap();
  assert((await page.locator('.water .val').textContent()) === '1 / 10 glasses', 'water goal not applied');
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
  await form.getByLabel('What will you do?').fill('Anki');
  await form.getByLabel('A number').check();
  await form.getByLabel('How many each day?').fill('100');
  await form.getByLabel('Of what?').fill('cards');
  await form.getByLabel('Times a week').check();
  await form.getByLabel('How many times?').fill('5');
  await form.getByLabel('At a set time? (optional)').fill('07:30');
  await page.getByRole('button', { name: 'Add habit' }).tap();
  await page.getByRole('button', { name: 'Edit Anki' }).waitFor();
  await page.getByRole('button', { name: 'Edit Anki' }).tap();
  await page.locator('.setup-habit fieldset').getByLabel('How many each day?').fill('120');
  await page.getByRole('button', { name: 'Save changes' }).tap();
  assert((await page.locator('.setup-habit', { hasText: 'Anki' }).textContent()).includes('120 cards · 5 times a week'), 'edit not shown');
  await page.getByRole('button', { name: 'Archive Anki' }).tap();
  await page.getByRole('button', { name: 'Restore Anki' }).waitFor();
  await page.getByRole('button', { name: 'Restore Anki' }).tap();
  await page.getByRole('button', { name: 'Edit Anki' }).waitFor();
  // Correct the record (in Data): a future date is refused.
  await page.getByRole('button', { name: 'Data', exact: true }).tap();
  await page.locator('#fix-date').fill('2099-01-01');
  await page.locator('#fix-value').fill('1');
  await page.getByRole('button', { name: 'Correct the record' }).tap();
  assert((await page.locator('.toast').textContent()).includes('not started'), 'future correction not refused');
  await page.getByRole('link', { name: 'Back to today' }).tap();
  const anki = await page.locator('.habit', { hasText: 'Anki' }).textContent();
  assert(anki.includes('0 of 5 this week') && anki.includes('at 7:30 am'), `quota or time line missing: ${anki}`);
  // Timed habits come first.
  assert((await page.locator('.habits .habit .name').first().textContent()) === 'Anki', 'timed habit not first');
});

await test('phone width: nothing scrolls sideways', async (page) => {
  await start(page);
  for (const hash of ['#list', '#camp', '#today', '#week', '#month', '#year', '#setup']) {
    await page.evaluate((h) => (location.hash = h), hash);
    await page.waitForTimeout(150);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(over <= 0, `${hash} overflows by ${over}px`);
  }
  await page.evaluate(() => (location.hash = '#list'));
  await page.screenshot({ path: 'dist/e2e-list.png', fullPage: true });
  await page.evaluate(() => (location.hash = '#today'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'dist/e2e-today.png' });
  await page.evaluate(() => (location.hash = '#setup'));
  await page.screenshot({ path: 'dist/e2e-setup.png', fullPage: true });
});

// ---------- M9: the game screen ----------

const chip = (page, name) => page.locator('.gchip', { hasText: name });
async function hold(page, loc, ms) {
  const b = await loc.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

await test('game: lands on Today: the world fills the screen, a minimal glass checklist floats low', async (page) => {
  await startGame(page);
  assert((await page.evaluate(() => location.hash)) === '#today', 'not on #today');
  const vh = await page.evaluate(() => window.innerHeight);
  const world = await page.evaluate(() => Math.max(...[...document.querySelectorAll('canvas.world, .world-fallback')].map((e) => e.getBoundingClientRect().height)));
  assert(world / vh > 0.98, `world takes ${world / vh}`);
  const chipTop = (await page.locator('#s-today .gchip').first().boundingBox()).y;
  assert(chipTop / vh > 0.7, `checklist starts at ${chipTop / vh}`);
  assert((await page.locator('#s-today .gchip').count()) === 2, 'two chips expected');
  // Nothing else over the world: the day picker and water bar live below the fold.
  const headTop = (await page.locator('#s-today .sheet-head').boundingBox()).y;
  assert(headTop > vh, 'the day picker should be below the fold');
});

await test('game: the flask is on every screen; a tap is a glass, a hold offers removing one', async (page) => {
  await startGame(page);
  for (const name of ['Week', 'Camp']) {
    await page.getByRole('button', { name, exact: true }).click();
    assert(await page.locator('.flask-btn').isVisible(), `no flask on ${name}`);
  }
  await page.locator('.flask-btn').tap();
  await page.locator('.flask-btn').tap();
  assert((await page.locator('.flask-btn .flask-n').textContent()) === '2/8', 'glasses not counted');
  assert((await page.locator('.flask-btn').getAttribute('aria-label')).startsWith('Drink a glass of water. 2 of 8'), 'flask label not updated');
  assert((await page.locator('.game > .sr-only').textContent()).includes('Ari drinks'), 'no drink announcement');
  await hold(page, page.locator('.flask-btn'), 850);
  await page.getByRole('button', { name: 'Remove a glass' }).click();
  assert((await page.locator('.flask-btn .flask-n').textContent()) === '1/8', 'glass not removed');
});

await test('game: tapping a day on the week screen replays it, and it can be closed', async (page) => {
  await startGame(page);
  await hold(page, chip(page, 'Qbank'), 850);
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.waitForFunction(() => location.hash === '#week');
  await page.locator('#s-week .wd:not([disabled])').last().click();
  await page.locator('.reel:not([hidden])').waitFor();
  const first = await page.locator('.reel-card').textContent();
  assert(first.includes('Today, still being written'), `first card: ${first}`);
  await page.waitForTimeout(1400);
  const second = await page.locator('.reel-card').textContent();
  assert(second.includes('Qbank'), 'second card is not the habit');
  // Honest replay: the habit shows the time it was recorded, in the record's own clock.
  assert(/· \d\d:\d\d/.test(second), `no recorded time on the habit card: ${second}`);
  // A real modal: nothing behind it takes focus or keys.
  assert(await page.locator('.pager').evaluate((e) => e.inert), 'screens behind the replay are not inert');
  await page.keyboard.press('Alt+PageDown');
  assert((await page.evaluate(() => location.hash)) === '#week', 'Alt+PageDown changed screens behind the replay');
  await page.getByRole('button', { name: 'Close' }).click();
  assert(await page.locator('.reel').isHidden(), 'replay did not close');
  assert(!(await page.locator('.pager').evaluate((e) => e.inert)), 'screens stayed inert after the replay');
  // Escape closes it too.
  await page.locator('#s-week .wd:not([disabled])').last().click();
  await page.keyboard.press('Escape');
  assert(await page.locator('.reel').isHidden(), 'Escape did not close the replay');
});

await test('game: hold is done, hold again is empty; under 100 ms to stored', async (page) => {
  await startGame(page);
  await hold(page, chip(page, 'Review mistakes'), 850);
  assert((await chip(page, 'Review mistakes').getAttribute('data-state')) === 'fulfilled', 'hold did not mark done');
  assert(!(await page.locator('dialog.opts[open]').count()), 'hold opened the options');
  await hold(page, chip(page, 'Qbank'), 850);
  assert((await chip(page, 'Qbank').getAttribute('data-state')) === 'fulfilled', 'hold on an amount did not fill to target');
  assert((await chip(page, 'Qbank').textContent()).includes('50/50'), 'amount not shown');
  await hold(page, chip(page, 'Review mistakes'), 850);
  assert((await chip(page, 'Review mistakes').getAttribute('data-state')) === 'open', 'second hold did not empty');
  assert((await chip(page, 'Review mistakes').getAttribute('aria-label')).includes('not done'), 'state not in the name');
  const ms = await page.evaluate(() => window.__ascent.tapToStored);
  assert(ms.length >= 3 && Math.max(...ms) < 100, `hold to stored: ${ms.map((x) => x.toFixed(1)).join(', ')} ms`);
});

await test('game: a tap opens the options: amount, Mark done, attempted, rest; Undo puts back what was there', async (page) => {
  await startGame(page);
  // A short press is a tap: it never logs, it opens the sheet.
  await hold(page, chip(page, 'Qbank'), 250);
  await page.locator('dialog.opts[open]').waitFor();
  assert((await chip(page, 'Qbank').getAttribute('data-state')) === 'open', 'a tap logged something');
  await page.locator('dialog.opts .opts-amount').fill('10');
  await page.getByRole('button', { name: 'Save amount' }).click();
  assert((await chip(page, 'Qbank').textContent()).includes('10/50'), '0 → 10 not saved');
  await chip(page, 'Qbank').tap();
  assert((await page.locator('dialog.opts .opts-amount').inputValue()) === '10', 'editor does not show the total so far');
  await page.locator('dialog.opts .opts-amount').fill('12');
  await page.getByRole('button', { name: 'Save amount' }).click();
  assert((await chip(page, 'Qbank').textContent()).includes('12/50'), 'edit total not saved');
  // Cancel changes nothing.
  await chip(page, 'Qbank').tap();
  await page.getByRole('button', { name: 'Cancel' }).click();
  assert((await chip(page, 'Qbank').textContent()).includes('12/50'), 'cancel changed the amount');
  // Explicit Mark done, then Undo back to 12, not to empty.
  await chip(page, 'Qbank').tap();
  await page.getByRole('button', { name: /^Mark done/ }).click();
  assert((await chip(page, 'Qbank').textContent()).includes('50/50'), 'Mark done did not fill the target');
  await page.locator('.undo').getByRole('button', { name: 'Undo' }).click();
  assert((await chip(page, 'Qbank').textContent()).includes('12/50'), 'Undo did not restore 12');
  // Rest options and attempted on a yes-or-no habit.
  await chip(page, 'Review mistakes').tap();
  await page.getByRole('button', { name: 'Sick', exact: true }).click();
  assert((await chip(page, 'Review mistakes').getAttribute('data-state')) === 'skipped', 'sick not saved');
  assert((await chip(page, 'Review mistakes').textContent()).includes('Sick'), 'skip reason not shown');
  await chip(page, 'Review mistakes').tap();
  await page.getByRole('button', { name: 'Attempted' }).click();
  assert((await chip(page, 'Review mistakes').getAttribute('data-state')) === 'attempted', 'binary attempted not saved');
  await page.locator('.undo').getByRole('button', { name: 'Undo' }).click();
  assert((await chip(page, 'Review mistakes').getAttribute('data-state')) === 'skipped', 'Undo did not restore the sick day');
});

await test('game: keyboard: Enter opens the options with the amount ready; Mark done; Escape returns focus', async (page) => {
  await startGame(page);
  await chip(page, 'Review mistakes').focus();
  await page.keyboard.press('Enter');
  await page.locator('dialog.opts[open]').waitFor();
  assert((await page.evaluate(() => document.activeElement?.textContent)) === 'Mark done', 'Mark done not focused first');
  await page.keyboard.press('Enter');
  assert((await chip(page, 'Review mistakes').getAttribute('data-state')) === 'fulfilled', 'keyboard Mark done failed');
  assert((await page.evaluate(() => document.activeElement?.classList.contains('gchip'))), 'focus not returned to the chip');
  await chip(page, 'Qbank').focus();
  await page.keyboard.press('Enter');
  assert((await page.evaluate(() => document.activeElement?.classList.contains('opts-amount'))), 'amount not focused from the keyboard');
  await page.keyboard.type('30');
  await page.keyboard.press('Enter');
  assert((await chip(page, 'Qbank').textContent()).includes('30/50'), 'typed amount not saved');
  await page.keyboard.press('Shift+F10');
  await page.locator('dialog.opts[open]').waitFor();
  await page.keyboard.press('Escape');
  assert(!(await page.locator('dialog.opts[open]').count()), 'Escape did not close');
  assert((await page.evaluate(() => document.activeElement?.classList.contains('gchip'))), 'focus not returned after Escape');
});

await test('game: Mark done on one habit and straight away on the next (speedrun finding: the second sheet closed itself)', async (page) => {
  await startGame(page);
  for (const name of ['Review mistakes', 'Qbank']) {
    await chip(page, name).focus();
    await page.keyboard.press('Enter');
    await page.locator('dialog.opts[open]').waitFor();
    await page.locator('dialog.opts[open]').getByRole('button', { name: /^Mark done/ }).click({ timeout: 5000 });
    assert((await chip(page, name).getAttribute('data-state')) === 'fulfilled', `${name} not done`);
  }
});

await test('game: screens left to right are Camp, Today, Week, Month, Year', async (page) => {
  await startGame(page);
  const labels = await page.locator('.screen-btn').allTextContents();
  assert(labels.join(',') === 'Camp,Today,Week,Month,Year', `order ${labels}`);
  for (const [name, hash] of [['Week', '#week'], ['Month', '#month'], ['Year', '#year'], ['Camp', '#camp']]) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForFunction((h) => location.hash === h, hash);
  }
  // Swipe right to left from Camp lands on Today.
  const w = await page.evaluate(() => window.innerWidth);
  await page.locator('.pager').evaluate((p, x) => p.scrollTo({ left: x }), w);
  await page.waitForFunction(() => location.hash === '#today');
  assert(await page.locator('#s-today .gchip').first().isVisible(), 'Today not shown after swipe');
});

await test('game: base camp journal saves and survives a reload; leagues follow tags', async (page) => {
  await startGame(page);
  await hold(page, chip(page, 'Qbank'), 850);
  await page.getByRole('button', { name: 'Camp', exact: true }).click();
  assert((await page.getByRole('tab', { name: 'Journal' }).getAttribute('aria-selected')) === 'true', 'base camp should open on the journal');
  await page.getByLabel('Today’s note').fill('Did the qbank before lunch.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await page.waitForTimeout(150);
  await page.reload();
  await page.locator('.gchip').first().waitFor();
  assert((await page.evaluate(() => location.hash)) === '#camp', 'reload did not keep the screen');
  await page.getByRole('tab', { name: 'Journal' }).click();
  assert((await page.getByLabel('Today’s note').inputValue()) === 'Did the qbank before lunch.', 'note lost');
  await page.getByRole('tab', { name: 'Leagues' }).click();
  assert(await page.getByRole('article', { name: 'Medical exams league' }).isVisible(), 'no league for the tag group');
  await page.getByRole('tab', { name: 'Trophies' }).click();
  assert((await page.locator('.trophy.on').count()) >= 1, 'no trophy for showing up');
});

await test('game: the mark is optional, saved with the record, and asked once of an existing climber', async (page) => {
  await page.getByRole('radio', { name: 'Pine' }).check();
  await page.getByRole('radio', { name: 'Moss' }).check();
  await startGame(page);
  const ex = await page.evaluate(() => window.__ascent.app.view().snapshot.expedition);
  assert(ex.symbol === 'pine' && ex.accent === 'moss' && typeof ex.introOn === 'string', `expedition ${JSON.stringify(ex)}`);
  assert(!(await page.locator('.onboard').count()), 'the opening layer stayed up');
  // Someone who began before the opening existed: a short mark card, once.
  await page.evaluate(() => window.__ascent.app.saveExpedition({ introOn: null }));
  await page.getByRole('dialog', { name: 'Your mark' }).waitFor();
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.locator('.onboard').waitFor({ state: 'detached' });
  await page.reload();
  await page.locator('.gchip').first().waitFor();
  assert(!(await page.locator('.onboard').count()), 'asked again after Not now');
});

await test('game: the detail is a full-screen layer with its own title bar; the HUD steps aside', async (page) => {
  await startGame(page);
  await page.locator('#s-today').evaluate((p) => p.scrollTo({ top: p.scrollHeight }));
  await page.waitForFunction(() => document.querySelector('.game')?.dataset.lifted === 'true');
  const bar = await page.locator('#s-today .below-bar').boundingBox();
  assert(bar.y < 4, `title bar at ${bar.y}`);
  assert(await page.locator('.screens').evaluate((e) => e.inert), 'hidden tabs can still take focus');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.screens')).opacity === '0', null, { timeout: 3000 }).catch(() => {
    throw new Error('tabs still over the detail');
  });
  await page.locator('#s-today').getByRole('button', { name: 'Back to scene' }).click();
  await page.waitForFunction(() => document.querySelector('.game')?.dataset.lifted === 'false');
});

await test('Setup: change the mark and name; watch the opening again', async (page) => {
  await startGame(page);
  await page.getByRole('link', { name: 'Setup' }).click();
  await page.getByRole('button', { name: 'You & day', exact: true }).click();
  const sec = page.getByRole('region', { name: 'Your expedition' });
  await sec.getByRole('radio', { name: 'Star' }).check();
  await sec.getByLabel('Expedition name (optional)').fill('The long winter');
  await sec.getByRole('button', { name: 'Save mark' }).click();
  const ex = await page.evaluate(() => window.__ascent.app.view().snapshot.expedition);
  assert(ex.symbol === 'star' && ex.name === 'The long winter', `expedition ${JSON.stringify(ex)}`);
  await sec.getByRole('link', { name: 'Watch the opening again' }).click();
  await page.getByRole('dialog', { name: 'Your mark' }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.onboard').waitFor({ state: 'detached' });
  assert((await page.evaluate(() => window.__ascent.app.view().snapshot.expedition.symbol)) === 'star', 'mark lost after the opening');
});

await test('game: the HUD leaves the picture when idle; the waking touch presses nothing', async (page) => {
  await startGame(page);
  await page.waitForFunction(() => document.body.classList.contains('hud-idle'), null, { timeout: 8000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.screens')).opacity === '0', null, { timeout: 2000 });
  assert((await page.locator('.screens').evaluate((e) => getComputedStyle(e).pointerEvents)) === 'none', 'hidden tabs still take touches');
  assert(await page.locator('#s-today .gchip').first().isVisible(), 'habits hid with the HUD');
  // Touch exactly where the Week tab is: it wakes the HUD and changes nothing.
  const b = await page.getByRole('button', { name: 'Week', exact: true }).boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  assert(!(await page.evaluate(() => document.body.classList.contains('hud-idle'))), 'touch did not wake the HUD');
  assert((await page.evaluate(() => location.hash)) === '#today', 'the waking touch pressed a hidden tab');
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.waitForFunction(() => location.hash === '#week');
  // Keyboard focus in the controls keeps them up.
  await page.getByRole('button', { name: 'Today', exact: true }).focus();
  await page.keyboard.press('Shift');
  await page.waitForTimeout(5200);
  assert(!(await page.evaluate(() => document.body.classList.contains('hud-idle'))), 'HUD hid while a tab had keyboard focus');
}, { idle: true });

await test('game: habits are full-width rows, open first and done below, never moving under a finger', async (page) => {
  await startGame(page);
  const names = () => page.locator('#s-today .gchip .gchip-name').allTextContents();
  assert((await names()).join(',') === 'Qbank,Review mistakes', `start order ${await names()}`);
  const [a, b] = await Promise.all([chip(page, 'Qbank').boundingBox(), chip(page, 'Review mistakes').boundingBox()]);
  assert(Math.abs(a.width - b.width) < 1 && a.width > 300 && b.y > a.y + a.height - 1, 'rows are not full-width and stacked');
  // Hold Qbank to done: while the finger is still down, nothing moves.
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(850);
  assert((await chip(page, 'Qbank').getAttribute('data-state')) === 'fulfilled', 'hold did not complete');
  assert((await names()).join(',') === 'Qbank,Review mistakes', 'rows moved under the finger');
  await page.mouse.up();
  // Once released and settled, done goes below.
  await page.waitForFunction(() => [...document.querySelectorAll('#s-today .gchip-name')].map((e) => e.textContent).join(',') === 'Review mistakes,Qbank', null, { timeout: 3000 });
  await page.locator('.undo').getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('#s-today .gchip-name')].map((e) => e.textContent).join(',') === 'Qbank,Review mistakes', null, { timeout: 3000 });
});

await test('Setup: one part at a time; deep links open the right part; the Lab stays hidden until asked for', async (page) => {
  await startGame(page);
  await page.getByRole('link', { name: 'Setup' }).click();
  assert(await page.getByRole('region', { name: 'Habits' }).isVisible(), 'Habits not the first part');
  assert(!(await page.getByRole('region', { name: 'Backup' }).count()), 'every part shown at once');
  await page.evaluate(() => (location.hash = '#setup-backup'));
  await page.getByRole('region', { name: 'Backup' }).waitFor();
  assert((await page.getByRole('button', { name: 'Data', exact: true }).getAttribute('aria-pressed')) === 'true', 'deep link did not select Data');
  await page.getByRole('button', { name: 'About', exact: true }).click();
  assert(!(await page.getByRole('link', { name: 'Open the Environment Lab' }).count()), 'Lab visible before unlock');
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: /^Ascent / }).click();
  await page.getByRole('link', { name: 'Open the Environment Lab' }).waitFor();
});

await test("Setup: Ari's light and shake are this device's choices; they never touch the record", async (page) => {
  await startGame(page);
  const before = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter((k) => !k.startsWith('ascent:world') && !k.startsWith('ascent:trial')).sort().map((k) => [k, localStorage.getItem(k)])));
  await page.evaluate(() => (location.hash = '#setup-settings'));
  await page.getByText('The world (this device)').waitFor();
  assert(await page.getByLabel('Lantern').isChecked(), 'lantern is not the default');
  assert(!(await page.getByLabel('Shake the phone to stir the world').isChecked()), 'shake should start off');
  await page.getByLabel('Glow stick').check();
  await page.getByLabel('Shake the phone to stir the world').check();
  await page.reload();
  await page.evaluate(() => (location.hash = '#setup-settings'));
  await page.getByText('The world (this device)').waitFor();
  assert(await page.getByLabel('Glow stick').isChecked(), 'light choice not kept');
  assert(await page.getByLabel('Shake the phone to stir the world').isChecked(), 'shake choice not kept');
  const after = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter((k) => !k.startsWith('ascent:world') && !k.startsWith('ascent:trial')).sort().map((k) => [k, localStorage.getItem(k)])));
  assert(before === after, 'the world choices changed the stored record');
});

await test('M10: the 14-day check reads the record daily and reports nothing lost', async (page) => {
  await startGame(page);
  await hold(page, chip(page, 'Qbank'), 850);
  await page.evaluate(() => (location.hash = '#setup-trial'));
  const box = page.getByRole('region', { name: 'The 14-day check' });
  await box.waitFor();
  assert((await box.textContent()).includes('Checked on 1 of 14 days'), `not checked: ${await box.textContent()}`);
  await box.getByRole('button', { name: 'Check now' }).click();
  const text = await box.textContent();
  assert(text.includes('Nothing lost, nothing changed without an edit'), `check did not pass: ${text}`);
});

await test('water close-up: count, the time of each glass, remove with Undo', async (page) => {
  await startGame(page);
  await page.locator('.flask-btn').tap();
  await page.locator('.flask-btn').tap();
  await hold(page, page.locator('.flask-btn'), 850);
  const sheet = page.getByRole('dialog', { name: 'Water' });
  await sheet.waitFor();
  assert((await sheet.locator('.flask-big').textContent()).includes('2 of 8'), 'count missing');
  const times = await sheet.locator('.flask-times').textContent();
  assert(/Glasses at .*\d.*·.*\d/.test(times), `times missing: ${times}`);
  assert(!/ml/.test(await sheet.textContent()), 'ml shown with no glass size set');
  await sheet.getByRole('button', { name: 'Remove a glass' }).click();
  assert((await sheet.locator('.flask-big').textContent()).includes('1 of 8'), 'remove did not count');
  await sheet.getByRole('button', { name: 'Undo' }).click();
  assert((await sheet.locator('.flask-big').textContent()).includes('2 of 8'), 'undo did not restore');
  await sheet.getByRole('button', { name: 'Close' }).click();
  assert((await page.locator('.flask-btn .flask-n').textContent()) === '2/8', 'corner count wrong');
});

await test('world: the flask is in view and clear of the controls on Today and Camp (with the world)', async (page) => {
  await page.goto(`${base}?debug`);
  await startGame(page);
  const where = () =>
    page.evaluate(() => {
      const s = window.__stage;
      const v = s.flask.getWorldPosition(s.camera.position.clone());
      v.project(s.camera);
      const r = document.querySelector('canvas.world').getBoundingClientRect();
      const compact = document.querySelector('.panel:not([inert]) .compact')?.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, front: v.z < 1, w: innerWidth, h: innerHeight, controls: compact?.top ?? innerHeight };
    });
  for (const screen of ['Today', 'Camp']) {
    await page.getByRole('button', { name: screen, exact: true }).click();
    await page.waitForTimeout(5000);
    const p = await where();
    assert(p.front && p.x > 20 && p.x < p.w - 20 && p.y > 60 && p.y < p.controls - 10, `${screen}: flask at ${Math.round(p.x)},${Math.round(p.y)} (controls from ${Math.round(p.controls)})`);
  }
});

await test('world: sliders for time, season, weather and moon preview the world and write nothing (with the world)', async (page) => {
  await page.goto(`${base}?debug`);
  await startGame(page);
  const before = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter((k) => !k.startsWith('ascent:world') && !k.startsWith('ascent:trial')).sort().map((k) => [k, localStorage.getItem(k)])));
  await page.evaluate(() => (location.hash = '#setup-settings'));
  await page.getByRole('link', { name: 'Preview time, season and weather' }).click();
  await page.locator('.lab').waitFor();
  await page.locator('#lab-time').fill('17.5');
  await page.locator('#lab-season').fill('4');
  await page.locator('#lab-weather').fill('12');
  await page.locator('#lab-moon').fill('14.75');
  const p = await page.evaluate(() => {
    const s = window.__stage;
    return { ...s.previewing, kind: s.conditions.kind, season: s.conditions.season };
  });
  assert(p.hour === 17.5 && p.season === 'winter' && p.kind === 'blizzard' && p.moon === 14.75, `previews not applied: ${JSON.stringify(p)}`);
  assert((await page.locator('label[for="lab-moon"] output').textContent()).includes('Full moon'), 'moon phase not named');
  const lab = page.locator('.lab');
  await lab.getByRole('button', { name: 'Hide' }).click();
  assert(await page.locator('.lab-body').isHidden(), 'the panel did not fold');
  await lab.getByRole('button', { name: 'Show' }).click();
  await lab.getByRole('button', { name: 'Back to live' }).click();
  const q = await page.evaluate(() => window.__stage.previewing);
  assert(q.hour === null && q.kind === null && q.season === null && q.moon === null, 'Back to live left a preview');
  const after = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter((k) => !k.startsWith('ascent:world') && !k.startsWith('ascent:trial')).sort().map((k) => [k, localStorage.getItem(k)])));
  assert(before === after, 'previewing changed the stored record');
});

await test('game: closing the day plays the reward and says so (with the world)', async (page) => {
  await page.goto(base);
  await startGame(page);
  assert(await page.locator('canvas.world').isVisible(), 'the world did not start');
  // Keyboard: software WebGL stalls the main thread too much for timed holds.
  for (const name of ['Review mistakes', 'Qbank']) {
    await chip(page, name).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^Mark done/ }).click();
  }
  await page.waitForFunction(() => document.querySelector('.game > .sr-only')?.textContent?.includes('Camp is made'), null, { timeout: 60_000, polling: 500 });
  assert((await page.locator('#s-today .coach').textContent()).includes('Camp is made'), 'caption did not change');
});

await browser.close();
server.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
