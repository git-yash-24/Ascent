import * as THREE from 'three';

/**
 * Ari, built from simple shapes and animated in code.
 * Facing +z by default. Joint rotations are Euler XYZ in radians.
 * Conventions: negative x on a hip or shoulder swings the limb forward; positive x on the spine leans forward.
 */

export type Joint =
  | 'spine' | 'neck' | 'head'
  | 'shoulderL' | 'elbowL' | 'shoulderR' | 'elbowR'
  | 'hipL' | 'kneeL' | 'hipR' | 'kneeR';

export type Rot = [number, number, number];
export interface Pose {
  hipsY: number;
  hipsX?: number; // pelvis tilt
  j: Partial<Record<Joint, Rot>>;
}

const JOINTS: Joint[] = ['spine', 'neck', 'head', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR'];

export const POSES = {
  sitHunched: {
    hipsY: 0.44,
    j: {
      spine: [0.5, 0, 0], neck: [0.15, 0, 0], head: [0.3, 0, 0],
      shoulderL: [-0.5, 0, -0.18], elbowL: [-0.95, 0, -0.35],
      shoulderR: [-0.5, 0, 0.18], elbowR: [-0.95, 0, 0.35],
      hipL: [-1.42, 0, 0.12], kneeL: [1.5, 0, 0], hipR: [-1.42, 0, -0.12], kneeR: [1.5, 0, 0],
    },
  },
  sitLookUp: {
    hipsY: 0.44,
    j: {
      spine: [0.32, 0, 0], neck: [0.0, 0, 0], head: [-0.05, 0, 0],
      shoulderL: [-0.5, 0, -0.18], elbowL: [-0.95, 0, -0.35],
      shoulderR: [-0.5, 0, 0.18], elbowR: [-0.95, 0, 0.35],
      hipL: [-1.42, 0, 0.12], kneeL: [1.5, 0, 0], hipR: [-1.42, 0, -0.12], kneeR: [1.5, 0, 0],
    },
  },
  handsOnKnees: {
    hipsY: 0.6,
    j: {
      spine: [0.85, 0, 0], neck: [-0.25, 0, 0], head: [-0.2, 0, 0],
      shoulderL: [-0.55, 0, -0.05], elbowL: [-0.2, 0, 0],
      shoulderR: [-0.55, 0, 0.05], elbowR: [-0.2, 0, 0],
      hipL: [-1.0, 0, 0.08], kneeL: [1.25, 0, 0], hipR: [-1.0, 0, -0.08], kneeR: [1.25, 0, 0],
    },
  },
  stand: {
    hipsY: 0.93,
    j: {
      spine: [0.04, 0, 0], neck: [0, 0, 0], head: [0.05, 0, 0],
      shoulderL: [0.05, 0, 0.08], elbowL: [-0.15, 0, 0],
      shoulderR: [0.05, 0, -0.08], elbowR: [-0.15, 0, 0],
      hipL: [0, 0, 0.03], kneeL: [0.02, 0, 0], hipR: [0, 0, -0.03], kneeR: [0.02, 0, 0],
    },
  },
  stretch: {
    hipsY: 0.94,
    j: {
      spine: [-0.14, 0, 0], neck: [-0.15, 0, 0], head: [-0.3, 0, 0],
      shoulderL: [-2.85, 0, 0.3], elbowL: [-0.25, 0, 0],
      shoulderR: [-2.85, 0, -0.3], elbowR: [-0.25, 0, 0],
      hipL: [0, 0, 0.03], kneeL: [0, 0, 0], hipR: [0, 0, -0.03], kneeR: [0, 0, 0],
    },
  },
  reachDown: {
    hipsY: 0.8,
    j: {
      spine: [1.0, 0, -0.2], neck: [0.1, 0, 0], head: [0.2, 0, 0],
      shoulderL: [-0.7, 0, -0.15], elbowL: [-0.1, 0, 0],
      shoulderR: [-0.3, 0, -0.1], elbowR: [-0.3, 0, 0],
      hipL: [-0.4, 0, 0.05], kneeL: [0.45, 0, 0], hipR: [-0.35, 0, -0.05], kneeR: [0.4, 0, 0],
    },
  },
  shoulderPack: {
    hipsY: 0.93,
    j: {
      spine: [0.08, 0.15, 0], neck: [0, -0.1, 0], head: [0.05, 0, 0],
      shoulderL: [-2.2, 0, 0.6], elbowL: [-1.6, 0, 0],
      shoulderR: [-0.2, 0, -0.1], elbowR: [-0.5, 0, 0],
      hipL: [0, 0, 0.03], kneeL: [0, 0, 0], hipR: [0, 0, -0.03], kneeR: [0, 0, 0],
    },
  },
  kickBack: {
    hipsY: 0.92,
    j: {
      spine: [0.12, 0, 0], neck: [0.2, 0, 0], head: [0.3, 0, 0],
      shoulderL: [0.15, 0, 0.15], elbowL: [-0.3, 0, 0],
      shoulderR: [-0.2, 0, -0.15], elbowR: [-0.3, 0, 0],
      hipL: [0, 0, 0.03], kneeL: [0, 0, 0], hipR: [0.35, 0, -0.05], kneeR: [0.6, 0, 0],
    },
  },
  kickForward: {
    hipsY: 0.92,
    j: {
      spine: [0.1, 0, 0], neck: [0.25, 0, 0], head: [0.3, 0, 0],
      shoulderL: [0.2, 0, 0.15], elbowL: [-0.3, 0, 0],
      shoulderR: [-0.25, 0, -0.15], elbowR: [-0.3, 0, 0],
      hipL: [0, 0, 0.03], kneeL: [0, 0, 0], hipR: [-0.75, 0, -0.05], kneeR: [0.15, 0, 0],
    },
  },
} satisfies Record<string, Pose>;

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = { hipsY: a.hipsY + (b.hipsY - a.hipsY) * t, hipsX: (a.hipsX ?? 0) + ((b.hipsX ?? 0) - (a.hipsX ?? 0)) * t, j: {} };
  for (const k of JOINTS) {
    const ra = a.j[k] ?? [0, 0, 0];
    const rb = b.j[k] ?? [0, 0, 0];
    out.j[k] = [ra[0] + (rb[0] - ra[0]) * t, ra[1] + (rb[1] - ra[1]) * t, ra[2] + (rb[2] - ra[2]) * t];
  }
  return out;
}

/** A walk-cycle pose at phase p (radians); uphill lean. */
export function walkPose(p: number, lean = 0.2): Pose {
  const s = Math.sin(p);
  const swingL = -0.5 * s - 0.08;
  const swingR = 0.5 * s - 0.08;
  const kneeL = 0.15 + 0.75 * Math.max(0, Math.sin(p + 1.3));
  const kneeR = 0.15 + 0.75 * Math.max(0, Math.sin(p + 1.3 + Math.PI));
  return {
    hipsY: 0.9 - 0.035 * Math.abs(Math.cos(p)),
    j: {
      spine: [lean, 0.06 * s, 0], neck: [-0.08, -0.04 * s, 0], head: [0.05, 0, 0],
      shoulderL: [0.38 * s, 0, 0.1], elbowL: [-0.35 - 0.2 * Math.max(0, s), 0, 0],
      shoulderR: [-0.38 * s, 0, -0.1], elbowR: [-0.35 - 0.2 * Math.max(0, -s), 0, 0],
      hipL: [swingL, 0, 0.03], kneeL: [kneeL, 0, 0], hipR: [swingR, 0, -0.03], kneeR: [kneeR, 0, 0],
    },
  };
}

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface Keyframe {
  at: number; // seconds from the start of the clip
  pose: Pose;
}

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
  overlay(t: number, cold: number, motion: boolean): void;
}

export function buildClimber(): Climber {
  const mat = (color: string): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color, flatShading: true });
  const coat = mat('#384152');
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

  const arm = (side: 1 | -1): { shoulder: THREE.Group; elbow: THREE.Group } => {
    const shoulder = grp(0.23 * side, 0.46, 0);
    spine.add(shoulder);
    const upper = cyl(0.065, 0.058, 0.3, coat, 6);
    upper.position.y = -0.15;
    shoulder.add(upper);
    const elbow = grp(0, -0.3, 0);
    shoulder.add(elbow);
    const fore = cyl(0.057, 0.05, 0.27, coat, 6);
    fore.position.y = -0.135;
    elbow.add(fore);
    const glove = new THREE.Mesh(new THREE.IcosahedronGeometry(0.052, 0), coatDark);
    glove.position.y = -0.3;
    glove.scale.set(0.9, 1.2, 0.8);
    elbow.add(glove);
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

  const climber: Climber = {
    root, hips, joints, satchel, mouth,
    setPose(p: Pose) {
      hips.position.y = p.hipsY;
      hips.rotation.x = p.hipsX ?? 0;
      for (const k of JOINTS) {
        const r = p.j[k] ?? [0, 0, 0];
        joints[k].rotation.set(r[0], r[1], r[2]);
      }
    },
    sample(keys: Keyframe[], t: number): Pose {
      const first = keys[0];
      if (!first) return POSES.stand;
      if (t <= first.at) return first.pose;
      for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i]!;
        const b = keys[i + 1]!;
        if (t >= a.at && t <= b.at) {
          const u = b.at === a.at ? 1 : (t - a.at) / (b.at - a.at);
          return lerpPose(a.pose, b.pose, ease(u));
        }
      }
      return keys[keys.length - 1]!.pose;
    },
    overlay(t: number, cold: number, motion: boolean) {
      // Breathing: a slow rise of the chest, deeper when cold.
      const breath = Math.sin(t * (Math.PI * 2) / 3.8);
      spine.rotation.x += breath * 0.012;
      neck.rotation.x -= breath * 0.008;
      if (!motion) return;
      // Shivers come in bursts when cold.
      const burst = Math.max(0, Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1));
      const shiver = cold * Math.pow(burst, 3) * Math.sin(t * 46) * 0.03;
      spine.rotation.z += shiver;
      L.shoulder.rotation.z += shiver * 0.8;
      R.shoulder.rotation.z -= shiver * 0.8;
    },
  };
  climber.setPose(POSES.sitHunched);
  return climber;
}
