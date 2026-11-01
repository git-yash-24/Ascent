/**
 * The small things on the ground (art direction: a world that is lived in and growing):
 *
 *   ferns       curled fronds at the feet of trees and along the brook, swaying a little
 *   mushrooms   red-capped and brown, in rings near trees and on damp ground
 *   glowcaps    a few pale fungi on the brook's dark banks; by night they glow faintly blue,
 *               one of the night's honest light sources
 *   reeds       tall stems with brown heads along both banks, bending in the wind
 *   pebbles     scattered along the trail and round the trodden camp
 *   leaves      fallen leaves under the broadleaves and across the meadow, in autumn only
 *
 * Instanced, one draw call per kind; presentation only.
 */
import * as THREE from 'three';
import { fbm, mulberry32 } from '../prototype/shared/noise';
import { STREAM, STREAM_HALF, groundHeight, pathX, patchMaterial, streamDistance } from '../prototype/feel3d/world';
import { stoneGeometry } from './style';
import type { Season } from './conditions';

export const clutterU = { uGlow: { value: 0 } };

function merge(parts: Array<{ g: THREE.BufferGeometry; c: THREE.Color | ((v: THREE.Vector3) => THREE.Color) }>): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const v = new THREE.Vector3();
  for (const { g, c } of parts) {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.computeVertexNormals();
    const p = ng.attributes.position as THREE.BufferAttribute;
    const n = ng.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const cc = typeof c === 'function' ? c(v) : c;
      pos.push(v.x, v.y, v.z);
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(cc.r, cc.g, cc.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

function mushroomGeometry(cap: string, dots: boolean): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.018, 0.024, 0.09, 8);
  stem.translate(0, 0.045, 0);
  const c = new THREE.SphereGeometry(0.055, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  c.scale(1, 0.62, 1);
  c.translate(0, 0.085, 0);
  const parts: Array<{ g: THREE.BufferGeometry; c: THREE.Color | ((v: THREE.Vector3) => THREE.Color) }> = [
    { g: stem, c: new THREE.Color('#ece2cc') },
    { g: c, c: new THREE.Color(cap) },
  ];
  if (dots) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const d = new THREE.SphereGeometry(0.008, 5, 4);
      const r = i % 2 ? 0.032 : 0.02;
      d.translate(Math.cos(a) * r, 0.085 + Math.sqrt(Math.max(0, 0.055 * 0.055 - r * r)) * 0.62, Math.sin(a) * r);
      parts.push({ g: d, c: new THREE.Color('#fff8ea') });
    }
  }
  return merge(parts);
}

function fernGeometry(seed: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const parts: Array<{ g: THREE.BufferGeometry; c: (v: THREE.Vector3) => THREE.Color }> = [];
  const base = new THREE.Color('#2e4a26');
  const tip = new THREE.Color('#7aa04a');
  for (let f = 0; f < 7; f++) {
    const a = (f / 7) * Math.PI * 2 + rnd() * 0.4;
    const len = 0.32 + rnd() * 0.18;
    // A frond: a strip arching up and out, leaflets as a zig-zag edge.
    const pos: number[] = [];
    const N = 8;
    for (let i = 0; i < N; i++) {
      const t0 = i / N;
      const t1 = (i + 1) / N;
      const pt = (t: number, side: number): number[] => {
        const r = t * len;
        const y = Math.sin(t * Math.PI * 0.85) * len * 0.55;
        const w = (1 - t) * 0.06 * (i % 2 ? 1.25 : 0.8) * side;
        return [Math.cos(a) * r - Math.sin(a) * w, y, Math.sin(a) * r + Math.cos(a) * w];
      };
      const a0 = pt(t0, -1);
      const b0 = pt(t0, 1);
      const a1 = pt(t1, -1);
      const b1 = pt(t1, 1);
      pos.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    parts.push({ g, c: (v) => base.clone().lerp(tip, Math.min(1, Math.hypot(v.x, v.z) / len)) });
  }
  return merge(parts);
}

function reedGeometry(seed: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const parts: Array<{ g: THREE.BufferGeometry; c: THREE.Color }> = [];
  for (let i = 0; i < 5; i++) {
    const h = 0.7 + rnd() * 0.5;
    const x = (rnd() - 0.5) * 0.12;
    const z = (rnd() - 0.5) * 0.12;
    const stem = new THREE.CylinderGeometry(0.004, 0.007, h, 4);
    stem.translate(x, h / 2, z);
    parts.push({ g: stem, c: new THREE.Color('#6a7a3a') });
    if (i < 3) {
      const head = new THREE.CylinderGeometry(0.016, 0.016, 0.12, 6);
      head.translate(x, h - 0.06, z);
      parts.push({ g: head, c: new THREE.Color('#6a4026') });
    }
    // A long leaf.
    const lp = [x, 0, z, x + 0.03, 0, z, x + 0.12 * (rnd() - 0.3), h * 0.75, z + 0.06];
    const leaf = new THREE.BufferGeometry();
    leaf.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    parts.push({ g: leaf, c: new THREE.Color('#7a8a44') });
  }
  return merge(parts);
}

export class Clutter {
  readonly group = new THREE.Group();
  private readonly leaves: THREE.InstancedMesh;
  private leafMax = 0;

  constructor(scene: THREE.Scene) {
    const rnd = mulberry32(1717);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const place = (mesh: THREE.InstancedMesh, n: number, want: (x: number, z: number) => boolean, scale: () => number, ring = [3, 30]): number => {
      let i = 0;
      let guard = 0;
      while (i < n && guard++ < n * 60) {
        const a = rnd() * Math.PI * 2;
        const d = ring[0]! + Math.sqrt(rnd()) * (ring[1]! - ring[0]!);
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (Math.abs(x - pathX(z)) < 0.7 || Math.hypot(x + 2.3, z + 2.1) < 1.6 || Math.hypot(x, z) < 2.4) continue;
        if (!want(x, z)) continue;
        const s = scale();
        q.setFromAxisAngle(up, rnd() * Math.PI * 2);
        m.compose(new THREE.Vector3(x, groundHeight(x, z) - 0.01, z), q, new THREE.Vector3(s, s, s));
        mesh.setMatrixAt(i++, m);
      }
      mesh.count = i;
      return i;
    };
    const wet = (x: number, z: number): number => streamDistance(x, z).d;
    const shady = (x: number, z: number): number => fbm(x * 0.05 + 11, z * 0.05 + 4, 2);

    // Ferns: where the trees stand and along the brook's banks.
    const fernMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    patchMaterial(fernMat, { sway: [0, 1.2], snow: 0.8, grow: true });
    const ferns = new THREE.InstancedMesh(fernGeometry(7), fernMat, 220);
    place(ferns, 220, (x, z) => { const w = wet(x, z); return (w > STREAM_HALF + 0.4 && w < STREAM_HALF + 2.6) || (shady(x, z) > 0.5 && Math.hypot(x, z) > 9); }, () => 0.8 + rnd() * 0.9, [4, 40]);
    // Mushrooms: rings in the shade, a few in the damp.
    const mushMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const red = new THREE.InstancedMesh(mushroomGeometry('#c23a22', true), mushMat, 50);
    place(red, 50, (x, z) => shady(x, z) > 0.52, () => 0.8 + rnd() * 0.8, [6, 35]);
    const brown = new THREE.InstancedMesh(mushroomGeometry('#8a5a34', false), mushMat, 70);
    place(brown, 70, (x, z) => shady(x, z) > 0.48 || wet(x, z) < STREAM_HALF + 2, () => 0.7 + rnd() * 0.7, [4, 35]);
    // Glowcaps on the dark banks: faint by day, a soft blue glow by night.
    const glowMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#5ad8ff', emissiveIntensity: 0 });
    glowMat.onBeforeCompile = (sh) => {
      sh.uniforms.uGlow = clutterU.uGlow;
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform float uGlow;\nvoid main() {').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance = vec3(0.35, 0.85, 1.0) * uGlow * 2.2;');
    };
    glowMat.customProgramCacheKey = () => 'glowcap';
    const glow = new THREE.InstancedMesh(mushroomGeometry('#cfe6ea', false), glowMat, 36);
    place(glow, 36, (x, z) => { const w = wet(x, z); return w > STREAM_HALF + 0.3 && w < STREAM_HALF + 1.4; }, () => 0.7 + rnd() * 0.6, [3, 40]);
    // Reeds along both banks.
    const reedMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    patchMaterial(reedMat, { sway: [0.1, 0.8], snow: 0.5 });
    const reeds = new THREE.InstancedMesh(reedGeometry(3), reedMat, 90);
    {
      let i = 0;
      for (let k = 0; k < STREAM.length - 1 && i < 90; k++) {
        for (let r = 0; r < 2 && i < 90; r++) {
          const a = STREAM[k]!;
          const b = STREAM[k + 1]!;
          const t = rnd();
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          const l = Math.hypot(dx, dz) || 1;
          const side = rnd() < 0.5 ? -1 : 1;
          const off = (STREAM_HALF + 0.45 + rnd() * 0.5) * side;
          const x = a[0] + dx * t - (dz / l) * off;
          const z = a[1] + dz * t + (dx / l) * off;
          if (Math.abs(x - pathX(z)) < 1.2 || rnd() < 0.35) continue;
          const s = 0.8 + rnd() * 0.6;
          q.setFromAxisAngle(up, rnd() * Math.PI * 2);
          m.compose(new THREE.Vector3(x, groundHeight(x, z) - 0.02, z), q, new THREE.Vector3(s, s, s));
          reeds.setMatrixAt(i++, m);
        }
      }
      reeds.count = i;
    }
    // Pebbles along the trail and round camp.
    const pebbleMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const pebbles = new THREE.InstancedMesh(stoneGeometry(91, '#6a6e50', '#8a847c', 1), pebbleMat, 160);
    {
      let i = 0;
      let guard = 0;
      while (i < 160 && guard++ < 6000) {
        const z = 6 - rnd() * 40;
        const onTrail = rnd() < 0.6;
        const x = onTrail ? pathX(z) + (rnd() - 0.5) * 2.4 : (rnd() - 0.5) * 7;
        if (Math.hypot(x, z) < 1.4 || Math.hypot(x + 2.3, z + 2.1) < 1.5) continue;
        if (Math.abs(x) < 0.9 && Math.abs(z + 1.12) < 0.4) continue;
        const s = 0.05 + rnd() * rnd() * 0.16;
        q.setFromAxisAngle(up, rnd() * Math.PI * 2);
        m.compose(new THREE.Vector3(x, groundHeight(x, z) + s * 0.05, z), q, new THREE.Vector3(s * 1.3, s * 0.7, s));
        pebbles.setMatrixAt(i++, m);
      }
      pebbles.count = i;
    }
    // Fallen leaves (autumn): flat, curled a little, in warm colours.
    const leafGeo = new THREE.PlaneGeometry(0.07, 0.05, 2, 1);
    leafGeo.rotateX(-Math.PI / 2);
    const lp = leafGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) lp.setY(i, Math.abs(lp.getX(i)) * 0.25);
    leafGeo.computeVertexNormals();
    const leafMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    this.leaves = new THREE.InstancedMesh(leafGeo, leafMat, 700);
    {
      const cols = ['#d8822e', '#c4552d', '#e0a640', '#a8452a', '#c88a3a'].map((c) => new THREE.Color(c));
      let i = 0;
      let guard = 0;
      const e = new THREE.Euler();
      while (i < 700 && guard++ < 20000) {
        const a = rnd() * Math.PI * 2;
        const d = 2.2 + Math.sqrt(rnd()) * 26;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (wet(x, z) < STREAM_HALF + 0.1) continue;
        if (fbm(x * 0.03 + 50, z * 0.03, 2) < 0.45 && rnd() < 0.6) continue;
        e.set((rnd() - 0.5) * 0.4, rnd() * 6.3, (rnd() - 0.5) * 0.4);
        q.setFromEuler(e);
        const s = 0.8 + rnd() * 0.8;
        m.compose(new THREE.Vector3(x, groundHeight(x, z) + 0.012, z), q, new THREE.Vector3(s, s, s));
        this.leaves.setMatrixAt(i, m);
        this.leaves.setColorAt(i, cols[Math.floor(rnd() * cols.length)]!);
        i++;
      }
      this.leaves.count = i;
      this.leafMax = i;
    }
    for (const o of [ferns, red, brown, glow, reeds, pebbles, this.leaves]) {
      o.receiveShadow = true;
      this.group.add(o);
    }
    ferns.castShadow = reeds.castShadow = true;
    scene.add(this.group);
  }

  /** `night` 0..1 lights the glowcaps; the season decides the fallen leaves. */
  update(night: number, season: Season): void {
    clutterU.uGlow.value = night;
    const k = season === 'autumn' ? 1 : season === 'winter' ? 0.25 : 0;
    this.leaves.count = Math.floor(this.leafMax * k);
    this.leaves.visible = k > 0;
  }
}
