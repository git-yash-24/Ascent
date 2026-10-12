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

declare global {
  interface Window {
    __ascent?: { tapToStored: number[]; app: Controller };
  }
}

const STATUS: Record<SyncStatus, string> = { synced: '', saving: 'Saving', local: 'Saved here', unsaved: 'Not saved' };

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
  const kv = browserKV();
  const dev = deviceId(kv);
  const { backend, saver } = await capabilities();
  const store = new SyncedStore({ backend, kv, dev });
  const app = new Controller(store, kv, dev);
  window.__ascent = { tapToStored: [], app };

  const statusDot = h('span', { class: 'dot', 'aria-hidden': 'true' });
  const statusText = h('span', { class: 'status-text' });
  const status = h('span', { class: 'status', role: 'status', 'aria-live': 'polite' }, statusDot, statusText);
  const nav = h('a', { class: 'btn ghost nav', href: '#setup' }, 'Setup');
  const header = h('header', { class: 'top' }, h('span', { class: 'mark', text: 'Ascent' }), status, nav);
  const outlet = h('div', { class: 'outlet' });
  root.replaceChildren(header, outlet);

  const today = new TodayView(app);
  const setup = new SetupView(app, saver, __APP_VERSION__);
  let current: 'today' | 'setup' | 'welcome' | null = null;

  const route = (): 'today' | 'setup' => (location.hash.startsWith('#setup') ? 'setup' : 'today');

  const paint = (v: View, navigated = false): void => {
    const s = v.store.status;
    statusDot.dataset.s = s;
    statusText.textContent = v.store.offline ? 'Offline' : STATUS[s];
    status.hidden = s === 'synced' && !v.store.offline;
    if (v.firstRun) {
      if (current !== 'welcome') {
        outlet.replaceChildren(welcome(app));
        current = 'welcome';
      }
      nav.hidden = true;
      return;
    }
    nav.hidden = false;
    const want = route();
    nav.textContent = want === 'setup' ? 'Today' : 'Setup';
    nav.setAttribute('href', want === 'setup' ? '#today' : '#setup');
    if (want === 'today') {
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
  window.addEventListener('hashchange', () => paint(app.view(), true));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && route() === 'setup' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
      location.hash = '#today';
    }
  });

  // The day rolls only at the boundary, checked on a timer and whenever the app comes back.
  const check = (): void => app.checkDay();
  setInterval(check, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });

  paint(app.view());
  await store.open();
  check();
  paint(app.view());
}
