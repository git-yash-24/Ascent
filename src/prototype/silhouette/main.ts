/**
 * M3 prototype: the same 60 seconds as silhouette theatre.
 * A side view on a 2D canvas: painted dusk sky, parallax ridges, black silhouettes rimmed by firelight.
 * Ari uses the same poses and script as the 3D version, flattened to the side (only x rotations count).
 */
import { fbm, mulberry32, valueNoise } from '../shared/noise';
import { JOINTS, POSES, RISE, SCRIPT, lerpPose, samplePose, walkPose, type Joint, type Pose } from '../shared/poses';
import { createSound } from '../shared/audio';

type Phase = 'sitting' | 'rising' | 'walking' | 'toWeek' | 'week' | 'toCamp';
type Outcome = 'closed' | 'partial' | 'rested' | 'missed';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// ---------- Canvas ----------
const canvas = $<HTMLCanvasElement>('scene');
const ctxOrNull = canvas.getContext('2d');
if (!ctxOrNull) {
  $('fallback').hidden = false;
  throw new Error('Canvas 2D unavailable');
}
const ctx: CanvasRenderingContext2D = ctxOrNull;
let W = 0;
let H = 0;
let dpr = 1;
function resize(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
}
window.addEventListener('resize', resize);
resize();

// ---------- The land (world units are metres; y is up) ----------
/** Ground height. Flat camp around x = 0; uphill to the right (ahead); downhill to the left (the days behind). */
function groundY(x: number): number {
  const up = Math.max(0, x - 4) * 0.3;
  const down = Math.min(0, x + 4) * 0.2;
  const rough = (fbm(x * 0.07 + 3, 1.7, 3) - 0.5) * 1.6 * smooth(4, 10, Math.abs(x));
  return up + down + rough;
}

// ---------- Camera ----------
const cam = { x: 0.35, y: 0.95, s: 120 };
const sx = (wx: number): number => W / 2 + (wx - cam.x) * cam.s;
const sy = (wy: number): number => H * 0.6 - (wy - cam.y) * cam.s;
function dayScale(): number {
  return Math.max(70, Math.min(150, Math.min(H * 0.155, W * 0.2)));
}
cam.s = dayScale();

// ---------- Palette ----------
const COLORS = {
  skyTop: '#121831',
  skyMid: '#4b3a5d',
  skyLow: '#d98a5c',
  far: '#3a3f57',
  snow: '#8a8fa6',
  ridge: '#272a3b',
  mid: '#191b26',
  ground: '#0e0e14',
  figure: '#0a0a0d',
  hood: '#7a3519',
  fire: '255,150,70',
  rimWarm: '#ff8a3d',
  rimCool: '#7f8fd6',
};

// ---------- Static decoration (seeded) ----------
const rnd = mulberry32(42);
const stars = Array.from({ length: 140 }, () => ({ x: rnd(), y: rnd() * 0.42, r: 0.4 + rnd() * 0.9, tw: rnd() * 6 }));
const groundTrees = Array.from({ length: 90 }, () => {
  const x = -150 + rnd() * 230;
  return { x, h: 3 + rnd() * 6, w: 0.9 + rnd() * 0.8 };
}).filter((t) => Math.abs(t.x) > 6 && !(t.x > -3 && t.x < 3));

// The far range in screen-relative units (fractions of the screen height).
interface Peak { u: number; h: number; w: number }
const FAR_PEAKS: Peak[] = [
  { u: -0.55, h: 0.2, w: 0.35 },
  { u: 0.18, h: 0.34, w: 0.34 }, // Ambar
  { u: 0.75, h: 0.24, w: 0.3 },
  { u: 1.3, h: 0.17, w: 0.35 },
  { u: -1.1, h: 0.15, w: 0.4 },
];
const AMBAR = FAR_PEAKS[1]!;
function farProfile(u: number): number {
  let h = 0.04 + (fbm(u * 3, 9, 3) - 0.5) * 0.03;
  for (const p of FAR_PEAKS) {
    const d = Math.abs(u - p.u) / p.w;
    // Jagged ridgelines: coarse shoulders plus fine crags, strongest near the summit.
    const crag = (fbm(u * 22 + p.u * 3, 2, 3) - 0.5) * 0.16 * (1 - d);
    const ridge = 0.8 + 0.4 * fbm(u * 6 + p.u, 2, 4) + crag;
    h = Math.max(h, p.h * Math.max(0, 1 - Math.pow(d, 0.75)) * ridge);
  }
  return h;
}

// ---------- Drawing helpers ----------
function fillProfile(fn: (screenX: number) => number, color: string, bottom = H): void {
  ctx.beginPath();
  ctx.moveTo(-10, bottom + 10);
  const step = 5;
  for (let x = -10; x <= W + 10; x += step) ctx.lineTo(x, fn(x));
  ctx.lineTo(W + 10, bottom + 10);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function pine(x: number, base: number, h: number, w: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const t0 = i / tiers;
    const y0 = base - h * (0.15 + t0 * 0.75);
    const ww = w * (1 - t0 * 0.75);
    ctx.moveTo(x - ww / 2, y0);
    ctx.lineTo(x, y0 - h * 0.35);
    ctx.lineTo(x + ww / 2, y0);
  }
  ctx.fill();
  ctx.fillRect(x - w * 0.05, base - h * 0.2, w * 0.1, h * 0.2);
}

function glow(x: number, y: number, r: number, rgb: string, a: number): void {
  if (a <= 0.003 || r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(0.4, `rgba(${rgb},${a * 0.35})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ---------- The figure: a side-view rig built from the shared poses ----------
interface Figure {
  x: number;
  y: number;
  facing: number; // -1 left, +1 right; values between squash the turn
  pose: Pose;
  satchelOnBack: boolean;
}

const BONES = { torso: 0.52, neck: 0.1, upper: 0.3, fore: 0.28, thigh: 0.45, shin: 0.42 };

function rot(p: Pose, j: Joint): number {
  return (p.j[j] ?? [0, 0, 0])[0];
}

/** Joint positions in world metres for a pose, side view. */
function skeleton(f: Figure, t: number): Record<string, [number, number]> {
  const p = f.pose;
  const fd = f.facing;
  const up = (a: number, len: number, from: [number, number]): [number, number] => [from[0] + fd * Math.sin(a) * len, from[1] + Math.cos(a) * len];
  const down = (a: number, len: number, from: [number, number]): [number, number] => [from[0] - fd * Math.sin(a) * len, from[1] - Math.cos(a) * len];
  const hips: [number, number] = [f.x, f.y + p.hipsY];
  const hx = p.hipsX ?? 0;
  const spineBase = up(hx, 0.06, hips);
  const s = hx + rot(p, 'spine');
  const chest = up(s, BONES.torso, spineBase);
  const shoulder = up(s, 0.46, spineBase);
  const n = s + rot(p, 'neck');
  const neckTop = up(n, BONES.neck, chest);
  const hd = n + rot(p, 'head');
  const headC = up(hd, 0.11, neckTop);
  const aL = s + rot(p, 'shoulderL');
  const elbowL = down(aL, BONES.upper, shoulder);
  const handL = down(aL + rot(p, 'elbowL'), BONES.fore, elbowL);
  const aR = s + rot(p, 'shoulderR');
  const elbowR = down(aR, BONES.upper, shoulder);
  const handR = down(aR + rot(p, 'elbowR'), BONES.fore, elbowR);
  const hipJ: [number, number] = [hips[0], hips[1] - 0.06];
  const tL = hx + rot(p, 'hipL');
  const kneeL = down(tL, BONES.thigh, hipJ);
  const ankleL = down(tL + rot(p, 'kneeL'), BONES.shin, kneeL);
  const tR = hx + rot(p, 'hipR');
  const kneeR = down(tR, BONES.thigh, hipJ);
  const ankleR = down(tR + rot(p, 'kneeR'), BONES.shin, kneeR);
  const breath = Math.sin(t * ((Math.PI * 2) / 3.8));
  return {
    hips, spineBase, chest: [chest[0], chest[1] + breath * 0.006], shoulder, neckTop, headC,
    elbowL, handL, elbowR, handR, hipJ, kneeL, ankleL, kneeR, ankleR,
    hd: [hd, 0], s: [s, 0],
  };
}

function drawFigure(f: Figure, t: number, fill: string, hoodFill: string | null, scarfWave: number): void {
  const k = skeleton(f, t);
  const P = (q: [number, number] | undefined): [number, number] => (q ? [sx(q[0]), sy(q[1])] : [0, 0]);
  const fd = f.facing;
  const sc = cam.s;
  const limb = (a: [number, number] | undefined, b: [number, number] | undefined, w: number): void => {
    const pa = P(a);
    const pb = P(b);
    ctx.lineWidth = w * sc;
    ctx.beginPath();
    ctx.moveTo(pa[0], pa[1]);
    ctx.lineTo(pb[0], pb[1]);
    ctx.stroke();
  };
  ctx.strokeStyle = fill;
  ctx.fillStyle = fill;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Far limbs first.
  limb(k.hipJ, k.kneeR, 0.16);
  limb(k.kneeR, k.ankleR, 0.125);
  boot(P(k.ankleR), fd, sc);
  limb(k.shoulder, k.elbowR, 0.11);
  limb(k.elbowR, k.handR, 0.095);

  // Coat skirt
  const hips = k.hips!;
  const s = k.s![0];
  const kneeMid: [number, number] = [lerp(hips[0], k.kneeL![0], 0.55), lerp(hips[1], k.kneeL![1], 0.55)];
  const backBottom: [number, number] = [hips[0] - fd * 0.2 + Math.sin(t * 1.3) * 0.01, hips[1] - 0.4 + Math.max(0, 0.93 - (f.pose.hipsY)) * 0.3];
  ctx.beginPath();
  const pts: Array<[number, number]> = [
    [hips[0] - fd * 0.17, hips[1] + 0.1],
    [hips[0] + fd * 0.15, hips[1] + 0.1],
    kneeMid,
    [kneeMid[0] - fd * 0.06, kneeMid[1] - 0.12],
    backBottom,
  ];
  pts.forEach((q, i) => {
    const pq = P(q);
    if (i === 0) ctx.moveTo(pq[0], pq[1]);
    else ctx.lineTo(pq[0], pq[1]);
  });
  ctx.closePath();
  ctx.fill();

  // Torso: a tapered body along the spine.
  const base = k.spineBase!;
  const chest = k.chest!;
  const perp = (w: number, at: [number, number]): [number, number][] => {
    const nx = Math.cos(s) * fd;
    const ny = -Math.sin(s);
    return [[at[0] - nx * w, at[1] - ny * w], [at[0] + nx * w, at[1] + ny * w]];
  };
  const [b1, b2] = perp(0.2, base);
  const [c1, c2] = perp(0.23, chest);
  ctx.beginPath();
  [b1, b2, c2, c1].forEach((q, i) => {
    const pq = P(q);
    if (i === 0) ctx.moveTo(pq[0], pq[1]);
    else ctx.lineTo(pq[0], pq[1]);
  });
  ctx.closePath();
  ctx.fill();

  // Satchel on the back
  if (f.satchelOnBack) {
    const at: [number, number] = [lerp(base[0], chest[0], 0.45) - fd * Math.cos(s) * 0.24, lerp(base[1], chest[1], 0.45) + Math.sin(s) * 0.24];
    const pa = P(at);
    ctx.save();
    ctx.translate(pa[0], pa[1]);
    ctx.rotate(fd * s);
    ctx.fillRect(-0.09 * sc, -0.14 * sc, 0.18 * sc, 0.28 * sc);
    ctx.restore();
  }

  // Near leg and arm
  limb(k.hipJ, k.kneeL, 0.17);
  limb(k.kneeL, k.ankleL, 0.13);
  boot(P(k.ankleL), fd, sc);

  // Neck, scarf, hood
  limb(chest, k.neckTop, 0.13);
  const neckP = P(k.neckTop);
  ctx.lineWidth = 0.035 * sc;
  ctx.beginPath();
  ctx.moveTo(neckP[0], neckP[1]);
  ctx.quadraticCurveTo(neckP[0] - fd * 0.18 * sc, neckP[1] + (0.05 + scarfWave * 0.04) * sc, neckP[0] - fd * (0.34 + scarfWave * 0.05) * sc, neckP[1] + (0.04 + scarfWave * 0.1) * sc);
  ctx.stroke();

  const head = P(k.headC);
  const hd = k.hd![0];
  ctx.save();
  ctx.translate(head[0], head[1]);
  ctx.rotate(fd * hd);
  ctx.scale(fd, 1);
  const r = 0.165 * sc;
  ctx.fillStyle = hoodFill ?? fill;
  ctx.beginPath();
  // Hood: rounded front, a peak trailing back, drape down to the shoulders.
  ctx.moveTo(r * 0.95, -r * 0.1);
  ctx.quadraticCurveTo(r * 1.05, -r * 1.15, -r * 0.2, -r * 1.2);
  ctx.quadraticCurveTo(-r * 1.15, -r * 1.1, -r * 1.35, -r * 0.35);
  ctx.quadraticCurveTo(-r * 1.6, r * 0.9, -r * 1.2, r * 1.5);
  ctx.lineTo(r * 0.7, r * 1.35);
  ctx.quadraticCurveTo(r * 1.05, r * 0.7, r * 0.95, -r * 0.1);
  ctx.fill();
  if (hoodFill) {
    // The face opening: deep shadow.
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(r * 0.62, r * 0.15, r * 0.36, r * 0.62, 0.15, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = fill;

  limb(k.shoulder, k.elbowL, 0.12);
  limb(k.elbowL, k.handL, 0.1);
  const hand = P(k.handL);
  ctx.beginPath();
  ctx.arc(hand[0], hand[1], 0.05 * sc, 0, Math.PI * 2);
  ctx.fill();
}

function boot(at: [number, number], fd: number, sc: number): void {
  ctx.beginPath();
  ctx.moveTo(at[0] - fd * 0.06 * sc, at[1] - 0.02 * sc);
  ctx.lineTo(at[0] + fd * 0.17 * sc, at[1] + 0.02 * sc);
  ctx.lineTo(at[0] + fd * 0.16 * sc, at[1] + 0.08 * sc);
  ctx.lineTo(at[0] - fd * 0.07 * sc, at[1] + 0.08 * sc);
  ctx.closePath();
  ctx.fill();
}

// ---------- Fire ----------
const fire = { level: 0.18, target: 0.18 };
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number }
const embers: Particle[] = [];
const smoke: Particle[] = [];

function drawFire(t: number, dt: number): void {
  fire.level += (fire.target - fire.level) * Math.min(1, dt * 1.6);
  const L = fire.level;
  const flick = 0.8 + valueNoise(t * 6.5, 1.3) * 0.4;
  const x0 = sx(0);
  const y0 = sy(groundY(0));
  const sc = cam.s;
  // Stones and logs
  ctx.fillStyle = '#060608';
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.ellipse(x0 + i * 0.12 * sc, y0 - 0.02 * sc, 0.07 * sc, 0.05 * sc, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(x0, y0 - 0.06 * sc);
  ctx.rotate(0.35);
  ctx.fillRect(-0.3 * sc, -0.04 * sc, 0.6 * sc, 0.08 * sc);
  ctx.rotate(-0.7);
  ctx.fillRect(-0.3 * sc, -0.04 * sc, 0.6 * sc, 0.08 * sc);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Ember bed
  glow(x0, y0 - 0.05 * sc, 0.32 * sc, '255,90,30', 0.55 + 0.25 * valueNoise(t * 2, 7));
  // Flames
  for (let i = 0; i < 4; i++) {
    const n = valueNoise(t * 7 + i * 13.1, i * 3.7);
    const h = (0.12 + L * 0.62) * (0.65 + n * 0.6) * (i === 0 ? 1.2 : 0.8) * sc;
    const w = h * 0.32;
    const fx = x0 + (i - 1.5) * 0.06 * sc + Math.sin(t * 3 + i) * 0.02 * sc;
    const sway = Math.sin(t * 5 + i * 2) * w * 0.4;
    const g = ctx.createLinearGradient(fx, y0, fx, y0 - h);
    g.addColorStop(0, `rgba(255,230,170,${0.9 * Math.min(1, 0.5 + L)})`);
    g.addColorStop(0.45, `rgba(255,140,50,${0.75 * Math.min(1, 0.4 + L)})`);
    g.addColorStop(1, 'rgba(200,40,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(fx - w, y0 - 0.04 * sc);
    ctx.quadraticCurveTo(fx - w * 0.9, y0 - h * 0.55, fx + sway, y0 - h);
    ctx.quadraticCurveTo(fx + w * 0.9, y0 - h * 0.5, fx + w, y0 - 0.04 * sc);
    ctx.fill();
  }
  ctx.restore();

  // Embers
  if (Math.random() < (0.2 + L * 1.6) * dt * 10) {
    embers.push({ x: (Math.random() - 0.5) * 0.25, y: 0.15, vx: (Math.random() - 0.5) * 0.2, vy: 0.5 + Math.random() * (0.4 + L), life: 0, max: 0.8 + Math.random() * 1.8 });
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = embers.length - 1; i >= 0; i--) {
    const e = embers[i]!;
    e.life += dt;
    if (e.life > e.max) { embers.splice(i, 1); continue; }
    e.x += e.vx * dt + Math.sin(t * 2 + i) * 0.003;
    e.y += e.vy * dt;
    const a = (1 - e.life / e.max) * 0.9;
    ctx.fillStyle = `rgba(255,176,102,${a})`;
    ctx.fillRect(sx(e.x), sy(groundY(0) + e.y), Math.max(1.5, 0.025 * sc), Math.max(1.5, 0.025 * sc));
  }
  ctx.restore();

  // Smoke after the fire is kicked out
  if (kicked && L < 0.3 && Math.random() < dt * 2.5) {
    smoke.push({ x: (Math.random() - 0.5) * 0.2, y: 0.2, vx: 0.15 + Math.random() * 0.1, vy: 0.35, life: 0, max: 4 });
  }
  for (let i = smoke.length - 1; i >= 0; i--) {
    const p = smoke[i]!;
    p.life += dt;
    if (p.life > p.max) { smoke.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const a = Math.sin((p.life / p.max) * Math.PI) * 0.07;
    ctx.fillStyle = `rgba(150,150,165,${a})`;
    ctx.beginPath();
    ctx.arc(sx(p.x), sy(groundY(0) + p.y), (0.06 + p.life * 0.09) * sc, 0, Math.PI * 2);
    ctx.fill();
  }
  void flick;
}

// ---------- Week (sample data) ----------
const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const today = new Date();
const outcomes: Outcome[] = ['closed', 'closed', 'partial', 'missed', 'closed', 'rested'];
const weekDays = outcomes.map((outcome, i) => {
  const d = new Date(today);
  d.setDate(today.getDate() - (6 - i));
  return { label: fmt.format(d), outcome };
});
const moves = outcomes.filter((o) => o !== 'missed').length;
let step = 0;
const pastCamps = weekDays.map((d) => {
  if (d.outcome !== 'missed') step++;
  const k = moves - step + 1;
  return { ...d, x: -18 * k };
});

function tent(x: number, color: string, scale = 1): void {
  const bx = sx(x);
  const by = sy(groundY(x));
  const sc = cam.s * scale;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(bx - 0.95 * sc, by + 2);
  ctx.lineTo(bx, by - 1.05 * sc);
  ctx.lineTo(bx + 0.95 * sc, by + 2);
  ctx.closePath();
  ctx.fill();
}

// ---------- Scene state ----------
const figure: Figure = { x: 1.0, y: groundY(1.0), facing: -1, pose: POSES.sitHunched, satchelOnBack: false };
const LOG_X = 1.0;
let phase: Phase = 'sitting';
let phaseStart = 0;
let clock = 0;
let speed = 1;
let walked = 0;
let walkPhase = 0;
let lastStepSign = 0;
let pickedUp = false;
let kicked = false;
let nextBreath = 1.5;
const breaths: Array<{ x: number; y: number; life: number; peak: number; dir: number }> = [];
let flight = { fromX: 0, fromY: 0, fromS: 0 };
const setPhase = (p: Phase): void => { phase = p; phaseStart = clock; document.body.dataset.phase = p; };
setPhase('sitting');

// ---------- Sound ----------
const sound = createSound();
let soundOn = true;
const startSound = (): void => {
  if (!sound.started && soundOn) void sound.start();
  $('soundHint').hidden = true;
};
window.addEventListener('pointerdown', startSound, { once: true });
window.addEventListener('keydown', startSound, { once: true });
$('soundBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  soundOn = !soundOn;
  if (soundOn && !sound.started) void sound.start();
  sound.setMuted(!soundOn);
  $('soundBtn').setAttribute('aria-pressed', String(soundOn));
  $('soundBtn').textContent = soundOn ? 'Sound on' : 'Sound off';
});

// ---------- UI ----------
const check = $<HTMLButtonElement>('habit');
const caption = $('caption');
const pullBtn = $<HTMLButtonElement>('pullBack');
const mist = $('mist');
const labels = $('labels');
function showCaption(text: string, ms = 4500): void {
  caption.textContent = text;
  caption.classList.add('on');
  window.setTimeout(() => caption.classList.remove('on'), ms);
}
showCaption('Day 1 · Lowmarket terraces · dusk', 5000);
check.addEventListener('click', () => {
  if (phase !== 'sitting') return;
  check.setAttribute('aria-checked', 'true');
  check.classList.add('done');
  $('habitState').textContent = 'Logged · 50 of 50';
  startSound();
  sound.tick();
  setPhase('rising');
});
function pullBack(): void {
  if (phase !== 'walking') return;
  flight = { fromX: cam.x, fromY: cam.y, fromS: cam.s };
  sound.whoosh();
  setPhase('toWeek');
  pullBtn.hidden = true;
}
function backToCamp(): void {
  if (phase !== 'week') return;
  flight = { fromX: cam.x, fromY: cam.y, fromS: cam.s };
  sound.whoosh();
  setPhase('toCamp');
  $('weekPanel').hidden = true;
  labels.hidden = true;
}
pullBtn.addEventListener('click', pullBack);
$('backToCamp').addEventListener('click', backToCamp);
$('replay').addEventListener('click', () => window.location.reload());
let wheelAcc = 0;
window.addEventListener('wheel', (e) => {
  wheelAcc += e.deltaY;
  if (wheelAcc > 120) { wheelAcc = 0; pullBack(); }
  if (wheelAcc < -120) { wheelAcc = 0; backToCamp(); }
}, { passive: true });
let pinchStart = 0;
window.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    const a = e.touches[0]!;
    const b = e.touches[1]!;
    pinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && pinchStart > 0) {
    const a = e.touches[0]!;
    const b = e.touches[1]!;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (d < pinchStart * 0.7) { pinchStart = 0; pullBack(); }
    else if (d > pinchStart * 1.4) { pinchStart = 0; backToCamp(); }
  }
}, { passive: true });
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' || e.key === '-') pullBack();
  if (e.key === 'ArrowDown' || e.key === '+' || e.key === 'Escape') backToCamp();
});

// Week labels
const WORD: Record<Outcome, string> = { closed: 'camp made', partial: 'partial', rested: 'rest day', missed: 'stayed put' };
const labelEls = pastCamps.map((c) => {
  const el = document.createElement('div');
  el.className = 'camp-label';
  el.innerHTML = `<b>${c.label}</b><span>${WORD[c.outcome]}</span>`;
  labels.appendChild(el);
  return el;
});
const todayLabel = document.createElement('div');
todayLabel.className = 'camp-label today';
todayLabel.innerHTML = `<b>${fmt.format(today)}</b><span>today</span>`;
labels.appendChild(todayLabel);
function placeLabel(el: HTMLElement, x: number, y: number, dy = 0): void {
  el.style.transform = `translate(${x}px, ${y + dy}px) translate(-50%, -100%)`;
}

const fpsEl = $('fps');
fpsEl.hidden = window.location.hash !== '#fps';
let fpsFrames = 0;
let fpsTime = 0;

// ---------- Frame ----------
let last = performance.now();
let running = true;
document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
  if (running) { last = performance.now(); requestAnimationFrame(frame); }
});

function frame(nowMs: number): void {
  if (!running) return;
  const realDt = (nowMs - last) / 1000;
  const dt = Math.min(0.05, realDt) * speed;
  last = nowMs;
  clock += dt;
  const t = clock - phaseStart;
  sound.setFire(fire.level);

  // --- Story logic: same script as the 3D version ---
  let cold = 1 - fire.level;
  if (phase === 'sitting') {
    figure.pose = POSES.sitHunched;
  } else if (phase === 'rising') {
    if (t > SCRIPT.fireCatches && t < SCRIPT.fireCatches + 0.1) fire.target = 1;
    if (t < SCRIPT.turn) figure.pose = samplePose(RISE, t);
    if (!pickedUp && t >= SCRIPT.pickUp) { pickedUp = true; figure.satchelOnBack = true; sound.rustle(); }
    if (!kicked && t >= SCRIPT.kick) { kicked = true; fire.target = 0.08; sound.thud(); }
    cold = t < 4.5 ? 1 - fire.level : 0.45;
    if (t >= SCRIPT.turn) {
      const u = easeInOut(clamp01((t - SCRIPT.turn) / (SCRIPT.walk - SCRIPT.turn)));
      figure.facing = Math.cos(Math.PI * (1 - u)) >= 0 ? Math.max(0.15, Math.abs(Math.cos(Math.PI * (1 - u)))) : -Math.max(0.15, Math.abs(Math.cos(Math.PI * (1 - u))));
      figure.pose = lerpPose(POSES.stand, walkPose(0, 0.12), u * 0.4);
    }
    if (t >= SCRIPT.walk) {
      figure.facing = 1;
      setPhase('walking');
      sound.setWalking(true);
      showCaption('Logged. Ari takes the route.', 3500);
      window.setTimeout(() => { if (phase === 'walking') pullBtn.hidden = false; }, 3500);
    }
  } else {
    if (walked < SCRIPT.walkLimit) {
      walked += SCRIPT.walkSpeed * dt;
      walkPhase += ((Math.PI * 2 * SCRIPT.walkSpeed) / SCRIPT.stride) * dt;
      figure.x = LOG_X + walked;
      const slope = (groundY(figure.x + 0.5) - groundY(figure.x)) / 0.5;
      figure.pose = walkPose(walkPhase, 0.1 + Math.max(0, slope) * 0.6);
      const sgn = Math.sign(Math.sin(walkPhase));
      if (sgn !== lastStepSign) { lastStepSign = sgn; sound.step(); }
    } else {
      figure.pose = lerpPose(POSES.stand, { hipsY: 0.93, j: { head: [-0.35, 0, 0], neck: [-0.1, 0, 0] } }, 0.7);
      sound.setWalking(false);
    }
    cold = 0.4;
  }
  if (phase === 'sitting' || phase === 'rising') figure.x = phase === 'rising' && t > 3.5 ? LOG_X + 0.15 : LOG_X;
  figure.y = groundY(figure.x);
  // Shiver: a tremor in the shoulders when cold (skipped with reduced motion).
  if (!reduceMotion && cold > 0.3) {
    const burst = Math.max(0, Math.sin(clock * 0.9) * Math.sin(clock * 0.37 + 1));
    const sh = cold * Math.pow(burst, 3) * Math.sin(clock * 46) * 0.03;
    const p: Pose = { hipsY: figure.pose.hipsY, j: { ...figure.pose.j } };
    for (const j of ['spine', 'shoulderL', 'shoulderR'] as Joint[]) {
      const r = p.j[j] ?? [0, 0, 0];
      p.j[j] = [r[0] + sh, r[1], r[2]];
    }
    figure.pose = p;
  }
  void JOINTS;

  // --- Camera ---
  const target = { x: 0.35, y: 0.95, s: dayScale() };
  if (phase === 'rising' && t > 3.5) { target.x = 0.6; target.y = 1.15; }
  if (phase === 'walking' || phase === 'toCamp') { target.x = figure.x + 1.2; target.y = figure.y + 1.0; }
  if (phase === 'week') { const c = weekCenter(); target.x = c.x; target.y = c.y; target.s = weekScale(); }
  if (phase === 'toWeek' || phase === 'toCamp') {
    const toWeek = phase === 'toWeek';
    const dur = reduceMotion ? 0.8 : 3.2;
    const u = clamp01(t / dur);
    const e = easeInOut(u);
    const wc = weekCenter();
    const toX = toWeek ? wc.x : figure.x + 1.2;
    const toY = toWeek ? wc.y : figure.y + 1.0;
    const toS = toWeek ? weekScale() : dayScale();
    if (reduceMotion) {
      mist.style.opacity = String(Math.sin(u * Math.PI));
      if (u > 0.5) { cam.x = toX; cam.y = toY; cam.s = toS; }
    } else {
      cam.x = lerp(flight.fromX, toX, e);
      cam.y = lerp(flight.fromY, toY, e);
      cam.s = Math.exp(lerp(Math.log(flight.fromS), Math.log(toS), e));
      mist.style.opacity = String(Math.sin(u * Math.PI) * 0.6);
    }
    if (u >= 1) {
      mist.style.opacity = '0';
      if (toWeek) { setPhase('week'); $('weekPanel').hidden = false; labels.hidden = false; }
      else { setPhase('walking'); if (walked < SCRIPT.walkLimit) pullBtn.hidden = false; }
    }
  } else {
    const k = 1 - Math.exp(-dt * (phase === 'walking' ? 2.2 : 1.4));
    cam.x = lerp(cam.x, target.x, k);
    cam.y = lerp(cam.y, target.y, k);
    cam.s = Math.exp(lerp(Math.log(cam.s), Math.log(target.s), k));
  }
  const zoomOut = clamp01((Math.log(dayScale()) - Math.log(cam.s)) / (Math.log(dayScale()) - Math.log(weekScale())));

  // --- Draw ---
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, COLORS.skyTop);
  sky.addColorStop(0.42, COLORS.skyMid);
  sky.addColorStop(0.66, COLORS.skyLow);
  sky.addColorStop(1, COLORS.skyLow);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  for (const s of stars) {
    const a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(clock * 0.8 + s.tw));
    ctx.fillStyle = `rgba(215,222,255,${a * (1 - s.y * 1.6)})`;
    ctx.fillRect(s.x * W, s.y * H, s.r, s.r);
  }

  // Far range (barely moves): Ambar with the Ninth Hut's light.
  const horizon = H * (0.56 + zoomOut * 0.06);
  const farShift = cam.x * 0.0009;
  const farScale = H * (1 - zoomOut * 0.12);
  const farY = (px: number): number => {
    const u = (px - W / 2) / farScale + farShift;
    return horizon - farProfile(u) * farScale;
  };
  fillProfile(farY, COLORS.far);
  // Snow on the high faces
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-10, H);
  for (let x = -10; x <= W + 10; x += 5) ctx.lineTo(x, farY(x));
  ctx.lineTo(W + 10, H);
  ctx.closePath();
  ctx.clip();
  const snowG = ctx.createLinearGradient(0, horizon - farScale * 0.42, 0, horizon - farScale * 0.18);
  snowG.addColorStop(0, COLORS.snow);
  snowG.addColorStop(1, 'rgba(138,143,166,0)');
  ctx.fillStyle = snowG;
  ctx.fillRect(0, horizon - farScale * 0.45, W, farScale * 0.3);
  ctx.restore();
  // The light
  const ambarX = W / 2 + (AMBAR.u - farShift) * farScale;
  const ambarY = horizon - farProfile(AMBAR.u) * farScale + 4;
  const cycle = clock % 7;
  const flash = Math.max(Math.exp(-Math.pow((cycle - 1) / 0.25, 2)), Math.exp(-Math.pow((cycle - 1.9) / 0.25, 2)));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glow(ambarX, ambarY, 6 + flash * 22, '125,255,176', 0.5 + flash * 0.5);
  ctx.fillStyle = `rgba(200,255,220,${0.6 + flash * 0.4})`;
  ctx.fillRect(ambarX - 1, ambarY - 1, 2, 2);
  ctx.restore();

  // Ridge and mid hills with tree lines
  const ridgeScale = lerp(H * 0.9, H * 0.6, zoomOut);
  const ridgeY = (px: number): number => {
    const u = (px - W / 2) / ridgeScale + cam.x * 0.004;
    return horizon + H * 0.02 - (0.06 + fbm(u * 4 + 10, 3, 3) * 0.1) * ridgeScale;
  };
  fillProfile(ridgeY, COLORS.ridge);
  for (let i = 0; i < 40; i++) {
    const px = ((i * 47.3 - cam.x * 0.004 * ridgeScale * 1.0) % (W + 60) + W + 60) % (W + 60) - 30;
    pine(px, ridgeY(px) + 2, 14 + (i % 5) * 4, 7 + (i % 3) * 2, COLORS.ridge);
  }
  const midScale = lerp(H * 0.8, H * 0.35, zoomOut);
  const midY = (px: number): number => {
    const u = (px - W / 2) / midScale + cam.x * 0.03 * (cam.s / dayScale());
    return horizon + H * 0.09 - (0.04 + fbm(u * 3 + 30, 5, 3) * 0.09) * midScale;
  };
  fillProfile(midY, COLORS.mid);
  for (let i = 0; i < 26; i++) {
    const period = W + 120;
    const px = ((i * 83.1 - cam.x * 0.03 * cam.s) % period + period) % period - 60;
    pine(px, midY(px) + 3, 26 + (i % 4) * 9, 12 + (i % 3) * 3, COLORS.mid);
  }

  // Ground (world)
  fillProfile((px) => sy(groundY(cam.x + (px - W / 2) / cam.s)), COLORS.ground);
  // Trees on the ground plane
  for (const tr of groundTrees) {
    const px = sx(tr.x);
    if (px < -100 || px > W + 100) continue;
    pine(px, sy(groundY(tr.x)) + 2, tr.h * cam.s, tr.w * cam.s * 1.4, '#09090d');
  }

  // Past camps and the trail (fade in with the zoom)
  if (zoomOut > 0.02) {
    ctx.save();
    ctx.globalAlpha = zoomOut;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(241,216,184,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = OLDEST_X; x <= figure.x; x += 1) {
      const px = sx(x);
      const py = sy(groundY(x)) - 4;
      if (x === OLDEST_X) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  for (const c of pastCamps) {
    if (c.outcome === 'missed') continue;
    tent(c.x - 1.4, '#08080b');
    if (zoomOut > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const strength = c.outcome === 'closed' ? 1 : c.outcome === 'partial' ? 0.5 : 0.4;
      const rgb = c.outcome === 'rested' ? '255,227,161' : COLORS.fire;
      glow(sx(c.x), sy(groundY(c.x) + 0.4), Math.max(10, 3 * cam.s) * strength + 6, rgb, 0.9 * zoomOut * strength);
      ctx.restore();
    }
  }

  // The camp: tent, log, satchel, fire
  tent(-2.3, '#08080b');
  const logY = sy(groundY(LOG_X) + 0.17);
  ctx.fillStyle = '#08080b';
  ctx.beginPath();
  ctx.ellipse(sx(LOG_X), logY, 0.7 * cam.s, 0.17 * cam.s, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!figure.satchelOnBack) {
    ctx.fillRect(sx(1.55) - 0.17 * cam.s, sy(groundY(1.55)) - 0.27 * cam.s, 0.34 * cam.s, 0.27 * cam.s);
  }
  // Warm light on the ground around the fire
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glow(sx(0), sy(groundY(0) + 0.3), (1.4 + fire.level * 2.4) * cam.s, COLORS.fire, 0.14 + fire.level * 0.26);
  ctx.restore();

  // The figure: cool rim from the sky behind, warm rim from the fire, then the silhouette.
  const fireDist = Math.abs(figure.x);
  const warm = clamp01(fire.level * 1.4 - fireDist * 0.08);
  const towardFire = figure.x > 0 ? -1 : 1;
  const wave = Math.sin(clock * 2.4) * 0.5 + Math.sin(clock * 3.7) * 0.5;
  ctx.save();
  ctx.translate(-towardFire * 0.018 * cam.s, -0.006 * cam.s);
  ctx.globalAlpha = 0.45;
  drawFigure(figure, clock, COLORS.rimCool, COLORS.rimCool, wave);
  ctx.restore();
  if (warm > 0.02) {
    ctx.save();
    ctx.translate(towardFire * 0.024 * cam.s, -0.004 * cam.s);
    ctx.globalAlpha = warm;
    drawFigure(figure, clock, COLORS.rimWarm, COLORS.rimWarm, wave);
    ctx.restore();
  }
  const hood = `rgb(${Math.round(lerp(60, 150, warm))},${Math.round(lerp(26, 62, warm))},${Math.round(lerp(14, 30, warm))})`;
  drawFigure(figure, clock, COLORS.figure, hood, wave);

  drawFire(clock, dt);

  // Breath puffs
  if (clock > nextBreath) {
    nextBreath = clock + 3.8;
    if (cold > 0.3 && phase !== 'week' && phase !== 'toWeek') {
      const k = skeleton(figure, clock);
      const hc = k.headC!;
      breaths.push({ x: hc[0] + figure.facing * 0.22, y: hc[1] - 0.04, life: 0, peak: 0.08 + cold * 0.16, dir: figure.facing });
    }
  }
  for (let i = breaths.length - 1; i >= 0; i--) {
    const b = breaths[i]!;
    b.life += dt;
    if (b.life > 1.7) { breaths.splice(i, 1); continue; }
    const u = b.life / 1.7;
    const g = ctx.createRadialGradient(sx(b.x + b.dir * u * 0.3), sy(b.y + u * 0.2), 0, sx(b.x + b.dir * u * 0.3), sy(b.y + u * 0.2), (0.05 + u * 0.22) * cam.s);
    g.addColorStop(0, `rgba(225,232,245,${Math.sin(u * Math.PI) * b.peak})`);
    g.addColorStop(1, 'rgba(225,232,245,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx(b.x + b.dir * u * 0.3), sy(b.y + u * 0.2), (0.05 + u * 0.22) * cam.s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Foreground grass, darker and faster than the ground (depth).
  const fg = (px: number): number => H - H * 0.035 - (fbm((px + cam.x * cam.s * 1.3) * 0.02, 8, 3) * 0.06) * H * (1 - zoomOut);
  fillProfile(fg, '#050507');

  // Labels in week view
  if (phase === 'week' || phase === 'toWeek') {
    pastCamps.forEach((c, i) => {
      const el = labelEls[i]!;
      placeLabel(el, sx(c.x), sy(groundY(c.x) + 1.4) - 8, c.outcome === 'missed' ? -34 : 0);
    });
    placeLabel(todayLabel, sx(figure.x), sy(figure.y + 2.2) - 8);
  }

  fpsFrames++;
  fpsTime += realDt;
  if (fpsTime > 0.5) {
    fpsEl.textContent = `${Math.round(fpsFrames / fpsTime)} fps`;
    fpsFrames = 0;
    fpsTime = 0;
  }
  requestAnimationFrame(frame);
}

const OLDEST_X = -112;
/** Fit the route from the oldest camp to where Ari is now. */
function weekScale(): number {
  const span = Math.max(80, figure.x - OLDEST_X) * 1.12;
  return Math.max(2.2, Math.min(W / span, H / 45));
}
function weekCenter(): { x: number; y: number } {
  const x = (OLDEST_X + figure.x) / 2;
  return { x, y: (groundY(OLDEST_X) + groundY(figure.x)) / 2 - 3 };
}

window.addEventListener('error', (e) => console.error('frame error', e.message));
requestAnimationFrame(frame);

(window as unknown as { __feel: object }).__feel = {
  tick: () => check.click(),
  pullBack,
  backToCamp,
  setSpeed: (s: number) => { speed = s; },
  state: () => ({ phase, clock, walked, x: figure.x, fire: fire.level, cam: { ...cam } }),
};
