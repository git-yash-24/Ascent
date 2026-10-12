import * as THREE from 'three';
import { buildWorld, groundHeight, pathX } from './world';
import { buildCamp } from './camp';
import { buildClimber, POSES, walkPose, lerpPose, type Keyframe, type Pose } from './climber';
import { buildWeek, type Outcome } from './week';
import { createSound } from './audio';
import { glowTexture } from './world';

type Phase = 'sitting' | 'rising' | 'walking' | 'toWeek' | 'week' | 'toCamp';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = window.matchMedia('(pointer: coarse)').matches;

// ---------- Renderer, scene, camera ----------
const canvas = $<HTMLCanvasElement>('scene');
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch {
  $('fallback').hidden = false;
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.6 : 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const FOG_NEAR = 30;
const FOG_FAR = 1300;
scene.fog = new THREE.Fog('#5a4b5e', FOG_NEAR, FOG_FAR);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 4000);

scene.add(new THREE.HemisphereLight('#7a7eac', '#2e261b', 1.35));
const lastLight = new THREE.DirectionalLight('#ffb27a', 0.9);
lastLight.position.set(-80, 18, -40);
scene.add(lastLight);

const world = buildWorld(scene);
const camp = buildCamp(scene, coarse ? 512 : 1024);
const climber = buildClimber();
scene.add(climber.root);
climber.root.position.set(0, camp.seat.position.y - 0.17, camp.seat.position.z);
scene.add(climber.satchel);
climber.satchel.position.copy(camp.satchelSpot);
climber.satchel.rotation.set(0, 0.4, 0.12);

// Sample week: real dates, invented outcomes, clearly marked as a sample in the panel.
const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const today = new Date();
const outcomes: Outcome[] = ['closed', 'closed', 'partial', 'missed', 'closed', 'rested'];
const weekDays = outcomes.map((outcome, i) => {
  const d = new Date(today);
  d.setDate(today.getDate() - (6 - i));
  return { label: fmt.format(d), outcome };
});
const week = buildWeek(scene, weekDays);

// A marker that finds him from far away in the week view.
const finder = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff7a3d', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
finder.scale.setScalar(9);
scene.add(finder);

// The line of light that runs from the checkbox into the fire.
const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffcf8a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
spark.scale.setScalar(0.25);
scene.add(spark);

// Breath: a few soft puffs reused.
const breathTex = glowTexture();
const puffs = Array.from({ length: 5 }, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: breathTex, color: '#dfe6f0', transparent: true, opacity: 0, depthWrite: false }));
  s.userData = { life: 0, vel: new THREE.Vector3() };
  scene.add(s);
  return s;
});
let nextBreath = 1.5;

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

// ---------- Timelines ----------
const RISE: Keyframe[] = [
  { at: 0.0, pose: POSES.sitHunched },
  { at: 0.9, pose: POSES.sitHunched },
  { at: 2.0, pose: POSES.sitLookUp },
  { at: 2.6, pose: POSES.sitLookUp },
  { at: 3.5, pose: POSES.handsOnKnees },
  { at: 4.5, pose: POSES.stand },
  { at: 5.3, pose: POSES.stretch },
  { at: 6.1, pose: POSES.stand },
  { at: 6.8, pose: POSES.reachDown },
  { at: 7.6, pose: POSES.shoulderPack },
  { at: 8.3, pose: POSES.stand },
  { at: 8.7, pose: POSES.kickBack },
  { at: 9.0, pose: POSES.kickForward },
  { at: 9.5, pose: POSES.stand },
];
const T_PICKUP = 6.95;
const T_KICK = 9.0;
const T_TURN = 9.5;
const T_WALK = 10.4;
const WALK_SPEED = 1.05;
const STRIDE = 1.35;
const WALK_LIMIT = 70;

// ---------- State ----------
let phase: Phase = 'sitting';
let phaseStart = 0;
let clock = 0;
let walked = 0;
let walkPhase = 0;
let lastStepSign = 0;
let pickedUp = false;
let kicked = false;
let flightFrom = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
const camLook = new THREE.Vector3(0.05, 0.62, -0.8);
const camPos = new THREE.Vector3(1.15, 1.0, 2.5);
const weekCam = { pos: new THREE.Vector3(78, 100, 250), look: new THREE.Vector3(0, -4, 62) };

camera.position.copy(camPos);
camera.lookAt(camLook);

const setPhase = (p: Phase): void => {
  phase = p;
  phaseStart = clock;
  document.body.dataset.phase = p;
};
setPhase('sitting');

// ---------- UI ----------
const check = $<HTMLButtonElement>('habit');
const caption = $('caption');
const pullBtn = $<HTMLButtonElement>('pullBack');
const backBtn = $<HTMLButtonElement>('backToCamp');
const replayBtn = $<HTMLButtonElement>('replay');
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
  flightFrom = { pos: camera.position.clone(), look: camLook.clone() };
  sound.whoosh();
  setPhase('toWeek');
  pullBtn.hidden = true;
}
function backToCamp(): void {
  if (phase !== 'week') return;
  flightFrom = { pos: camera.position.clone(), look: camLook.clone() };
  sound.whoosh();
  setPhase('toCamp');
  $('weekPanel').hidden = true;
}
pullBtn.addEventListener('click', pullBack);
backBtn.addEventListener('click', backToCamp);
replayBtn.addEventListener('click', () => window.location.reload());

// Scroll and pinch zoom between levels.
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

// ---------- Helpers ----------
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const v3 = new THREE.Vector3();

function pathPoint(s: number): THREE.Vector3 {
  const z = camp.seat.position.z - s;
  const x = pathX(z);
  return new THREE.Vector3(x, groundHeight(x, z), z);
}

function chaseTargets(): { pos: THREE.Vector3; look: THREE.Vector3 } {
  const p = climber.root.position;
  return {
    pos: new THREE.Vector3(p.x + 0.9, p.y + 1.75, p.z + 3.6),
    look: new THREE.Vector3(p.x, p.y + 1.1, p.z - 3.5),
  };
}

function spawnBreath(cold: number): void {
  const puff = puffs.find((p) => (p.userData.life as number) <= 0);
  if (!puff) return;
  climber.mouth.getWorldPosition(puff.position);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(climber.root.quaternion);
  puff.userData.life = 1.7;
  (puff.userData.vel as THREE.Vector3).copy(fwd.multiplyScalar(0.18)).add(new THREE.Vector3(0, 0.12, 0));
  puff.userData.peak = 0.06 + cold * 0.16;
  puff.scale.setScalar(0.06);
}

// ---------- Projected labels for the week view ----------
const labelEls = week.camps.map((c, i) => {
  const el = document.createElement('div');
  el.className = 'camp-label';
  const word: Record<Outcome, string> = { closed: 'camp made', partial: 'partial', rested: 'rest day', missed: 'stayed put' };
  el.innerHTML = `<b>${c.label}</b><span>${word[c.outcome]}</span>`;
  el.dataset.offset = String(c.outcome === 'missed' ? 1 : 0);
  el.dataset.idx = String(i);
  labels.appendChild(el);
  return el;
});
const todayLabel = document.createElement('div');
todayLabel.className = 'camp-label today';
todayLabel.innerHTML = `<b>${fmt.format(today)}</b><span>today</span>`;
labels.appendChild(todayLabel);

function placeLabel(el: HTMLElement, world: THREE.Vector3, dy = 0): void {
  v3.copy(world).project(camera);
  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;
  el.style.transform = `translate(${((v3.x + 1) / 2) * w}px, ${((1 - v3.y) / 2) * h + dy}px) translate(-50%, -130%)`;
}

// ---------- FPS readout for profiling (open with #fps) ----------
const fpsEl = $('fps');
fpsEl.hidden = window.location.hash !== '#fps';
let fpsFrames = 0;
let fpsTime = 0;

// ---------- Loop ----------
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 62 : 48;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let running = true;
let speed = 1; // only changed by the screenshot harness
document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
  if (running) { last = performance.now(); requestAnimationFrame(frame); }
});

function frame(nowMs: number): void {
  if (!running) return;
  const dt = Math.min(0.05, (nowMs - last) / 1000) * speed;
  last = nowMs;
  clock += dt;
  const t = clock - phaseStart;

  world.update(clock);
  camp.fire.update(clock, dt);
  sound.setFire(camp.fire.level);

  let pose: Pose = POSES.sitHunched;
  let cold = 1 - camp.fire.level;
  const desired = { pos: camPos.clone(), look: camLook.clone() };

  if (phase === 'sitting') {
    pose = POSES.sitHunched;
    desired.pos.set(1.15 + Math.sin(clock * 0.2) * 0.08, 1.0, 2.5);
    desired.look.set(0.05, 0.62, -0.8);
  } else if (phase === 'rising') {
    // The spark flies from the bottom of the screen into the fire.
    if (t < 0.9) {
      const u = easeInOut(clamp01(t / 0.8));
      const startW = new THREE.Vector3(0.5, -0.9, 0.2).unproject(camera);
      spark.position.copy(startW).lerp(new THREE.Vector3(0, 0.3, 0), u);
      spark.material.opacity = Math.sin(u * Math.PI) * 0.95 + (u > 0.95 ? 0 : 0.05);
      spark.scale.setScalar(0.12 + u * 0.4);
    } else spark.material.opacity = 0;
    if (t > 0.6 && t < 0.7) camp.fire.target = 1;
    if (t < T_TURN) pose = climber.sample(RISE, t);
    if (!pickedUp && t >= T_PICKUP) {
      pickedUp = true;
      climber.joints.spine.add(climber.satchel);
      climber.satchel.position.set(0.02, 0.22, -0.2);
      climber.satchel.rotation.set(0.15, Math.PI, 0.25);
      sound.rustle();
    }
    if (!kicked && t >= T_KICK) {
      kicked = true;
      camp.fire.target = 0.12;
      sound.thud();
    }
    cold = t < 4.5 ? 1 - camp.fire.level : 0.45;
    // Turn around toward the mountain, then set off.
    if (t >= T_TURN) {
      const u = easeInOut(clamp01((t - T_TURN) / (T_WALK - T_TURN)));
      climber.root.rotation.y = u * Math.PI;
      pose = lerpPose(POSES.stand, walkPose(0, 0.12), u * 0.4);
    }
    const camU = easeInOut(clamp01((t - 3.0) / 2.5));
    desired.pos.set(1.15 + camU * 0.5, 1.0 + camU * 0.65, 2.5 + camU * 0.8);
    desired.look.set(0.02, 0.62 + camU * 0.45, -0.8 - camU * 0.3);
    if (t >= T_WALK) {
      setPhase('walking');
      sound.setWalking(true);
      showCaption('Logged. Ari takes the route.', 3500);
      window.setTimeout(() => { if (phase === 'walking') pullBtn.hidden = false; }, 3500);
    }
  } else if (phase === 'walking' || phase === 'toWeek' || phase === 'week' || phase === 'toCamp') {
    // He keeps walking (or stands at the end of the stretch looking up at the light).
    if (walked < WALK_LIMIT) {
      walked += WALK_SPEED * dt * Math.min(1, (clock - phaseStart + 0.3) / 0.8 + (phase !== 'walking' ? 1 : 0));
      walkPhase += ((Math.PI * 2 * WALK_SPEED) / STRIDE) * dt;
      const p = pathPoint(walked);
      const ahead = pathPoint(walked + 0.6);
      climber.root.position.copy(p);
      climber.root.rotation.y = Math.atan2(ahead.x - p.x, ahead.z - p.z);
      const slope = (ahead.y - p.y) / 0.6;
      pose = walkPose(walkPhase, 0.1 + Math.max(0, slope) * 0.6);
      const sgn = Math.sign(Math.sin(walkPhase));
      if (sgn !== lastStepSign) { lastStepSign = sgn; sound.step(); }
    } else {
      pose = lerpPose(POSES.stand, { hipsY: 0.93, j: { head: [-0.35, 0, 0], neck: [-0.1, 0, 0] } }, 0.7);
      sound.setWalking(false);
    }
    cold = 0.4;
    const chase = chaseTargets();
    if (phase === 'walking') {
      desired.pos.copy(chase.pos);
      desired.look.copy(chase.look);
    } else if (phase === 'toWeek' || phase === 'toCamp') {
      const toWeek = phase === 'toWeek';
      const dur = reduceMotion ? 0.8 : 3.2;
      const u = clamp01(t / dur);
      const e = easeInOut(u);
      const from = flightFrom;
      const to = toWeek ? weekCam : chase;
      if (reduceMotion) {
        mist.style.opacity = String(Math.sin(u * Math.PI));
        if (u > 0.5) { desired.pos.copy(to.pos); desired.look.copy(to.look); camera.position.copy(to.pos); camLook.copy(to.look); }
      } else {
        // An arc: up and back through cloud, then down onto the target.
        desired.pos.copy(from.pos).lerp(to.pos, e);
        desired.pos.y += Math.sin(e * Math.PI) * 40;
        desired.look.copy(from.look).lerp(to.look, e);
        mist.style.opacity = String(Math.sin(u * Math.PI) * 0.75);
        camera.position.copy(desired.pos);
        camLook.copy(desired.look);
      }
      week.setVisible(toWeek ? e : 1 - e);
      finder.material.opacity = (toWeek ? e : 1 - e) * 0.9;
      if (u >= 1) {
        mist.style.opacity = '0';
        if (toWeek) {
          setPhase('week');
          $('weekPanel').hidden = false;
          labels.hidden = false;
        } else {
          setPhase('walking');
          labels.hidden = true;
          if (walked < WALK_LIMIT) pullBtn.hidden = false;
        }
      }
      if (!toWeek) labels.hidden = true;
    } else if (phase === 'week') {
      desired.pos.set(weekCam.pos.x + Math.sin(clock * 0.1) * 4, weekCam.pos.y, weekCam.pos.z);
      desired.look.copy(weekCam.look);
      week.setVisible(1);
    }
  }

  climber.setPose(pose);
  climber.overlay(clock, clamp01(cold), !reduceMotion);
  finder.position.copy(climber.root.position).add(new THREE.Vector3(0, 3, 0));

  // Breath puffs when cold.
  if (clock > nextBreath) {
    nextBreath = clock + 3.8;
    if (cold > 0.3 && (phase === 'sitting' || phase === 'rising' || phase === 'walking')) spawnBreath(cold);
  }
  for (const p of puffs) {
    let life = p.userData.life as number;
    if (life > 0) {
      life -= dt;
      p.userData.life = life;
      p.position.addScaledVector(p.userData.vel as THREE.Vector3, dt);
      const u = 1 - life / 1.7;
      p.material.opacity = Math.sin(u * Math.PI) * (p.userData.peak as number);
      p.scale.setScalar(0.06 + u * 0.45);
    } else p.material.opacity = 0;
  }

  // Smooth camera everywhere except during flights (already set exactly).
  if (phase !== 'toWeek' && phase !== 'toCamp') {
    const k = 1 - Math.exp(-dt * (phase === 'walking' ? 2.2 : 1.6));
    camera.position.lerp(desired.pos, k);
    camLook.lerp(desired.look, k);
  }
  camera.lookAt(camLook);

  if (phase === 'week' || phase === 'toWeek') {
    week.camps.forEach((c, i) => {
      const el = labelEls[i]!;
      placeLabel(el, c.position, Number(el.dataset.offset) * 34);
    });
    placeLabel(todayLabel, climber.root.position.clone().add(new THREE.Vector3(0, 2.5, 0)));
  }

  renderer.render(scene, camera);

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime > 0.5) {
    fpsEl.textContent = `${Math.round(fpsFrames / fpsTime)} fps`;
    fpsFrames = 0;
    fpsTime = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug hooks for automated screenshots.
(window as unknown as { __feel: object }).__feel = {
  tick: () => check.click(),
  pullBack,
  backToCamp,
  setSpeed: (s: number) => { speed = s; },
  scene,
  THREE,
};
