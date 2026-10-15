/**
 * The Ascent beta shell (M8): boot, routing, the header and its sync status.
 * The checklist is the one part that must always work, so it renders from the device copy
 * first and never waits on the world, the sound or the account.
 */
import { ArtifactDbBackend, type DbLike } from '../data/adapters/artifactDb';
import type { Backend } from '../data/backend';
import { newDeviceId } from '../data/codec';
import { SyncedStore, type SyncStatus } from '../data/store';
import { browserKV, type KV } from '../data/sync/journal';
import { Controller, type View } from '../ui/controller';
import { h } from '../ui/dom';
import { TodayView } from '../ui/checklist/today';
import { SetupView, type Saver } from '../ui/setup/setup';
import { welcome } from '../ui/welcome';
import { setMotionSetting } from '../ui/motion';
import { GameView, screenFromHash } from '../game/game';
import { appNow, setWarp, skipAhead, warpFromUrl, warpState } from '../core/time/appClock';
import { warpBar } from '../ui/warpBar';
import { setHemisphereFromZone } from '../game/conditions';

/** Every key a sandbox writes is kept apart from the real record's (`ascent:sandbox:` + key). */
function prefixedKV(kv: KV | null, prefix: string): KV | null {
  if (!kv) return null;
  return { get: (k) => kv.get(prefix + k), set: (k, v) => kv.set(prefix + k, v), remove: (k) => kv.remove(prefix + k) };
}

declare global {
  interface Window {
    __ascent?: { tapToStored: number[]; app: Controller };
  }
}

const STATUS: Record<SyncStatus, string> = { synced: '', saving: 'Saving', local: 'Saved on this device', unsaved: 'Not saved yet' };

function deviceId(kv: KV | null): string {
  try {
    const known = kv?.get('ascent:device');
    if (known) return known;
    const id = newDeviceId();
    kv?.set('ascent:device', id);
    return id;
  } catch {
    return newDeviceId();
  }
}

async function capabilities(): Promise<{ backend: Backend | null; saver: Saver }> {
  const none: Saver = { available: false, save: async () => false };
  const claude = window.claude;
  if (!claude) return { backend: null, saver: none };
  const [db, user, downloads] = await Promise.all([claude.use('db'), claude.use('user'), claude.use('downloads')]);
  let backend: Backend | null = null;
  if (db && user) {
    const id = await (user as { id(): Promise<string | null> }).id();
    if (id) backend = new ArtifactDbBackend(db as DbLike, id);
  }
  const dl = downloads as { save(r: { filename: string; data: string }): Promise<unknown> } | null;
  const saver: Saver = dl
    ? {
        available: true,
        save: async (filename, data) => {
          try {
            await dl.save({ filename, data });
            return true;
          } catch {
            return false;
          }
        },
      }
    : none;
  return { backend, saver };
}

export async function boot(root: HTMLElement): Promise<void> {
  // A speedrun (?warp=<speed>&from=<date>) or ?sandbox runs on simulated time in a separate,
  // local-only record: nothing it writes can reach the real one.
  const q = new URLSearchParams(location.search);
  const sandboxKv = prefixedKV(browserKV(), 'ascent:sandbox:');
  const resume = Number(sandboxKv?.get('warp:simAt') ?? NaN);
  const warp = warpFromUrl(location.search, Number.isFinite(resume) ? resume : null);
  const sandbox = warp !== null || q.has('sandbox');
  const kv = sandbox ? sandboxKv : browserKV();
  const dev = deviceId(kv);
  const caps = await capabilities();
  const backend = sandbox ? null : caps.backend;
  const saver = caps.saver;
  const store = new SyncedStore({ backend, kv, dev });
setHemisphereFromZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const app = new Controller(store, kv, dev, { now: appNow, zone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
  window.__ascent = { tapToStored: [], app };

  const statusDot = h('span', { class: 'dot', 'aria-hidden': 'true' });
  const statusText = h('span', { class: 'status-text' });
  const status = h('span', { class: 'status', role: 'status', 'aria-live': 'polite' }, statusDot, statusText);
  // In the game the link is a small gear; its name stays the visible word in plain mode.
  const navText = h('span', { class: 'nav-t', text: 'Setup' });
  const nav = h('a', { class: 'btn ghost nav', href: '#setup' }, gear(), navText);
  const skip = h('a', { class: 'skip-link', href: '#list' }, 'Open the plain checklist');
  const toGame = h('a', { class: 'btn ghost to-game', href: '#today' }, 'Game');
  const header = h('header', { class: 'top' }, skip, h('span', { class: 'mark', text: 'Ascent' }), status, toGame, nav);
  const outlet = h('div', { class: 'outlet' });
  root.replaceChildren(header, outlet);
  if (sandbox) {
    document.body.dataset.sandbox = 'true';
    if (warp) root.append(warpBar());
    // Hooks for the speedrun scripts (sandbox only): pause, jump, read simulated time.
    (window as unknown as { __warp: object }).__warp = { setWarp, skipAhead, appNow, warpState };
    window.setInterval(() => kv?.set('warp:simAt', String(appNow())), 2000);
  }

  let opened = false;
  const today = new TodayView(app);
  const setup = new SetupView(app, saver, __APP_VERSION__);
  const game = new GameView(app);
  let current: 'game' | 'today' | 'setup' | 'welcome' | null = null;

  // The game screen is home; #list is the plain checklist (keyboard, screen reader, no world).
  const route = (): 'game' | 'today' | 'setup' => (location.hash.startsWith('#setup') ? 'setup' : location.hash === '#list' ? 'today' : 'game');

  // Where Setup returns to: the plain checklist or the game screen last shown.
  let home = '#today';
  const paint = (v: View, navigated = false): void => {
    if (location.hash === '#home') history.replaceState(null, '', home);
    setMotionSetting(v.snapshot.profile?.settings.reducedMotion ?? false);
    const s = v.store.status;
    statusDot.dataset.s = s;
    statusText.textContent = v.store.offline ? 'Offline · saved on this device' : STATUS[s];
    // Words show, not only the dot, whenever the truth is anything but synced or a passing save.
    status.dataset.say = String(v.store.offline || s === 'local' || s === 'unsaved');
    status.hidden = s === 'synced' && !v.store.offline;
    if (v.firstRun) {
      // Decide only once the store has opened: a returning person's first paint must never
      // look like a first launch.
      if (!opened) return;
      document.body.dataset.mode = 'game';
      if (current !== 'welcome') {
        outlet.replaceChildren(game.root);
        game.mount('today');
        game.startOnboarding(welcome(app, (m) => game.preview(m)));
        current = 'welcome';
      }
      nav.hidden = true;
      toGame.hidden = true;
      skip.hidden = true;
      return;
    }
    nav.hidden = false;
    const want = route();
    document.body.dataset.mode = want;
    navText.textContent = want === 'setup' ? 'Back' : 'Setup';
    nav.setAttribute('href', want === 'setup' ? '#home' : '#setup');
    toGame.hidden = want !== 'today';
    toGame.setAttribute('href', `#${game.screen}`);
    skip.hidden = want !== 'game';
    if (want === 'game') {
      if (current !== 'game' || navigated) {
        if (current !== 'game' && current !== 'welcome') outlet.replaceChildren(game.root);
        current = 'game';
        game.mount(screenFromHash(location.hash) ?? game.screen);
      } else game.render(v);
    } else if (want === 'today') {
      if (current !== 'today') {
        outlet.replaceChildren(today.root);
        current = 'today';
      }
      today.render(v);
    } else {
      if (current !== 'setup' || navigated) {
        outlet.replaceChildren(setup.root);
        current = 'setup';
        setup.render(v, location.hash.startsWith('#setup-') ? location.hash.slice(1) : undefined);
      }
    }
  };

  app.onChange((v) => paint(v));
  window.addEventListener('hashchange', (e) => {
    const old = new URL(e.oldURL).hash;
    if (old && !old.startsWith('#setup') && old !== '#home') home = old;
    paint(app.view(), true);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && route() === 'setup' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
      location.hash = '#home';
    }
  });

  // The day rolls only at the boundary, checked on a timer and whenever the app comes back.
  const check = (): void => {
    app.checkDay();
    // M10: once a day, the record is checked against yesterday's (nothing lost, nothing changed).
    if (opened) app.trialCheck(__APP_VERSION__);
  };
  // On simulated time the boundary comes round fast: look every second.
  setInterval(check, warp ? 1000 : 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });

  paint(app.view());
  await store.open();
  opened = true;
  app.ensureWater();
  check();
  paint(app.view());
}

function gear(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'nav-gear');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M4 7h10M18 7h2M4 17h2M10 17h10M16 4.5v5M8 14.5v5');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.8');
  p.setAttribute('stroke-linecap', 'round');
  svg.append(p);
  return svg;
}
