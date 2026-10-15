/**
 * A cloud layer over the valley: soft painted sprites far out and high up, cheap on a phone
 * (one texture, a few dozen quads, no volumetrics). Their colour comes from the sky: the side
 * toward the sun catches its light (a silver or golden lining near the horizon), the rest takes
 * the shade colour. Cover grows and thins slowly, so weather arrives instead of switching.
 */
import * as THREE from 'three';
import type { SkyLook } from './sky';

const COUNT = 26;

function cloudTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 22; i++) {
    const x = 40 + rnd() * 176;
    const y = 52 + (rnd() - 0.5) * 34 - Math.abs(x - 128) * 0.12;
    const r = 18 + rnd() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // A flatter, darker underside.
  const fade = g.createLinearGradient(0, 60, 0, 128);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = fade;
  g.fillRect(0, 60, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Cloud {
  s: THREE.Sprite;
  /** Order in which clouds appear as cover grows (0 first). */
  rank: number;
  base: THREE.Vector3;
  size: number;
}

export class Clouds {
  private readonly items: Cloud[] = [];
  private drift = 0;
  cover = 0.3;

  constructor(scene: THREE.Scene) {
    const tex = cloudTexture();
    let seed = 11;
    const rnd = (): number => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    for (let i = 0; i < COUNT; i++) {
      // A ring of cloud mostly over the mountain side of the sky, some overhead.
      const a = -Math.PI * 0.95 + rnd() * Math.PI * 1.9;
      const r = 380 + rnd() * 620;
      const base = new THREE.Vector3(Math.sin(a) * r, 150 + rnd() * 190, -Math.cos(a) * r * 0.9 - 60);
      const size = 170 + rnd() * 260;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
      s.scale.set(size, size * 0.42, 1);
      s.position.copy(base);
      s.renderOrder = -1;
      scene.add(s);
      this.items.push({ s, rank: rnd(), base, size });
    }
  }

  /** Ease the cover toward `target`, drift with the wind, colour by the sky and the sun. */
  update(dt: number, target: number, tau: number, look: SkyLook, sunDir: THREE.Vector3, wind: THREE.Vector2, windStrength: number): void {
    this.cover += (target - this.cover) * (1 - Math.exp(-dt / tau));
    this.drift += dt * (2 + windStrength * 10);
    const lit = new THREE.Color();
    const dir = new THREE.Vector3();
    for (const c of this.items) {
      // More clouds as the cover rises, each fading in rather than popping.
      const show = Math.max(0, Math.min(1, (this.cover - c.rank * 0.85) / 0.15));
      const x = ((c.base.x + this.drift * wind.x + 1300) % 2600) - 1300;
      c.s.position.set(x, c.base.y, c.base.z);
      dir.copy(c.s.position).normalize();
      const toward = Math.max(0, dir.dot(sunDir));
      const lining = Math.pow(toward, 6) * (sunDir.y < 0.35 ? 1 : 0.4);
      lit.copy(look.cloudShade).lerp(look.cloudLit, Math.min(1, 0.35 + lining * 0.9 + Math.max(0, sunDir.y) * 0.4));
      const m = c.s.material;
      m.color.copy(lit);
      m.opacity = show * (0.55 + this.cover * 0.4);
      c.s.visible = m.opacity > 0.01;
      // Heavier cover: bigger, lower, flatter.
      const k = 1 + this.cover * 0.5;
      c.s.scale.set(c.size * k, c.size * 0.42 * (1 + this.cover * 0.3), 1);
    }
  }
}
