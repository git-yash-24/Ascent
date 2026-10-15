/**
 * The meadow round camp (Living World plan, Phase 4 art pass): tufts of grass and wild flowers,
 * instanced, swaying in the shared wind, tinted by the season, sinking under lying snow. Flowers
 * bloom in spring, thin out in summer and are gone by autumn. The number of tufts follows the
 * quality tier (a mid-range phone draws the standard count).
 */
import * as THREE from 'three';
import { fbm, mulberry32 } from '../prototype/shared/noise';
import { groundHeight, pathX, patchMaterial } from '../prototype/feel3d/world';
import type { Season } from './conditions';

const TUFTS = 3200;
const FLOWERS = 520;

function tuftGeometry(): THREE.BufferGeometry {
  const rnd = mulberry32(61);
  const pos: number[] = [];
  const col: number[] = [];
  const base = new THREE.Color('#2a361c');
  const tip = new THREE.Color('#8a9a4c');
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd() * 0.5;
    const h = 0.22 + rnd() * 0.2;
    const lean = 0.06 + rnd() * 0.1;
    const w = 0.025;
    const cx = Math.cos(a) * 0.03;
    const cz = Math.sin(a) * 0.03;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean);
    col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Somewhere in the meadow that is not the path, the fire ring, the tent or the seats. */
function spot(rnd: () => number, inner: number, outer: number): [number, number] | null {
  const a = rnd() * Math.PI * 2;
  const d = inner + Math.sqrt(rnd()) * (outer - inner);
  const x = Math.cos(a) * d;
  const z = Math.sin(a) * d;
  if (Math.abs(x - pathX(z)) < 0.9) return null;
  if (Math.hypot(x + 2.3, z + 2.1) < 1.4) return null;
  if (Math.hypot(x, z) < 2.3) return null;
  return [x, z];
}

export class Meadow {
  readonly group = new THREE.Group();
  private readonly grass: THREE.InstancedMesh;
  private readonly flowers: THREE.InstancedMesh;

  constructor(scene: THREE.Scene) {
    const rnd = mulberry32(67);
    const grassMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    patchMaterial(grassMat, { sway: [0, 2.2], snow: 0.6, tint: true, grow: true });
    this.grass = new THREE.InstancedMesh(tuftGeometry(), grassMat, TUFTS);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    let guard = 0;
    while (n < TUFTS && guard++ < 40000) {
      const p = spot(rnd, 2.3, 30);
      if (!p) continue;
      // In clumps, thicker toward the meadow's hollows, thinner by the trodden camp.
      if (fbm(p[0] * 0.25 + 9, p[1] * 0.25, 2) < 0.42 + (Math.hypot(p[0], p[1]) < 5 ? 0.12 : 0)) continue;
      const sc = 0.7 + rnd() * 0.8;
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      m.compose(new THREE.Vector3(p[0], groundHeight(p[0], p[1]) - 0.02, p[1]), q, new THREE.Vector3(sc, sc * (0.8 + rnd() * 0.5), sc));
      this.grass.setMatrixAt(n++, m);
    }
    this.grass.count = n;
    this.grass.userData.max = n;
    this.grass.receiveShadow = true;

    const head = new THREE.IcosahedronGeometry(0.028, 0);
    head.translate(0, 0.16, 0);
    const stem = new THREE.CylinderGeometry(0.004, 0.004, 0.16, 3);
    stem.translate(0, 0.08, 0);
    const flowerMat = new THREE.MeshLambertMaterial({ flatShading: true });
    patchMaterial(flowerMat, { sway: [0, 3], grow: true });
    this.flowers = new THREE.InstancedMesh(mergeTwo(head, stem), flowerMat, FLOWERS);
    const palette = ['#f2efe6', '#f4d35e', '#b58ad8', '#e8a0b4', '#f2efe6'].map((c) => new THREE.Color(c));
    n = 0;
    guard = 0;
    while (n < FLOWERS && guard++ < 20000) {
      const p = spot(rnd, 3, 24);
      if (!p || fbm(p[0] * 0.18 + 3, p[1] * 0.18 + 4, 2) < 0.5) continue;
      const sc = 0.7 + rnd() * 0.7;
      m.compose(new THREE.Vector3(p[0], groundHeight(p[0], p[1]) - 0.02, p[1]), q.identity(), new THREE.Vector3(sc, sc, sc));
      this.flowers.setMatrixAt(n, m);
      this.flowers.setColorAt(n, palette[Math.floor(rnd() * palette.length)]!);
      n++;
    }
    this.flowers.count = n;
    this.flowers.userData.max = n;
    this.group.add(this.grass, this.flowers);
    scene.add(this.group);
  }

  /** The season's flowers: a full meadow in spring, fewer in summer, none in autumn or winter. */
  setSeason(s: Season): void {
    const k = s === 'spring' ? 1 : s === 'summer' ? 0.55 : 0;
    this.flowers.count = Math.floor((this.flowers.userData.max as number) * k);
    this.flowers.visible = k > 0;
  }

  /** Fewer tufts on a slower device (quality tier 0, 1, 2). */
  setTier(t: number): void {
    this.grass.count = Math.floor((this.grass.userData.max as number) * [0.35, 0.7, 1][t]!);
  }
}

/** Two non-indexed geometries as one (positions and normals). */
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const pa = a.toNonIndexed();
  const pb = b.toNonIndexed();
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal'] as const) {
    const x = pa.getAttribute(k).array as Float32Array;
    const y = pb.getAttribute(k).array as Float32Array;
    const out = new Float32Array(x.length + y.length);
    out.set(x);
    out.set(y, x.length);
    g.setAttribute(k, new THREE.BufferAttribute(out, 3));
  }
  return g;
}
