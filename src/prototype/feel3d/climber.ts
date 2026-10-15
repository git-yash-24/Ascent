import * as THREE from 'three';
import { JOINTS, POSES, samplePose, type Joint, type Keyframe, type Pose } from '../shared/poses';

export { POSES, lerpPose, walkPose, type Joint, type Keyframe, type Pose } from '../shared/poses';

/**
 * Ari, built from simple shapes and animated in code.
 * Facing +z by default. Joint rotations are Euler XYZ in radians.
 * Conventions: negative x on a hip or shoulder swings the limb forward; positive x on the spine leans forward.
 */

export interface Climber {
  root: THREE.Group;
  hips: THREE.Group;
  joints: Record<Joint, THREE.Group>;
  satchel: THREE.Group;
  mouth: THREE.Object3D;
  setPose(p: Pose): void;
  /** Evaluate a keyframed clip at time t. */
  sample(keys: Keyframe[], t: number): Pose;
  /** Small additive motions: breath and shiver. */
  /** Breathing and shivers. `breath` is the breathing phase (radians), `depth` 0 to 1 deepens it. */
  overlay(t: number, cold: number, motion: boolean, breath?: number, depth?: number): void;
  /** Clothes for the weather (game/conditions.ts outfitFor). */
  dress(o: { layer: 'light' | 'coat' | 'shell' | 'parka'; sunHat: boolean; bundled: boolean }): void;
  /** Every material she wears, for the golden-hour rim light. */
  materials: THREE.MeshLambertMaterial[];
  /** Cloth that moves: the scarf's tails and the cape lift and swing with the wind and her movement. */
  flutter(t: number, wind: number, moving: number): void;
  /**
   * Where she looks, added on top of the pose: `yaw` and `pitch` in radians (head and eyes share
   * it, the eyes leading), and how open her eyes are (0 shut to 1).
   */
  look(yaw: number, pitch: number, open: number): void;
}

/** Clothing colours per layer: coat, sleeves, hood. */
const LAYERS = {
  coat: ['#384152', '#384152', '#b4532c'],
  light: ['#8a7a5a', '#b58c68', '#b4532c'],
  shell: ['#b8902a', '#b8902a', '#b8902a'],
  parka: ['#5e2f2a', '#5e2f2a', '#4a2622'],
} as const;

export function buildClimber(): Climber {
  const mat = (color: string): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color, flatShading: true });
  const coat = mat('#384152');
  const sleeve = mat('#384152');
  const mitt = mat('#2b3240');
  const coatDark = mat('#2b3240');
  const hood = mat('#b4532c');
  const scarf = mat('#7f7c74');
  const trousers = mat('#272b33');
  const boots = mat('#4a3426');
  const face = new THREE.MeshBasicMaterial({ color: '#09090b' });

  const shadowed = <T extends THREE.Object3D>(o: T): T => {
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
      }
    });
    return o;
  };
  const grp = (x = 0, y = 0, z = 0): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    return g;
  };
  const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 7): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
    return mesh;
  };
  /** A turned shape from [radius, y] pairs, top to bottom: torsos, sleeves, trouser legs. */
  const lathe = (pts: Array<[number, number]>, m: THREE.Material, seg = 9): THREE.Mesh =>
    new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), m);
  const ball = (r: number, m: THREE.Material, sx = 1, sy = 1, sz = 1, w = 8, h = 6): THREE.Mesh => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, w, h), m);
    b.scale.set(sx, sy, sz);
    return b;
  };

  const root = grp();
  const hips = grp(0, 0.93, 0);
  root.add(hips);

  const pelvis = ball(0.17, trousers, 1, 0.62, 0.78);
  hips.add(pelvis);
  // The coat's skirt hangs from the waist and flares to a hem.
  coat.side = THREE.DoubleSide;
  const skirt = lathe([[0.19, 0.1], [0.21, -0.02], [0.24, -0.2], [0.27, -0.36], [0.275, -0.4]], coat, 10);
  skirt.scale.z = 0.86;
  hips.add(skirt);

  const spine = grp(0, 0.06, 0);
  hips.add(spine);
  // Chest broader than the waist, rounding into the shoulders.
  const torso = lathe([[0.04, 0.54], [0.12, 0.52], [0.19, 0.47], [0.215, 0.38], [0.21, 0.24], [0.19, 0.1], [0.18, 0.0], [0.17, -0.04]], coat, 10);
  torso.scale.z = 0.78;
  spine.add(torso);
  const belt = cyl(0.185, 0.185, 0.045, coatDark, 10);
  belt.position.y = 0.02;
  belt.scale.z = 0.8;
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), mat('#9a8a6a'));
  buckle.position.set(0, 0.02, 0.15);
  // A placket down the front of the coat, and two toggles.
  const placket = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 0.02), coatDark);
  placket.position.set(0.02, 0.27, 0.16);
  spine.add(belt, buckle, placket);
  for (const y of [0.22, 0.36]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.015, 0.02), mat('#9a8a6a'));
    t.position.set(0.02, y, 0.172);
    spine.add(t);
  }

  const neck = grp(0, 0.52, 0);
  spine.add(neck);
  const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.055, 6, 12), scarf);
  scarfRing.rotation.x = Math.PI / 2;
  scarfRing.position.y = 0.02;
  neck.add(scarfRing);
  // The scarf's tails hang from a knot and move with her and the wind (see flutter).
  const scarfTail = grp(0.06, -0.02, 0.12);
  const tailA = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.28, 0.025), scarf);
  tailA.position.y = -0.14;
  const tailB = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.2, 0.025), scarf);
  tailB.position.set(0.05, -0.1, -0.01);
  tailB.rotation.z = 0.25;
  scarfTail.add(tailA, tailB);
  neck.add(scarfTail);

  const head = grp(0, 0.1, 0.01);
  neck.add(head);
  const hoodBall = ball(0.165, hood, 1, 1.1, 1.15, 12, 9);
  hoodBall.position.y = 0.11;
  head.add(hoodBall);
  // The hood's point falls back behind the head, like a climber's cowl.
  const hoodPeak = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.2, 6), hood);
  hoodPeak.position.set(0, 0.17, -0.18);
  hoodPeak.rotation.x = -2.1;
  head.add(hoodPeak);
  // The hood drapes over the shoulders.
  const drape = lathe([[0.12, 0.04], [0.17, -0.02], [0.24, -0.08], [0.285, -0.14]], hood, 10);
  drape.scale.z = 0.85;
  head.add(drape);
  // Face opening: a deep hollow in the hood, with a turned-back rim around it.
  const opening = ball(0.115, face, 0.95, 1.15, 0.75, 10, 8);
  opening.position.set(0, 0.09, 0.14);
  head.add(opening);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.022, 5, 14), hood);
  rim.position.set(0, 0.095, 0.19);
  rim.scale.set(0.95, 1.18, 1);
  head.add(rim);
  const mouth = new THREE.Object3D();
  mouth.position.set(0, 0.06, 0.22);
  head.add(mouth);
  // Her eyes: two warm points in the shadow of the hood. They blink, droop when she is tired
  // and lead the head when something catches her attention.
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#f6ecd4' });
  const eyes = grp(0, 0.1, 0.221);
  for (const sx of [-1, 1]) {
    const eye = ball(0.017, eyeMat, 0.78, 1.2, 0.35, 10, 8);
    eye.position.x = sx * 0.04;
    eyes.add(eye);
  }
  head.add(eyes);
  // Weather clothes, hidden until needed: a straw hat over the hood, a fur ruff, a rain cape.
  const straw = mat('#c9a86a');
  const sunHat = grp(0, 0.17, -0.01);
  const brim = cyl(0.3, 0.3, 0.014, straw, 14);
  const crown = cyl(0.12, 0.15, 0.11, straw, 10);
  crown.position.y = 0.06;
  const band = cyl(0.152, 0.152, 0.03, coatDark, 10);
  band.position.y = 0.025;
  sunHat.add(brim, crown, band);
  sunHat.rotation.x = -0.12;
  head.add(sunHat);
  const ruff = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.038, 5, 14), mat('#e6dfd2'));
  ruff.position.set(0, 0.095, 0.19);
  ruff.scale.set(1, 1.15, 1);
  head.add(ruff);
  const capeMat = mat(LAYERS.shell[0]);
  capeMat.side = THREE.DoubleSide;
  const cape = lathe([[0.16, 0.56], [0.25, 0.45], [0.33, 0.2], [0.38, -0.05], [0.4, -0.16]], capeMat, 11);
  cape.position.z = -0.05;
  cape.scale.z = 1.08;
  spine.add(cape);

  const bulk: THREE.Mesh[] = [torso, skirt];
  const gloves: THREE.Mesh[] = [];
  const arm = (side: 1 | -1): { shoulder: THREE.Group; elbow: THREE.Group } => {
    const shoulder = grp(0.23 * side, 0.46, 0);
    spine.add(shoulder);
    const cap = ball(0.075, coat, 1, 0.9, 1);
    shoulder.add(cap);
    const upper = lathe([[0.07, 0.0], [0.071, -0.12], [0.064, -0.24], [0.06, -0.31]], coat, 8);
    shoulder.add(upper);
    const elbow = grp(0, -0.3, 0);
    shoulder.add(elbow);
    // Forearm with a cuff that flares a little at the wrist.
    const fore = lathe([[0.06, 0.01], [0.057, -0.12], [0.052, -0.22], [0.063, -0.255], [0.058, -0.27]], sleeve, 8);
    elbow.add(fore);
    // A mitt with a thumb.
    const glove = grp(0, -0.305, 0);
    const palm = ball(0.048, mitt, 0.9, 1.25, 0.75);
    const thumb = ball(0.022, mitt, 1, 1.4, 1);
    thumb.position.set(-0.035 * side, 0.01, 0.025);
    thumb.rotation.z = 0.5 * side;
    glove.add(palm, thumb);
    elbow.add(glove);
    bulk.push(upper, fore);
    gloves.push(palm);
    return { shoulder, elbow };
  };
  const L = arm(1);
  const R = arm(-1);

  const leg = (side: 1 | -1): { hip: THREE.Group; knee: THREE.Group } => {
    const hip = grp(0.1 * side, -0.06, 0);
    hips.add(hip);
    const thigh = lathe([[0.088, 0.02], [0.09, -0.12], [0.08, -0.3], [0.07, -0.46]], trousers, 8);
    hip.add(thigh);
    const knee = grp(0, -0.45, 0);
    hip.add(knee);
    const shin = lathe([[0.07, 0.02], [0.068, -0.15], [0.06, -0.3]], trousers, 8);
    knee.add(shin);
    // A walking boot: shaft, a rolled sock at the top, a rounded toe and a darker sole.
    const shaft = cyl(0.068, 0.072, 0.13, boots, 8);
    shaft.position.y = -0.33;
    const sock = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.016, 4, 10), mat('#8a7a64'));
    sock.rotation.x = Math.PI / 2;
    sock.position.y = -0.27;
    const foot = ball(0.07, boots, 0.85, 0.65, 1.7);
    foot.position.set(0, -0.415, 0.05);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.025, 0.25), mat('#2a221c'));
    sole.position.set(0, -0.46, 0.05);
    knee.add(shaft, sock, foot, sole);
    return { hip, knee };
  };
  const LL = leg(1);
  const RL = leg(-1);

  // Her pack (still called the satchel in code): canvas body with a rounded top and a lid, a
  // front pocket for your mark, side pockets (the flask rides in one), a bedroll on top and a
  // sleeping mat underneath. Its origin sits 0.12 above the base, as the old bag's did.
  const satchel = new THREE.Group();
  const canvas = mat('#6b4a30');
  const leather = mat('#4a3324');
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.2), canvas);
  body.position.y = 0.1;
  const top = cyl(0.1, 0.1, 0.34, canvas, 8);
  top.rotation.z = Math.PI / 2;
  top.position.y = 0.28;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 0.22), leather);
  lid.position.set(0, 0.35, 0.01);
  const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.17, 0.06), leather);
  pocket.position.set(0, 0.03, 0.12);
  const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.13), leather);
  sideL.position.set(0.19, 0.0, 0);
  const sideR = sideL.clone();
  sideR.position.x = -0.19;
  const roll = cyl(0.065, 0.065, 0.42, mat('#7a6a4a'), 9);
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, 0.42, -0.01);
  const mat2 = cyl(0.055, 0.055, 0.4, mat('#4f6b7a'), 9);
  mat2.rotation.z = Math.PI / 2;
  mat2.position.set(0, -0.12, 0.02);
  const strapMat = mat('#2e241b');
  for (const x of [-0.12, 0.12]) {
    const band2 = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.01, 4, 10), strapMat);
    band2.rotation.y = Math.PI / 2;
    band2.position.set(x, 0.42, -0.01);
    const harness = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.38, 0.02), strapMat);
    harness.position.set(x * 0.8, 0.12, -0.11);
    satchel.add(band2, harness);
  }
  satchel.add(body, top, lid, pocket, sideL, sideR, roll, mat2);

  shadowed(root);
  shadowed(satchel);

  const joints: Record<Joint, THREE.Group> = {
    spine, neck, head,
    shoulderL: L.shoulder, elbowL: L.elbow, shoulderR: R.shoulder, elbowR: R.elbow,
    hipL: LL.hip, kneeL: LL.knee, hipR: RL.hip, kneeR: RL.knee,
  };

  const scarfParts: THREE.Object3D[] = [scarfRing, scarfTail];
  const materials: THREE.MeshLambertMaterial[] = [];
  root.traverse((c) => {
    const m = (c as THREE.Mesh).material;
    if (m instanceof THREE.MeshLambertMaterial && !materials.includes(m)) materials.push(m);
  });
  const climber: Climber = {
    root, hips, joints, satchel, mouth, materials,
    dress(o) {
      const [c, sl, hd] = LAYERS[o.layer];
      coat.color.set(c);
      sleeve.color.set(sl);
      hood.color.set(hd);
      const puff = o.layer === 'parka' ? 1.16 : o.layer === 'light' ? 0.94 : 1;
      for (const m of bulk) m.scale.set(puff, 1, puff * (m === torso ? 0.78 : m === skirt ? 0.86 : 1));
      sunHat.visible = o.sunHat;
      ruff.visible = o.layer === 'parka';
      cape.visible = o.layer === 'shell';
      for (const p of scarfParts) {
        p.visible = o.layer !== 'light';
        p.scale.setScalar(o.bundled ? 1.3 : 1);
      }
      for (const g of gloves) g.scale.set(0.9 * (o.bundled ? 1.25 : 1), 1.25, 0.75 * (o.bundled ? 1.25 : 1));
      mitt.color.set(o.layer === 'light' ? '#a07a5a' : '#2b3240');
    },
    setPose(p: Pose) {
      hips.position.y = p.hipsY;
      hips.rotation.x = p.hipsX ?? 0;
      for (const k of JOINTS) {
        const r = p.j[k] ?? [0, 0, 0];
        joints[k].rotation.set(r[0], r[1], r[2]);
      }
    },
    sample(keys: Keyframe[], t: number): Pose {
      return samplePose(keys, t);
    },
    look(yaw: number, pitch: number, open: number) {
      head.rotation.y += yaw * 0.75;
      head.rotation.x += pitch * 0.7;
      neck.rotation.y += yaw * 0.25;
      eyes.position.x = Math.max(-0.014, Math.min(0.014, yaw * 0.03));
      eyes.position.y = 0.1 + Math.max(-0.01, Math.min(0.01, -pitch * 0.025));
      eyes.scale.y = Math.max(0.08, open);
    },
    flutter(t: number, wind: number, moving: number) {
      const k = Math.min(1.2, wind * 0.9 + moving * 0.35);
      const n = Math.sin(t * (3 + wind * 5)) * 0.6 + Math.sin(t * 7.3 + 1.2) * 0.4;
      scarfTail.rotation.set(-0.15 - k * 0.55 + n * 0.12 * k, n * 0.15 * k, 0.12 + n * 0.1 * k);
      cape.rotation.x = -k * 0.08 + n * 0.02 * k;
    },
    overlay(t: number, cold: number, motion: boolean, phase?: number, depth = 0) {
      // Breathing: a slow rise of the chest; heavier and quicker when she is tired.
      const breath = Math.sin(phase ?? (t * (Math.PI * 2)) / 3.8);
      const amp = 1 + depth * 1.2;
      spine.rotation.x += breath * 0.012 * amp;
      neck.rotation.x -= breath * 0.008 * amp;
      L.shoulder.rotation.z += breath * 0.01 * depth;
      R.shoulder.rotation.z -= breath * 0.01 * depth;
      if (!motion) return;
      // Shivers come in bursts when cold.
      const burst = Math.max(0, Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1));
      const shiver = cold * Math.pow(burst, 3) * Math.sin(t * 46) * 0.03;
      spine.rotation.z += shiver;
      L.shoulder.rotation.z += shiver * 0.8;
      R.shoulder.rotation.z -= shiver * 0.8;
    },
  };
  climber.dress({ layer: 'coat', sunHat: false, bundled: false });
  climber.setPose(POSES.sitHunched);
  return climber;
}
