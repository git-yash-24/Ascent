/**
 * The world behind the game screens: one WebGL scene, one camera.
 *
 *   view     the pager position: 0 base camp, 1 today, 2 week, 3 month, 4 year (fractional while
 *            swiping). Base camp is Ari at the same fire, writing in his journal. Week is this
 *            week's stretch of trail, close enough to see him and what he crossed. Month pulls
 *            back to the valley; year shows the whole mountain, the route and one beacon.
 *   day      today's progress and whether it is closed: Ari's posture, the fire, the reward walk.
 *   actions  short scenes layered over whatever he is doing: drinking from his flask (any screen,
 *            any time water is logged), a nod when a habit is done, a look when you touch him.
 *   replay   a past day as a quick montage: hard camera cuts around his ghost double crossing
 *            that day's obstacle, timed with the captions the game screen shows.
 *
 * The checklist never waits on any of this; without WebGL the screens run on a painted sky.
 */
import * as THREE from 'three';
import { buildWorld, glowTexture, groundHeight, pathX } from '../prototype/feel3d/world';
import { buildCamp } from '../prototype/feel3d/camp';
import { buildClimber, POSES, lerpPose, walkPose, type Climber, type Joint, type Pose } from '../prototype/feel3d/climber';
import { RISE, SCRIPT, type Rot } from '../prototype/shared/poses';
import { createSound, type Sound } from '../prototype/shared/audio';
import { buildFlask, buildJournal, ghostify, type Journal } from './props';
import { DAY_GAP, WeekTrail, YearRoute, YEAR_STAGES, type Anchor, type TrailDay } from './trail';

export type { Anchor, TrailDay };

interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const UP = v(0, 1, 0);

const MONTH_SHOT: Shot = { pos: v(110, 170, 300), look: v(-40, 10, -160) };
const YEAR_SHOT: Shot = { pos: v(430, 980, 330), look: v(-70, 40, -430) };
/** How far up the closed day's walk takes him: to tomorrow's camp. */
const WALK_TO = DAY_GAP - 1.6;
/** The world is framed a little high so the glass checklist sits over the ground. */
const FRAME_SHIFT = 0.07;

type Phase = 'sit' | 'rise' | 'walk' | 'stand';
type ActKind = 'drink' | 'nod' | 'look';
interface Act {
  kind: ActKind;
  start: number;
  dur: number;
}

interface Mote {
  s: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
}

export interface DayInput {
  /** Today's progress f, 0 to 1. */
  progress: number;
  closed: boolean;
  /** True when this change came from a tap now (plays the reward); false at load or on sync. */
  live: boolean;
}

export interface Projected {
  x: number;
  y: number;
  visible: boolean;
}

export class Stage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 5000);
  private readonly world;
  private readonly camp;
  private readonly climber: Climber;
  private readonly trail: WeekTrail;
  private readonly route: YearRoute;
  private readonly flask: THREE.Group;
  private readonly journal: Journal;
  private readonly finder: THREE.Sprite;
  private readonly spark: THREE.Sprite;
  private readonly relief: THREE.Sprite;
  private readonly hemi: THREE.HemisphereLight;
  private readonly snow: THREE.Points;
  private readonly motes: Mote[] = [];
  private readonly glowTex = glowTexture();
  private readonly sound: Sound;
  private ghost: Climber | null = null;
  private soundOn = true;
  private readonly reduced: boolean;

  private view = 1;
  private phase: Phase = 'sit';
  private phaseStart = 0;
  private clock = 0;
  private progress = 0;
  private walked = 0;
  private walkPhase = 0;
  private lastStepSign = 0;
  private pickedUp = false;
  private kicked = false;
  private sparkT = -1;
  private sparkFrom = new THREE.Vector3();
  private acts: Act[] = [];
  private journalW = 0;
  private journalOpen = 0;
  private scribbleUntil = 0;
  private reliefT = -1;
  private camPos = v(1.15, 1.0, 2.5);
  private camLook = v(0.05, 0.62, -0.8);
  private shift = FRAME_SHIFT;
  private montage: { anchor: Anchor; start: number; card: number; cards: number; lastCut: number } | null = null;
  private running = true;
  private dimmed = false;
  private last = performance.now();
  private raf = 0;
  /** A fixed camera for tuning poses (?debug only). */
  debugShot: Shot | null = null;
  /** Called after every drawn frame (the game screen places its labels here). */
  onFrame: (() => void) | null = null;

  /** Returns null when WebGL is unavailable; the caller shows the painted fallback. */
  static create(canvas: HTMLCanvasElement, opts: { reducedMotion: boolean }): Stage | null {
    try {
      const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      return new Stage(canvas, r, opts.reducedMotion);
    } catch (e) {
      console.warn('Ascent: the world could not start', e);
      return null;
    }
  }

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    renderer: THREE.WebGLRenderer,
    reducedMotion: boolean,
  ) {
    this.renderer = renderer;
    this.reduced = reducedMotion;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.fog = new THREE.Fog('#5a4b5e', 30, 1300);
    this.hemi = new THREE.HemisphereLight('#7a7eac', '#2e261b', 1.35);
    this.scene.add(this.hemi);
    const lastLight = new THREE.DirectionalLight('#ffb27a', 0.9);
    lastLight.position.set(-80, 18, -40);
    this.scene.add(lastLight);

    this.sound = createSound();
    this.world = buildWorld(this.scene);
    this.camp = buildCamp(this.scene, coarse ? 512 : 1024);
    this.climber = buildClimber();
    this.scene.add(this.climber.root);
    this.scene.add(this.climber.satchel);
    this.trail = new WeekTrail(this.scene);
    this.route = new YearRoute(this.scene, this.world.summitLight.position.clone());

    this.flask = buildFlask();
    this.journal = buildJournal();
    this.journal.group.visible = false;
    this.climber.root.add(this.journal.group);
    this.climber.joints.elbowR.add(this.journal.pencil);
    this.journal.pencil.position.set(0.02, -0.33, 0.04);
    this.journal.pencil.rotation.set(0.5, 0, 0.3);
    this.journal.pencil.visible = false;
    this.holster();
    this.seat();

    const glow = (color: string, opacity = 0): THREE.Sprite => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity, fog: false }));
      this.scene.add(s);
      return s;
    };
    this.finder = glow('#ff7a3d');
    this.spark = glow('#ffcf8a');
    this.relief = glow('#9fe7ff');
    this.snow = this.buildSnow();

    const start = (): void => {
      if (!this.sound.started && this.soundOn) void this.sound.start();
    };
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    document.addEventListener('visibilitychange', () => this.setRunning(!document.hidden));
    this.raf = requestAnimationFrame((t) => this.frame(t));
    if (location.search.includes('debug')) (window as unknown as { __stage: Stage }).__stage = this;
  }

  // Inputs ----------------------------------------------------------------------------------

  setView(p: number): void {
    this.view = Math.max(0, Math.min(4, p));
  }

  /** Pause drawing while the detail covers the world (saves battery on long scrolls). */
  setDimmed(d: boolean): void {
    this.dimmed = d;
  }

  setSound(on: boolean): void {
    this.soundOn = on;
    this.sound.setMuted(!on);
  }

  setDay(d: DayInput): void {
    this.progress = d.progress;
    if (d.closed) {
      if (this.phase === 'sit') {
        if (d.live && !this.reduced) this.setPhase('rise');
        else this.onRoute(WALK_TO);
      }
    } else if (this.phase !== 'sit') {
      this.seat();
    }
    if (this.phase === 'sit') this.camp.fire.target = 0.12 + 0.88 * Math.min(1, d.progress);
  }

  setWeek(days: TrailDay[]): void {
    this.trail.set(days);
  }

  /** The year route's progress, by stages climbed. */
  setStage(stage: number): void {
    this.route.setProgress(stage / YEAR_STAGES);
  }

  get anchors(): Anchor[] {
    return this.trail.anchors;
  }

  /** A habit tapped: a spark flies from the chip into the fire; done earns a nod. */
  pulse(clientX: number, clientY: number, done: boolean): void {
    if (done) {
      this.sound.tick();
      this.act('nod', 0.8);
    }
    if (this.phase !== 'sit' || this.view > 1.5 || this.reduced) return;
    const r = this.canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((clientY - r.top) / r.height) * 2 - 1);
    this.sparkFrom.set(nx, Math.max(-1.6, ny), 0.2).unproject(this.camera);
    this.sparkT = 0;
  }

  /** A glass of water: Ari drinks from his flask, wherever the screen is. */
  drink(): void {
    if (this.acts.some((a) => a.kind === 'drink')) return;
    this.act('drink', this.reduced ? 1.6 : 3.6);
  }

  /** Typing in the journal: his pencil keeps pace. */
  scribble(): void {
    if (this.clock > this.scribbleUntil - 0.6) this.sound.scribble();
    this.scribbleUntil = this.clock + 1.2;
  }

  /** A touch on the world: Ari looks up at you, or the fire throws sparks. */
  poke(clientX: number, clientY: number): void {
    if (this.montage) return;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    if (ray.intersectObject(this.climber.root, true).length) {
      this.act('look', 2.4);
      this.puff(1.4);
      return;
    }
    if (ray.intersectObject(this.camp.fire.group, true).length && this.view < 1.6) {
      this.camp.fire.level = Math.min(1, this.camp.fire.level + 0.35);
      this.sound.thud();
      for (let i = 0; i < 14; i++) this.mote('#ffb066', v(0, 0.35, 0), v((Math.random() - 0.5) * 0.8, 1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 0.8), 1.4, 0.09);
    }
  }

  whoosh(): void {
    this.sound.whoosh();
  }

  /** Replay a day: `cards` beats of `card` seconds each. */
  playMontage(anchor: Anchor, cards: number, card: number): void {
    this.montage = { anchor, start: this.clock, card, cards, lastCut: -1 };
    this.sound.whoosh();
    if (!anchor.isToday) {
      if (!this.ghost) {
        this.ghost = buildClimber();
        ghostify(this.ghost);
        this.scene.add(this.ghost.root);
      }
      this.ghost.root.visible = true;
    }
  }

  endMontage(): void {
    this.montage = null;
    if (this.ghost) this.ghost.root.visible = false;
  }

  /** Screen position of a world point, in client pixels. */
  project(p: THREE.Vector3): Projected {
    const q = p.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((q.x + 1) / 2) * r.width, y: r.top + ((1 - q.y) / 2) * r.height, visible: q.z < 1 && Math.abs(q.x) < 1.2 && Math.abs(q.y) < 1.2 };
  }

  get beacon(): THREE.Vector3 {
    return this.route.beacon.position.clone().add(v(0, 40, 0));
  }

  get viewPos(): number {
    return this.view;
  }

  // Internals -------------------------------------------------------------------------------

  private act(kind: ActKind, dur: number): void {
    this.acts = this.acts.filter((a) => a.kind !== kind);
    this.acts.push({ kind, start: this.clock, dur });
    if (kind === 'drink') this.sound.rustle();
  }

  private actT(kind: ActKind): number {
    const a = this.acts.find((x) => x.kind === kind);
    return a ? this.clock - a.start : -1;
  }

  private setRunning(on: boolean): void {
    if (on === this.running) return;
    this.running = on;
    if (on) {
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.frame(t));
    } else cancelAnimationFrame(this.raf);
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseStart = this.clock;
  }

  /** The flask rides on his belt, right side, until he drinks. */
  private holster(): void {
    this.climber.joints.spine.add(this.flask);
    this.flask.position.set(-0.2, -0.02, 0.07);
    this.flask.rotation.set(0.1, 0, 0.25);
  }

  /** In his right hand, mouth toward the lips when the arm is raised. */
  private inHand(): void {
    this.climber.joints.elbowR.add(this.flask);
    // With the forearm raised, local +z points back toward his face: the flask's mouth goes
    // there, tilted up, its base high, the way you drink from a flask.
    this.flask.position.set(0, -0.31, 0.02);
    this.flask.rotation.set(2.09, 0, 0);
  }

  /** Ari at the fire, satchel on the ground. */
  private seat(): void {
    const c = this.climber;
    c.root.position.set(0, this.camp.seat.position.y - 0.17, this.camp.seat.position.z);
    c.root.rotation.set(0, 0, 0);
    this.scene.add(c.satchel);
    c.satchel.position.copy(this.camp.satchelSpot);
    c.satchel.rotation.set(0, 0.4, 0.12);
    this.pickedUp = false;
    this.kicked = false;
    this.walked = 0;
    this.sound.setWalking(false);
    this.setPhase('sit');
  }

  private shoulder(): void {
    const c = this.climber;
    c.joints.spine.add(c.satchel);
    c.satchel.position.set(0.02, 0.22, -0.2);
    c.satchel.rotation.set(0.15, Math.PI, 0.25);
    this.pickedUp = true;
  }

  /** Ari already on the route (a day closed before this screen opened). */
  private onRoute(distance: number): void {
    this.shoulder();
    this.kicked = true;
    this.camp.fire.target = 0.12;
    this.walked = distance;
    this.placeOnPath();
    this.setPhase(distance >= WALK_TO ? 'stand' : 'walk');
  }

  private pathPoint(s: number): THREE.Vector3 {
    const z = this.camp.seat.position.z - s;
    const x = pathX(z);
    return new THREE.Vector3(x, groundHeight(x, z), z);
  }

  private placeOnPath(): void {
    const p = this.pathPoint(this.walked);
    const ahead = this.pathPoint(this.walked + 0.6);
    this.climber.root.position.copy(p);
    this.climber.root.rotation.y = Math.atan2(ahead.x - p.x, ahead.z - p.z);
  }

  private resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 60 : 46;
    this.camera.updateProjectionMatrix();
  }

  private buildSnow(): THREE.Points {
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = Math.random() * 18;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: '#dfe6f0', size: 0.05, transparent: true, opacity: 0.7, depthWrite: false, fog: false }));
    pts.frustumCulled = false;
    this.scene.add(pts);
    return pts;
  }

  /** Light snow around the camera: the world never stands still. */
  private updateSnow(dt: number): void {
    const a = this.snow.geometry.attributes.position as THREE.BufferAttribute;
    const c = this.camera.position;
    const t = this.clock;
    for (let i = 0; i < a.count; i++) {
      let x = a.getX(i) + Math.sin(t * 0.7 + i) * 0.2 * dt;
      let y = a.getY(i) - (0.35 + (i % 7) * 0.05) * dt;
      let z = a.getZ(i) + 0.15 * dt;
      if (y < c.y - 9) y += 18;
      if (x < c.x - 15) x += 30;
      else if (x > c.x + 15) x -= 30;
      if (z < c.z - 15) z += 30;
      else if (z > c.z + 15) z -= 30;
      a.setXYZ(i, x, y, z);
    }
    a.needsUpdate = true;
    (this.snow.material as THREE.PointsMaterial).opacity = 0.7 * (1 - clamp01(this.view - 1.6));
  }

  private mote(color: string, from: THREE.Vector3, vel: THREE.Vector3, life: number, size: number): void {
    let m = this.motes.find((x) => x.life <= 0);
    if (!m) {
      if (this.motes.length > 40) return;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
      this.scene.add(s);
      m = { s, vel: new THREE.Vector3(), life: 0, max: 1, size };
      this.motes.push(m);
    }
    m.s.material.color.set(color);
    m.s.position.copy(from);
    m.vel.copy(vel);
    m.life = m.max = life;
    m.size = size;
  }

  private puff(scale: number): void {
    const at = new THREE.Vector3();
    this.climber.mouth.getWorldPosition(at);
    const fwd = v(0, 0, 1).applyQuaternion(this.climber.root.quaternion);
    this.mote('#dfe6f0', at, fwd.multiplyScalar(0.25).add(v(0, 0.15, 0)), 1.8, 0.12 * scale);
  }

  /** Base pose from the phase, then each action layered on top. */
  private compose(dt: number): Pose {
    const c = this.climber;
    const t = this.clock - this.phaseStart;
    let pose: Pose = POSES.sitHunched;
    const drinkT = this.actT('drink');
    const drinking = drinkT >= 0;

    if (this.phase === 'sit') {
      pose = lerpPose(POSES.sitHunched, POSES.sitLookUp, clamp01(this.progress));
      // Idle: his gaze wanders, and now and then he looks up at the summit light.
      if (!this.reduced) {
        const glance = smooth(Math.sin(this.clock * 0.29) * 1.6 - 0.9);
        pose = blendJ(pose, { head: add(pose.j.head, [-0.45 * glance, Math.sin(this.clock * 0.21) * 0.28 * (1 - glance), 0]) }, 1);
      }
    } else if (this.phase === 'rise') {
      if (t > 0.6 && t < 0.7) this.camp.fire.target = 1;
      if (t < SCRIPT.turn) pose = c.sample(RISE, t);
      if (!this.pickedUp && t >= SCRIPT.pickUp) {
        this.shoulder();
        this.sound.rustle();
      }
      if (!this.kicked && t >= SCRIPT.kick) {
        this.kicked = true;
        this.camp.fire.target = 0.12;
        this.sound.thud();
      }
      if (t >= SCRIPT.turn) {
        const u = ease(clamp01((t - SCRIPT.turn) / (SCRIPT.walk - SCRIPT.turn)));
        c.root.rotation.y = u * Math.PI;
        pose = lerpPose(POSES.stand, walkPose(0, 0.12), u * 0.4);
      }
      if (t >= SCRIPT.walk) {
        this.setPhase('walk');
        this.sound.setWalking(true);
      }
    } else if (this.phase === 'walk') {
      if (!drinking) {
        this.walked += SCRIPT.walkSpeed * dt * Math.min(1, (t + 0.3) / 0.8);
        this.walkPhase += ((Math.PI * 2 * SCRIPT.walkSpeed) / SCRIPT.stride) * dt;
      }
      this.placeOnPath();
      const p = this.pathPoint(this.walked);
      const ahead = this.pathPoint(this.walked + 0.6);
      pose = drinking ? POSES.stand : walkPose(this.walkPhase, 0.1 + Math.max(0, (ahead.y - p.y) / 0.6) * 0.6);
      const sgn = Math.sign(Math.sin(this.walkPhase));
      if (!drinking && sgn !== this.lastStepSign) {
        this.lastStepSign = sgn;
        if (this.view < 1.5) this.sound.step();
      }
      if (this.walked >= WALK_TO) {
        this.setPhase('stand');
        this.sound.setWalking(false);
      }
    } else {
      pose = lerpPose(POSES.stand, { hipsY: 0.93, j: { head: [-0.35, 0, 0], neck: [-0.1, 0, 0] } }, 0.7);
    }
    const sitting = this.phase === 'sit';

    // The journal, at base camp: he takes it out, opens it, writes.
    const wantJournal = this.view < 0.6 && (this.phase === 'sit' || this.phase === 'stand') && !this.montage ? 1 : 0;
    this.journalW += (wantJournal - this.journalW) * (1 - Math.exp(-dt * 3));
    const wasOpen = this.journalOpen > 0.5;
    this.journalOpen += ((this.journalW > 0.7 ? 1 : 0) - this.journalOpen) * (1 - Math.exp(-dt * 4));
    if (wasOpen !== this.journalOpen > 0.5) this.sound.page();
    const jw = smooth(this.journalW) * (drinking ? 0.2 : 1);
    if (jw > 0.01) {
      const writing = this.clock < this.scribbleUntil ? 1 : 0.35;
      const w1 = Math.sin(this.clock * 13) * 0.05 * writing;
      const w2 = Math.cos(this.clock * 8.5) * 0.04 * writing;
      pose = blendJ(
        pose,
        sitting
          ? {
              spine: [0.42, 0, 0], neck: [0.28, 0, 0], head: [0.42, 0.05, 0],
              shoulderL: [-0.95, 0.1, -0.32], elbowL: [-0.75, 0, -0.2],
              shoulderR: [-0.8 + w2, 0.12 + w1, 0.3], elbowR: [-1.05, 0, 0.15],
            }
          : {
              spine: [0.12, 0, 0], neck: [0.3, 0, 0], head: [0.45, 0.05, 0],
              shoulderL: [-0.9, 0.1, -0.3], elbowL: [-1.1, 0, -0.2],
              shoulderR: [-0.75 + w2, 0.1 + w1, 0.28], elbowR: [-1.4, 0, 0.15],
            },
        jw,
      );
    }
    const j = this.journal;
    j.group.visible = jw > 0.02;
    j.pencil.visible = jw > 0.4;
    j.group.scale.setScalar(Math.max(0.001, ease(clamp01(jw * 1.4))));
    if (sitting) {
      j.group.position.set(0, 0.68, 0.34);
      j.group.rotation.set(-0.5, 0, 0);
    } else {
      j.group.position.set(0, 1.12, 0.32);
      j.group.rotation.set(-0.85, 0, 0);
    }
    j.setOpen(this.journalOpen);

    // Drinking: reach, lift, drink head back, lower, breathe out.
    if (drinking) {
      const T = this.reduced ? 1.6 : 3.6;
      const k = T / 3.6;
      const lift = smooth(clamp01(drinkT / (0.7 * k))) * (1 - smooth(clamp01((drinkT - 2.5 * k) / (0.5 * k))));
      const sip = smooth(clamp01((drinkT - 0.8 * k) / (0.35 * k))) * (1 - smooth(clamp01((drinkT - 2.2 * k) / (0.35 * k))));
      const ease2 = smooth(clamp01((drinkT - 2.8 * k) / (0.3 * k))) * (1 - clamp01((drinkT - 3.2 * k) / (0.4 * k)));
      if (drinkT > 0.35 * k && drinkT < 2.95 * k && this.flask.parent !== c.joints.elbowR) this.inHand();
      if ((drinkT >= 2.95 * k || drinkT < 0.35 * k) && this.flask.parent === c.joints.elbowR) this.holster();
      pose = blendJ(pose, { shoulderR: [-1.05 - 0.15 * sip, 0, 0.45], elbowR: [-2.15, 0, 0], shoulderL: [-0.45, 0, -0.15], elbowL: [-0.6, 0, 0] }, lift);
      pose = blendJ(pose, { spine: [sitting ? 0.18 : -0.05, 0, 0], neck: [-0.25, 0, 0], head: [-0.55, 0, 0] }, sip);
      // Relief: the shoulders drop and he straightens.
      pose = blendJ(pose, { spine: [sitting ? 0.25 : 0.02, 0, 0], shoulderL: [0.1, 0, 0.2], shoulderR: [0.1, 0, -0.2], head: [-0.15, 0, 0] }, ease2 * 0.6);
      this.cue(drinkT, 0.9 * k, () => this.sound.gulp());
      this.cue(drinkT, 2.75 * k, () => {
        this.sound.sigh();
        this.puff(1.6);
        this.reliefT = 0;
        const at = new THREE.Vector3();
        c.joints.spine.getWorldPosition(at);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          this.mote('#8fdcff', at.clone().add(v(Math.cos(a) * 0.45, 0.1, Math.sin(a) * 0.45)), v(Math.cos(a) * 0.12, 0.45 + Math.random() * 0.4, Math.sin(a) * 0.12), 1.8, 0.035);
        }
      });
    }

    // A nod when a habit is done.
    const nodT = this.actT('nod');
    if (nodT >= 0) pose = blendJ(pose, { head: add(pose.j.head, [0.35, 0, 0]) }, Math.sin(clamp01(nodT / 0.8) * Math.PI));

    // A look when touched: he turns his head toward you.
    const lookT = this.actT('look');
    if (lookT >= 0) {
      const toCam = this.camera.position.clone().sub(c.root.position);
      const yaw = Math.atan2(toCam.x, toCam.z) - c.root.rotation.y;
      const wrapped = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      const w = smooth(clamp01(lookT / 0.4)) * (1 - smooth(clamp01((lookT - 1.8) / 0.6)));
      pose = blendJ(pose, { neck: [-0.05, clampAbs(wrapped * 0.4, 0.4), 0], head: [-0.2, clampAbs(wrapped * 0.6, 0.7), 0] }, w);
    }

    this.acts = this.acts.filter((a) => this.clock - a.start < a.dur);
    return pose;
  }

  private cued = new Set<string>();
  /** Run `fn` once when the act's time crosses `at`. */
  private cue(t: number, at: number, fn: () => void): void {
    const a = this.acts.find((x) => x.kind === 'drink');
    const key = `${a?.start ?? 0}:${at}`;
    if (t >= at && !this.cued.has(key)) {
      this.cued.add(key);
      if (this.cued.size > 40) this.cued = new Set([key]);
      fn();
    }
  }

  private camShot(): Shot {
    const c = this.climber;
    const head = new THREE.Vector3();
    c.joints.head.getWorldPosition(head);
    const yaw = c.root.rotation.y;
    const local = (x: number, y: number, z: number): THREE.Vector3 => v(x, y, z).applyAxisAngle(UP, yaw).add(c.root.position);

    // Base camp: close on Ari and his journal, same fire as Today.
    const campShot: Shot = this.phase === 'sit' ? { pos: local(1.2, 1.3, 2.05), look: local(-0.05, 0.82, 0.15) } : { pos: local(1.2, 1.8, 2.1), look: local(0, 1.25, 0.15) };
    // Today: at the fire, or the chase once he is on the route.
    let todayShot: Shot;
    if (this.phase === 'sit' || this.phase === 'rise') {
      const t = this.phase === 'rise' ? this.clock - this.phaseStart : 0;
      const u = ease(clamp01((t - 3.0) / 2.5));
      const sway = Math.sin(this.clock * 0.2) * 0.08;
      todayShot = { pos: v(1.3 + sway + u * 0.5, 1.15 + u * 0.6, 2.95 + u * 0.8), look: v(0.0, 0.55 + u * 0.45, -0.8 - u * 0.3) };
    } else {
      const p = c.root.position;
      todayShot = { pos: v(p.x + 0.9, p.y + 1.75, p.z + 3.6), look: v(p.x, p.y + 1.1, p.z - 3.5) };
    }
    // Week: this week's stretch of trail, close enough to see him and what he crossed.
    const zs = this.trail.anchors.map((a) => a.pos.z);
    const low = Math.max(14, ...zs.filter((z) => z >= 0));
    const high = -12;
    const mid = (low + high) / 2;
    const at = (z: number): THREE.Vector3 => {
      const x = pathX(z);
      return v(x, groundHeight(x, z), z);
    };
    const weekShot: Shot = { pos: at(low + 14).add(v(7, 15 + (low - 14) * 0.25, 0)), look: at(mid).add(v(0, -1.5, 0)) };
    const shots = [campShot, todayShot, weekShot, MONTH_SHOT, YEAR_SHOT];
    const i = Math.min(shots.length - 2, Math.floor(this.view));
    const a = shots[i]!;
    const b = shots[i + 1]!;
    const u = ease(this.view - i);
    const pos = a.pos.clone().lerp(b.pos, u);
    pos.y += Math.sin(u * Math.PI) * Math.min(40, a.pos.distanceTo(b.pos) * 0.12);
    let shot: Shot = { pos, look: a.look.clone().lerp(b.look, u) };

    // The drink scene cuts in close, wherever we are.
    const drinkT = this.actT('drink');
    if (drinkT >= 0 && !this.montage) {
      const T = this.reduced ? 1.6 : 3.6;
      const w = smooth(clamp01(drinkT / 0.5)) * (1 - smooth(clamp01((drinkT - (T - 0.6)) / 0.6)));
      const near: Shot = { pos: local(-1.1, this.phase === 'sit' ? 1.15 : 1.7, 1.75), look: head.clone().add(v(0, -0.2, 0)) };
      shot = { pos: shot.pos.lerp(near.pos, w), look: shot.look.lerp(near.look, w) };
    }
    return shot;
  }

  /** The replay: hard cuts around the subject, one per caption. */
  private montageShot(): { shot: Shot; cut: boolean } | null {
    const m = this.montage;
    if (!m) return null;
    const el = this.clock - m.start;
    const total = m.cards * m.card;
    if (el > total + 0.4) {
      this.endMontage();
      return null;
    }
    const a = m.anchor;
    const fwd = a.pos.clone().sub(a.from).setY(0).normalize();
    const side = fwd.clone().cross(UP).normalize();
    let subj = a.pos.clone();
    if (!a.isToday && this.ghost) {
      const g = this.ghost;
      const moving = a.outcome === 'closed' || a.outcome === 'partial';
      const reach = a.outcome === 'partial' ? 0.55 : 1;
      const u = moving ? clamp01(el / (total * 0.9)) * reach : 1;
      const p = moving ? a.from.clone().lerp(a.pos, u) : a.pos.clone().add(side.clone().multiplyScalar(-0.9));
      p.y = groundHeight(p.x, p.z);
      g.root.position.copy(p);
      g.root.rotation.y = Math.atan2(fwd.x, fwd.z) + (moving ? 0 : Math.PI * 0.75);
      g.setPose(moving && u < reach ? walkPose(el * 6, 0.25) : a.outcome === 'missed' ? POSES.stand : POSES.sitHunched);
      g.overlay(this.clock, 0.6, !this.reduced);
      subj = p;
    } else subj = this.climber.root.position.clone();
    const k = Math.min(m.cards - 1, Math.floor(el / m.card));
    const lt = el - k * m.card;
    const s = subj.clone();
    const U = (n: number): THREE.Vector3 => UP.clone().multiplyScalar(n);
    const F = (n: number): THREE.Vector3 => fwd.clone().multiplyScalar(n);
    const R = (n: number): THREE.Vector3 => side.clone().multiplyScalar(n);
    const cuts: Shot[] = [
      { pos: s.clone().add(R(6)).add(U(4)).add(F(-6)), look: s.clone().add(F(2)) },
      { pos: s.clone().add(R(3.4)).add(U(1.5)).add(F(0.6)), look: s.clone().add(U(0.9)) },
      { pos: s.clone().add(F(4.4)).add(U(1.7)), look: s.clone().add(U(0.9)) },
      { pos: s.clone().add(U(7)).add(F(-3)).add(R(1)), look: s.clone() },
      { pos: s.clone().add(F(-3.2)).add(U(2.1)).add(R(0.8)), look: s.clone().add(F(5)).add(U(1)) },
      { pos: s.clone().add(R(-4)).add(U(1.6)), look: s.clone().add(U(0.9)) },
    ];
    const cut = cuts[k % cuts.length]!;
    // A slow push in within each cut.
    cut.pos.lerp(cut.look, 0.08 * lt);
    const isNew = k !== m.lastCut;
    if (isNew) {
      m.lastCut = k;
      this.sound.chime(k);
    }
    return { shot: cut, cut: isNew };
  }

  private frame(nowMs: number): void {
    if (!this.running) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    // Capped so a long pause does not jump the story; generous enough for slow phones.
    const dt = Math.min(0.1, (nowMs - this.last) / 1000);
    this.last = nowMs;
    this.clock += dt;
    if (this.dimmed) return;
    const c = this.climber;

    this.world.update(this.clock);
    this.camp.fire.update(this.clock, dt);
    this.sound.setFire(this.view < 1.5 ? this.camp.fire.level : this.camp.fire.level * 0.2);

    const pose = this.compose(dt);
    c.setPose(pose);
    const cold = this.phase === 'sit' ? 1 - this.camp.fire.level : 0.4;
    c.overlay(this.clock, clamp01(cold), !this.reduced);

    // The spark from a tapped chip.
    if (this.sparkT >= 0) {
      this.sparkT += dt;
      const u = ease(clamp01(this.sparkT / 0.7));
      this.spark.position.copy(this.sparkFrom).lerp(v(0, 0.3, 0), u);
      this.spark.material.opacity = Math.sin(u * Math.PI) * 0.95;
      this.spark.scale.setScalar(0.12 + u * 0.4);
      if (this.sparkT > 0.55 && this.phase === 'sit') this.camp.fire.level = Math.min(1, this.camp.fire.level + 0.25);
      if (this.sparkT >= 0.7) {
        this.sparkT = -1;
        this.spark.material.opacity = 0;
      }
    }

    // Relief after drinking: a cool bloom around him, the world a touch brighter.
    if (this.reliefT >= 0) {
      this.reliefT += dt;
      const u = clamp01(this.reliefT / 1.6);
      const at = new THREE.Vector3();
      c.joints.spine.getWorldPosition(at);
      this.relief.position.copy(at).add(v(0, 0.3, 0));
      this.relief.scale.setScalar(0.5 + u * 2.2);
      this.relief.material.opacity = Math.sin(u * Math.PI) * 0.32;
      if (u >= 1) this.reliefT = -1;
    } else this.relief.material.opacity = 0;
    const glow = this.reliefT >= 0 ? Math.sin(clamp01(this.reliefT / 1.6) * Math.PI) : 0;
    this.renderer.toneMappingExposure = 1.12 + glow * 0.16;
    this.hemi.intensity = 1.35 + glow * 0.35;

    // Breath when cold, more often after the climb.
    if (Math.floor(this.clock / 3.8) !== Math.floor((this.clock - dt) / 3.8) && cold > 0.3 && this.view < 1.6) this.puff(1);
    for (const m of this.motes) {
      if (m.life <= 0) {
        m.s.material.opacity = 0;
        continue;
      }
      m.life -= dt;
      m.s.position.addScaledVector(m.vel, dt);
      m.vel.y -= m.size > 0.1 ? 0 : 0.2 * dt;
      const u = 1 - m.life / m.max;
      const breath = m.size > 0.1;
      m.s.material.opacity = Math.sin(u * Math.PI) * (breath ? 0.12 : 0.9);
      m.s.scale.setScalar(m.size * (1 + u * (breath ? 2.5 : 0.5)));
    }

    // Far screens: a glow finds him; the week's camps glow; the year shows the route.
    const yearV = clamp01(this.view - 3);
    const far = clamp01(this.view - 1.4) * (1 - yearV);
    this.finder.material.opacity = far * 0.8;
    this.finder.position.copy(c.root.position).add(v(0, 2.5 + clamp01(this.view - 2) * 8, 0));
    this.finder.scale.setScalar(4 + clamp01(this.view - 2) * 30);
    this.trail.setGlow(clamp01((this.view - 1.3) / 0.7) * (1 - clamp01(this.view - 2.6)), this.clock);
    this.route.update(yearV, this.clock);
    this.updateSnow(dt);

    // Camera: the replay's cuts, or the screen's shot.
    const m = this.montageShot();
    const want = this.debugShot ?? (m ? m.shot : this.camShot());
    if (m?.cut) {
      this.camPos.copy(want.pos);
      this.camLook.copy(want.look);
    } else {
      const k = 1 - Math.exp(-dt * (m ? 6 : 5));
      this.camPos.lerp(want.pos, k);
      this.camLook.lerp(want.look, k);
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.shift += ((this.montage || this.debugShot ? 0 : FRAME_SHIFT) - this.shift) * (1 - Math.exp(-dt * 4));
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.camera.setViewOffset(w, h, 0, h * this.shift, w, h);
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
  }
}

function blendJ(p: Pose, j: Partial<Record<Joint, Rot>>, w: number): Pose {
  if (w <= 0) return p;
  const out: Pose = { hipsY: p.hipsY, hipsX: p.hipsX ?? 0, j: { ...p.j } };
  for (const [k, r] of Object.entries(j) as Array<[Joint, Rot]>) {
    const a = p.j[k] ?? [0, 0, 0];
    out.j[k] = [a[0] + (r[0] - a[0]) * w, a[1] + (r[1] - a[1]) * w, a[2] + (r[2] - a[2]) * w];
  }
  return out;
}

function add(a: Rot | undefined, b: Rot): Rot {
  const x = a ?? [0, 0, 0];
  return [x[0] + b[0], x[1] + b[1], x[2] + b[2]];
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

function clampAbs(x: number, m: number): number {
  return Math.max(-m, Math.min(m, x));
}

function smooth(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
