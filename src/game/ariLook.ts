/**
 * Ari's cloth (art direction: a hooded pilgrim whose cloak lives in the wind). Added over the
 * procedural rig without touching its poses:
 *
 *   cape    a short cloak pinned across her upper back, falling to her knees, in the hood's
 *           colour a shade deeper; it drapes over the log when she sits and streams when she
 *           walks or the wind rises
 *   scarf   two tails from the knot at her throat, in your colour, flicking in the wind
 *
 * Collision keeps the cloth off her body, her thighs and her seat; it settles on the ground.
 */
import * as THREE from 'three';
import { ClothSheet, type Capsule, type ClothEnv } from './cloth';
import type { Climber } from '../prototype/feel3d/climber';

const CAPE_COLS = 7;
const SCARF_ROWS = 7;

export class AriLook {
  readonly group = new THREE.Group();
  private readonly cape: ClothSheet;
  private readonly scarfA: ClothSheet;
  private readonly scarfB: ClothSheet;
  private readonly capeMat = new THREE.MeshLambertMaterial({ color: '#8e3f24', side: THREE.DoubleSide });
  private readonly scarfMat = new THREE.MeshLambertMaterial({ color: '#7f7c74', side: THREE.DoubleSide });
  private readonly v = Array.from({ length: 12 }, () => new THREE.Vector3());
  enabled = true;

  constructor(scene: THREE.Scene, private readonly c: Climber, private readonly seat: Capsule | null) {
    this.cape = new ClothSheet(CAPE_COLS, 11, 0.72, this.capeMat, 0.982, 1.1);
    this.scarfA = new ClothSheet(2, SCARF_ROWS, 0.3, this.scarfMat, 0.975, 1.6);
    this.scarfB = new ClothSheet(2, SCARF_ROWS, 0.24, this.scarfMat, 0.975, 1.6);
    this.group.add(this.cape.mesh, this.scarfA.mesh, this.scarfB.mesh);
    scene.add(this.group);
    // The stiff modelled tails and the old hood point give way to the cloth.
    for (const o of c.replaceable) o.traverse((m) => m.layers.set(1));
  }

  private wp(o: THREE.Object3D, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(local).applyMatrix4(o.matrixWorld);
  }

  update(dt: number, env: Omit<ClothEnv, 'capsules'>, sitting: boolean, visible: boolean): void {
    this.group.visible = visible && this.enabled;
    if (!this.group.visible) return;
    const c = this.c;
    c.root.updateMatrixWorld(true);
    // Colours follow her clothes: the hood's, a shade deeper; the scarf is yours.
    this.capeMat.color.copy(c.palette.hood.color).multiplyScalar(0.78);
    this.scarfMat.color.copy(c.palette.scarf.color);
    const j = c.joints;
    // Pins across her upper back, curving round the shoulders.
    const pins: THREE.Vector3[] = [];
    for (let i = 0; i < CAPE_COLS; i++) {
      const u = i / (CAPE_COLS - 1) * 2 - 1;
      const local = new THREE.Vector3(u * 0.2, 0.47 - Math.abs(u) * 0.03, -0.16 + Math.abs(u) * 0.06);
      pins.push(this.wp(j.spine, local, new THREE.Vector3()));
    }
    const caps: Capsule[] = [
      { a: this.wp(j.spine, new THREE.Vector3(0, 0.02, -0.02), this.v[0]!), b: this.wp(j.spine, new THREE.Vector3(0, 0.42, -0.02), this.v[1]!), r: 0.25 },
      { a: this.wp(j.hipL, new THREE.Vector3(0, 0, 0), this.v[2]!), b: this.wp(j.kneeL, new THREE.Vector3(0, 0, 0), this.v[3]!), r: 0.11 },
      { a: this.wp(j.hipR, new THREE.Vector3(0, 0, 0), this.v[4]!), b: this.wp(j.kneeR, new THREE.Vector3(0, 0, 0), this.v[5]!), r: 0.11 },
      { a: this.wp(j.head, new THREE.Vector3(0, 0.05, -0.05), this.v[6]!), b: this.wp(j.head, new THREE.Vector3(0, 0.2, -0.05), this.v[7]!), r: 0.2 },
    ];
    if (sitting && this.seat) caps.push(this.seat);
    const full: ClothEnv = { ...env, capsules: caps };
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(c.root.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    this.cape.update(dt, pins, (v) => 0.4 + v * 0.3, full, back);
    // Scarf tails from the knot at her throat.
    const knotA = [this.wp(j.neck, new THREE.Vector3(0.03, -0.01, 0.13), new THREE.Vector3()), this.wp(j.neck, new THREE.Vector3(0.1, -0.02, 0.11), new THREE.Vector3())];
    const knotB = [this.wp(j.neck, new THREE.Vector3(0.06, -0.02, 0.13), new THREE.Vector3()), this.wp(j.neck, new THREE.Vector3(0.12, -0.04, 0.1), new THREE.Vector3())];
    const front: ClothEnv = { ...env, capsules: [{ a: caps[0]!.a, b: caps[0]!.b, r: 0.27 }, caps[1]!, caps[2]!] };
    const fwd = back.clone().negate();
    this.scarfA.update(dt, knotA, () => 0.075, front, fwd);
    this.scarfB.update(dt, knotB, () => 0.065, front, fwd);
  }
}
