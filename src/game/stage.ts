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
import { buildWorld, dotTexture, glowTexture, groundHeight, pathX } from '../prototype/feel3d/world';
import { buildCamp } from '../prototype/feel3d/camp';
import { buildClimber, POSES, lerpPose, walkPose, type Climber, type Joint, type Pose } from '../prototype/feel3d/climber';
import { RISE, SCRIPT, type Rot } from '../prototype/shared/poses';
import { createSound, type Sound } from '../prototype/shared/audio';
import { buildFlask, buildJournal, ghostify, type Journal } from './props';
import { DAY_GAP, WeekTrail, YearRoute, YEAR_STAGES, type Anchor, type TrailDay } from './trail';
import { buildKit, symbolTexture, type Kit } from './kit';
import type { TrailSymbol } from '../core/model/types';
import type { Weather } from '../core/world';

export type { Anchor, TrailDay };

interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const UP = v(0, 1, 0);

const MONTH_SHOT: Shot = { pos: v(110, 170, 300), look: v(-40, 10, -160) };
const YEAR_SHOT: Shot = { pos: v(430, 980, 330), look: v(-70, 40, -430) };
/** How far up the closed day's walk takes her: to tomorrow's camp. */
const WALK_TO = DAY_GAP - 1.6;
/** The world is framed a little high so the glass checklist sits over the ground. */
const FRAME_SHIFT = 0.07;

type Phase = 'sit' | 'rise' | 'walk' | 'stand';
type ActKind = 'drink' | 'nod' | 'look' | 'greet' | 'reveal' | 'offer' | 'warm' | 'tend' | 'route';
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
  private readonly kit: Kit;
  private readonly lastLight: THREE.DirectionalLight;
  private patch: THREE.Mesh | null = null;
  private weather: Weather = 'calm';
  private momentum = 0;
  private lookCooldown = -99;
  private revealAt: THREE.Vector3 | null = null;
  private nextAmbient = 30;
  private frameShift = FRAME_SHIFT;
  private cupHome: THREE.Vector3 | null = null;
  private offerFrom: THREE.Vector3 | null = null;
  /** The flask close-up: she holds it up for you to look at. */
  private inspecting = false;
  /** Called once the reveal has played to its end (true) or was cut short (false). */
  private revealDone: ((shown: boolean) => void) | null = null;
  private steamT = -1;
  private intro: { start: number; done: () => void; seg: number; cues: Set<string> } | null = null;
  private hourOverride: number | null = null;
  /** Environment Lab: a preview weather that wins over the record's, until cleared. */
  private weatherOverride: Weather | null = null;
  private recordWeather: Weather = 'calm';
  /** Frame time, smoothed (ms), for the Lab's readout. */
  frameMs = 16;
  private skyTimer = 99;
  private hemiBase = 1.35;
  private teaByClose = false;
  private soundOn = true;
  private reduced: boolean;

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
    this.lastLight = lastLight;
    // A cool rim from behind and above the camp: it separates Ari's shoulders, arms and hood
    // from the dark slope without lifting the whole night.
    const rim = new THREE.DirectionalLight('#9db4ff', 0.55);
    rim.position.set(-5, 8, -11);
    this.scene.add(rim);

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
    this.kit = buildKit(this.scene);
    this.seat();

    const glow = (color: string, opacity = 0): THREE.Sprite => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity, fog: false }));
      this.scene.add(s);
      return s;
    };
    this.finder = glow('#ff7a3d');
    this.spark = glow('#ffcf8a');
    this.relief = glow('#9fe7ff');
    const h = new URLSearchParams(location.search).get('hour');
    if (h !== null && Number.isFinite(Number(h))) this.hourOverride = Number(h);
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
    // The day-close ritual: your cup is filled when the day is closed, and emptied if it reopens.
    if (d.closed && !this.teaByClose) {
      this.teaByClose = true;
      this.fillCup();
      if (d.live) this.sound.chime(5);
    } else if (!d.closed && this.teaByClose) {
      this.teaByClose = false;
      const tea = this.kit.yourCup.getObjectByName('tea');
      if (tea) tea.visible = false;
      this.steamT = -1;
    }
    if (d.closed) {
      if (this.phase === 'sit') {
        if (d.live && !this.reduced) this.setPhase('rise');
        else this.onRoute(WALK_TO);
      }
    } else if (this.phase !== 'sit') {
      this.seat();
    }
    // After missed days the fire is down to embers until the first effort relights it.
    if (this.phase === 'sit') this.camp.fire.target = d.progress <= 0 && this.momentum >= 3 ? 0.05 : 0.12 + 0.88 * Math.min(1, d.progress);
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

  /** Your mark and colour: the flag, the carving, the pack patch, Ari's scarf. */
  setExpedition(symbol: TrailSymbol | undefined, accent: string): void {
    this.kit.setSymbol(symbol, accent);
    // The scarf is the neck's direct meshes (ring and tail).
    for (const ch of this.climber.joints.neck.children) {
      const m = ch as THREE.Mesh;
      if (m.isMesh) (m.material as THREE.MeshLambertMaterial).color.set(accent);
    }
    if (this.patch) {
      this.climber.satchel.remove(this.patch);
      this.patch = null;
    }
    if (symbol) {
      this.patch = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), new THREE.MeshLambertMaterial({ map: symbolTexture(symbol, '#efe6d2', accent), transparent: false }));
      this.patch.position.set(0, -0.02, 0.067);
      this.climber.satchel.add(this.patch);
    }
  }

  /** Camp improvements earned so far (the travelling home). */
  setCamp(built: string[]): void {
    this.kit.setBuilt(built);
  }

  /** Show a newly made improvement: the camera finds it, a little light, a bell. */
  reveal(id: string, done?: (shown: boolean) => void): void {
    const at = this.kit.where(id);
    if (!at) {
      done?.(true);
      return;
    }
    this.cancelReveal();
    this.revealAt = at;
    this.revealDone = done ?? null;
    this.act('reveal', this.reduced ? 1.5 : 3.4);
    this.sound.chime(3);
    for (let i = 0; i < 10; i++) this.mote('#ffe3b0', at.clone().add(v((Math.random() - 0.5) * 0.8, 0.2, (Math.random() - 0.5) * 0.8)), v(0, 0.4 + Math.random() * 0.4, 0), 1.6, 0.05);
  }

  /** Stop a reveal in progress (you moved on); it is not counted as seen. */
  cancelReveal(): void {
    if (!this.acts.some((a) => a.kind === 'reveal') && !this.revealDone) return;
    this.acts = this.acts.filter((a) => a.kind !== 'reveal');
    const d = this.revealDone;
    this.revealDone = null;
    d?.(false);
  }

  /**
   * The UI covering the world (px from the bottom and from the top): the picture shifts so
   * Ari, her hands and the fire sit in the open part, not behind the checklist.
   */
  setOcclusion(bottom: number, top: number): void {
    const h = this.canvas.clientHeight || window.innerHeight || 1;
    // The shots were composed with an 84 px checklist and the caption ending 130 px down;
    // move the picture by half of whatever differs from that.
    this.frameShift = Math.max(0, Math.min(0.2, FRAME_SHIFT + (bottom - 84 - (top - 130)) / (2 * h)));
  }

  /** Far screens keep their own composition. */
  resetOcclusion(): void {
    this.frameShift = FRAME_SHIFT;
  }

  /** The motion policy changed (system or Setup): from the next moment on, stills and fades. */
  setReduced(r: boolean): void {
    this.reduced = r;
  }

  /** Arrival: she looks up at you and lifts a hand, then goes back to what she was doing. */
  greet(away = false): void {
    if (this.intro || this.montage) return;
    this.act('greet', 2.6);
    this.nextAmbient = this.clock + 20;
    // Back after a while: she slides your cup back within reach, then leaves you to it.
    if (away && this.phase === 'sit') {
      const cup = this.kit.yourCup;
      if (cup.parent === this.kit.group) {
        // She had kept it by her, near the fire; now it comes back to you.
        this.cupHome ??= cup.position.clone();
        cup.position.copy(this.cupBeside());
        this.act('offer', 5);
      }
    }
  }

  /** Your cup's place while you were away: by her right foot, near the fire. */
  private cupBeside(): THREE.Vector3 {
    const c = this.climber;
    const p = v(0.42, 0, 0.5).applyAxisAngle(UP, c.root.rotation.y).add(c.root.position);
    p.y = this.cupHome?.y ?? p.y;
    return p;
  }

  /**
   * What is under a touch, among the things in the world you can act on (the prop registry):
   * today only the flask. Null when nothing is, or when a scene is playing.
   */
  pick(clientX: number, clientY: number): 'flask' | null {
    if (this.montage || this.intro || this.view > 1.5) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = this.flask.getObjectByName('hit');
    return hit && ray.intersectObject(hit, false).length ? 'flask' : null;
  }

  /** Water level shown on the flask's fill line, 0 to 1. */
  setFlaskLevel(u: number): void {
    (this.flask.userData.setLevel as ((u: number) => void) | undefined)?.(u);
  }

  /** Hold the flask up for a close look (the inspector), or put it back. */
  inspectFlask(on: boolean): void {
    if (on === this.inspecting) return;
    this.inspecting = on;
    if (on && !this.acts.some((a) => a.kind === 'drink')) this.inHand();
    if (!on && !this.acts.some((a) => a.kind === 'drink')) this.holster();
  }

  /** Her own small routine between your visits: never during anything else, on a cooldown. */
  private ambient(): void {
    if (this.reduced || this.intro || this.montage || this.phase !== 'sit' || this.view > 1.5 || this.acts.length) return;
    if (this.clock < this.nextAmbient) return;
    const pick = (['warm', 'tend', 'route'] as const)[Math.floor(Math.random() * 3)]!;
    // Warming hands is for cold weather or a low fire; otherwise tend it or check the route.
    const kind = pick === 'warm' && this.weather === 'clear' && this.camp.fire.level > 0.6 ? 'tend' : pick;
    this.act(kind, kind === 'warm' ? 5 : kind === 'tend' ? 3.6 : 4);
    this.nextAmbient = this.clock + 26 + Math.random() * 34;
  }

  /** Your cup filled and steaming: the day-close ritual (and the end of the opening). */
  fillCup(): void {
    const tea = this.kit.yourCup.getObjectByName('tea');
    if (tea) tea.visible = true;
    this.steamT = 0;
  }

  /** Environment Lab: preview the light at any hour (null: your clock again). Writes nothing. */
  previewHour(h: number | null): void {
    this.hourOverride = h;
    this.skyTimer = 99;
  }

  /** Environment Lab: preview a weather (null: the record's again). Writes nothing. */
  previewWeather(w: Weather | null): void {
    this.weatherOverride = w;
    this.setWeather(this.recordWeather);
  }

  get previewing(): { hour: number | null; weather: Weather | null } {
    return { hour: this.hourOverride, weather: this.weatherOverride };
  }

  setWeather(w: Weather): void {
    this.recordWeather = w;
    if (this.weatherOverride) w = this.weatherOverride;
    this.weather = w;
  }

  /** 0 to 3 after missed days: the fire lower, her eyes on the trail. Never worse than 3. */
  setMomentum(step: number): void {
    this.momentum = Math.max(0, Math.min(3, step));
  }

  get introPlaying(): boolean {
    return this.intro !== null;
  }

  /** The opening scene for a first launch; `done` runs when it ends or is skipped. */
  playIntro(done: () => void): void {
    if (this.reduced) {
      this.fillCup();
      done();
      return;
    }
    this.intro = { start: this.clock, done, seg: 0, cues: new Set() };
    this.camPos.copy(this.climber.root.position).add(v(5, 22, 20));
    this.camLook.copy(this.climber.root.position).add(v(0, 7, -26));
  }

  skipIntro(): void {
    if (!this.intro) return;
    this.endIntro();
  }

  private endIntro(): void {
    const i = this.intro;
    this.intro = null;
    this.kit.map.visible = false;
    this.kit.rope.visible = false;
    if (this.kit.yourCup.parent !== this.kit.group) {
      this.kit.group.add(this.kit.yourCup);
      this.kit.yourCup.position.copy(this.kit.yourSeat).add(v(0.6, -0.16, -0.25));
      this.kit.yourCup.rotation.set(0, 0, 0);
    }
    this.fillCup();
    i?.done();
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
    if (this.montage || this.intro) return;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    if (ray.intersectObject(this.climber.root, true).length) {
      // A glance, not a toy: once every 10 seconds at most.
      if (this.clock - this.lookCooldown < 10) return;
      this.lookCooldown = this.clock;
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
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: '#dfe6f0', size: 0.07, map: dotTexture(), alphaTest: 0.02, transparent: true, opacity: 0.7, depthWrite: false, fog: false }));
    pts.frustumCulled = false;
    this.scene.add(pts);
    return pts;
  }

  /** Light snow around the camera: the world never stands still. */
  private updateSnow(dt: number): void {
    const a = this.snow.geometry.attributes.position as THREE.BufferAttribute;
    const c = this.camera.position;
    const t = this.clock;
    // The week's weather: sparse when climbing, thicker when holding, driven sideways in a storm.
    const wx = this.intro ? 1.2 : this.weather === 'storm' ? 2.4 : this.weather === 'snow' ? 0.5 : 0.15;
    const fall = this.intro ? 1.6 : this.weather === 'storm' ? 2.2 : this.weather === 'snow' ? 1.3 : 1;
    for (let i = 0; i < a.count; i++) {
      let x = a.getX(i) + (Math.sin(t * 0.7 + i) * 0.2 + wx) * dt;
      let y = a.getY(i) - (0.35 + (i % 7) * 0.05) * fall * dt;
      let z = a.getZ(i) + 0.15 * dt;
      if (y < c.y - 9) y += 18;
      if (x < c.x - 15) x += 30;
      else if (x > c.x + 15) x -= 30;
      if (z < c.z - 15) z += 30;
      else if (z > c.z + 15) z -= 30;
      a.setXYZ(i, x, y, z);
    }
    a.needsUpdate = true;
    const amount = this.intro ? 0.9 : this.weather === 'storm' ? 1 : this.weather === 'snow' ? 0.85 : this.weather === 'clear' ? 0.18 : 0.5;
    (this.snow.material as THREE.PointsMaterial).opacity = amount * (1 - clamp01(this.view - 1.6));
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
        // After missed days she keeps looking back toward the trail, ready to go.
        if (this.momentum >= 2 && this.progress <= 0) {
          const back = (this.momentum / 3) * smooth(Math.sin(this.clock * 0.17 + 1) * 1.4 - 0.1);
          pose = blendJ(pose, { spine: add(pose.j.spine, [-0.1, 0.35, 0]), neck: [0, 0.45, 0], head: [-0.1, 0.7, 0] }, back);
        }
      }
      if (this.intro) pose = this.introPose(pose);
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

    // Her own routine: hands to the fire, a log pushed in, a look up the trail.
    const warmT = this.actT('warm');
    if (warmT >= 0) {
      const w = smooth(clamp01(warmT / 0.8)) * (1 - smooth(clamp01((warmT - 4.0) / 0.9)));
      const rub = Math.sin(warmT * 9) * 0.08 * clamp01((warmT - 1.6) / 0.4) * (1 - clamp01((warmT - 3.2) / 0.3));
      pose = blendJ(pose, { spine: [0.42, 0, 0], shoulderL: [-1.05, 0, -0.2 + rub], elbowL: [-0.55, 0, 0], shoulderR: [-1.05, 0, 0.2 - rub], elbowR: [-0.55, 0, 0], head: [0.15, 0, 0] }, w);
    }
    const tendT = this.actT('tend');
    if (tendT >= 0) {
      const w = smooth(clamp01(tendT / 0.7)) * (1 - smooth(clamp01((tendT - 2.7) / 0.8)));
      const push = Math.sin(clamp01((tendT - 1.0) / 0.9) * Math.PI);
      pose = blendJ(pose, { spine: [0.7 + push * 0.12, -0.15, 0], head: [0.3, -0.1, 0], shoulderR: [-1.2 - push * 0.25, 0, 0.15], elbowR: [-0.35, 0, 0] }, w);
      this.cue(tendT, 1.45, () => {
        this.camp.fire.target = Math.min(1, this.camp.fire.target + 0.05);
        for (let i = 0; i < 7; i++) this.mote('#ffb066', v((Math.random() - 0.5) * 0.3, 0.35, (Math.random() - 0.5) * 0.3), v((Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4), 1.2, 0.03);
        this.sound.thud();
      }, 'tend');
    }
    const routeT = this.actT('route');
    if (routeT >= 0) {
      const w = smooth(clamp01(routeT / 0.9)) * (1 - smooth(clamp01((routeT - 3.0) / 0.9)));
      pose = blendJ(pose, { spine: add(pose.j.spine, [-0.08, 0.25, 0]), neck: [-0.1, 0.4, 0], head: [-0.35, 0.55, 0] }, w);
    }
    // The return beat: she picks up your cup from beside her, holds it out, and sets it at your place.
    const offerT = this.actT('offer');
    if (offerT >= 0 && this.cupHome) {
      const cup = this.kit.yourCup;
      const down = smooth(clamp01((offerT - 1.1) / 0.4)) * (1 - smooth(clamp01((offerT - 1.8) / 0.4)));
      pose = blendJ(pose, { spine: [0.75, 0.2, 0], head: [0.35, 0.1, 0], shoulderR: [-0.6, 0, 0.2], elbowR: [-0.2, 0, 0] }, down);
      const out = smooth(clamp01((offerT - 1.8) / 0.5)) * (1 - smooth(clamp01((offerT - 3.6) / 0.5)));
      pose = blendJ(pose, { spine: [0.38, 0, 0], head: [-0.2, 0, 0], shoulderR: [-1.45, 0, 0.1], elbowR: [-0.3, 0, 0] }, out);
      const hand = this.climber.joints.elbowR;
      if (offerT >= 1.7 && offerT < 3.7 && cup.parent !== hand) {
        hand.add(cup);
        cup.position.set(0, -0.34, 0.03);
        cup.rotation.set(Math.PI / 2, 0, 0);
        this.sound.rustle();
      }
      if (offerT >= 3.7 && cup.parent === hand) {
        const at = cup.getWorldPosition(new THREE.Vector3());
        this.kit.group.add(cup);
        cup.position.copy(this.kit.group.worldToLocal(at));
        cup.rotation.set(0, 0, 0);
        this.offerFrom = cup.position.clone();
      }
      if (offerT >= 3.7 && this.offerFrom) cup.position.copy(this.offerFrom.clone().lerp(this.cupHome, ease(clamp01((offerT - 3.7) / 0.6))));
      if (offerT < 1.7) cup.position.copy(this.cupBeside());
    }
    // Cut short (a replay, the opening): the cup is simply back at your place.
    if (offerT < 0 && !this.intro && this.cupHome && this.kit.yourCup.parent === this.climber.joints.elbowR) {
      this.kit.group.add(this.kit.yourCup);
      this.kit.yourCup.position.copy(this.cupHome);
      this.kit.yourCup.rotation.set(0, 0, 0);
    }

    // The close-up: the flask held up in front of her, turned toward you.
    if (this.inspecting && !drinking) {
      pose = blendJ(pose, { shoulderR: [-1.15, 0, 0.35], elbowR: [-1.75, 0, 0], head: [0.2, -0.2, 0], neck: [0.05, 0, 0] }, 1);
    }

    // A nod when a habit is done.
    const nodT = this.actT('nod');
    if (nodT >= 0) pose = blendJ(pose, { head: add(pose.j.head, [0.35, 0, 0]) }, Math.sin(clamp01(nodT / 0.8) * Math.PI));

    // Arrival: she looks up and lifts a hand to you.
    const greetT = this.actT('greet');
    if (greetT >= 0) {
      const w = smooth(clamp01(greetT / 0.5)) * (1 - smooth(clamp01((greetT - 1.9) / 0.7)));
      const hand = smooth(clamp01((greetT - 0.4) / 0.4)) * (1 - smooth(clamp01((greetT - 1.5) / 0.5)));
      pose = blendJ(pose, { neck: [-0.08, 0, 0], head: [-0.25, 0.1, 0] }, w);
      pose = blendJ(pose, { shoulderR: [-2.0, 0, 0.35], elbowR: [-0.8, 0, 0] }, hand);
    }

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
    if (this.revealDone && !this.acts.some((a) => a.kind === 'reveal')) {
      const d = this.revealDone;
      this.revealDone = null;
      d(true);
    }
    return pose;
  }

  /**
   * The opening, in five shots (seconds from the start):
   *   0    the camera falls through the snow onto the camp at dusk
   *   3.5  close on her hands, finishing a knot
   *   7    the map slips from her lap; she catches it, a little embarrassed
   *   10   from your seat: she looks up at you, and nods
   *   13   she holds out the second cup; then it sits by your seat, steaming
   */
  private introPose(base: Pose): Pose {
    const i = this.intro;
    if (!i) return base;
    const t = this.clock - i.start;
    let pose = base;
    const knot = smooth(clamp01((t - 3) / 0.6)) * (1 - smooth(clamp01((t - 7.2) / 0.4)));
    if (knot > 0) {
      const tw = Math.sin(t * 7) * 0.12;
      pose = blendJ(pose, { spine: [0.55, 0, 0], neck: [0.2, 0, 0], head: [0.5, 0, 0], shoulderL: [-0.85, 0, -0.35], elbowL: [-0.95, 0, -0.45 + tw], shoulderR: [-0.85, 0, 0.35], elbowR: [-0.95, 0, 0.45 + tw] }, knot);
    }
    const reach = smooth(clamp01((t - 7.9) / 0.35)) * (1 - smooth(clamp01((t - 8.9) / 0.5)));
    if (reach > 0) pose = blendJ(pose, { spine: [0.75, 0.15, 0], head: [0.45, -0.2, 0], shoulderR: [-0.55, 0, -0.3], elbowR: [-0.2, 0, 0] }, reach);
    const sheepish = smooth(clamp01((t - 9.2) / 0.3)) * (1 - smooth(clamp01((t - 9.9) / 0.3)));
    if (sheepish > 0) pose = blendJ(pose, { head: [-0.05, 0.3, 0.08] }, sheepish);
    const look = smooth(clamp01((t - 10.1) / 0.5)) * (1 - smooth(clamp01((t - 15.4) / 0.6)));
    if (look > 0) {
      const nod = Math.sin(clamp01((t - 11.6) / 0.7) * Math.PI) * 0.3;
      pose = blendJ(pose, { neck: [-0.05, 0, 0], head: [-0.32 + nod, 0, 0], spine: [0.3, 0, 0] }, look);
    }
    const offer = smooth(clamp01((t - 13) / 0.6)) * (1 - smooth(clamp01((t - 15.1) / 0.4)));
    if (offer > 0) pose = blendJ(pose, { spine: [0.38, 0, 0], shoulderR: [-1.45, 0, 0.1], elbowR: [-0.3, 0, 0] }, offer);
    return pose;
  }

  /** Props and cuts for the opening; returns its camera, or null when it is over. */
  private introStep(): { shot: Shot; cut: boolean } | null {
    const i = this.intro;
    if (!i) return null;
    const t = this.clock - i.start;
    const c = this.climber;
    const yaw = c.root.rotation.y;
    const local = (x: number, y: number, z: number): THREE.Vector3 => v(x, y, z).applyAxisAngle(UP, yaw).add(c.root.position);
    const hand = (j: THREE.Object3D): THREE.Vector3 => j.localToWorld(v(0, -0.32, 0.02));
    const kit = this.kit;
    // The map on her lap, slipping, caught.
    kit.map.visible = t > 3 && t < 10.5;
    if (t < 7.6) kit.map.position.copy(local(0.2, 0.64, 0.32));
    else if (t < 8.1) kit.map.position.copy(local(0.2, 0.64, 0.32).lerp(local(0.62, 0.08, 0.18), ease(clamp01((t - 7.6) / 0.45))));
    else if (t < 8.5) kit.map.position.copy(local(0.62, 0.08, 0.18));
    else kit.map.position.copy(hand(c.joints.elbowR));
    kit.map.rotation.set(0, yaw + (t > 7.6 && t < 8.5 ? 0.6 : 0), t > 7.6 && t < 8.5 ? 0.3 : 0);
    if (t > 7.6 && !i.cues.has('slip')) {
      i.cues.add('slip');
      this.sound.rustle();
    }
    // The rope between her hands while she ties the knot.
    kit.rope.visible = t > 3.4 && t < 7.1;
    if (kit.rope.visible) {
      kit.rope.position.copy(hand(c.joints.elbowL).lerp(hand(c.joints.elbowR), 0.5));
      kit.rope.rotation.set(Math.PI / 2, 0, t * 2);
    }
    // The second cup: in her hand, then by your seat.
    if (t > 13.3 && t < 15.2 && kit.yourCup.parent !== c.joints.elbowR) {
      c.joints.elbowR.add(kit.yourCup);
      kit.yourCup.position.set(0, -0.34, 0.03);
      kit.yourCup.rotation.set(Math.PI / 2, 0, 0);
    }
    if (t >= 15.2 && kit.yourCup.parent !== kit.group) {
      kit.group.add(kit.yourCup);
      kit.yourCup.position.copy(kit.yourSeat).add(v(0.6, -0.16, -0.25));
      kit.yourCup.rotation.set(0, 0, 0);
      this.fillCup();
      this.sound.chime(4);
    }
    if (t >= 11.6 && !i.cues.has('nod')) {
      i.cues.add('nod');
      this.puff(1.2);
    }
    const head = new THREE.Vector3();
    c.joints.head.getWorldPosition(head);
    const cup = kit.yourCup.getWorldPosition(new THREE.Vector3());
    const seat = kit.yourSeat.clone();
    const segs: Array<[number, () => Shot]> = [
      [0, () => {
        // Down through the snow from high on the slope, to the fire.
        const u = ease(clamp01(t / 3.5));
        const at = c.root.position;
        return { pos: at.clone().add(v(5, 22, 20)).lerp(local(1.5, 1.35, 3.2), u), look: at.clone().add(v(0, 7, -26)).lerp(local(0, 0.65, 0), u) };
      }],
      [3.5, () => ({ pos: local(0.8, 1.0, 1.55).lerp(local(0.6, 0.92, 1.3), clamp01((t - 3.5) / 3.5)), look: local(0, 0.52, 0.3) })],
      [7, () => ({ pos: local(1.9, 1.05, 1.7), look: local(0.35, 0.38, 0.2) })],
      [10, () => ({ pos: seat.clone().add(v(0, 0.78, 0.3)).lerp(seat.clone().add(v(0, 0.74, 0.05)), clamp01((t - 10) / 5)), look: head.clone().add(v(0, -0.12, 0)) })],
      [15.2, () => ({ pos: cup.clone().add(v(0.42, 0.34, 0.5)), look: cup.clone().add(v(0, 0.05, 0)) })],
    ];
    let k = 0;
    for (let n = 0; n < segs.length; n++) if (t >= segs[n]![0]) k = n;
    if (t > 16.8) {
      this.endIntro();
      return null;
    }
    const isCut = k !== i.seg;
    i.seg = k;
    return { shot: segs[k]![1](), cut: isCut };
  }

  /** Sky, fog and light by the hour of your clock (?hour= overrides it for review). */
  private applySky(): void {
    const now = new Date();
    const hour = this.hourOverride ?? now.getHours() + now.getMinutes() / 60;
    const k = skyAt(hour);
    const sky = this.world.sky;
    sky.zenith.set(k.zenith);
    sky.mid.set(k.mid);
    sky.horizon.set(k.horizon);
    this.world.stars.opacity = k.stars;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(k.fog);
    const storm = this.weather === 'storm' && this.view < 1.6;
    fog.near = storm ? 8 : 30;
    fog.far = storm ? 420 : 1300;
    this.hemi.color.copy(k.hemiSky);
    this.hemi.groundColor.copy(k.hemiGround);
    this.hemiBase = k.hemi;
    this.lastLight.color.copy(k.sun);
    this.lastLight.intensity = k.sunI;
  }

  private cued = new Set<string>();
  /** Run `fn` once when the act's time crosses `at`. */
  private cue(t: number, at: number, fn: () => void, kind: ActKind = 'drink'): void {
    const a = this.acts.find((x) => x.kind === kind);
    const key = `${kind}:${a?.start ?? 0}:${at}`;
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
    this.frameMs += ((nowMs - this.last) - this.frameMs) * 0.05;
    this.last = nowMs;
    this.clock += dt;
    if (this.dimmed) return;
    const c = this.climber;

    this.world.update(this.clock);
    this.camp.fire.update(this.clock, dt);
    this.sound.setFire(this.view < 1.5 ? this.camp.fire.level : this.camp.fire.level * 0.2);

    const pose = this.compose(dt);
    c.setPose(pose);
    // Cold comes from the weather, never from an unchecked habit (decision A-8).
    const cold = this.weather === 'storm' ? 0.75 : this.weather === 'snow' ? 0.45 : 0.12;
    c.overlay(this.clock, cold, !this.reduced);
    this.kit.update(this.clock);
    this.ambient();

    // The sky follows your clock; checked every second.
    this.skyTimer += dt;
    if (this.skyTimer > 1) {
      this.skyTimer = 0;
      this.applySky();
    }

    // Steam from your cup once it is filled.
    if (this.steamT >= 0) {
      this.steamT += dt;
      if (Math.floor(this.steamT / 1.1) !== Math.floor((this.steamT - dt) / 1.1) && this.view < 1.6) {
        const at = this.kit.yourCup.getWorldPosition(new THREE.Vector3()).add(v(0, 0.09, 0));
        this.mote('#f2ece4', at, v((Math.random() - 0.5) * 0.04, 0.16, 0), 2.2, 0.11);
      }
    }

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
    this.hemi.intensity = this.hemiBase + glow * 0.35;

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

    // Camera: the opening, the replay's cuts, a reveal, or the screen's shot.
    const intro = this.introStep();
    const m = intro ?? this.montageShot();
    let want = this.debugShot ?? (m ? m.shot : this.camShot());
    const revealT = this.actT('reveal');
    if (revealT >= 0 && this.revealAt && !m) {
      const T = this.reduced ? 1.5 : 3.4;
      const w = smooth(clamp01(revealT / 0.7)) * (1 - smooth(clamp01((revealT - (T - 0.8)) / 0.8)));
      const at = this.revealAt;
      const from = at.clone().add(v(1.6, 1.2, 2.2));
      want = { pos: want.pos.clone().lerp(from, w), look: want.look.clone().lerp(at, w) };
    }
    // The return beat is framed from your place: your cup in front, Ari beyond.
    const offerT = this.actT('offer');
    if (offerT >= 0 && !m && this.view < 1.5 && this.cupHome) {
      const w = smooth(clamp01(offerT / 0.9)) * (1 - smooth(clamp01((offerT - 4.3) / 0.7)));
      const seat = this.kit.yourSeat;
      const head = new THREE.Vector3();
      this.climber.joints.head.getWorldPosition(head);
      const shot = { pos: seat.clone().add(v(0.25, 0.9, 0.55)), look: head.clone().add(v(0, -0.35, 0)) };
      want = { pos: want.pos.clone().lerp(shot.pos, w), look: want.look.clone().lerp(shot.look, w) };
    }
    if (this.inspecting && !m && this.view < 1.5) {
      const at = this.flask.getWorldPosition(new THREE.Vector3());
      const yaw = this.climber.root.rotation.y;
      // Pulled back enough to see her hand and the tin; the sheet takes the lower part.
      want = { pos: at.clone().add(v(0.55, 0.3, 1.35).applyAxisAngle(UP, yaw)), look: at.clone().add(v(0, -0.22, 0)) };
    }
    if (m?.cut || (intro && this.intro?.seg === 0)) {
      this.camPos.copy(want.pos);
      this.camLook.copy(want.look);
    } else {
      const k = 1 - Math.exp(-dt * (m ? 6 : 5));
      this.camPos.lerp(want.pos, k);
      this.camLook.lerp(want.look, k);
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.shift += ((this.montage || this.intro || this.debugShot ? 0 : this.frameShift) - this.shift) * (1 - Math.exp(-dt * 4));
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

interface SkyKey {
  zenith: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  fog: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemi: number;
  sun: THREE.Color;
  sunI: number;
  stars: number;
}

const C = (h: string): THREE.Color => new THREE.Color(h);
const NIGHT: SkyKey = { zenith: C('#05070f'), mid: C('#0f1428'), horizon: C('#232640'), fog: C('#141726'), hemiSky: C('#2c3360'), hemiGround: C('#0e0c0a'), hemi: 0.8, sun: C('#8fa4d8'), sunI: 0.18, stars: 0.95 };
const DAWN: SkyKey = { zenith: C('#1b2546'), mid: C('#5d4f75'), horizon: C('#e6936a'), fog: C('#6e5a6a'), hemiSky: C('#6b6f9c'), hemiGround: C('#2a2218'), hemi: 1.15, sun: C('#ffb98a'), sunI: 0.75, stars: 0.25 };
const DAY: SkyKey = { zenith: C('#335b93'), mid: C('#7fa6cc'), horizon: C('#cfdce4'), fog: C('#8d9fb2'), hemiSky: C('#a9bbd8'), hemiGround: C('#463b2c'), hemi: 1.5, sun: C('#fff0d8'), sunI: 1.0, stars: 0 };
const DUSK: SkyKey = { zenith: C('#141a33'), mid: C('#4a3a5c'), horizon: C('#d8875a'), fog: C('#5a4b5e'), hemiSky: C('#7a7eac'), hemiGround: C('#2e261b'), hemi: 1.35, sun: C('#ffb27a'), sunI: 0.9, stars: 0.55 };
const SKY_KEYS: Array<[number, SkyKey]> = [[0, NIGHT], [5, NIGHT], [6.5, DAWN], [8.5, DAY], [16, DAY], [18.3, DUSK], [20.3, NIGHT], [24, NIGHT]];

/** The sky at an hour of the day, blended between night, dawn, day and dusk. */
export function skyAt(hour: number): SkyKey {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < SKY_KEYS.length - 2 && h >= SKY_KEYS[i + 1]![0]) i++;
  const [h0, a] = SKY_KEYS[i]!;
  const [h1, b] = SKY_KEYS[i + 1]!;
  const u = smooth((h - h0) / Math.max(0.001, h1 - h0));
  const mix = (x: THREE.Color, y: THREE.Color): THREE.Color => x.clone().lerp(y, u);
  return {
    zenith: mix(a.zenith, b.zenith),
    mid: mix(a.mid, b.mid),
    horizon: mix(a.horizon, b.horizon),
    fog: mix(a.fog, b.fog),
    hemiSky: mix(a.hemiSky, b.hemiSky),
    hemiGround: mix(a.hemiGround, b.hemiGround),
    hemi: a.hemi + (b.hemi - a.hemi) * u,
    sun: mix(a.sun, b.sun),
    sunI: a.sunI + (b.sunI - a.sunI) * u,
    stars: a.stars + (b.stars - a.stars) * u,
  };
}
