// The speedrun in the real app: each persona lives UI_DAYS simulated days in a sandbox at
// UI_SPEED× (2880: a day in 30 seconds), world on, in their own time zone. Actions go through the
// interface (chips, options sheet, flask, journal, day picker, replay) at their simulated time;
// the few things the interface cannot reach quickly (corrections, habit edits) go through the
// app's controller. Records per-day state, frame times, sky and weather samples, console errors
// and screenshots. Usage: node tests/sim/ui-speedrun.mjs [personaId ...]
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const OUT = '.sim';
const SHOTS = `${OUT}/shots`;
mkdirSync(SHOTS, { recursive: true });
execFileSync('node_modules/.bin/esbuild', ['tests/sim/personas.ts', '--bundle', '--format=esm', `--outfile=${OUT}/personas.mjs`, '--log-level=error']);
const { PERSONAS } = await import(`../../${OUT}/personas.mjs`);

const DAYS = Number(process.env.UI_DAYS ?? 14);
const SPEED = Number(process.env.UI_SPEED ?? 2880);
const START = '2026-10-15';
const only = process.argv.slice(2);
const html = readFileSync('dist/index.html', 'utf8');
const server = createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html' });
  r.end(html);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

const addDays = (d, n) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const dowOf = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();

async function runPersona(p) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, timezoneId: p.zone, hasTouch: true, isMobile: true });
  // Keep the HUD awake (the run acts slower than a person would).
  await ctx.addInitScript(() => setInterval(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })), 1500));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push({ at: Date.now(), msg: String(e).slice(0, 300) }));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push({ at: Date.now(), msg: m.text().slice(0, 300) }));
  await page.route(/fonts\./, (r) => r.abort());
  await page.goto(`${base}?debug&warp=0&from=${START}T05:30`);
  await page.waitForFunction(() => window.__ascent && window.__warp);
  // Set the person up through the controller (the welcome form only offers the two starter habits).
  const started = await page.evaluate(({ name, habits, water }) => {
    const app = window.__ascent.app;
    const r = app.start({ identity: `${name}, a few small things a day`, habits: habits.map((h) => ({ name: h.name, definition: h.def })) });
    app.ensureWater();
    app.setWaterTarget(water);
    app.saveExpedition({ introOn: app.today });
    return r.ok;
  }, { name: p.name, habits: p.habits, water: p.water });
  if (!started) throw new Error(`${p.id}: start failed`);
  await page.goto(`${base}?debug&warp=0&from=${START}T05:30#today`);
  await page.locator('.gchip').first().waitFor({ timeout: 60_000 });

  const simNow = () => page.evaluate(() => window.__warp.appNow());
  const at = (date, minutes) => page.evaluate(({ date, minutes }) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d, 0, minutes).getTime(); }, { date, minutes });
  const pause = () => page.evaluate(() => window.__warp.setWarp(0));
  // Let simulated time run to `due`. If it stops moving (an import reloads the page, and the
  // reloaded sandbox starts paused), start it again rather than wait forever.
  const waitUntil = async (due) => {
    let last = -1;
    let still = 0;
    for (;;) {
      await page.waitForFunction(() => window.__warp, null, { timeout: 60_000 });
      const n = await simNow();
      if (n >= due) return;
      if (n === last && ++still >= 3) {
        await play();
        still = 0;
      }
      last = n;
      await page.waitForTimeout(Math.min(1500, Math.max(120, ((due - n) / SPEED) * 0.8)));
    }
  };
  const play = () => page.evaluate((s) => window.__warp.setWarp(s), SPEED);
  const rnd = (() => { let s = p.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0; return () => ((s = (Math.imul(s, 48271) >>> 0) % 2147483647) / 2147483647); })();

  const chip = (name) => page.locator('#s-today .gchip', { hasText: name }).first();
  const ui = { count: 0, api: 0, failed: [] };
  const onToday = async () => {
    if (!(await page.evaluate(() => location.hash === '#today'))) {
      await page.getByRole('button', { name: 'Today', exact: true }).click();
      await page.waitForFunction(() => location.hash === '#today');
    }
  };
  const optsFor = async (name) => {
    await onToday();
    const c = chip(name);
    if (!(await c.count())) throw new Error(`no chip ${name}`);
    await c.focus();
    await page.keyboard.press('Enter');
    await page.locator('dialog.opts[open]').waitFor({ timeout: 5000 });
    return page.locator('dialog.opts[open]');
  };
  const doEvent = async (e) => {
    switch (e.kind) {
      case 'open':
        return 'ui';
      case 'done': {
        const d = await optsFor(e.habit);
        await d.getByRole('button', { name: /^Mark done/ }).click();
        return 'ui';
      }
      case 'amount': {
        const d = await optsFor(e.habit);
        const input = d.locator('.opts-amount');
        if (await input.count()) {
          await input.fill(String(e.v));
          await input.press('Enter');
        } else await d.getByRole('button', { name: /^Mark done/ }).click();
        return 'ui';
      }
      case 'attempt': {
        const d = await optsFor(e.habit);
        await d.getByRole('button', { name: 'Attempted' }).click();
        return 'ui';
      }
      case 'skip': {
        const label = { rest: 'Rest day', sick: 'Sick', exam: 'Exam', night: 'Night duty', travel: 'Travel' }[e.reason] ?? 'Skip';
        const d = await optsFor(e.habit);
        await d.getByRole('button', { name: label, exact: true }).click();
        return 'ui';
      }
      case 'glass':
        await page.locator('.flask-btn').click();
        return 'ui';
      case 'note': {
        await page.getByRole('button', { name: 'Camp', exact: true }).click();
        await page.getByLabel('Today’s note').fill(e.text);
        await page.getByRole('button', { name: 'Save note' }).click();
        await onToday();
        return 'ui';
      }
      case 'replay': {
        await page.getByRole('button', { name: 'Week', exact: true }).click();
        const days = page.locator('#s-week .wd:not([disabled])');
        const n = await days.count();
        if (n) {
          await days.nth(Math.max(0, n - 1 - (e.daysAgo ?? 1))).click();
          await page.locator('.reel:not([hidden])').waitFor({ timeout: 5000 });
          const cards = [];
          for (let i = 0; i < 4; i++) {
            cards.push(await page.locator('.reel-card').textContent());
            await page.waitForTimeout(1300);
          }
          await page.keyboard.press('Escape');
          replays.push({ day: dayIndex, cards });
        }
        await onToday();
        return 'ui';
      }
      default: {
        // Through the controller: corrections, edits, archive, the day boundary, undo, round trip.
        const r = await page.evaluate((e) => {
          const app = window.__ascent.app;
          const v = app.view();
          const id = e.habit ? v.snapshot.habits.habits.find((h) => h.name === e.habit)?.id : undefined;
          const add = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
          switch (e.kind) {
            case 'unglass': return app.addGlass(-1);
            case 'backfill': { app.setViewDate(add(app.today, -(e.daysAgo ?? 1))); const r = e.v !== undefined ? app.setValue(id, e.v) : app.complete(id); app.setViewDate(app.today); return r; }
            case 'correct': return app.correct(add(app.today, -e.daysAgo), id, e.v === null ? null : { v: e.v });
            case 'edit': return app.editHabit(id, e.habit, e.def);
            case 'archive': return app.archive(id);
            case 'restore': return app.restore(id);
            case 'add': return app.addHabit(e.name, e.def);
            case 'remove': return app.remove(id, e.habit);
            case 'boundary': return app.saveProfile({ dayBoundary: e.minutes });
            case 'roundtrip': { const f = app.exportFiles('ui'); const p = app.prepareImport(f.json.data, 'ui'); if (!p.ok) return { ok: false, message: p.error }; app.applyImport(p.incoming); return { ok: true }; }
            case 'undo': return app.clearEntry(id);
            default: return { ok: true, skipped: e.kind };
          }
        }, e);
        if (r && r.ok === false) throw new Error(r.message);
        return 'api';
      }
    }
  };

  const days = [];
  const samples = [];
  const replays = [];
  let dayIndex = 0;
  const shotDays = new Set([0, Math.floor(DAYS / 2), DAYS - 1]);
  await play();
  const t0 = Date.now();
  for (let d = 0; d < DAYS; d++) {
    dayIndex = d;
    const date = addDays(START, d);
    const evs = p.plan(d, rnd, dowOf(date)).filter((e) => (e.dev ?? 0) === 0 && e.kind !== 'zone' && e.kind !== 'offline').sort((a, b) => a.t - b.t);
    const marks = [7 * 60, 13 * 60, 18 * 60 + 30, 22 * 60].map((m) => ({ t: m, kind: '__shot' }));
    const probes = [3, 9, 15, 21].map((h) => ({ t: h * 60, kind: '__probe' }));
    const queue = [...evs, ...(shotDays.has(d) ? marks : []), ...probes].sort((a, b) => a.t - b.t);
    const dayStartReal = Date.now();
    for (const e of queue) {
      const due = await at(date, e.t);
      // Let simulated time run until the event is due (the world keeps living meanwhile).
      await waitUntil(due);
      await pause();
      try {
        if (e.kind === '__shot') {
          await page.screenshot({ path: `${SHOTS}/${p.id}-d${String(d + 1).padStart(2, '0')}-${String(Math.floor(e.t / 60)).padStart(2, '0')}.png` });
        } else if (e.kind === '__probe') {
          samples.push(await page.evaluate((day) => {
            const s = window.__stage;
            const v = window.__ascent.app.view();
            const w = new Date(window.__warp.appNow());
            return { day, sim: w.toISOString(), localHour: w.getHours(), today: v.today, sunElev: s ? Math.round(s.sunElev * 10) / 10 : null, kind: s?.conditions?.kind ?? null, season: s?.conditions?.season ?? null, frameMs: s ? Math.round(s.frameMs) : null, tier: s?.tier ?? null };
          }, d));
        } else {
          if (process.env.TRACE) console.error(p.id, d, e.t, e.kind, e.habit ?? '');
          const how = await doEvent(e);
          if (how === 'api') ui.api++;
          else ui.count++;
        }
      } catch (err) {
        ui.failed.push({ day: d, event: e, error: String(err).slice(0, 200) });
        await page.keyboard.press('Escape').catch(() => {});
        await onToday().catch(() => {});
      }
      await play();
    }
    // The end of the day (23:58), then what the app says about it.
    const end = await at(date, 23 * 60 + 58);
    await waitUntil(end);
    days.push(await page.evaluate(({ d, date }) => {
      const v = window.__ascent.app.view();
      const dd = v.derived.days[date];
      return { day: d, date, today: v.today, outcome: dd?.outcome ?? null, progress: dd?.progress ?? null, storyDay: v.derived.storyDayEarned, stage: v.derived.climb.stage, water: v.derived.water?.today ?? null, status: v.store.status };
    }, { d, date }));
    days[days.length - 1].realSeconds = Math.round((Date.now() - dayStartReal) / 100) / 10;
  }
  const trial = await page.evaluate(() => window.__ascent.app.trialCheck('ui', true));
  const res = { persona: { id: p.id, name: p.name, zone: p.zone }, speed: SPEED, daysRun: DAYS, realMinutes: Math.round((Date.now() - t0) / 6000) / 10, ui, days, samples, replays, errors, trial: trial ? { days: trial.days.length, last: trial.days[trial.days.length - 1], findings: trial.findings } : null };
  writeFileSync(`${OUT}/ui-${p.id}.json`, JSON.stringify(res, null, 1));
  await ctx.close();
  return res;
}

for (const p of PERSONAS) {
  if (only.length && !only.includes(p.id)) continue;
  const t = Date.now();
  try {
    const r = await runPersona(p);
    console.log(`${p.id}: ${r.daysRun} days in ${r.realMinutes} min, ${r.ui.count} UI actions, ${r.ui.api} via controller, ${r.ui.failed.length} failed, ${r.errors.length} errors`);
  } catch (err) {
    console.log(`${p.id}: crashed after ${Math.round((Date.now() - t) / 1000)} s: ${String(err).slice(0, 300)}`);
    writeFileSync(`${OUT}/ui-${p.id}.json`, JSON.stringify({ persona: { id: p.id }, crashed: String(err) }, null, 1));
  }
}
await browser.close();
server.close();
