/**
 * Tap or hold on one control. On a habit chip (Xander, 13 Oct: "the tap hold will be the
 * completed and only tap will reveal all the other options"): holding marks it done, a tap opens
 * the options.
 *
 * Touch and mouse: a press shorter than HOLD_MS is a tap; holding past it fires `hold` and the
 * release does nothing more. Moving more than a few pixels is a swipe, never a tap. Keyboard:
 * Enter or Space taps. Shift+F10, the context-menu key and right-click fire `menu` (or `hold`
 * when there is no menu).
 */
export const HOLD_MS = 700;
const SLOP_PX = 10;

export interface TapEvent {
  x: number;
  y: number;
  /** 'key' when Enter or Space activated it: an editor may take focus at once. */
  via: 'pointer' | 'key';
}

export function holdable(el: HTMLElement, on: { tap(e: TapEvent): void; hold(): void; menu?(): void }): void {
  const menu = (): void => (on.menu ?? on.hold)();
  let timer = 0;
  let start: { x: number; y: number; id: number; touch: boolean } | null = null;
  let held = false;
  /** Clicks right after a pointer press belong to that press. */
  let quietUntil = 0;

  const cancel = (): void => {
    window.clearTimeout(timer);
    timer = 0;
    start = null;
    el.classList.remove('holding');
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    held = false;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType !== 'mouse' };
    el.classList.add('holding');
    timer = window.setTimeout(() => {
      held = true;
      timer = 0;
      el.classList.remove('holding');
      navigator.vibrate?.(12);
      on.hold();
    }, HOLD_MS);
  });
  el.addEventListener('pointermove', (e) => {
    if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP_PX) cancel();
  });
  el.addEventListener('pointerup', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const wasPending = timer !== 0;
    cancel();
    quietUntil = performance.now() + 600;
    if (wasPending && !held) on.tap({ x: e.clientX, y: e.clientY, via: 'pointer' });
  });
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('click', (e) => {
    // Pointer presses are handled above; a click with no pointer press is the keyboard.
    if (performance.now() < quietUntil) {
      e.preventDefault();
      return;
    }
    const r = el.getBoundingClientRect();
    on.tap({ x: r.left + r.width / 2, y: r.top + r.height / 2, via: 'key' });
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    // A touch long-press raises this early; the hold timer decides on touch.
    if (start?.touch) return;
    if (!held) {
      cancel();
      held = true;
      quietUntil = performance.now() + 600;
      menu();
    }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      menu();
    }
  });
  el.setAttribute('aria-keyshortcuts', 'Shift+F10');
}
