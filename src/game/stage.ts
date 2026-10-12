/**
 * The world behind the game screens: one WebGL scene, one camera, driven by two inputs:
 *
 *   view   the pager position, 0 base camp, 1 today, 2 week, 3 month, 4 year (fractional while
 *          swiping), so the camera pulls back further with every screen to the right;
 *   day    today's progress and whether the day is closed, which set Ari's pose and the fire.
 *
 * Closing the day live plays the reward from the feel test: Ari rises, shoulders the satchel,
 * kicks out the fire and takes the route. A day already closed at load shows him on the route.
 * The checklist never waits on any of this; without WebGL the screens run on a painted sky.
 */
import * as THREE from 'three';
import { buildWorld, glowTexture, groundHeight, pathX } from '../prototype/feel3d/world';
import { buildCamp } from '../prototype/feel3d/camp';
import { buildClimber, POSES, lerpPose, walkPose, type Pose } from '../prototype/feel3d/climber';
import { buildWeek, type Outcome } from '../prototype/feel3d/week';
import { RISE, SCRIPT } from '../prototype/shared/poses';
import { createSound, type Sound } from '../prototype/shared/audio';

export type { Outcome };

interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Camera per screen; today's shot is replaced by the chase shot once Ari is on the route. */
const SHOTS: Shot[] = [
  { pos: v(1.4, 1.5, 1.9), look: v(-1.6, 0.5, -1.9) }, // base camp: the tent, the fire, the gear
  { pos: v(1.15, 1.0, 2.5), look: v(0.05, 0.62, -0.8) }, // today: at the fire
  { pos: v(70, 92, 230), look: v(0, -4, 62) }, // week: the camps down the slope
  { pos: v(110, 170, 300), look: v(-40, 10, -160) }, // month: the foothills
  { pos: v(260, 470, 520), look: v(-110, 120, -620) }, // year: the whole mountain
];

type Phase = 'sit' | 'rise' | 'walk' | 'stand';

export interface DayInput {
  /** Today's progress f, 0 to 1. */
  progress: number;
  closed: boolean;
  /** True when this change came from a tap now (plays the reward); false at load or on sync. */
  live: boolean;
}

export class Stage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 4000);
  private readonly world;
  private readonly camp;
  private readonly climber;
  private week: ReturnType<typeof buildWeek> | null = null;
  private weekKey = '';
  private readonly finder: THREE.Sprite;
  private readonly spark: THREE.Sprite;
  private readonly sound: Sound;
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
  private camPos = SHOTS[1]!.pos.clone();
  private camLook = SHOTS[1]!.look.clone();
  private running = true;
  private dimmed = false;
  private last = performance.now();
  private raf = 0;

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
    this.scene.add(new THREE.HemisphereLight('#7a7eac', '#2e261b', 1.35));
    const lastLight = new THREE.DirectionalLight('#ffb27a', 0.9);
    lastLight.position.set(-80, 18, -40);
    this.scene.add(lastLight);

    this.sound = createSound();
    this.world = buildWorld(this.scene);
    this.camp = buildCamp(this.scene, coarse ? 512 : 1024);
    this.climber = buildClimber();
    this.scene.add(this.climber.root);
    this.scene.add(this.climber.satchel);
    this.seat();

    this.finder = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff7a3d', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, fog: false }));
    this.scene.add(this.finder);
    this.spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffcf8a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    this.scene.add(this.spark);

    const start = (): void => {
      if (!this.sound.started && this.soundOn) void this.sound.start();
    };
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    document.addEventListener('visibilitychange', () => this.setRunning(!document.hidden));
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // Inputs ----------------------------------------------------------------------------------

  setView(p: number): void {
    this.view = Math.max(0, Math.min(SHOTS.length - 1, p));
  }

  /** Pause drawing while the sheet covers the world (saves battery on long scrolls). */
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
        else this.onRoute(SCRIPT.walkLimit);
      }
    } else if (this.phase !== 'sit') {
      this.seat();
    }
    if (this.phase === 'sit') this.camp.fire.target = 0.12 + 0.88 * Math.min(1, d.progress);
  }

  /** This week's ended days as camps down the slope (rebuilt only when they change). */
  setWeek(days: Array<{ label: string; outcome: Outcome }>): void {
    const key = days.map((d) => `${d.label}:${d.outcome}`).join('|');
    if (key === this.weekKey) return;
    this.weekKey = key;
    if (this.week) {
      this.scene.remove(this.week.group);
      this.week.group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
    }
    this.week = buildWeek(this.scene, days);
  }

  /** A tick: a spark flies from the tapped chip into the fire, which flares. */
  pulse(clientX: number, clientY: number, done: boolean): void {
    if (done) this.sound.tick();
    if (this.phase !== 'sit' || this.view > 1.5 || this.reduced) return;
    const r = this.canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((clientY - r.top) / r.height) * 2 - 1);
    this.sparkFrom.set(nx, Math.max(-1.6, ny), 0.2).unproject(this.camera);
    this.sparkT = 0;
  }

  whoosh(): void {
    this.sound.whoosh();
  }

  // Internals -------------------------------------------------------------------------------

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
    this.setPhase(distance >= SCRIPT.walkLimit ? 'stand' : 'walk');
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
    this.camera.fov = w / h < 0.8 ? 62 : 48;
    this.camera.updateProjectionMatrix();
  }

  private todayShot(): Shot {
    if (this.phase === 'sit' || this.phase === 'rise') {
      const t = this.phase === 'rise' ? this.clock - this.phaseStart : 0;
      const u = ease(clamp01((t - 3.0) / 2.5));
      const sway = Math.sin(this.clock * 0.2) * 0.08;
      return { pos: v(1.15 + sway + u * 0.5, 1.0 + u * 0.65, 2.5 + u * 0.8), look: v(0.05, 0.62 + u * 0.45, -0.8 - u * 0.3) };
    }
    const p = this.climber.root.position;
    return { pos: v(p.x + 0.9, p.y + 1.75, p.z + 3.6), look: v(p.x, p.y + 1.1, p.z - 3.5) };
  }

  private shotAt(view: number): Shot {
    const shots = SHOTS.map((s, i) => (i === 1 ? this.todayShot() : s));
    const i = Math.min(shots.length - 2, Math.floor(view));
    const a = shots[i]!;
    const b = shots[i + 1]!;
    const u = ease(view - i);
    const pos = a.pos.clone().lerp(b.pos, u);
    // Through the cloud between screens: a slight lift mid-swipe.
    pos.y += Math.sin(u * Math.PI) * Math.min(40, a.pos.distanceTo(b.pos) * 0.12);
    return { pos, look: a.look.clone().lerp(b.look, u) };
  }

  private frame(nowMs: number): void {
    if (!this.running) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    // Capped so a long pause does not jump the story; generous enough for slow phones.
    const dt = Math.min(0.1, (nowMs - this.last) / 1000);
    this.last = nowMs;
    this.clock += dt;
    if (this.dimmed) return;
    const t = this.clock - this.phaseStart;
    const c = this.climber;

    this.world.update(this.clock);
    this.camp.fire.update(this.clock, dt);
    this.sound.setFire(this.view < 1.5 ? this.camp.fire.level : this.camp.fire.level * 0.2);

    let pose: Pose = POSES.sitHunched;
    let cold = 1 - this.camp.fire.level;
    if (this.phase === 'sit') {
      // He straightens as the day fills.
      pose = lerpPose(POSES.sitHunched, POSES.sitLookUp, clamp01(this.progress));
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
      cold = t < 4.5 ? 1 - this.camp.fire.level : 0.45;
      if (t >= SCRIPT.walk) {
        this.setPhase('walk');
        this.sound.setWalking(true);
      }
    } else if (this.phase === 'walk') {
      this.walked += SCRIPT.walkSpeed * dt * Math.min(1, (t + 0.3) / 0.8);
      this.walkPhase += ((Math.PI * 2 * SCRIPT.walkSpeed) / SCRIPT.stride) * dt;
      this.placeOnPath();
      const p = this.pathPoint(this.walked);
      const ahead = this.pathPoint(this.walked + 0.6);
      pose = walkPose(this.walkPhase, 0.1 + Math.max(0, (ahead.y - p.y) / 0.6) * 0.6);
      const sgn = Math.sign(Math.sin(this.walkPhase));
      if (sgn !== this.lastStepSign) {
        this.lastStepSign = sgn;
        if (this.view < 1.5) this.sound.step();
      }
      if (this.walked >= SCRIPT.walkLimit) {
        this.setPhase('stand');
        this.sound.setWalking(false);
      }
      cold = 0.4;
    } else {
      pose = lerpPose(POSES.stand, { hipsY: 0.93, j: { head: [-0.35, 0, 0], neck: [-0.1, 0, 0] } }, 0.7);
      cold = 0.4;
    }
    c.setPose(pose);
    c.overlay(this.clock, clamp01(cold), !this.reduced);

    // The spark from the tapped chip.
    if (this.sparkT >= 0) {
      this.sparkT += dt;
      const u = ease(clamp01(this.sparkT / 0.7));
      this.spark.position.copy(this.sparkFrom).lerp(new THREE.Vector3(0, 0.3, 0), u);
      this.spark.material.opacity = Math.sin(u * Math.PI) * 0.95;
      this.spark.scale.setScalar(0.12 + u * 0.4);
      if (this.sparkT > 0.55 && this.phase === 'sit') {
        this.camp.fire.level = Math.min(1, this.camp.fire.level + 0.25);
      }
      if (this.sparkT >= 0.7) {
        this.sparkT = -1;
        this.spark.material.opacity = 0;
      }
    }

    // Far screens: a glow finds him, and the week's camps fade in.
    const far = clamp01(this.view - 1.2);
    this.finder.material.opacity = far * 0.9;
    this.finder.position.copy(c.root.position).add(new THREE.Vector3(0, 3 + far * 6, 0));
    this.finder.scale.setScalar(9 + clamp01(this.view - 2) * 30);
    this.week?.setVisible(clamp01((this.view - 1.3) / 0.7));

    const want = this.shotAt(this.view);
    const k = 1 - Math.exp(-dt * 5);
    this.camPos.lerp(want.pos, k);
    this.camLook.lerp(want.look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.renderer.render(this.scene, this.camera);
  }
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
