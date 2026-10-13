/**
 * The world beyond the map, for the month and year views (Xander, 13 Oct: "waterfalls in the
 * distance and clouds so we don't see or notice the abrupt ends").
 *
 *   far ring    a full circle of distant peaks with snow, so every direction ends in mountains
 *   cloud sea   a deck of cloud around the map's edges, below the peaks: the ground fades into
 *               it instead of stopping; it thins at camp level so the near views stay clear
 *   waterfalls  falls that follow the real slopes of the main range, with mist at their feet
 *
 * Cheap on a phone: one merged mesh for the ring, ~70 cloud sprites, a few ribbons; no shadows.
 */
import * as THREE from 'three';
import { heightAt, rangeHeight } from '../prototype/feel3d/world';
import type { SkyLook } from './sky';

const CENTRE = new THREE.Vector3(-60, 0, -380);
const WATER = new THREE.Color('#e8f6ff');

function rng(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 48271) % 2147483647) / 2147483647);
}

/**
 * A ring of jagged peaks far out, snow above a line; vertex-coloured, flat-shaded, one mesh.
 * No peak stands close to the year view's camera or behind it: it would fill the frame as a wall.
 */
function farRing(eye: THREE.Vector3, look: THREE.Vector3): THREE.Mesh {
  const fwd = new THREE.Vector2(look.x - eye.x, look.z - eye.z).normalize();
  const rnd = rng(5);
  const pos: number[] = [];
  const col: number[] = [];
  const rock = new THREE.Color('#4a5161');
  const rock2 = new THREE.Color('#3d4352');
  const snow = new THREE.Color('#dfe6ef');
  const N = 54;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rnd() * 0.05;
    const r = 1450 + rnd() * 300;
    const h = 260 + rnd() * 520 * (0.55 + 0.45 * Math.abs(Math.sin(a * 1.7)));
    const w = 170 + rnd() * 160;
    const cx = CENTRE.x + Math.sin(a) * r;
    const cz = CENTRE.z - Math.cos(a) * r;
    const rel = new THREE.Vector2(cx - eye.x, cz - eye.z);
    if (rel.length() < 1300 || rel.dot(fwd) < rel.length() * 0.15) continue;
    // A peak: a 6-sided cone with a jittered apex, base well below the cloud deck.
    const sides = 6;
    const apex = new THREE.Vector3(cx + (rnd() - 0.5) * 60, h, cz + (rnd() - 0.5) * 60);
    const ring: THREE.Vector3[] = [];
    for (let k = 0; k < sides; k++) {
      const b = (k / sides) * Math.PI * 2 + rnd() * 0.4;
      const rr = w * (0.7 + rnd() * 0.5);
      ring.push(new THREE.Vector3(cx + Math.cos(b) * rr, -60, cz + Math.sin(b) * rr));
    }
    // A shoulder halfway up makes each peak read as a mountain, not a cone.
    const mid = ring.map((p) => p.clone().lerp(apex, 0.45 + rnd() * 0.15).add(new THREE.Vector3((rnd() - 0.5) * 40, 0, (rnd() - 0.5) * 40)));
    const snowLine = h * (0.55 + rnd() * 0.12);
    const tri = (p: THREE.Vector3, q: THREE.Vector3, s: THREE.Vector3, shade: THREE.Color): void => {
      for (const v of [p, q, s]) pos.push(v.x, v.y, v.z);
      const y = (p.y + q.y + s.y) / 3;
      const c = shade.clone();
      if (y > snowLine) c.lerp(snow, Math.min(0.92, (y - snowLine) / (h * 0.18)));
      for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    };
    for (let k = 0; k < sides; k++) {
      const n = (k + 1) % sides;
      const shade = k % 2 ? rock : rock2;
      tri(ring[k]!, ring[n]!, mid[n]!, shade);
      tri(ring[k]!, mid[n]!, mid[k]!, shade);
      tri(mid[k]!, mid[n]!, apex, shade);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  m.frustumCulled = false;
  return m;
}

function cloudTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rnd = rng(9);
  for (let i = 0; i < 14; i++) {
    const x = 24 + rnd() * 80;
    const y = 40 + rnd() * 48;
    const r = 18 + rnd() * 26;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Falling water: soft vertical streaks that scroll down. */
function fallTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const g = c.getContext('2d')!;
  const rnd = rng(13);
  g.fillStyle = 'rgba(200,230,255,0.35)';
  g.fillRect(0, 0, 32, 128);
  for (let i = 0; i < 40; i++) {
    const x = rnd() * 32;
    const y = rnd() * 128;
    const len = 20 + rnd() * 60;
    const grad = g.createLinearGradient(0, y, 0, y + len);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, 1 + rnd() * 2, len);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Fall {
  mesh: THREE.Mesh;
  mist: THREE.Sprite;
}

/**
 * A fall as a ribbon laid on the slope from `top` down to where the ground flattens; `width` in
 * metres. The route's line and the summit are avoided by the chosen spots.
 */
function waterfall(x: number, zTop: number, zBottom: number, width: number, tex: THREE.Texture): Fall {
  const steps = 40;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let len = 0;
  let prev: THREE.Vector3 | null = null;
  for (let i = 0; i <= steps; i++) {
    const z = zTop + ((zBottom - zTop) * i) / steps;
    const y = Math.max(rangeHeight(x, z), heightAt(x, z)) + 2.5;
    const p = new THREE.Vector3(x + Math.sin(i * 0.7) * 3, y, z);
    if (prev) len += p.distanceTo(prev);
    prev = p;
    pos.push(p.x - width / 2, p.y, p.z, p.x + width / 2, p.y, p.z);
    uv.push(0, len / 40, 1, len / 40);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const t = tex.clone();
  t.needsUpdate = true;
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: '#dff1ff' }));
  const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex(), transparent: true, depthWrite: false, color: '#eef6ff', opacity: 0.55 }));
  mist.position.set(x, Math.max(rangeHeight(x, zBottom), heightAt(x, zBottom)) + 14, zBottom);
  mist.scale.set(width * 5, width * 3, 1);
  return { mesh, mist };
}

/**
 * Forest on the high shoulders either side of the valley: simple pines (one instanced mesh),
 * so from the year view the land beside the route has texture, not bare slopes.
 */
function shoulderForest(): THREE.InstancedMesh {
  const crown = new THREE.ConeGeometry(4.5, 13, 6);
  crown.translate(0, 9, 0);
  const mesh = new THREE.InstancedMesh(crown, new THREE.MeshLambertMaterial({ color: '#26352a', flatShading: true }), 900);
  const rnd = rng(31);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let n = 0;
  let guard = 0;
  while (n < 900 && guard++ < 40000) {
    const x = (rnd() - 0.5) * 1500 - 40;
    const z = -480 + rnd() * 900;
    if (Math.abs(x) < 190) continue;
    // Clumps, and not on the snow.
    const h = heightAt(x, z);
    if (h > 330 || Math.sin(x * 0.02) * Math.cos(z * 0.025) + (rnd() - 0.5) * 0.6 < 0.15) continue;
    const s = 0.7 + rnd() * 0.8;
    m4.compose(new THREE.Vector3(x, h - 1, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28), new THREE.Vector3(s, s, s));
    mesh.setMatrixAt(n++, m4);
  }
  mesh.count = n;
  return mesh;
}

export class Horizon {
  private readonly ring: THREE.Mesh;
  private readonly sea: THREE.Sprite[] = [];
  /** Low cloud lying over the shoulders, seen only from far up. */
  private readonly shoulderCloud: THREE.Sprite[] = [];
  private readonly falls: Fall[] = [];

  constructor(scene: THREE.Scene, eye: THREE.Vector3, look: THREE.Vector3) {
    this.ring = farRing(eye, look);
    scene.add(this.ring);
    // The cloud deck: a band around the map's edge and out to the ring, below the far peaks.
    const tex = cloudTex();
    const rnd = rng(17);
    for (let i = 0; i < 72; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 820 + rnd() * 700;
      const px = CENTRE.x + Math.sin(a) * r;
      const pz = CENTRE.z - Math.cos(a) * r;
      // Keep the deck away from under and behind the year camera: there it only blurs the frame.
      if (Math.hypot(px - eye.x, pz - eye.z) < 950 || (px - eye.x) * (look.x - eye.x) + (pz - eye.z) * (look.z - eye.z) < 0) continue;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
      s.position.set(px, 40 + rnd() * 90, pz);
      const size = 380 + rnd() * 420;
      s.scale.set(size, size * 0.45, 1);
      s.userData.base = s.position.clone();
      scene.add(s);
      this.sea.push(s);
    }
    scene.add(shoulderForest());
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1;
      const x = -40 + side * (260 + rnd() * 460);
      // Not right under the year camera, where a cloud would fill the frame.
      const z = -460 + rnd() * 600;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
      s.position.set(x, heightAt(x, z) + 70 + rnd() * 70, z);
      const size = 260 + rnd() * 260;
      s.scale.set(size, size * 0.4, 1);
      scene.add(s);
      this.shoulderCloud.push(s);
    }
    // Falls on the steepest faces of the main range, clear of the route and the summit.
    const ftex = fallTex();
    for (const [x, zTop, zBottom, w] of [
      [-430, -905, -640, 14],
      [210, -880, -630, 11],
      [-640, -820, -600, 12],
    ] as const) {
      const f = waterfall(x, zTop, zBottom, w, ftex);
      scene.add(f.mesh, f.mist);
      this.falls.push(f);
    }
  }

  /**
   * `far`: 0 at camp, 1 in the month and year views. The deck thickens with distance; colours
   * follow the sky (lit edges toward a low sun); the water keeps falling.
   */
  update(t: number, dt: number, look: SkyLook, sunDir: THREE.Vector3, far: number): void {
    const lit = new THREE.Color();
    const d = new THREE.Vector3();
    for (const s of this.sea) {
      const b = s.userData.base as THREE.Vector3;
      s.position.x = b.x + Math.sin(t * 0.01 + b.z * 0.01) * 30;
      d.copy(s.position).sub(CENTRE).normalize();
      const toward = Math.max(0, d.dot(sunDir));
      lit.copy(look.cloudShade).lerp(look.cloudLit, Math.min(1, 0.45 + Math.pow(toward, 4) * 0.6 + Math.max(0, sunDir.y) * 0.3));
      s.material.color.copy(lit);
      s.material.opacity = 0.22 + far * 0.58;
    }
    for (const s of this.shoulderCloud) {
      s.material.color.copy(look.cloudLit).lerp(look.cloudShade, 0.35);
      s.material.opacity = Math.max(0, far - 0.4) * 0.5;
      s.visible = s.material.opacity > 0.01;
    }
    for (const f of this.falls) {
      const m = f.mesh.material as THREE.MeshBasicMaterial;
      // v runs down the fall, so the streaks move down as the offset falls.
      if (m.map) m.map.offset.y -= dt * 0.55;
      m.opacity = 0.55 + far * 0.35;
      m.color.copy(look.cloudLit).lerp(WATER, 0.6);
      f.mist.material.color.copy(look.cloudLit);
      f.mist.material.opacity = 0.35 + 0.15 * Math.sin(t * 0.7);
    }
  }
}
