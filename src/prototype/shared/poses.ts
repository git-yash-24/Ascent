/**
 * Ari's poses and the feel-test script, shared by the 3D and silhouette prototypes so both play
 * exactly the same 60 seconds. No rendering code here.
 *
 * Joint rotations are Euler XYZ in radians, in the 3D rig's frame (facing +z).
 * Negative x on a hip or shoulder swings the limb forward; positive x on the spine leans forward.
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

export const JOINTS: Joint[] = ['spine', 'neck', 'head', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR'];

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

export const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface Keyframe {
  at: number; // seconds from the start of the clip
  pose: Pose;
}


export function samplePose(keys: Keyframe[], t: number): Pose {
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
}

/** The 60-second script: rise after the tick, then walk. Times in seconds from the tick. */
export const RISE: Keyframe[] = [
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
export const SCRIPT = {
  fireCatches: 0.6,
  pickUp: 6.95,
  kick: 9.0,
  turn: 9.5,
  walk: 10.4,
  walkSpeed: 1.05,
  stride: 1.35,
  walkLimit: 70,
} as const;
