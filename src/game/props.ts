/**
 * Small low-poly props for the game screens: Ari's flask and journal, the trail's obstacles and
 * camp marks, and the ghost double that replays a past day (Pine's memory doubles, gate 1).
 * Built from primitives in the feel test's flat-shaded style.
 */
import * as THREE from 'three';
import { buildTent } from '../prototype/feel3d/camp';
import { groundHeight, pathX } from '../prototype/feel3d/world';
import { mulberry32 } from '../prototype/shared/noise';
import type { Climber } from '../prototype/feel3d/climber';
import type { Obstacle } from './beats';

const lambert = (color: string, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

/** The trusty flask: dented tin with a leather sleeve and a cap on a chain. Mouth at +y. */
export function buildFlask(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.16, 8), lambert('#9aa3ad'));
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.054, 0.08, 8), lambert('#5a3d27'));
  sleeve.position.y = -0.02;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, 0.04, 6), lambert('#9aa3ad'));
  neck.position.y = 0.1;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.025, 6), lambert('#2d2f33'));
  cap.position.y = 0.13;
  // A pale band on the tin where the water sits: the fill line, seen in the close-up.
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.057, 0.057, 0.01, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#bfeaff', transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  line.name = 'level';
  // An invisible, generous touch target, so the flask can be tapped in the world.
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  hit.name = 'hit';
  g.add(body, sleeve, neck, cap, line, hit);
  g.userData.mouth = new THREE.Vector3(0, 0.14, 0);
  /** 0 empty to 1 full: where the fill line sits on the tin. */
  g.userData.setLevel = (u: number): void => {
    line.visible = u > 0.02;
    line.position.y = -0.075 + Math.max(0, Math.min(1, u)) * 0.15;
  };
  (g.userData.setLevel as (u: number) => void)(0);
  return shadowed(g);
}

export interface Journal {
  group: THREE.Group;
  /** 0 closed, 1 open flat. */
  setOpen(u: number): void;
  pencil: THREE.Group;
}

/** Ari's journal: a worn red cloth cover, cream pages; opens about its spine (local z). */
export function buildJournal(): Journal {
  const group = new THREE.Group();
  const coverMat = lambert('#7a2f22');
  const pageMat = lambert('#e9dcc0');
  const lineMat = new THREE.MeshBasicMaterial({ color: '#8c7a5c' });
  const half = (side: 1 | -1): THREE.Group => {
    const pivot = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.008, 0.2), coverMat);
    cover.position.x = 0.075 * side;
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.014, 0.19), pageMat);
    pages.position.set(0.072 * side, 0.011, 0);
    pivot.add(cover, pages);
    // A few written lines on the right-hand page.
    if (side === 1) {
      for (let i = 0; i < 5; i++) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.09 - (i % 2) * 0.02, 0.001, 0.004), lineMat);
        l.position.set(0.07, 0.019, -0.06 + i * 0.028);
        pivot.add(l);
      }
    }
    return pivot;
  };
  const left = half(-1);
  const right = half(1);
  group.add(left, right);
  const pencil = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.13, 5), lambert('#c9a227'));
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.02, 5), lambert('#2d2f33'));
  tip.position.y = -0.075;
  tip.rotation.x = Math.PI;
  pencil.add(shaft, tip);
  const setOpen = (u: number): void => {
    const a = Math.max(0, Math.min(1, u));
    // Closed: the left half folded over the right. Open: a shallow V.
    left.rotation.z = -(1 - a) * (Math.PI - 0.06) + a * 0.14;
    right.rotation.z = -a * 0.14;
  };
  setOpen(0);
  shadowed(group);
  return { group, setOpen, pencil };
}

/** One obstacle crossing the path at depth z (the path runs along z). */
export function buildObstacle(kind: Obstacle, z: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const rnd = mulberry32(seed);
  const x0 = pathX(z);
  const at = (dx: number, dz: number, lift = 0): THREE.Vector3 => new THREE.Vector3(x0 + dx, groundHeight(x0 + dx, z + dz) + lift, z + dz);
  if (kind === 'stream') {
    // The water follows the ground, so the stream lies in its bed.
    g.add(groundSheet(x0, z, 6, 1.3, new THREE.MeshLambertMaterial({ color: '#6fa6c9', transparent: true, opacity: 0.85, emissive: '#1d3b52', flatShading: true }), 0.05, 0.25));
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), lambert('#6b665e'));
      s.position.copy(at(-0.4 + i * 0.4, -0.5 + i * 0.5, 0.08));
      s.scale.y = 0.5;
      g.add(s);
    }
  } else if (kind === 'boulders') {
    for (let i = 0; i < 6; i++) {
      const r = 0.4 + rnd() * 0.7;
      const b = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), lambert('#6b665e'));
      const side = i % 2 === 0 ? -1 : 1;
      b.position.copy(at(side * (0.9 + rnd() * 2.2), (rnd() - 0.5) * 2.4, r * 0.45));
      b.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      g.add(b);
    }
  } else if (kind === 'log') {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 4.6, 7), lambert('#5b4636'));
    log.rotation.z = Math.PI / 2;
    log.rotation.y = 0.25;
    log.position.copy(at(0, 0, 0.24));
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.5, 7), lambert('#4a3628'));
    stump.position.copy(at(2.4, 0.5, 0.25));
    g.add(log, stump);
  } else if (kind === 'ice') {
    // A frozen sheet over the path, lying on the ground.
    g.add(groundSheet(x0, z, 4.2, 1.8, new THREE.MeshLambertMaterial({ color: '#cfe8f2', transparent: true, opacity: 0.9, emissive: '#3a5866', flatShading: true }), 0.06));
  } else {
    const geo = new THREE.DodecahedronGeometry(0.14, 0);
    const mat = lambert('#7a746a');
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Mesh(geo, mat);
      s.position.copy(at((rnd() - 0.5) * 4.5, (rnd() - 0.5) * 2.2, 0.05));
      s.scale.setScalar(0.6 + rnd() * 1.4);
      g.add(s);
    }
  }
  return shadowed(g);
}

/** A thin sheet laid on the ground across the path (water, ice), following its slope. */
function groundSheet(x0: number, z: number, w: number, d: number, mat: THREE.Material, lift: number, wave = 0): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w, d, 12, 3);
  geo.rotateX(-Math.PI / 2);
  const pa = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pa.count; i++) {
    const x = x0 + pa.getX(i);
    const zz = z + pa.getZ(i) + Math.sin(pa.getX(i) * 0.9) * wave;
    pa.setXYZ(i, x, groundHeight(x, zz) + lift, zz);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/** The mark left at a day's camp. */
export function buildCampMark(kind: 'cairn' | 'tent' | 'storm' | 'drift', pos: THREE.Vector3, seed: number): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(pos);
  const rnd = mulberry32(seed);
  if (kind === 'cairn') {
    let y = 0;
    for (let i = 0; i < 4; i++) {
      const r = 0.24 - i * 0.045;
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), lambert('#77726a'));
      s.position.set((rnd() - 0.5) * 0.05, y + r * 0.7, 0);
      s.scale.y = 0.65;
      s.rotation.y = rnd() * 3;
      y += r * 1.15;
      g.add(s);
    }
  } else if (kind === 'tent' || kind === 'storm') {
    const t = buildTent(kind === 'storm' ? '#5d6470' : '#8a7a55');
    t.scale.setScalar(0.8);
    t.rotation.y = 0.5;
    g.add(t);
  } else {
    const drift = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), lambert('#e6ebf2'));
    drift.scale.set(2.2, 0.55, 0.9);
    g.add(drift);
  }
  return shadowed(g);
}

/** Turn a built climber into a ghost double: warm, translucent, glowing faintly. */
export function ghostify(c: Climber): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: '#ffd9b0', emissive: '#ff9a52', emissiveIntensity: 0.35, transparent: true, opacity: 0.55, depthWrite: false, flatShading: true });
  c.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.material = mat;
      m.castShadow = false;
    }
  });
  return mat;
}
