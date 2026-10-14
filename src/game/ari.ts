/**
 * What Ari carries and rigs against the weather (Xander, 13 Oct):
 *
 *   Carry    her own light after dark, the one you chose in Setup: a lantern (in her hand on the
 *            trail, on the ground beside her at camp), a headlamp (on the hood, its beam where
 *            she looks) or a glow stick (clipped to her strap). One point light, whichever it is.
 *   Shelter  a sheet over her bag and the woodpile when rain or snow falls, a rain fly over her
 *            seat in heavy rain, the tent door laced shut, stones on the corners in a gale.
 *   sunKiss  the golden hour's rim of light along her edges, facing the sun.
 */
import * as THREE from 'three';
import { glowTexture, groundHeight } from '../prototype/feel3d/world';
import type { Climber } from '../prototype/feel3d/climber';
import type { LightStyle } from '../ui/worldPrefs';

const lambert = (color: string, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

const STYLE: Record<LightStyle, { color: string; i: number; dist: number }> = {
  lantern: { color: '#ffb35c', i: 2.8, dist: 9 },
  headlamp: { color: '#e4ecff', i: 3.4, dist: 12 },
  glowstick: { color: '#9dff8a', i: 1.4, dist: 5 },
};

export class Carry {
  readonly light: THREE.PointLight;
  private readonly lantern = new THREE.Group();
  private readonly lamp = new THREE.Group();
  private readonly stick = new THREE.Group();
  private readonly beam: THREE.Mesh;
  private readonly glow: THREE.Sprite;
  private readonly glass: THREE.MeshLambertMaterial;
  private readonly lens: THREE.MeshBasicMaterial;
  private readonly tube: THREE.MeshBasicMaterial;
  style: LightStyle = 'lantern';
  /** Current brightness, 0 to 1 (it comes up when she lights it). */
  level = 0;
  private swing = 0;
  private swingV = 0;

  constructor(
    scene: THREE.Scene,
    private readonly c: Climber,
  ) {
    this.light = new THREE.PointLight('#ffb35c', 0, 9, 1.6);
    scene.add(this.light);
    // The lantern: a tin base, a glass with the flame, a cap and a bail handle.
    this.glass = lambert('#ffd9a0', { emissive: '#ff9a3c', emissiveIntensity: 0, transparent: true, opacity: 0.85 });
    const tin = lambert('#2f3136');
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.03, 8), tin);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8), this.glass);
    glass.position.y = 0.065;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.05, 8), tin);
    cap.position.y = 0.14;
    const bail = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.005, 4, 10, Math.PI), tin);
    bail.position.y = 0.165;
    this.lantern.add(base, glass, cap, bail);
    // The headlamp: a band round the hood and a lens; a soft beam where she looks.
    this.lens = new THREE.MeshBasicMaterial({ color: '#3a3d44' });
    const bandM = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.012, 4, 14), lambert('#22252b'));
    bandM.rotation.x = Math.PI / 2 - 0.25;
    bandM.position.y = 0.16;
    const lensM = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 8), this.lens);
    lensM.rotation.x = Math.PI / 2;
    lensM.position.set(0, 0.2, 0.16);
    const beamGeo = new THREE.ConeGeometry(0.5, 2.6, 14, 1, true);
    beamGeo.translate(0, -1.3, 0);
    beamGeo.rotateX(-Math.PI / 2 - 0.35);
    this.beam = new THREE.Mesh(
      beamGeo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uI: { value: 0 } },
        vertexShader: `varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uI; varying float vY; void main(){ gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * pow(vY, 1.6) * uI * 0.16, 1.0); }`,
      }),
    );
    this.beam.position.set(0, 0.2, 0.17);
    this.lamp.add(bandM, lensM, this.beam);
    c.joints.head.add(this.lamp);
    // The glow stick, clipped to the strap across her chest.
    this.tube = new THREE.MeshBasicMaterial({ color: '#2c4a2a' });
    const tubeM = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.15, 6), this.tube);
    this.stick.add(tubeM);
    this.stick.position.set(0.1, 0.36, 0.165);
    this.stick.rotation.z = 0.5;
    c.joints.spine.add(this.stick);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffb35c', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    scene.add(this.glow);
    scene.add(this.lantern);
    this.setStyle('lantern');
  }

  setStyle(s: LightStyle): void {
    this.style = s;
    const d = STYLE[s];
    this.light.color.set(d.color);
    this.light.distance = d.dist;
    this.glow.material.color.set(d.color);
    this.lantern.visible = s === 'lantern';
    this.lamp.visible = s === 'headlamp';
    this.stick.visible = s === 'glowstick';
  }

  /** A jolt (a shake of the phone, a stumble): the lantern swings. */
  jolt(k: number): void {
    this.swingV += (Math.random() < 0.5 ? -1 : 1) * 3.5 * k;
  }

  /**
   * `level` 0 to 1 (the stage eases it as she lights or puts out the light); `sitting`: at camp
   * the lantern stands on the ground at her side, on the trail it hangs from her left hand.
   */
  update(t: number, dt: number, level: number, sitting: boolean, walkPhase: number): void {
    this.level = level;
    const d = STYLE[this.style];
    const flick = this.style === 'lantern' ? 0.88 + 0.12 * Math.sin(t * 13.7) * Math.sin(t * 7.3 + 1) : 1;
    // Always in the scene (at zero by day): switching a light on and off would rebuild every shader.
    this.light.intensity = d.i * level * flick;
    // A pendulum: walking rocks it, a jolt throws it, it settles.
    this.swingV += (-this.swing * 18 - this.swingV * 2.2 + (sitting ? 0 : Math.sin(walkPhase) * 2.2)) * dt;
    this.swing += this.swingV * dt;
    const at = new THREE.Vector3();
    if (this.style === 'lantern') {
      const r = this.c.root;
      if (sitting) {
        at.set(-0.42, 0, 0.38).applyAxisAngle(new THREE.Vector3(0, 1, 0), r.rotation.y).add(r.position);
        at.y = groundHeight(at.x, at.z);
        this.lantern.position.copy(at);
        this.lantern.rotation.set(0, 0, 0);
      } else {
        this.c.joints.elbowL.localToWorld(at.set(0, -0.33, 0.02));
        this.lantern.position.copy(at).add(new THREE.Vector3(0, -0.19, 0));
        this.lantern.rotation.set(this.swing * 0.6, r.rotation.y, this.swing);
      }
      this.glass.emissiveIntensity = level * flick * 1.6;
      at.copy(this.lantern.position).add(new THREE.Vector3(0, 0.08, 0));
      this.light.position.copy(at).add(new THREE.Vector3(0, 0.1, 0));
      this.glow.scale.setScalar(0.5 + level * 0.5);
    } else if (this.style === 'headlamp') {
      this.c.joints.head.localToWorld(at.set(0, 0.2, 0.18));
      this.c.joints.head.localToWorld(this.light.position.set(0, -0.35, 1.4));
      (this.beam.material as THREE.ShaderMaterial).uniforms.uI!.value = level;
      this.beam.visible = level > 0.01;
      this.lens.color.set(level > 0.05 ? '#f2f6ff' : '#3a3d44');
      this.glow.scale.setScalar(0.18 + level * 0.12);
    } else {
      this.stick.getWorldPosition(at);
      this.light.position.copy(at).add(new THREE.Vector3(0, 0, 0.15));
      this.tube.color.set('#2c4a2a').lerp(new THREE.Color('#b8ff9a'), level);
      this.glow.scale.setScalar(0.25 + level * 0.35);
    }
    this.glow.position.copy(at);
    this.glow.material.opacity = level * (this.style === 'glowstick' ? 0.7 : 0.55) * flick;
  }
}

/** Cloth over her things, the fly over her seat, the tent laced shut: each appears with a little unfurl. */
export class Shelter {
  readonly group = new THREE.Group();
  private readonly parts: Record<'sheet' | 'pile' | 'fly' | 'flap' | 'stones', { o: THREE.Object3D; k: number; want: boolean }>;

  constructor(scene: THREE.Scene, satchelSpot: THREE.Vector3, tent: THREE.Object3D | undefined) {
    const tarp = lambert('#4f6170', { side: THREE.DoubleSide });
    const drape = (sx: number, sy: number, sz: number): THREE.Mesh => {
      const g = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      const m = new THREE.Mesh(g, tarp);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      return m;
    };
    const sheet = drape(0.3, 0.58, 0.26);
    sheet.position.copy(satchelSpot).setY(groundHeight(satchelSpot.x, satchelSpot.z) - 0.01);
    sheet.rotation.y = 0.4;
    const pile = drape(0.62, 0.48, 0.48);
    pile.position.set(-1.33, groundHeight(-1.33, -0.3) - 0.02, -0.3);
    // The rain fly: two poles and a sloping sheet behind and over her seat.
    const fly = new THREE.Group();
    const olive = lambert('#6f7d5c', { side: THREE.DoubleSide, emissive: '#262c1e' });
    const sheetGeo = new THREE.PlaneGeometry(1.7, 1.7, 4, 4);
    const sp = sheetGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) sp.setZ(i, -0.07 * (1 - Math.pow(sp.getX(i) / 0.85, 2)));
    sheetGeo.computeVertexNormals();
    const cloth = new THREE.Mesh(sheetGeo, olive);
    const y0 = groundHeight(0, -1.12);
    // High over her head in front, pegged to the ground behind her.
    cloth.position.set(0, y0 + 1.2, -1.45);
    cloth.rotation.x = 1.0;
    cloth.castShadow = true;
    cloth.receiveShadow = true;
    fly.add(cloth);
    for (const x of [-0.8, 0.8]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.68, 5), lambert('#6b5440'));
      pole.position.set(x, y0 + 0.84, -0.74);
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.78, 5), pole.material as THREE.Material);
      stake.position.set(x, y0 + 0.37, -2.17);
      fly.add(pole, stake);
    }
    const stones = new THREE.Group();
    const stoneGeo = new THREE.DodecahedronGeometry(0.1, 0);
    const stoneMat = lambert('#6a655e');
    for (const [x, z] of [[-0.84, -2.2], [0.84, -2.2], [-0.4, -2.24], [0.4, -2.22]] as const) {
      const s = new THREE.Mesh(stoneGeo, stoneMat);
      s.position.set(x, groundHeight(x, z) + 0.05, z);
      s.scale.set(1.2, 0.7, 1);
      stones.add(s);
    }
    // The tent door laced shut: a flap in the tent's own cloth over the dark doorway.
    const flap = new THREE.Group();
    const tentMesh = tent?.children[0] as THREE.Mesh | undefined;
    if (tent && tentMesh) {
      const s = new THREE.Shape();
      s.moveTo(-0.32, 0);
      s.lineTo(0, 0.66);
      s.lineTo(0.32, 0);
      s.lineTo(-0.32, 0);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(s), tentMesh.material as THREE.Material);
      m.position.z = 0.965;
      const lace = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.5, 0.01), lambert('#2a241c'));
      lace.position.set(0, 0.26, 0.97);
      flap.add(m, lace);
      tent.add(flap);
    }
    this.group.add(sheet, pile, fly, stones);
    scene.add(this.group);
    const part = (o: THREE.Object3D): { o: THREE.Object3D; k: number; want: boolean } => {
      o.visible = false;
      return { o, k: 0, want: false };
    };
    this.parts = { sheet: part(sheet), pile: part(pile), fly: part(fly), flap: part(flap), stones: part(stones) };
  }

  /** Whether her bag is under the sheet (the flask then waits on the log beside her, in view). */
  get bagCovered(): boolean {
    return this.parts.sheet.want;
  }

  /** What should be up now; `instant` skips the unfurl (at load, or when nobody is watching). */
  set(want: { sheet: boolean; pile: boolean; fly: boolean; flap: boolean; stones: boolean }, instant: boolean): void {
    for (const [k, p] of Object.entries(this.parts) as Array<[keyof typeof want, (typeof this.parts)['sheet']]>) {
      p.want = want[k];
      if (instant) p.k = p.want ? 1 : 0;
    }
  }

  update(dt: number): void {
    for (const p of Object.values(this.parts)) {
      p.k += ((p.want ? 1 : 0) - p.k) * (1 - Math.exp(-dt * 3));
      p.o.visible = p.k > 0.02;
      if (!p.o.visible) continue;
      const e = p.k * p.k * (3 - 2 * p.k);
      p.o.scale.setScalar(1);
      if (p.o === this.parts.fly.o) p.o.scale.set(1, e, 1);
      else if (p.o === this.parts.flap.o) p.o.scale.set(1, e, 1);
      else p.o.scale.multiplyScalar(e);
      // The drapes keep their own proportions.
      if (p.o === this.parts.sheet.o) p.o.scale.set(0.3 * e, 0.58 * e, 0.26 * e);
      if (p.o === this.parts.pile.o) p.o.scale.set(0.62 * e, 0.48 * e, 0.48 * e);
    }
  }
}

/** The golden hour's rim of light on Ari: edges that face the sun glow its colour. */
export const rimU = { uRim: { value: new THREE.Color(0, 0, 0) }, uSunV: { value: new THREE.Vector3(0, 1, 0) } };

export function sunKiss(mats: THREE.Material[]): void {
  for (const m of mats) {
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uRim = rimU.uRim;
      shader.uniforms.uSunV = rimU.uSunV;
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform vec3 uRim; uniform vec3 uSunV;\nvoid main() {')
        .replace(
          '#include <opaque_fragment>',
          `float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.2);
          outgoingLight += uRim * rimF * smoothstep(-0.25, 0.6, dot(normal, uSunV));
          #include <opaque_fragment>`,
        );
    };
    m.customProgramCacheKey = () => 'sunkiss';
  }
}
