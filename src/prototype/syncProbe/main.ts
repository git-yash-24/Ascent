/**
 * M6 sync probe: answers the spec's three prototype questions on a real phone, using the real
 * store, journal and artifact database adapter.
 *   1. How long does a merge write take to confirm on mobile data?
 *   2. Does a journal entry written offline survive a restart and sync once online?
 *   3. Does browser storage persist across Claude app restarts?
 */
import { logicalDay } from '../../core/model/date';
import { emptySnapshot } from '../../core/model/snapshot';
import { entryOn } from '../../core/model/entries';
import { ArtifactDbBackend, type DbLike } from '../../data/adapters/artifactDb';
import type { Backend } from '../../data/backend';
import { newDeviceId } from '../../data/codec';
import { SyncedStore, type StoreState, type SyncStatus } from '../../data/store';
import { browserKV, JOURNAL_KEY, type KV } from '../../data/sync/journal';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const STATUS_TEXT: Record<SyncStatus, string> = {
  synced: 'Synced',
  saving: 'Saving…',
  local: 'Saved here',
  unsaved: 'Not saved yet',
};

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const today = (): string => logicalDay(new Date(), zone, 240);

interface DeviceInfo {
  dev: string;
  firstSeen: number;
  opens: number;
}

function deviceInfo(kv: KV | null): DeviceInfo {
  const fresh: DeviceInfo = { dev: newDeviceId(), firstSeen: Date.now(), opens: 1 };
  if (!kv) return fresh;
  try {
    const raw = kv.get('ascent:probe:device');
    const prev = raw ? (JSON.parse(raw) as DeviceInfo) : null;
    const info = prev ? { ...prev, opens: prev.opens + 1 } : fresh;
    kv.set('ascent:probe:device', JSON.stringify(info));
    return info;
  } catch {
    return fresh;
  }
}

function pendingAtOpen(kv: KV | null): number {
  try {
    const raw = kv?.get(JOURNAL_KEY);
    const ops: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ops) ? ops.length : 0;
  } catch {
    return 0;
  }
}

async function connect(): Promise<{ backend: Backend | null; why: string }> {
  const claude = window.claude;
  if (!claude) return { backend: null, why: 'Not running inside a Claude artifact viewer.' };
  const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
  if (!db) return { backend: null, why: 'The synced store is not available in this view.' };
  const id = user ? await (user as { id(): Promise<string | null> }).id() : null;
  if (!id) return { backend: null, why: 'No signed-in user id, so there is no private store.' };
  return { backend: new ArtifactDbBackend(db as DbLike, id), why: '' };
}

const latencies: number[] = [];
let lines = { r1: '', r2: '', r3: '', env: '' };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

function renderReport(): void {
  $('report').textContent = [
    'Ascent sync probe',
    lines.env,
    `Test 1: ${lines.r1 || 'not run'}`,
    `Test 2: ${lines.r2 || 'not run'}`,
    `Test 3: ${lines.r3 || 'not run'}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const kv = browserKV();
  const info = deviceInfo(kv);
  const waiting = pendingAtOpen(kv);

  lines.r3 = kv
    ? `device ${info.dev}, opened ${info.opens} time${info.opens === 1 ? '' : 's'}, first seen ${new Date(info.firstSeen).toLocaleString()}`
    : 'device storage unavailable in this view';
  $('r3').textContent = kv
    ? `Device id   ${info.dev}\nOpen count  ${info.opens}\nFirst seen  ${new Date(info.firstSeen).toLocaleString()}`
    : 'Device storage is not available here (private window or blocked). Offline copies cannot be kept.';

  const { backend, why } = await connect();
  lines.env = `${navigator.userAgent.slice(0, 120)}\nstore: ${backend ? 'artifact db' : `none (${why})`}`;
  const store = new SyncedStore({ backend, kv, dev: info.dev });

  const paint = (s: StoreState): void => {
    $('dot').dataset.s = s.status;
    $('statusText').textContent = s.offline ? `${STATUS_TEXT[s.status]} · offline` : STATUS_TEXT[s.status];
    $('meta').textContent = backend ? `${Object.keys(s.snapshot.logs).length} month(s)` : 'device only';
  };
  store.onChange(paint);
  await store.open();
  paint(store.current);

  // The probe habit, created once.
  const s0 = store.current.snapshot;
  if (!s0.habits.habits.some((h) => h.id === 'probe')) {
    const day = today();
    store.putDoc('habits', {
      ...emptySnapshot().habits,
      habits: [
        {
          id: 'probe',
          name: 'Probe',
          category: 'test',
          createdOn: day,
          versions: [{ from: day, type: 'binary', target: 1, minimum: 1, schedule: { kind: 'daily' } }],
        },
      ],
    });
  }

  if (waiting > 0) {
    $('r2').textContent = `${waiting} change(s) were waiting in this device's journal from the last visit.\nSyncing now…`;
    const done = (): void => {
      const ok = store.current.status === 'synced';
      lines.r2 = ok ? `PASS: ${waiting} offline change(s) survived the restart and synced` : `waiting: ${STATUS_TEXT[store.current.status]}`;
      $('r2').innerHTML = ok
        ? `<span class="pass">Pass.</span> ${waiting} change(s) made offline survived the restart and are now synced.`
        : `${waiting} change(s) survived the restart. Status: ${STATUS_TEXT[store.current.status]}.`;
      renderReport();
    };
    store.onChange(done);
    done();
  }

  const tickOnce = async (): Promise<number | null> => {
    const day = today();
    const cur = entryOn(store.current.snapshot, day, 'probe');
    const t0 = performance.now();
    store.putEntry(day, 'probe', cur?.v ? { at: Date.now(), dev: info.dev } : { v: 1, at: Date.now(), dev: info.dev });
    if (!backend) return null;
    await store.flush();
    return store.current.status === 'synced' ? performance.now() - t0 : null;
  };

  const show1 = (): void => {
    if (latencies.length === 0) return;
    const ms = latencies.map((x) => Math.round(x));
    lines.r1 = `confirmed in ${ms.join(', ')} ms (median ${Math.round(median(latencies))} ms)`;
    $('r1').textContent = `Confirmed in  ${ms.join(' · ')} ms\nMedian        ${Math.round(median(latencies))} ms\nTarget: under 100 ms to save on the device (always met: the journal), sync time is what this measures.`;
    renderReport();
  };

  const run = async (n: number): Promise<void> => {
    $<HTMLButtonElement>('run5').disabled = true;
    $<HTMLButtonElement>('one').disabled = true;
    try {
      for (let i = 0; i < n; i++) {
        const ms = await tickOnce();
        if (ms !== null) latencies.push(ms);
        else if (store.current.status !== 'synced') {
          $('r1').textContent = `Saved on this device; not confirmed by the store (${STATUS_TEXT[store.current.status]}).`;
          lines.r1 = lines.r1 || `offline: ${STATUS_TEXT[store.current.status]}`;
          break;
        }
      }
      show1();
    } finally {
      $<HTMLButtonElement>('run5').disabled = false;
      $<HTMLButtonElement>('one').disabled = false;
      renderReport();
    }
  };

  $('run5').addEventListener('click', () => void run(5));
  $('one').addEventListener('click', () => void run(1));
  $('copy').addEventListener('click', () => {
    const text = $('report').textContent ?? '';
    navigator.clipboard.writeText(text).then(
      () => ($('copy').textContent = 'Copied'),
      () => {
        const range = document.createRange();
        range.selectNodeContents($('report'));
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        $('copy').textContent = 'Selected: copy it';
      },
    );
  });
  renderReport();
}

void main();
