/**
 * The app's one clock. Normally the real time; in a speedrun sandbox (`?warp=720&from=2026-10-14T06:00`)
 * simulated time that runs `speed` times faster, so a whole day (the logical day, the sun, the
 * weather, the moon, the water reminders) passes in 86400 / speed seconds: ×720 is a day in two
 * minutes. Everything that asks "what time is it" asks here, never Date.now() directly.
 *
 * A warp always runs in a sandbox (see shell/app.ts): its writes go to a separate, local-only
 * record, never to the real one, because simulated days would otherwise land in the real log.
 */
export interface Warp {
  /** Simulated seconds per real second (0 = paused). */
  speed: number;
  /** Simulated time (ms) at `realAt`. */
  simAt: number;
  /** performance.now() when the anchor was taken. */
  realAt: number;
}

let warp: Warp | null = null;
const listeners = new Set<() => void>();
const realNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function appNow(): number {
  return warp ? warp.simAt + (realNow() - warp.realAt) * warp.speed : Date.now();
}

export function appDate(): Date {
  return new Date(appNow());
}

export function warpState(): Warp | null {
  return warp;
}

/** Start (or re-anchor) simulated time. `at` defaults to now in simulated time. */
export function setWarp(speed: number, at: number = appNow()): void {
  warp = { speed: Math.max(0, speed), simAt: at, realAt: realNow() };
  for (const fn of listeners) fn();
}

/** Jump simulated time forward (a speedrun's "next morning"). */
export function skipAhead(ms: number): void {
  if (warp) setWarp(warp.speed, appNow() + ms);
}

export function onWarp(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Reads `?warp=<speed>&from=<YYYY-MM-DD[THH:mm]>` (local time). Returns the warp, or null for
 * real time. `resumeAt`, when later than `from`, continues a sandbox where it left off.
 */
export function warpFromUrl(search: string, resumeAt: number | null): Warp | null {
  const q = new URLSearchParams(search);
  const raw = q.get('warp');
  if (raw === null) return null;
  const speed = Number(raw);
  if (!Number.isFinite(speed) || speed < 0 || speed > 100_000) return null;
  const from = q.get('from');
  const fromMs = from ? new Date(from.length <= 10 ? `${from}T06:00` : from).getTime() : Date.now();
  const at = resumeAt !== null && resumeAt > fromMs ? resumeAt : Number.isFinite(fromMs) ? fromMs : Date.now();
  setWarp(speed, at);
  return warp;
}
