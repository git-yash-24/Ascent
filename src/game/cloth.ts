/**
 * Cloth that moves (art direction: "alive"): Ari's cape and scarf tails as small verlet
 * simulations. Pinned rows follow her joints; gravity, the shared wind and her own movement do
 * the rest; capsules keep the cloth off her body and her seat, and it never sinks into the ground.
 *
 * Cheap on a phone: the cape is 7 by 10 particles, the scarf two chains of 7, three constraint
 * passes a frame on a fixed step.
 */
import * as THREE from 'three';

interface Particle {
  p: THREE.Vector3;
  prev: THREE.Vector3;
  pinned: boolean;
}

interface Link {
  a: number;
  b: number;
  rest: number;
  k: number;
}

export interface Capsule {
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
}

export interface ClothEnv {
  /** World wind (x, z) times strength, and a gust 0..1. */
  wind: THREE.Vector2;
  gust: number;
  time: number;
  /** Ground height under a point. */
  ground: (x: number, z: number) => number;
  capsules: Capsule[];
}

const STEP = 1 / 60;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

function pushOut(p: THREE.Vector3, c: Capsule): void {
  const ab = tmp.copy(c.b).sub(c.a);
  const t = THREE.MathUtils.clamp(tmp2.copy(p).sub(c.a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
  const closest = ab.multiplyScalar(t).add(c.a);
  const d = tmp2.copy(p).sub(closest);
  const l = d.length();
  if (l < c.r && l > 1e-6) p.addScaledVector(d, (c.r - l) / l);
}

export class ClothSheet {
  readonly mesh: THREE.Mesh;
  private readonly pts: Particle[] = [];
  private readonly links: Link[] = [];
  private readonly geo: THREE.BufferGeometry;
  private acc = 0;
  private placed = false;

  /**
   * `cols` x `rows` particles; `pin(i)` gives the world position of pinned column i (row 0)
   * each frame, `width(v)` the sheet's width at row fraction v, `drop` its length.
   */
  constructor(
    private readonly cols: number,
    private readonly rows: number,
    private readonly drop: number,
    material: THREE.Material,
    private readonly drag = 0.985,
    private readonly windK = 1,
  ) {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) this.pts.push({ p: new THREE.Vector3(), prev: new THREE.Vector3(), pinned: j === 0 });
    }
    const id = (i: number, j: number): number => j * cols + i;
    const segV = drop / (rows - 1);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (i < cols - 1) this.links.push({ a: id(i, j), b: id(i + 1, j), rest: 0, k: 1 });
        if (j < rows - 1) this.links.push({ a: id(i, j), b: id(i, j + 1), rest: segV, k: 1 });
        if (i < cols - 1 && j < rows - 1) {
          this.links.push({ a: id(i, j), b: id(i + 1, j + 1), rest: 0, k: 0.5 });
          this.links.push({ a: id(i + 1, j), b: id(i, j + 1), rest: 0, k: 0.5 });
        }
        if (j < rows - 2) this.links.push({ a: id(i, j), b: id(i, j + 2), rest: segV * 2, k: 0.3 });
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cols * rows * 3), 3));
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) uv.push(i / (cols - 1), j / (rows - 1));
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = id(i, j);
        idx.push(a, id(i, j + 1), a + 1, a + 1, id(i, j + 1), id(i + 1, j + 1));
      }
    }
    this.geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  /** Lay the sheet straight down from its pins (at start, or after a jump). */
  private place(pins: THREE.Vector3[], widthAt: (v: number) => number, back: THREE.Vector3): void {
    const segV = this.drop / (this.rows - 1);
    const first = pins[0]!;
    const last = pins[this.cols - 1]!;
    const axis = tmp2.copy(last).sub(first);
    if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
    axis.normalize();
    const centre = first.clone().add(last).multiplyScalar(0.5);
    for (let j = 0; j < this.rows; j++) {
      const v = j / (this.rows - 1);
      for (let i = 0; i < this.cols; i++) {
        const u = i / (this.cols - 1) - 0.5;
        const p = this.pts[j * this.cols + i]!;
        if (j === 0) p.p.copy(pins[i]!);
        else p.p.copy(centre).addScaledVector(axis, u * widthAt(v)).addScaledVector(back, j * segV * 0.55).setY(centre.y - j * segV * 0.84);
        p.prev.copy(p.p);
      }
    }
    // Rest lengths follow the width profile.
    for (const l of this.links) {
      const ja = Math.floor(l.a / this.cols);
      const jb = Math.floor(l.b / this.cols);
      const ia = l.a % this.cols;
      const ib = l.b % this.cols;
      const w = ((widthAt(ja / (this.rows - 1)) + widthAt(jb / (this.rows - 1))) / 2 / (this.cols - 1)) * Math.abs(ib - ia);
      if (ja === jb) l.rest = w;
      else if (ia !== ib) l.rest = Math.hypot(w, segV * Math.abs(jb - ja));
    }
    this.placed = true;
  }

  /** `back`: the direction the sheet should first fall away to (behind her, for the cape). */
  update(dt: number, pins: THREE.Vector3[], widthAt: (v: number) => number, env: ClothEnv, back = new THREE.Vector3()): void {
    if (!this.placed || pins[0]!.distanceTo(this.pts[0]!.p) > 0.6) this.place(pins, widthAt, back);
    this.acc = Math.min(this.acc + dt, STEP * 6);
    const g = -9.8 * STEP * STEP;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      for (let i = 0; i < this.pts.length; i++) {
        const q = this.pts[i]!;
        if (q.pinned) {
          q.prev.copy(q.p);
          q.p.copy(pins[i]!);
          continue;
        }
        const row = Math.floor(i / this.cols) / (this.rows - 1);
        // Wind: stronger toward the hem, fluttering on its own small waves.
        const flutter = Math.sin(env.time * 7 + i * 0.7) * 0.35 + Math.sin(env.time * 3.1 + i * 1.3) * 0.25;
        const wk = (0.6 + env.gust * 0.9 + flutter * 0.4) * (0.35 + row * 0.65) * this.windK * STEP * STEP * 2.2;
        const vx = (q.p.x - q.prev.x) * this.drag;
        const vy = (q.p.y - q.prev.y) * this.drag;
        const vz = (q.p.z - q.prev.z) * this.drag;
        q.prev.copy(q.p);
        q.p.x += vx + env.wind.x * wk;
        q.p.y += vy + g + Math.abs(flutter) * env.wind.length() * wk * 0.2;
        q.p.z += vz + env.wind.y * wk;
      }
      for (let it = 0; it < 3; it++) {
        for (const l of this.links) {
          const a = this.pts[l.a]!;
          const b = this.pts[l.b]!;
          const d = tmp.copy(b.p).sub(a.p);
          const len = d.length() || 1e-6;
          const diff = ((len - l.rest) / len) * l.k;
          if (a.pinned && b.pinned) continue;
          if (a.pinned) b.p.addScaledVector(d, -diff);
          else if (b.pinned) a.p.addScaledVector(d, diff);
          else {
            a.p.addScaledVector(d, diff * 0.5);
            b.p.addScaledVector(d, -diff * 0.5);
          }
        }
        for (const q of this.pts) {
          if (q.pinned) continue;
          for (const c of env.capsules) pushOut(q.p, c);
          const gy = env.ground(q.p.x, q.p.z) + 0.02;
          if (q.p.y < gy) {
            q.p.y = gy;
            q.prev.x = q.p.x - (q.p.x - q.prev.x) * 0.5;
            q.prev.z = q.p.z - (q.p.z - q.prev.z) * 0.5;
          }
        }
      }
    }
    const pa = this.geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i]!.p;
      pa.setXYZ(i, p.x, p.y, p.z);
    }
    pa.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
