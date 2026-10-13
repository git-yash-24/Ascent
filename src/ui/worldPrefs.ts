/**
 * Per-device choices about the world's presentation (Setup, "The world"): which light Ari
 * carries at night, and whether shaking the phone stirs the world. Kept in this browser only:
 * they are about this screen, they never touch the record, and they need no schema change.
 */
export type LightStyle = 'lantern' | 'headlamp' | 'glowstick';
export const LIGHT_STYLES: Array<[LightStyle, string]> = [
  ['lantern', 'Lantern'],
  ['headlamp', 'Headlamp'],
  ['glowstick', 'Glow stick'],
];

interface Prefs {
  light: LightStyle;
  shake: boolean;
}

const KEY = 'ascent:world:v1';
const listeners = new Set<(p: Prefs) => void>();
let cache: Prefs | null = null;

export function worldPrefs(): Prefs {
  if (cache) return cache;
  let p: Prefs = { light: 'lantern', shake: false };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    if (raw.light === 'lantern' || raw.light === 'headlamp' || raw.light === 'glowstick') p.light = raw.light;
    if (typeof raw.shake === 'boolean') p = { ...p, shake: raw.shake };
  } catch {
    /* private window: defaults */
  }
  cache = p;
  return p;
}

export function setWorldPrefs(patch: Partial<Prefs>): void {
  cache = { ...worldPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* kept for this visit only */
  }
  for (const fn of listeners) fn(cache);
}

export function onWorldPrefs(fn: (p: Prefs) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Motion sensors, for "shake to stir the world". iOS asks once, from a tap; elsewhere the events
 * simply arrive (or never do, when the page is not allowed to read them). Resolves whether it
 * may listen.
 */
export async function askMotion(): Promise<boolean> {
  const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
  if (!DME) return false;
  if (typeof DME.requestPermission === 'function') {
    try {
      return (await DME.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Calls `fn(strength 0..1)` on a shake: a few sharp changes of acceleration within half a second.
 * Returns a stop function. Nothing is recorded.
 */
export function listenShake(fn: (strength: number) => void): () => void {
  let last: [number, number, number] | null = null;
  let jolts: number[] = [];
  let quietUntil = 0;
  const on = (e: DeviceMotionEvent): void => {
    const a = e.accelerationIncludingGravity ?? e.acceleration;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const now = performance.now();
    const cur: [number, number, number] = [a.x, a.y, a.z];
    if (last) {
      const d = Math.hypot(cur[0] - last[0], cur[1] - last[1], cur[2] - last[2]);
      if (d > 14) jolts.push(now);
      jolts = jolts.filter((t) => now - t < 600);
      if (jolts.length >= 3 && now > quietUntil) {
        quietUntil = now + 1200;
        jolts = [];
        fn(Math.min(1, d / 40));
      }
    }
    last = cur;
  };
  window.addEventListener('devicemotion', on);
  return () => window.removeEventListener('devicemotion', on);
}
