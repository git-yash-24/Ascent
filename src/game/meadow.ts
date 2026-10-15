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

const TUFTS = 5200;
const FLOWERS = 640;

/** The meadow's flowers open by day and fold up at night and in rain (shared by every flower). */
export const bloom = { uOpen: { value: 1 } };

/**
 * A painted tuft: eight blades, each curving outward in two segments, dark and cool at the root,
 * warm and light at the tip. Normals point up, so a tuft shades like a soft mound, not like cards.
 */
function tuftGeometry(): THREE.BufferGeometry {
  const rnd = mulberry32(61);
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const base = new THREE.Color('#465c2c');
  const mid = new THREE.Color('#7a9644');
  const tip = new THREE.Color('#cfcc7c');
  const push = (p: number[], c: THREE.Color): void => {
    pos.push(p[0]!, p[1]!, p[2]!);
    col.push(c.r, c.g, c.b);
    nor.push(p[0]! * 2, 1, p[2]! * 2);
  };
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rnd() * 0.5;
    const h = 0.11 + rnd() * 0.15;
    const lean = 0.07 + rnd() * 0.1;
    const w = 0.03 + rnd() * 0.016;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cx = ca * 0.04 * rnd();
    const cz = sa * 0.04 * rnd();
    const px = -sa * w;
    const pz = ca * w;
    // Root, a bend halfway up, the tip curling out.
    const m = [cx + ca * lean * 0.35, h * 0.55, cz + sa * lean * 0.35];
    const t = [cx + ca * lean, h, cz + sa * lean];
    push([cx - px, 0, cz - pz], base);
    push([cx + px, 0, cz + pz], base);
    push([m[0]! + px * 0.6, m[1]!, m[2]! + pz * 0.6], mid);
    push([cx - px, 0, cz - pz], base);
    push([m[0]! + px * 0.6, m[1]!, m[2]! + pz * 0.6], mid);
    push([m[0]! - px * 0.6, m[1]!, m[2]! - pz * 0.6], mid);
    push([m[0]! - px * 0.6, m[1]!, m[2]! - pz * 0.6], mid);
    push([m[0]! + px * 0.6, m[1]!, m[2]! + pz * 0.6], mid);
    push(t, tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const n = new THREE.Float32BufferAttribute(nor, 3);
  for (let i = 0; i < n.count; i++) {
    const v = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  g.setAttribute('normal', n);
  return g;
}

/**
 * A wild flower: a stem, five petals round a centre. `aPetal` marks how far out along a petal a
 * vertex is, so the shader can fold the petals up (closing) at night or in rain.
 */
function flowerGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const pet: number[] = [];
  const col: number[] = [];
  const H = 0.17;
  const stemC = [0.28, 0.42, 0.2];
  const tri = (a: number[], b: number[], c: number[], pa: number[], cl: number[], n: number[]): void => {
    pos.push(...a, ...b, ...c);
    pet.push(...pa);
    for (let k = 0; k < 3; k++) {
      col.push(...cl);
      nor.push(...n);
    }
  };
  // Stem: two crossed thin quads.
  for (const [dx, dz] of [[0.004, 0], [0, 0.004]] as const) {
    tri([-dx, 0, -dz], [dx, 0, dz], [dx, H, dz], [0, 0, 0], stemC, [dz * 250, 0, -dx * 250]);
    tri([-dx, 0, -dz], [dx, H, dz], [-dx, H, -dz], [0, 0, 0], stemC, [dz * 250, 0, -dx * 250]);
  }
  // A leaf halfway up.
  tri([0, H * 0.35, 0], [0.05, H * 0.5, 0.012], [0.02, H * 0.42, -0.012], [0, 0, 0], stemC, [0, 1, 0]);
  // Five petals (white: the instance colour tints them), a darker centre.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const b = a + 0.5;
    const c = a - 0.5;
    const r = 0.042;
    tri([0, H, 0], [Math.cos(c) * r * 0.75, H + 0.004, Math.sin(c) * r * 0.75], [Math.cos(a) * r, H + 0.008, Math.sin(a) * r], [0, 0.75, 1], [1, 1, 1], [0, 1, 0]);
    tri([0, H, 0], [Math.cos(a) * r, H + 0.008, Math.sin(a) * r], [Math.cos(b) * r * 0.75, H + 0.004, Math.sin(b) * r * 0.75], [0, 1, 0.75], [1, 1, 1], [0, 1, 0]);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const b = ((i + 1) / 6) * Math.PI * 2;
    tri([0, H + 0.012, 0], [Math.cos(a) * 0.013, H + 0.009, Math.sin(a) * 0.013], [Math.cos(b) * 0.013, H + 0.009, Math.sin(b) * 0.013], [0, 0, 0], [0.55, 0.4, 0.12], [0, 1, 0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aPetal', new THREE.Float32BufferAttribute(pet, 1));
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
    patchMaterial(grassMat, { sway: [0, 2.6], snow: 0.6, tint: true, grow: true });
    this.grass = new THREE.InstancedMesh(tuftGeometry(), grassMat, TUFTS);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    let guard = 0;
    while (n < TUFTS && guard++ < 40000) {
      const p = spot(rnd, 2.3, 32);
      if (!p) continue;
      // In clumps, thicker toward the meadow's hollows, thinner by the trodden camp.
      if (fbm(p[0] * 0.25 + 9, p[1] * 0.25, 2) < 0.33 + (Math.hypot(p[0], p[1]) < 5 ? 0.12 : 0)) continue;
      const far = Math.hypot(p[0], p[1]);
      const sc = (0.9 + rnd() * 0.9) * (far > 8 ? 1.4 : 1);
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      m.compose(new THREE.Vector3(p[0], groundHeight(p[0], p[1]) - 0.02, p[1]), q, new THREE.Vector3(sc * 1.2, sc * (0.8 + rnd() * 0.5), sc * 1.2));
      this.grass.setMatrixAt(n++, m);
    }
    this.grass.count = n;
    this.grass.userData.max = n;
    this.grass.receiveShadow = true;

    const flowerMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    patchMaterial(flowerMat, { sway: [0, 3], grow: true });
    const sway = flowerMat.onBeforeCompile;
    flowerMat.onBeforeCompile = (sh, r) => {
      sway(sh, r);
      sh.uniforms.uOpen = bloom.uOpen;
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'attribute float aPetal; uniform float uOpen;\nvoid main() {').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float shut = (1.0 - uOpen) * aPetal;
        vec2 d = transformed.xz;
        transformed.xz = d * (1.0 - shut * 0.7);
        transformed.y += length(d) * shut * 1.6;`,
      );
    };
    flowerMat.customProgramCacheKey = () => 'flower-petals';
    this.flowers = new THREE.InstancedMesh(flowerGeometry(), flowerMat, FLOWERS);
    const palette = ['#f6f2e8', '#f4d35e', '#b58ad8', '#ec9cb4', '#f6f2e8', '#8ab4e8', '#f39a4a'].map((c) => new THREE.Color(c));
    n = 0;
    guard = 0;
    while (n < FLOWERS && guard++ < 20000) {
      const p = spot(rnd, 3, 24);
      if (!p || fbm(p[0] * 0.18 + 3, p[1] * 0.18 + 4, 2) < 0.5) continue;
      const sc = 0.8 + rnd() * 0.9;
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      m.compose(new THREE.Vector3(p[0], groundHeight(p[0], p[1]) - 0.02, p[1]), q, new THREE.Vector3(sc, sc, sc));
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
