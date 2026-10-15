/**
 * Life round the camp (art direction): small, occasional and never in the way.
 *
 *   butterflies  over the meadow on warm, still, dry days in spring and summer; they wander,
 *                settle on a flower and open and close their wings, then go on
 *   birds        a loose flock crossing the sky now and then by day, a hawk circling on fair days
 *   rabbit       comes out of the grass in the soft hours (morning, evening), hops, nibbles,
 *                sits up with its ears turning, hops away; never in rain or snow
 *   deer         grazes at the forest edge at dawn and dusk, lifts its head to listen
 *
 * Everything is presentation only: it reads the hour, the season and the weather and writes
 * nothing. With reduced motion the animals stay away.
 */
import * as THREE from 'three';
import { groundHeight, pathX } from '../prototype/feel3d/world';
import type { Season } from './conditions';

const lam = (c: string): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color: c });

export interface FaunaState {
  t: number;
  dt: number;
  /** Sun elevation in degrees. */
  elev: number;
  season: Season;
  rain: number;
  snow: number;
  wind: number;
  cold: number;
  /** 0 near (camp, today) to 1 far (week and beyond). */
  far: number;
  reduced: boolean;
  /** Where Ari is, so nothing walks through her. */
  ari: THREE.Vector3;
}

// Butterflies ---------------------------------------------------------------------------------

const BUTTERFLIES = 9;
const WING_COLS = ['#f2c14e', '#f4f1e6', '#e8a0b4', '#7fb3d5', '#f08a4b', '#c9a0dc'];

function wingGeometry(): THREE.BufferGeometry {
  // Two rounded wings either side of a thin body; `aSide` (-1, 1) tells the shader which way to fold.
  const pos: number[] = [];
  const side: number[] = [];
  const col: number[] = [];
  const shape = (sx: number): void => {
    const pts: Array<[number, number]> = [[0, 0.02], [0.05, 0.06], [0.09, 0.05], [0.1, 0.0], [0.07, -0.03], [0.05, -0.06], [0.02, -0.05], [0, -0.02]];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      pos.push(0, 0, 0, a[0] * sx, 0, a[1], b[0] * sx, 0, b[1]);
      side.push(sx, sx, sx);
      const ea = Math.min(1, Math.hypot(a[0], a[1]) / 0.1);
      const eb = Math.min(1, Math.hypot(b[0], b[1]) / 0.1);
      col.push(0.55, 0.55, 0.55, 0.85 + ea * 0.15, 0.85 + ea * 0.15, 0.85 + ea * 0.15, 0.85 + eb * 0.15, 0.85 + eb * 0.15, 0.85 + eb * 0.15);
    }
  };
  shape(1);
  shape(-1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

interface Fly {
  home: THREE.Vector3;
  pos: THREE.Vector3;
  phase: number;
  speed: number;
  rest: number;
  next: number;
  heading: number;
  flap: number;
}

// Birds ---------------------------------------------------------------------------------------

function birdGeometry(): THREE.BufferGeometry {
  // A gull-wing silhouette: two bent wings and a body; `aSide` folds them in the shader.
  const pos = [
    0, 0, 0.18, 0, 0, -0.22, 0.06, 0, 0,
    0, 0, 0.18, -0.06, 0, 0, 0, 0, -0.22,
    0, 0, 0.06, 0.45, 0.05, -0.04, 0, 0, -0.08,
    0.45, 0.05, -0.04, 0.95, -0.06, -0.14, 0.4, 0.04, -0.12,
    0, 0, 0.06, 0, 0, -0.08, -0.45, 0.05, -0.04,
    -0.45, 0.05, -0.04, -0.4, 0.04, -0.12, -0.95, -0.06, -0.14,
  ];
  const side = [0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0.5, 1, 0.5, 0, 0, -0.5, -0.5, -0.5, -1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  return g;
}

/**
 * Fold geometry about its long axis by `aSide` times a flap angle; per instance `aFly` carries
 * the phase (x) and the strength (y: 1 flying, lower while settled).
 */
function flapping(mat: THREE.Material, uT: { value: number }, rate: number, amp: number): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = uT;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', `attribute float aSide; attribute vec2 aFly; uniform float uT;\nvoid main() {`)
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        float k = aFly.y;
        float a = (sin(uT * ${rate.toFixed(2)} * (0.35 + k * 0.65) + aFly.x) * ${amp.toFixed(2)} + 0.25) * (0.4 + k * 0.6);
        float r = abs(transformed.x);
        transformed.x = sign(transformed.x) * r * cos(a * abs(aSide));
        transformed.y += r * sin(a * abs(aSide));`,
      );
  };
  mat.customProgramCacheKey = () => `flap-${rate}-${amp}`;
}

// Rabbit and deer -----------------------------------------------------------------------------

function buildRabbit(): { root: THREE.Group; ears: THREE.Group[]; head: THREE.Group; body: THREE.Mesh } {
  const fur = lam('#9a7e62');
  const pale = lam('#e9e0d0');
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 9), fur);
  body.scale.set(0.85, 0.8, 1.25);
  body.position.y = 0.1;
  const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), fur);
  haunch.position.set(0, 0.07, -0.07);
  haunch.scale.set(1.3, 1, 1);
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), pale);
  tail.position.set(0, 0.12, -0.15);
  const head = new THREE.Group();
  head.position.set(0, 0.17, 0.11);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 9), fur);
  skull.scale.set(0.9, 0.9, 1.15);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), lam('#d88a8a'));
  nose.position.set(0, -0.005, 0.068);
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#141010' });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 4), eyeMat);
    eye.position.set(sx * 0.045, 0.015, 0.03);
    head.add(eye);
  }
  head.add(skull, nose);
  const ears: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(sx * 0.025, 0.04, -0.01);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), fur);
    e.scale.set(0.8, 3.4, 0.45);
    e.position.y = 0.07;
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), lam('#d8a8a0'));
    inner.scale.set(0.7, 3.6, 0.3);
    inner.position.set(0, 0.07, 0.008);
    ear.add(e, inner);
    ear.rotation.set(-0.3, 0, sx * 0.25);
    head.add(ear);
    ears.push(ear);
  }
  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), fur);
    foot.scale.set(0.8, 0.5, 2);
    foot.position.set(sx * 0.06, 0.02, -0.04);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5), pale);
    paw.position.set(sx * 0.04, 0.02, 0.09);
    root.add(foot, paw);
  }
  root.add(body, haunch, tail, head);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { root, ears, head, body };
}

function buildDeer(): { root: THREE.Group; neck: THREE.Group; ears: THREE.Object3D[]; tail: THREE.Object3D } {
  const coat = lam('#8a5a36');
  const pale = lam('#e8dcc8');
  const dark = lam('#3a2a20');
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 6, 12), coat);
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.95;
  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.4, 4, 10), pale);
  belly.rotation.x = Math.PI / 2;
  belly.position.set(0, 0.86, 0);
  const tail = new THREE.Group();
  tail.position.set(0, 1.03, -0.45);
  const tl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), pale);
  tl.scale.set(0.8, 1.4, 0.6);
  tl.position.y = -0.04;
  tail.add(tl);
  root.add(body, belly, tail);
  for (const [x, z] of [[-0.11, 0.3], [0.11, 0.3], [-0.11, -0.32], [0.11, -0.32]] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, 0.82, 6), coat);
    leg.position.set(x, 0.43, z);
    const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.05, 6), dark);
    hoof.position.set(x, 0.03, z);
    root.add(leg, hoof);
  }
  const neck = new THREE.Group();
  neck.position.set(0, 1.08, 0.36);
  const n = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.5, 8), coat);
  n.position.set(0, 0.2, 0.06);
  n.rotation.x = 0.45;
  const head = new THREE.Group();
  head.position.set(0, 0.42, 0.18);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), coat);
  skull.scale.set(0.85, 0.85, 1.1);
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.18, 8), coat);
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, -0.03, 0.12);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), dark);
  nose.position.set(0, -0.03, 0.21);
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#100c0a' });
  head.add(skull, snout, nose);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4), eyeMat);
    eye.position.set(sx * 0.07, 0.02, 0.05);
    head.add(eye);
  }
  const ears: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), coat);
    ear.scale.set(0.7, 1.8, 0.4);
    ear.position.set(sx * 0.08, 0.1, -0.02);
    ear.rotation.z = sx * -0.6;
    head.add(ear);
    ears.push(ear);
  }
  neck.add(n, head);
  root.add(neck);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { root, neck, ears, tail };
}

export class Fauna {
  readonly group = new THREE.Group();
  private readonly uT = { value: 0 };
  private readonly flies: THREE.InstancedMesh;
  private readonly fly: Fly[] = [];
  private readonly flyAttr: THREE.InstancedBufferAttribute;
  private flyK = 0;
  private readonly birds: THREE.InstancedMesh;
  private flock: { start: number; from: THREE.Vector3; dir: THREE.Vector3 } | null = null;
  private nextFlock = 25;
  private readonly rabbit = buildRabbit();
  private hop: { start: number; path: THREE.Vector3[]; leg: number; legStart: number; pause: number } | null = null;
  private nextRabbit = 20;
  private readonly deer = buildDeer();
  private deerK = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly c = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const wingMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    flapping(wingMat, this.uT, 22, 1.0);
    const wg = wingGeometry();
    this.flyAttr = new THREE.InstancedBufferAttribute(new Float32Array(BUTTERFLIES * 2), 2);
    wg.setAttribute('aFly', this.flyAttr);
    this.flies = new THREE.InstancedMesh(wg, wingMat, BUTTERFLIES);
    this.flies.frustumCulled = false;
    let s = 5;
    const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < BUTTERFLIES; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 2.4 + rnd() * 7;
      const home = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
      home.y = groundHeight(home.x, home.z);
      this.fly.push({ home, pos: home.clone(), phase: rnd() * 100, speed: 0.6 + rnd() * 0.5, rest: 0, next: 3 + rnd() * 8, heading: 0, flap: 1 });
      this.flies.setColorAt(i, this.c.set(WING_COLS[i % WING_COLS.length]!));
    }

    const birdMat = new THREE.MeshBasicMaterial({ color: '#2a2630', side: THREE.DoubleSide });
    flapping(birdMat, this.uT, 7, 0.55);
    const bg = birdGeometry();
    bg.setAttribute('aFly', new THREE.InstancedBufferAttribute(Float32Array.from({ length: 14 }, (_, i) => (i % 2 ? 1 : i * 0.9)), 2));
    this.birds = new THREE.InstancedMesh(bg, birdMat, 7);
    this.birds.frustumCulled = false;
    this.birds.visible = false;

    this.rabbit.root.visible = false;
    this.deer.root.visible = false;
    // The deer's place: the edge of the trees, across the meadow from the tent.
    const dx = 4.2;
    const dz = -15;
    this.deer.root.position.set(dx, groundHeight(dx, dz), dz);
    this.deer.root.rotation.y = -1.25;
    this.group.add(this.flies, this.birds, this.rabbit.root, this.deer.root);
    scene.add(this.group);
  }

  update(st: FaunaState): void {
    const { t, dt } = st;
    this.uT.value = t;
    const day = st.elev > 3;
    const fair = st.rain < 0.05 && st.snow < 0.05;
    const near = st.far < 0.7;

    // Butterflies: spring and summer, warm, dry and not too windy.
    const flyWant = !st.reduced && day && fair && st.wind < 0.55 && st.cold < 0.35 && near ? (st.season === 'summer' ? 1 : st.season === 'spring' ? 0.8 : st.season === 'autumn' ? 0.25 : 0) : 0;
    this.flyK += (flyWant - this.flyK) * Math.min(1, dt * 0.5);
    this.flies.visible = this.flyK > 0.02;
    if (this.flies.visible) {
      const n = Math.round(BUTTERFLIES * this.flyK);
      for (let i = 0; i < BUTTERFLIES; i++) {
        const f = this.fly[i]!;
        f.next -= dt;
        if (f.rest > 0) {
          // Settled on a flower: wings open and close slowly.
          f.rest -= dt;
          f.flap = 0.35;
          if (f.rest <= 0) f.next = 4 + Math.random() * 8;
        } else {
          f.flap = 1;
          const tt = t * f.speed + f.phase;
          const target = new THREE.Vector3(
            f.home.x + Math.sin(tt * 0.7) * 1.6 + Math.sin(tt * 1.9) * 0.4,
            f.home.y + 0.45 + Math.sin(tt * 1.3) * 0.25 + Math.abs(Math.sin(tt * 5.2)) * 0.12,
            f.home.z + Math.cos(tt * 0.6) * 1.4 + Math.cos(tt * 2.3) * 0.35,
          );
          target.x += st.wind * 0.6;
          const prev = f.pos.clone();
          f.pos.lerp(target, Math.min(1, dt * 2.5));
          const v = f.pos.clone().sub(prev);
          if (v.lengthSq() > 1e-7) f.heading = Math.atan2(v.x, v.z);
          if (f.next <= 0) {
            f.rest = 2.5 + Math.random() * 4;
            f.pos.y = groundHeight(f.pos.x, f.pos.z) + 0.17;
          }
        }
        // Keep clear of Ari's face.
        const away = f.pos.clone().sub(st.ari);
        if (away.lengthSq() < 0.5) f.pos.addScaledVector(away.normalize(), dt * 1.5);
        const visible = i < n;
        this.e.set(f.rest > 0 ? 0 : 0.25, f.heading, 0);
        this.q.setFromEuler(this.e);
        this.m.compose(f.pos, this.q, new THREE.Vector3().setScalar(visible ? 1.7 : 0));
        this.flies.setMatrixAt(i, this.m);
        this.flyAttr.setXY(i, f.phase, f.flap);
      }
      this.flies.instanceMatrix.needsUpdate = true;
      this.flyAttr.needsUpdate = true;
    }

    // Birds: now and then a loose flock crosses high over the valley.
    if (!this.flock && t > this.nextFlock && day && st.rain < 0.5 && !st.reduced) {
      const a = Math.random() * Math.PI * 2;
      const from = new THREE.Vector3(Math.cos(a) * 160, 45 + Math.random() * 30, Math.sin(a) * 160 - 60);
      const dir = from.clone().multiplyScalar(-1).setY(0).normalize();
      this.flock = { start: t, from, dir };
    }
    if (this.flock) {
      const u = t - this.flock.start;
      const speed = 11;
      this.birds.visible = true;
      const side = new THREE.Vector3(-this.flock.dir.z, 0, this.flock.dir.x);
      for (let i = 0; i < 7; i++) {
        const rank = Math.ceil(i / 2);
        const sx = i === 0 ? 0 : i % 2 ? 1 : -1;
        const p = this.flock.from
          .clone()
          .addScaledVector(this.flock.dir, u * speed - rank * 3.2 + Math.sin(u * 0.7 + i) * 0.6)
          .addScaledVector(side, sx * rank * 2.6 + Math.sin(u * 0.5 + i * 2) * 0.5);
        p.y += Math.sin(u * 0.9 + i) * 1.2;
        this.e.set(0, Math.atan2(this.flock.dir.x, this.flock.dir.z), Math.sin(u * 0.6 + i) * 0.15);
        this.q.setFromEuler(this.e);
        this.m.compose(p, this.q, new THREE.Vector3().setScalar(1.6));
        this.birds.setMatrixAt(i, this.m);
      }
      this.birds.instanceMatrix.needsUpdate = true;
      if (u * speed > 340) {
        this.flock = null;
        this.birds.visible = false;
        this.nextFlock = t + 40 + Math.random() * 70;
      }
    }

    this.updateRabbit(st, fair);

    // Deer: the soft hours only, at the forest edge, in fair weather.
    const soft = st.elev > -4 && st.elev < 14;
    const deerWant = soft && fair && near && !st.reduced ? 1 : 0;
    this.deerK += (deerWant - this.deerK) * Math.min(1, dt * 0.3);
    this.deer.root.visible = this.deerK > 0.05;
    if (this.deer.root.visible) {
      // Graze with the head down, then lift it to listen, ears turning.
      const cyc = (t * 0.11) % 1;
      const up = THREE.MathUtils.smoothstep(cyc, 0.55, 0.62) * (1 - THREE.MathUtils.smoothstep(cyc, 0.86, 0.93));
      this.deer.neck.rotation.x = 1.15 * (1 - up) - 0.1 + Math.sin(t * 3) * 0.02 * (1 - up);
      this.deer.neck.rotation.y = up * Math.sin(t * 0.7) * 0.4;
      this.deer.ears.forEach((e, i) => (e.rotation.y = up * Math.sin(t * 2.3 + i * 2) * 0.5));
      this.deer.tail.rotation.x = Math.max(0, Math.sin(t * 4.3)) * 0.4 * (Math.sin(t * 0.4) > 0.6 ? 1 : 0);
      this.deer.root.scale.setScalar(this.deerK < 1 ? 0.999 : 1);
    }
  }

  /** Something worth a look from `from`: a rabbit in the open, or a butterfly close by. */
  interest(from: THREE.Vector3): THREE.Vector3 | null {
    if (this.hop && this.rabbit.root.visible) {
      const p = this.rabbit.root.position;
      if (p.distanceTo(from) < 12) return p.clone().setY(p.y + 0.1);
    }
    if (this.flies.visible) {
      let best: THREE.Vector3 | null = null;
      let d = 2.6;
      for (const f of this.fly) {
        const k = f.pos.distanceTo(from);
        if (k < d) {
          d = k;
          best = f.pos;
        }
      }
      if (best) return best.clone();
    }
    return null;
  }

  private updateRabbit(st: FaunaState, fair: boolean): void {
    const { t, dt } = st;
    const r = this.rabbit;
    const soft = st.elev > -3 && st.elev < 25;
    if (!this.hop && t > this.nextRabbit && soft && fair && st.far < 0.7 && !st.reduced) {
      // In from the grass on one side, a few hops across the meadow in front of camp, out again.
      const sgn = Math.random() < 0.5 ? -1 : 1;
      // Across the meadow beyond Ari, in the open part of the picture.
      const z0 = -(4.5 + Math.random() * 3);
      const path: THREE.Vector3[] = [];
      for (let k = 0; k <= 9; k++) {
        const x = sgn * (8 - k * 1.7);
        const z = z0 + Math.sin(k * 1.3) * 0.8;
        if (Math.abs(x - pathX(z)) < 0.6) continue;
        path.push(new THREE.Vector3(x, groundHeight(x, z), z));
      }
      this.hop = { start: t, path, leg: 0, legStart: t, pause: 0 };
      r.root.visible = true;
      r.root.position.copy(path[0]!);
    }
    if (!this.hop) return;
    const h = this.hop;
    const a = h.path[h.leg]!;
    const b = h.path[h.leg + 1];
    if (!b) {
      this.hop = null;
      r.root.visible = false;
      this.nextRabbit = t + 50 + Math.random() * 80;
      return;
    }
    const legT = t - h.legStart;
    const hopDur = 0.42;
    if (legT < hopDur) {
      const u = legT / hopDur;
      r.root.position.lerpVectors(a, b, u);
      r.root.position.y += Math.sin(u * Math.PI) * 0.22;
      r.root.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      r.body.scale.set(0.85, 0.8 - Math.sin(u * Math.PI) * 0.12, 1.25 + Math.sin(u * Math.PI) * 0.2);
      r.head.rotation.x = -0.2;
      r.ears.forEach((e) => (e.rotation.x = -0.3 - Math.sin(u * Math.PI) * 0.5));
    } else {
      // Between hops: sometimes a nibble, sometimes it sits up and listens.
      if (h.pause === 0) h.pause = Math.random() < 0.3 ? 1.6 + Math.random() * 1.5 : 0.25 + Math.random() * 0.3;
      const p = legT - hopDur;
      const listen = h.pause > 1 ? Math.sin(Math.min(1, p / h.pause) * Math.PI) : 0;
      r.body.scale.set(0.85, 0.8 + listen * 0.12, 1.25 - listen * 0.15);
      r.head.rotation.x = listen > 0 ? -0.4 * listen : 0.35 + Math.sin(t * 14) * 0.05;
      r.ears.forEach((e, i) => {
        e.rotation.x = -0.3 + listen * 0.25;
        e.rotation.y = listen * Math.sin(t * 3 + i * 2) * 0.5;
      });
      if (p > h.pause) {
        h.leg++;
        h.legStart = t;
        h.pause = 0;
      }
    }
    void dt;
  }
}
