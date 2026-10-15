/**
 * What falls and floats through the air, and the light that comes through it (Living World,
 * Phase 3: weather and seasons). Everything here moves on the GPU: the CPU sets a handful of
 * uniforms per frame, so rain, snow and fireflies cost the same on a mid-range phone whether
 * there are 200 of them or 1,000.
 *
 *   Rain     falling streaks around the camera, slanted by the shared wind
 *   Air      one particle field per job: snow, and the fair-weather motes (petals in spring,
 *            pollen in summer light, leaves in autumn, fireflies on warm nights)
 *   Shafts   god rays: soft beams of low sun crossing the camp in the golden hour
 *   Bolt     a lightning stroke far off in a thunderstorm, with the flash it throws
 *   Puddles  dark water in the meadow's hollows when the ground is wet, mirroring the sky
 */
import * as THREE from 'three';
import { groundHeight, pathX } from '../prototype/feel3d/world';
import { mulberry32 } from '../prototype/shared/noise';

const WRAP = `vec3 wrapAround(vec3 p, vec3 c, vec3 box){ return mod(p - c + box * 0.5, box) - box * 0.5 + c; }`;

export class Rain {
  readonly mesh: THREE.Mesh;
  readonly u = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uWind: { value: new THREE.Vector2() },
    uAmt: { value: 0 },
    uColor: { value: new THREE.Color('#aab4c4') },
    uOpacity: { value: 0.42 },
  };

  /** Each drop is a thin streak (a quad, so it keeps its width on a high-density screen). */
  constructor(scene: THREE.Scene, count: number) {
    const rnd = mulberry32(17);
    const seed = new Float32Array(count * 16);
    const corner = new Float32Array(count * 8);
    const index: number[] = [];
    for (let i = 0; i < count; i++) {
      const s = [rnd(), rnd(), rnd(), rnd()];
      for (let k = 0; k < 4; k++) {
        seed.set(s, (i * 4 + k) * 4);
        corner.set([k % 2 ? 1 : -1, k < 2 ? 0 : 1], (i * 4 + k) * 2);
      }
      const o = i * 4;
      index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 12), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setIndex(index);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: this.u,
      vertexShader: `attribute vec4 aSeed; attribute vec2 aCorner; uniform float uTime; uniform float uAmt; uniform vec3 uCam; uniform vec2 uWind; varying float vA; ${WRAP}
        void main(){
          vec3 box = vec3(22.0, 14.0, 22.0);
          vec3 vel = vec3(uWind.x, -13.0 - aSeed.w * 4.0, uWind.y);
          vec3 p = wrapAround(aSeed.xyz * box + vel * uTime, uCam, box);
          p -= normalize(vel) * (0.45 + aSeed.w * 0.35) * aCorner.y;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          mv.x += aCorner.x * 0.006 * max(1.0, -mv.z * 0.18);
          vA = step(aSeed.w, uAmt) * (1.0 - aCorner.y * 0.7) * smoothstep(0.8, 2.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(uColor, uOpacity * vA); }`,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(t: number, cam: THREE.Vector3, wind: THREE.Vector2, amount: number, sky: THREE.Color): void {
    this.mesh.visible = amount > 0.01;
    if (!this.mesh.visible) return;
    this.u.uTime.value = t % 600;
    this.u.uCam.value.copy(cam);
    this.u.uWind.value.copy(wind);
    this.u.uAmt.value = amount;
    this.u.uColor.value.copy(sky).lerp(new THREE.Color('#d4dce8'), 0.6);
  }
}

export type AirMode = 'snow' | 'petals' | 'pollen' | 'leaves' | 'fireflies';

/** One particle field: how it falls, wanders, glows. */
const MODES: Record<AirMode, { fall: number; wander: number; size: number; a: string; b: string; glow: boolean; box: [number, number, number] }> = {
  snow: { fall: 1.1, wander: 0.35, size: 0.075, a: '#e6ecf4', b: '#ffffff', glow: false, box: [30, 18, 30] },
  petals: { fall: 0.32, wander: 0.9, size: 0.07, a: '#f4d6dc', b: '#fff4f0', glow: false, box: [26, 9, 26] },
  pollen: { fall: 0.02, wander: 0.5, size: 0.035, a: '#ffe7a8', b: '#fff6d8', glow: true, box: [16, 5, 16] },
  leaves: { fall: 0.9, wander: 1.2, size: 0.11, a: '#c4622a', b: '#e0a440', glow: false, box: [28, 10, 28] },
  fireflies: { fall: 0, wander: 1.1, size: 0.07, a: '#d8ff7a', b: '#fff2a0', glow: true, box: [26, 2.2, 26] },
};

export class Air {
  readonly points: THREE.Points;
  private mode: AirMode;
  readonly u = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(30, 18, 30) },
    uWind: { value: new THREE.Vector2() },
    uFall: { value: 1 },
    uWander: { value: 0.3 },
    uSize: { value: 0.07 },
    uAmt: { value: 0 },
    uStir: { value: 0 },
    uBlink: { value: 0 },
    uA: { value: new THREE.Color() },
    uB: { value: new THREE.Color() },
    uOpacity: { value: 0.8 },
    uPr: { value: 1 },
  };

  constructor(scene: THREE.Scene, count: number, mode: AirMode) {
    const rnd = mulberry32(23 + count);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = rnd();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: this.u,
      vertexShader: `attribute vec4 aSeed; uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform vec2 uWind; uniform float uFall; uniform float uWander; uniform float uSize; uniform float uAmt; uniform float uStir; uniform float uBlink; uniform float uPr; varying float vA; varying float vK; ${WRAP}
        void main(){
          float ph = aSeed.w * 40.0;
          vec3 vel = vec3(uWind.x, -uFall * (0.6 + 0.8 * aSeed.w), uWind.y);
          vec3 p = aSeed.xyz * uBox + vel * uTime;
          p += vec3(sin(uTime * 0.9 + ph), sin(uTime * 0.7 + ph * 1.3) * 0.5, cos(uTime * 0.8 + ph)) * uWander;
          p += uStir * vec3(sin(uTime * 5.0 + ph), cos(uTime * 4.0 + ph) * 0.8 + 0.7, sin(uTime * 4.5 + ph * 2.0)) * 1.6;
          p = wrapAround(p, uCenter, uBox);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float blink = mix(1.0, pow(max(0.0, sin(uTime * (1.1 + aSeed.x) + ph)), 6.0), uBlink);
          vA = step(aSeed.w, uAmt) * blink * smoothstep(0.3, 1.5, -mv.z);
          vK = aSeed.x;
          gl_PointSize = uSize * (0.6 + 0.8 * aSeed.y) * uPr * 420.0 / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uA; uniform vec3 uB; uniform float uOpacity; varying float vA; varying float vK;
        void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.15, r); gl_FragColor = vec4(mix(uA, uB, vK), a * vA * uOpacity); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.mode = mode;
    this.setMode(mode, true);
    scene.add(this.points);
  }

  setMode(mode: AirMode, force = false): void {
    if (mode === this.mode && !force) return;
    this.mode = mode;
    const d = MODES[mode];
    this.u.uFall.value = d.fall;
    this.u.uWander.value = d.wander;
    this.u.uSize.value = d.size;
    this.u.uA.value.set(d.a);
    this.u.uB.value.set(d.b);
    this.u.uBox.value.set(...d.box);
    this.u.uBlink.value = mode === 'fireflies' ? 1 : 0;
    const m = this.points.material as THREE.ShaderMaterial;
    m.blending = d.glow ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.needsUpdate = true;
  }

  get current(): AirMode {
    return this.mode;
  }

  /** `center`: where the field is (the camera, or the meadow floor for fireflies). */
  update(t: number, center: THREE.Vector3, wind: THREE.Vector2, amount: number, opacity: number, stir: number, pr: number): void {
    this.points.visible = amount > 0.01 && opacity > 0.01;
    if (!this.points.visible) return;
    this.u.uTime.value = t % 600;
    this.u.uCenter.value.copy(center);
    this.u.uWind.value.copy(wind);
    this.u.uAmt.value = amount;
    this.u.uOpacity.value = opacity;
    this.u.uStir.value = stir;
    this.u.uPr.value = pr;
  }
}

/**
 * God rays: soft beams of low sun through the trees in the golden hour. Each beam is a quad
 * along the light's direction, turned about that axis to face the camera.
 */
export class Shafts {
  private readonly beams: THREE.Mesh[] = [];
  private readonly offsets: THREE.Vector3[] = [];
  readonly u = { uColor: { value: new THREE.Color() }, uI: { value: 0 }, uTime: { value: 0 } };

  constructor(scene: THREE.Scene) {
    const rnd = mulberry32(31);
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      side: THREE.DoubleSide,
      uniforms: this.u,
      vertexShader: `varying vec2 vUv; varying float vD; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uI; uniform float uTime; varying vec2 vUv; varying float vD;
        void main(){
          float across = exp(-pow((vUv.x - 0.5) * 3.6, 2.0));
          float along = smoothstep(1.0, 0.72, vUv.y) * smoothstep(0.0, 0.5, vUv.y);
          float shimmer = 0.65 + 0.35 * sin(uTime * 0.6 + vUv.y * 4.0 + gl_FragCoord.x * 0.002);
          gl_FragColor = vec4(uColor * across * along * shimmer * uI * smoothstep(2.0, 7.0, vD), 1.0);
        }`,
    });
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.visible = false;
      m.userData.w = 0.7 + rnd() * 1.8;
      scene.add(m);
      this.beams.push(m);
      this.offsets.push(new THREE.Vector3((rnd() - 0.5) * 14, 0.4 + rnd() * 3.2, (rnd() - 0.5) * 10));
    }
  }

  update(t: number, at: THREE.Vector3, cam: THREE.Vector3, sunDir: THREE.Vector3, color: THREE.Color, intensity: number): void {
    const on = intensity > 0.005;
    this.u.uI.value = intensity;
    this.u.uTime.value = t;
    this.u.uColor.value.copy(color);
    const axis = sunDir.clone().multiplyScalar(-1).normalize();
    const X = new THREE.Vector3();
    const Z = new THREE.Vector3();
    const len = 24;
    this.beams.forEach((b, i) => {
      b.visible = on;
      if (!on) return;
      // The beam's middle passes near the camp; it comes from the sun side.
      const mid = at.clone().add(this.offsets[i]!);
      const toCam = cam.clone().sub(mid).normalize();
      X.crossVectors(axis, toCam).normalize();
      Z.crossVectors(X, axis);
      b.matrix.makeBasis(X.clone().multiplyScalar(b.userData.w as number), axis.clone().multiplyScalar(len), Z);
      b.matrix.setPosition(mid);
      b.matrixAutoUpdate = false;
      b.matrixWorldNeedsUpdate = true;
    });
  }
}

/** A lightning stroke: a jagged line from the cloud base to the ground, far off. */
export class Bolt {
  readonly line: THREE.LineSegments;
  private readonly rnd = mulberry32(41);

  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(48 * 3), 3));
    this.line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#f2f0ff', transparent: true, opacity: 0, fog: false, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.line.frustumCulled = false;
    scene.add(this.line);
  }

  /** A new stroke somewhere ahead of the camera, `dist` metres away. */
  strike(cam: THREE.Vector3, look: THREE.Vector3, dist: number): void {
    const r = this.rnd;
    const fwd = look.clone().sub(cam).setY(0).normalize();
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const base = cam.clone().addScaledVector(fwd, dist).addScaledVector(side, (r() - 0.5) * dist * 0.9);
    const top = 160 + r() * 80;
    const pos = this.line.geometry.attributes.position as THREE.BufferAttribute;
    let p = base.clone().setY(top + cam.y * 0.2);
    const ground = groundHeight(base.x, base.z);
    for (let i = 0; i < 24; i++) {
      const u = (i + 1) / 24;
      const q = new THREE.Vector3(p.x + (r() - 0.5) * 18, top - (top - ground) * u, p.z + (r() - 0.5) * 18);
      pos.setXYZ(i * 2, p.x, p.y, p.z);
      pos.setXYZ(i * 2 + 1, q.x, q.y, q.z);
      p = q;
    }
    pos.needsUpdate = true;
  }

  show(flash: number): void {
    (this.line.material as THREE.LineBasicMaterial).opacity = Math.min(1, flash * 1.4);
    this.line.visible = flash > 0.02;
  }
}

/** Water in the meadow's hollows near camp: dark, mirroring the sky's colour, only when wet. */
export class Puddles {
  private readonly mat = new THREE.MeshBasicMaterial({ color: '#8c9aae', transparent: true, opacity: 0, depthWrite: false, fog: true });
  readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    const rnd = mulberry32(53);
    let n = 0;
    let guard = 0;
    while (n < 9 && guard++ < 400) {
      const a = rnd() * Math.PI * 2;
      const d = 3.4 + rnd() * 9;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (Math.abs(x - pathX(z)) < 1.2 && d < 4) continue;
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.35 + rnd() * 0.7, 12), this.mat);
      m.rotation.x = -Math.PI / 2;
      m.scale.set(1, 0.55 + rnd() * 0.5, 1);
      m.position.set(x, groundHeight(x, z) + 0.03, z);
      m.renderOrder = 1;
      this.group.add(m);
      n++;
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  update(wet: number, sky: THREE.Color): void {
    this.group.visible = wet > 0.05;
    this.mat.opacity = Math.min(0.75, wet * 0.8);
    this.mat.color.copy(sky).multiplyScalar(0.75);
  }
}
