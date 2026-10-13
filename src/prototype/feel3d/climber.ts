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

  const root = grp();
  const hips = grp(0, 0.93, 0);
  root.add(hips);

  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.22), trousers);
  hips.add(pelvis);
  // Coat skirt hangs from the hips
  const skirt = cyl(0.2, 0.27, 0.42, coat, 8);
  skirt.position.y = -0.17;
  skirt.scale.z = 0.85;
  hips.add(skirt);

  const spine = grp(0, 0.06, 0);
  hips.add(spine);
  const torso = cyl(0.21, 0.18, 0.52, coat, 8);
  torso.position.y = 0.26;
  torso.scale.z = 0.78;
  spine.add(torso);
  const belt = cyl(0.19, 0.19, 0.05, coatDark, 8);
  belt.position.y = 0.04;
  belt.scale.z = 0.8;
  spine.add(belt);

  const neck = grp(0, 0.52, 0);
  spine.add(neck);
  const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.055, 6, 10), scarf);
  scarfRing.rotation.x = Math.PI / 2;
  scarfRing.position.y = 0.02;
  neck.add(scarfRing);
  const scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.03), scarf);
  scarfTail.position.set(0.07, -0.11, 0.13);
  scarfTail.rotation.z = 0.15;
  neck.add(scarfTail);

  const head = grp(0, 0.1, 0.01);
  neck.add(head);
  const hoodBall = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), hood);
  hoodBall.scale.set(1, 1.12, 1.15);
  hoodBall.position.y = 0.11;
  head.add(hoodBall);
  const hoodPeak = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 5), hood);
  hoodPeak.position.set(0, 0.2, -0.13);
  hoodPeak.rotation.x = -1.0;
  head.add(hoodPeak);
  // The hood drapes over the shoulders.
  const drape = cyl(0.12, 0.27, 0.2, hood, 8);
  drape.position.y = -0.04;
  drape.scale.z = 0.85;
  head.add(drape);
  // Face opening: a deep hollow in the hood, with only the line of a jaw catching the light.
  const opening = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), face);
  opening.position.set(0, 0.09, 0.105);
  opening.scale.set(0.95, 1.15, 0.7);
  head.add(opening);
  const mouth = new THREE.Object3D();
  mouth.position.set(0, 0.06, 0.22);
  head.add(mouth);
  // Weather clothes, hidden until needed: a straw hat over the hood, a fur ruff, a rain cape.
  const straw = mat('#c9a86a');
  const sunHat = grp(0, 0.17, -0.01);
  const brim = cyl(0.3, 0.3, 0.014, straw, 12);
  const crown = cyl(0.12, 0.15, 0.11, straw, 9);
  crown.position.y = 0.06;
  const band = cyl(0.152, 0.152, 0.03, coatDark, 9);
  band.position.y = 0.025;
  sunHat.add(brim, crown, band);
  sunHat.rotation.x = -0.12;
  head.add(sunHat);
  const ruff = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.035, 5, 12), mat('#e6dfd2'));
  ruff.position.set(0, 0.09, 0.13);
  head.add(ruff);
  const capeMat = mat(LAYERS.shell[0]);
  capeMat.side = THREE.DoubleSide;
  const cape = cyl(0.2, 0.4, 0.7, capeMat, 9);
  cape.position.set(0, 0.18, -0.05);
  cape.scale.z = 1.05;
  spine.add(cape);

  const bulk: THREE.Mesh[] = [torso, skirt];
  const gloves: THREE.Mesh[] = [];
  const arm = (side: 1 | -1): { shoulder: THREE.Group; elbow: THREE.Group } => {
    const shoulder = grp(0.23 * side, 0.46, 0);
    spine.add(shoulder);
    const upper = cyl(0.065, 0.058, 0.3, coat, 6);
    upper.position.y = -0.15;
    shoulder.add(upper);
    const elbow = grp(0, -0.3, 0);
    shoulder.add(elbow);
    const fore = cyl(0.057, 0.05, 0.27, sleeve, 6);
    fore.position.y = -0.135;
    elbow.add(fore);
    const glove = new THREE.Mesh(new THREE.IcosahedronGeometry(0.052, 0), mitt);
    glove.position.y = -0.3;
    glove.scale.set(0.9, 1.2, 0.8);
    elbow.add(glove);
    bulk.push(upper, fore);
    gloves.push(glove);
    return { shoulder, elbow };
  };
  const L = arm(1);
  const R = arm(-1);

  const leg = (side: 1 | -1): { hip: THREE.Group; knee: THREE.Group } => {
    const hip = grp(0.1 * side, -0.06, 0);
    hips.add(hip);
    const thigh = cyl(0.085, 0.07, 0.45, trousers, 6);
    thigh.position.y = -0.225;
    hip.add(thigh);
    const knee = grp(0, -0.45, 0);
    hip.add(knee);
    const shin = cyl(0.068, 0.06, 0.42, trousers, 6);
    shin.position.y = -0.21;
    knee.add(shin);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.24), boots);
    boot.position.set(0, -0.43, 0.05);
    knee.add(boot);
    return { hip, knee };
  };
  const LL = leg(1);
  const RL = leg(-1);

  // The satchel: a patched leather bag with a strap. Starts on the ground; later carried on the back.
  const satchel = new THREE.Group();
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.13), mat('#5a3d27'));
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.14), mat('#6b4a30'));
  flap.position.y = 0.08;
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 4, 12, Math.PI), mat('#3b2a1d'));
  strap.position.y = 0.12;
  satchel.add(bag, flap, strap);

  shadowed(root);
  shadowed(satchel);

  const joints: Record<Joint, THREE.Group> = {
    spine, neck, head,
    shoulderL: L.shoulder, elbowL: L.elbow, shoulderR: R.shoulder, elbowR: R.elbow,
    hipL: LL.hip, kneeL: LL.knee, hipR: RL.hip, kneeR: RL.knee,
  };

  const scarfParts = neck.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
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
      for (const m of bulk) m.scale.set(puff, 1, puff * (m === torso ? 0.78 : m === skirt ? 0.85 : 1));
      sunHat.visible = o.sunHat;
      ruff.visible = o.layer === 'parka';
      cape.visible = o.layer === 'shell';
      for (const p of scarfParts) {
        p.visible = o.layer !== 'light';
        p.scale.setScalar(o.bundled ? 1.3 : 1);
      }
      for (const g of gloves) g.scale.set(0.9 * (o.bundled ? 1.25 : 1), 1.2, 0.8 * (o.bundled ? 1.25 : 1));
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
