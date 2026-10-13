/**
 * Which game-screen layout this device shows: the five tabs, or the dock preview (Camp, Today,
 * Journey). A per-device viewing choice, kept in local storage and never in the record;
 * `?ui=dock` or `?ui=tabs` overrides it for a side-by-side look.
 */
export type Layout = 'tabs' | 'dock';
const KEY = 'ascent:layout:v1';
const listeners = new Set<(l: Layout) => void>();

export function layout(): Layout {
  const q = new URLSearchParams(location.search).get('ui');
  if (q === 'dock' || q === 'tabs') return q;
  try {
    return localStorage.getItem(KEY) === 'dock' ? 'dock' : 'tabs';
  } catch {
    return 'tabs';
  }
}

export function setLayout(l: Layout): void {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    // without storage the choice lasts for this visit
  }
  for (const fn of listeners) fn(l);
}

export function onLayoutChange(fn: (l: Layout) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
