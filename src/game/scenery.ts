/**
 * Modelled scenery near camp (Living World plan, Phase 4, started early at Xander's request,
 * 13 Oct): real low-poly pines and bushes instead of cones, where the camera actually looks.
 *
 * Models: Quaternius, "Ultimate Nature Pack" (PineTree 1 to 3, Bush 1), CC0 public domain,
 * https://quaternius.com/packs/ultimatenature.html — baked to compact flat-shaded meshes
 * (indexed int16 positions, one material flag per triangle) and recoloured to the mountain's palette.
 * Budget for a mid-range 2026 phone: about 60 pines (~2,000 triangles each) and 40 bushes,
 * one draw call per model, no shadow casting; the far forest stays as cones.
 */
import * as THREE from 'three';
import data from '../assets/quaternius-trees.json';
import { groundHeight, pathX, swayInWind } from '../prototype/feel3d/world';

type Name = 'pine_1' | 'pine_2' | 'pine_3' | 'bush_1';
const PACK = data as Record<Name, { tris: number; pos: string; idx: string; mat: string }>;

function bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** One model as a flat-shaded, vertex-coloured geometry, base at y = 0, height 1. */
export function modelGeometry(name: Name, leaf: THREE.Color, wood: THREE.Color): THREE.BufferGeometry {
  const m = PACK[name];
  const raw = bytes(m.pos);
  const verts = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const ir = bytes(m.idx);
  const idx = new Uint16Array(ir.buffer, ir.byteOffset, ir.byteLength / 2);
  const mat = bytes(m.mat);
  // Expanded to one vertex per corner, so every face keeps its own flat normal and colour.
  const n = idx.length;
  const p = new Float32Array(n * 3);
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = idx[i]! * 3;
    p[i * 3] = verts[v]! / 16000;
    p[i * 3 + 1] = verts[v + 1]! / 16000;
    p[i * 3 + 2] = verts[v + 2]! / 16000;
    const col = mat[Math.floor(i / 3)] === 1 ? leaf : wood;
    // A touch lighter toward the top of each tree: light from the sky, depth in the crown.
    const lift = 0.85 + 0.3 * p[i * 3 + 1]!;
    c[i * 3] = col.r * lift;
    c[i * 3 + 1] = col.g * lift;
    c[i * 3 + 2] = col.b * lift;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

function rng(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 48271) % 2147483647) / 2147483647);
}

export interface Scenery {
  group: THREE.Group;
  triangles: number;
}

/** The forest around camp: pines on the slopes, bushes at the edges, a clear path and fire ring. */
export function buildNearForest(radius: number): Scenery {
  const group = new THREE.Group();
  const rnd = rng(77);
  const leaves = [new THREE.Color('#2b3d2d'), new THREE.Color('#263829'), new THREE.Color('#314533')];
  const wood = new THREE.Color('#3b2c22');
  const pines: Name[] = ['pine_1', 'pine_2', 'pine_3'];
  const spots: Array<{ x: number; z: number; s: number; r: number; k: number }> = [];
  let guard = 0;
  while (spots.length < 62 && guard++ < 6000) {
    const a = rnd() * Math.PI * 2;
    const d = 11 + Math.pow(rnd(), 0.7) * (radius - 11);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (Math.abs(x - pathX(z)) < 4.5) continue;
    // Keep the view to the mountain open: few trees straight ahead of camp.
    if (z < -10 && Math.abs(x) < 9) continue;
    if (spots.some((o) => Math.hypot(o.x - x, o.z - z) < 3.2)) continue;
    spots.push({ x, z, s: 3.6 + rnd() * 3.4, r: rnd() * Math.PI * 2, k: Math.floor(rnd() * 3) });
  }
  let triangles = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  pines.forEach((name, k) => {
    const mine = spots.filter((o) => o.k === k);
    if (!mine.length) return;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    swayInWind(mat, 0.35, 0.18);
    const mesh = new THREE.InstancedMesh(modelGeometry(name, leaves[k]!, wood), mat, mine.length);
    mine.forEach((o, i) => {
      q.setFromAxisAngle(up, o.r);
      m4.compose(new THREE.Vector3(o.x, groundHeight(o.x, o.z) - 0.1, o.z), q, new THREE.Vector3(o.s * 0.9, o.s, o.s * 0.9));
      mesh.setMatrixAt(i, m4);
    });
    mesh.receiveShadow = true;
    triangles += PACK[name].tris * mine.length;
    group.add(mesh);
  });
  // Bushes at the clearing's edge and along the path.
  const bushMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const bushes = new THREE.InstancedMesh(modelGeometry('bush_1', new THREE.Color('#33472f'), wood), bushMat, 40);
  let b = 0;
  guard = 0;
  while (b < 40 && guard++ < 4000) {
    const a = rnd() * Math.PI * 2;
    const d = 7 + rnd() * 26;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (Math.abs(x - pathX(z)) < 2.2 || Math.hypot(x, z) < 6.5) continue;
    const s = 0.7 + rnd() * 0.9;
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    m4.compose(new THREE.Vector3(x, groundHeight(x, z) - 0.05, z), q, new THREE.Vector3(s, s * 1.15, s));
    bushes.setMatrixAt(b++, m4);
  }
  bushes.count = b;
  bushes.receiveShadow = true;
  triangles += PACK.bush_1.tris * b;
  group.add(bushes);
  return { group, triangles };
}
