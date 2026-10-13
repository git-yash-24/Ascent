/**
 * The trail in the world.
 *
 *   WeekTrail  this week, close up: a camp for each day below today's fire, the obstacle Ari
 *              crossed on the way up to it, and faint posts for the days still ahead.
 *   YearRoute  the whole route from the first camp to the summit, the part walked lit, and one
 *              beacon where Ari stands.
 */
import * as THREE from 'three';
import type { DateKey, DayOutcome } from '../core/model/types';
import { glowTexture, groundHeight, heightAt, pathX } from '../prototype/feel3d/world';
import { dateSeed, dayBeat, type Beat } from './beats';
import { buildCampMark, buildObstacle } from './props';

/** Distance along the trail between two days' camps. */
export const DAY_GAP = 8;
/** Stages in the year's route: a full year of weekly climbs reaches the summit. */
export const YEAR_STAGES = 52;

export interface TrailDay {
  date: DateKey;
  label: string;
  outcome: DayOutcome | 'future';
  isToday: boolean;
}

export interface Anchor {
  date: DateKey;
  label: string;
  outcome: DayOutcome | 'future';
  isToday: boolean;
  /** Where the day ended (its camp). */
  pos: THREE.Vector3;
  /** Where the day started (the camp below). */
  from: THREE.Vector3;
  beat: Beat;
}

const GLOW: Record<string, { color: string; size: number; opacity: number }> = {
  closed: { color: '#ff8a3d', size: 3.2, opacity: 0.95 },
  partial: { color: '#ff8a3d', size: 2, opacity: 0.55 },
  rested: { color: '#bfe3ff', size: 2, opacity: 0.7 },
  excused: { color: '#aab3c2', size: 1.6, opacity: 0.5 },
  future: { color: '#ffffff', size: 0.9, opacity: 0.25 },
};

const trailPoint = (z: number, side = 0): THREE.Vector3 => {
  const x = pathX(z) + side;
  return new THREE.Vector3(x, groundHeight(x, z), z);
};

export class WeekTrail {
  readonly group = new THREE.Group();
  anchors: Anchor[] = [];
  private key = '';
  private glows: THREE.Sprite[] = [];
  private readonly glowTex = glowTexture();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** z of a day's camp: today is the fire (0); earlier days lie below (+z), later above. */
  static zOf(i: number, today: number): number {
    return (today - i) * DAY_GAP;
  }

  set(days: TrailDay[]): void {
    const key = days.map((d) => `${d.date}:${d.outcome}:${d.isToday ? 1 : 0}`).join('|');
    if (key === this.key) return;
    this.key = key;
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.glows = [];
    const ti = Math.max(0, days.findIndex((d) => d.isToday));
    this.anchors = days.map((d, i) => {
      const z = WeekTrail.zOf(i, ti);
      const beat = dayBeat(d.date, d.isToday ? 'inProgress' : d.outcome);
      const pos = d.isToday ? new THREE.Vector3(0, groundHeight(0, 0), -1.1) : trailPoint(z);
      const from = trailPoint(z + DAY_GAP);
      const seed = dateSeed(d.date);
      if (beat.obstacle && !d.isToday) this.group.add(buildObstacle(beat.obstacle, z + DAY_GAP * 0.5, seed));
      if (!d.isToday) {
        if (beat.camp !== 'none') this.group.add(buildCampMark(beat.camp, trailPoint(z, beat.camp === 'drift' ? 0 : 1.9), seed));
        if (d.outcome === 'future') this.group.add(post(trailPoint(z, 1.2)));
        const g = GLOW[d.outcome];
        if (g) {
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: g.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
          s.position.copy(trailPoint(z, 1.9)).add(new THREE.Vector3(0, 1.1, 0));
          s.scale.setScalar(g.size);
          s.userData.base = g.opacity;
          this.group.add(s);
          this.glows.push(s);
        }
      }
      return { date: d.date, label: d.label, outcome: d.outcome, isToday: d.isToday, pos, from, beat };
    });
  }

  /** The day glows show from the week screen on. */
  setGlow(v: number, t: number): void {
    this.glows.forEach((g, i) => (g.material.opacity = (g.userData.base as number) * v * (0.85 + 0.15 * Math.sin(t * 1.7 + i))));
  }
}

function post(p: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 5), new THREE.MeshLambertMaterial({ color: '#6b5440', flatShading: true }));
  stake.position.y = 0.55;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), new THREE.MeshLambertMaterial({ color: '#c9b79a', side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
  flag.position.set(0.16, 0.98, 0);
  g.add(stake, flag);
  g.position.copy(p);
  return g;
}

export class YearRoute {
  readonly group = new THREE.Group();
  readonly points: THREE.Vector3[] = [];
  private readonly lengths: number[] = [];
  private readonly walked: THREE.Mesh;
  private readonly ahead: THREE.Mesh;
  private readonly tubular = 400;
  private readonly radial = 5;
  readonly beacon: THREE.Group;
  private readonly beaconGlow: THREE.Sprite;
  private readonly beam: THREE.Mesh;
  private readonly dots: THREE.Sprite[] = [];
  private fraction = 0;

  constructor(scene: THREE.Scene, summit: THREE.Vector3) {
    // From the first camp up the near valley, then switchbacks across the midlands to the summit.
    for (let z = 0; z >= -190; z -= 2) {
      const x = pathX(z);
      this.points.push(new THREE.Vector3(x, heightAt(x, z) + 0.6, z));
    }
    const a = this.points[this.points.length - 1]!.clone();
    const n = 160;
    for (let i = 1; i <= n; i++) {
      const s = i / n;
      const z = THREE.MathUtils.lerp(a.z, summit.z + 10, s);
      const x = THREE.MathUtils.lerp(a.x, summit.x, s) + Math.sin(s * Math.PI * 6) * 34 * (1 - s) ** 0.7;
      const y = i === n ? summit.y - 4 : heightAt(x, z) + 2;
      this.points.push(new THREE.Vector3(x, y, z));
    }
    let total = 0;
    this.lengths.push(0);
    for (let i = 1; i < this.points.length; i++) {
      total += this.points[i]!.distanceTo(this.points[i - 1]!);
      this.lengths.push(total);
    }
    const curve = new THREE.CatmullRomCurve3(this.points);
    const mk = (color: string, opacity: number, radius: number): THREE.Mesh =>
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, this.tubular, radius, this.radial, false),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, fog: false, depthWrite: false }),
      );
    this.ahead = mk('#f1e6d2', 0.0, 1.1);
    this.walked = mk('#ff8a3d', 0.0, 1.7);
    this.group.add(this.ahead, this.walked);

    // Chapter marks along the route, every four stages.
    const tex = glowTexture();
    for (let k = 4; k < YEAR_STAGES; k += 4) {
      const d = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#ffe3b0', transparent: true, depthWrite: false, fog: false, opacity: 0 }));
      d.position.copy(this.at(k / YEAR_STAGES)).add(new THREE.Vector3(0, 3, 0));
      d.scale.setScalar(12);
      d.userData.f = k / YEAR_STAGES;
      this.dots.push(d);
      this.group.add(d);
    }

    // The beacon: where Ari stands on the year's route.
    this.beacon = new THREE.Group();
    this.beaconGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#ff7a3d', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.beaconGlow.scale.setScalar(70);
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 2.6, 160, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ff9a52', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }),
    );
    this.beam.position.y = 80;
    this.beacon.add(this.beaconGlow, this.beam);
    this.group.add(this.beacon);
    this.group.visible = false;
    scene.add(this.group);
    this.setProgress(0);
  }

  /** The point at fraction f (0 to 1) of the route's length. */
  at(f: number): THREE.Vector3 {
    const total = this.lengths[this.lengths.length - 1]!;
    const want = Math.max(0, Math.min(1, f)) * total;
    let i = 1;
    while (i < this.lengths.length - 1 && this.lengths[i]! < want) i++;
    const l0 = this.lengths[i - 1]!;
    const l1 = this.lengths[i]!;
    const u = l1 > l0 ? (want - l0) / (l1 - l0) : 0;
    return this.points[i - 1]!.clone().lerp(this.points[i]!, u);
  }

  setProgress(f: number): void {
    this.fraction = Math.max(0, Math.min(1, f));
    const per = this.radial * 6;
    // Tube indices run along the curve, so a draw range shows the walked part.
    this.walked.geometry.setDrawRange(0, Math.max(per, Math.round(this.fraction * this.tubular) * per));
    this.beacon.position.copy(this.at(this.fraction));
  }

  /** v: how much of the year view is showing (0 to 1). */
  update(v: number, t: number): void {
    this.group.visible = v > 0.01;
    if (!this.group.visible) return;
    (this.ahead.material as THREE.MeshBasicMaterial).opacity = 0.45 * v;
    (this.walked.material as THREE.MeshBasicMaterial).opacity = 0.95 * v;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
    this.beaconGlow.material.opacity = v * (0.75 + 0.25 * pulse);
    this.beaconGlow.scale.setScalar(60 + pulse * 26);
    (this.beam.material as THREE.MeshBasicMaterial).opacity = v * (0.22 + 0.12 * pulse);
    for (const d of this.dots) d.material.opacity = v * ((d.userData.f as number) <= this.fraction ? 0.9 : 0.35);
  }
}
