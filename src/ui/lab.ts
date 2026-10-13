/**
 * The Environment Lab's gate: a preview tool for light, time and weather, hidden from normal
 * Setup. Unlocked per device (five taps on the version in About, or `?lab`). Opening it asks
 * the game screen to show the panel; nothing here touches the record.
 */
const KEY = 'ascent:lab:v1';

export function labUnlocked(set?: boolean): boolean {
  try {
    if (set !== undefined) localStorage.setItem(KEY, set ? '1' : '0');
    return new URLSearchParams(location.search).has('lab') || localStorage.getItem(KEY) === '1';
  } catch {
    return new URLSearchParams(location.search).has('lab');
  }
}

export function openLab(): void {
  window.setTimeout(() => window.dispatchEvent(new CustomEvent('ascent:lab')), 60);
}
