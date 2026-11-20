/** A tiny element builder. Text is always set with textContent, never parsed as HTML. */
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

const SVG = 'http://www.w3.org/2000/svg';

/**
 * The state glyph. Shape carries the state, colour only reinforces it:
 * hollow (open), dot (attempted), half (held), filled with a tick (fulfilled),
 * slashed (skipped), crossed (missed), dashed (not due).
 */
export function glyph(state: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `glyph g-${state}`);
  svg.setAttribute('aria-hidden', 'true');
  const add = (name: string, a: Record<string, string>): void => {
    const e = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(a)) e.setAttribute(k, v);
    svg.appendChild(e);
  };
  const ring = { cx: '12', cy: '12', r: '9', fill: 'none', 'stroke-width': '2' };
  switch (state) {
    case 'fulfilled':
      add('circle', { cx: '12', cy: '12', r: '10', class: 'fill' });
      add('path', { d: 'M7.5 12.5l3 3 6-7', fill: 'none', class: 'mark', 'stroke-width': '2.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      break;
    case 'held':
      add('circle', { ...ring, class: 'ring' });
      add('path', { d: 'M12 3a9 9 0 0 1 0 18z', class: 'fill' });
      break;
    case 'attempted':
      add('circle', { ...ring, class: 'ring' });
      add('circle', { cx: '12', cy: '12', r: '3', class: 'fill' });
      break;
    case 'skipped':
      add('circle', { ...ring, class: 'ring' });
      add('path', { d: 'M6 18L18 6', class: 'ring', 'stroke-width': '2', 'stroke-linecap': 'round' });
      break;
    case 'missed':
      add('circle', { ...ring, class: 'ring dim' });
      add('path', { d: 'M9 9l6 6M15 9l-6 6', class: 'ring dim', 'stroke-width': '2', 'stroke-linecap': 'round' });
      break;
    case 'unscheduled':
      add('circle', { ...ring, class: 'ring dim', 'stroke-dasharray': '3 3' });
      break;
    default:
      add('circle', { ...ring, class: 'ring' });
  }
  return svg;
}
