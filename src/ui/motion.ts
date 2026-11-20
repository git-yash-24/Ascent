/**
 * One motion policy for the whole app: reduced when the system asks for it OR when Setup's
 * "Reduce motion" is on. CSS, scrolling and the 3D stage all read it here, and it updates
 * the moment either source changes, with no reload.
 */
const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
let appSetting = false;
const listeners = new Set<(reduced: boolean) => void>();
let last: boolean | null = null;

export function reducedMotion(): boolean {
  return appSetting || (query?.matches ?? false);
}

function apply(): void {
  const r = reducedMotion();
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('reduce-motion', r);
  if (r === last) return;
  last = r;
  for (const fn of listeners) fn(r);
}

query?.addEventListener?.('change', apply);

/** Setup's switch, from the saved profile. */
export function setMotionSetting(reduced: boolean): void {
  appSetting = reduced;
  apply();
}

export function onMotionChange(fn: (reduced: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function scrollBehavior(): ScrollBehavior {
  return reducedMotion() ? 'auto' : 'smooth';
}
