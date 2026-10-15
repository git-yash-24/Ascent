/**
 * The cloud layer (art direction: painted storybook cumulus). Each cloud is a handful of round
 * puffs on a flat base, drawn as one instanced mesh with its own painted shader: a soft lit side
 * toward the sun, cool violet shade, a darker flat belly, a silver (or golden) lining near the
 * light, and a fade into the horizon haze with distance. Cheap on a phone: one draw call.
 *
 * Their colour comes from the sky (SkyLook); cover grows and thins slowly, so weather arrives
 * instead of switching: clouds swell in from nothing and shrink away.
 */
import * as THREE from 'three';
import type { SkyLook } from './sky';

const COUNT = 24;
const MAX_PUFFS = 9;

interface Puff {
  /** Offset from the cloud's base centre, in cloud units (size 1). */
  o: THREE.Vector3;
  r: number;
}

interface Cloud {
  rank: number;
  base: THREE.Vector3;
  size: number;
  puffs: Puff[];
  show: number;
  stretch: number;
}

const VS = /* glsl */ `
attribute vec4 aCenter; // cloud base centre (xyz) and how far it has formed (w)
uniform float uFlat;
varying vec3 vN;
varying vec3 vW;
varying vec3 vC;
varying float vShow;
varying float vBelly;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  // A flat base: nothing hangs below the cloud's floor.
  float floorY = aCenter.y;
  vBelly = clamp((wp.y - floorY) / max(1.0, uFlat), 0.0, 1.0);
  wp.y = max(wp.y, floorY + (wp.y - floorY) * 0.15);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vW = wp.xyz;
  vC = aCenter.xyz;
  vShow = aCenter.w;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FS = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uHaze;
uniform vec3 uLight;
uniform float uCover;
varying vec3 vN;
varying vec3 vW;
varying vec3 vC;
varying float vShow;
varying float vBelly;
void main() {
  // The whole cloud shades as one form: each puff's normal leans toward the cloud's.
  vec3 n = normalize(mix(vN, normalize(vW - vC - vec3(0.0, 20.0, 0.0)), 0.35));
  float w = dot(n, uLight) * 0.5 + 0.5;
  float lit = smoothstep(0.38, 0.62, w) * 0.72 + smoothstep(0.78, 0.96, w) * 0.28;
  vec3 col = mix(uShade, uLit, lit);
  // The belly is darker and cooler; storm cover darkens it more.
  col *= mix(0.72 - uCover * 0.18, 1.0, smoothstep(0.0, 0.55, vBelly));
  vec3 v = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.2);
  float toward = pow(max(dot(-v, uLight), 0.0), 4.0);
  col += uLit * fres * (0.18 + 0.7 * toward);
  // Aerial perspective: far and low clouds sink into the horizon haze.
  vec3 d = normalize(vW - cameraPosition);
  float haze = (1.0 - smoothstep(0.02, 0.32, d.y)) * 0.55;
  col = mix(col, uHaze, haze);
  gl_FragColor = vec4(col, clamp(vShow * 1.4, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Clouds {
  private readonly items: Cloud[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly centers: Float32Array;
  private readonly u = {
    uLit: { value: new THREE.Color('#ffffff') },
    uShade: { value: new THREE.Color('#9aa0b8') },
    uHaze: { value: new THREE.Color('#cfdce4') },
    uLight: { value: new THREE.Vector3(0, 1, 0) },
    uCover: { value: 0.3 },
    uFlat: { value: 60 },
  };
  private drift = 0;
  cover = 0.3;

  constructor(scene: THREE.Scene) {
    let seed = 11;
    const rnd = (): number => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    for (let i = 0; i < COUNT; i++) {
      // A ring of cloud mostly over the mountain side of the sky, some overhead.
      const a = -Math.PI * 0.95 + rnd() * Math.PI * 1.9;
      const r = 420 + rnd() * 640;
      const base = new THREE.Vector3(Math.sin(a) * r, 150 + rnd() * 170, -Math.cos(a) * r * 0.9 - 60);
      const size = 120 + rnd() * 170;
      // A cumulus: a tall middle, shoulders either side, a few small puffs along the base.
      const puffs: Puff[] = [];
      const n = 6 + Math.floor(rnd() * (MAX_PUFFS - 5));
      for (let k = 0; k < n; k++) {
        const u = n === 1 ? 0 : (k / (n - 1)) * 2 - 1;
        const tall = 1 - Math.abs(u);
        const rr = 0.2 + tall * 0.26 + rnd() * 0.1;
        puffs.push({ o: new THREE.Vector3(u * 0.62 + (rnd() - 0.5) * 0.12, rr * 0.55 + tall * 0.12, (rnd() - 0.5) * 0.25), r: rr });
      }
      puffs.push({ o: new THREE.Vector3((rnd() - 0.5) * 0.3, 0.42 + rnd() * 0.12, 0.05), r: 0.28 + rnd() * 0.08 });
      this.items.push({ rank: rnd(), base, size, puffs, show: 0, stretch: 1 + rnd() * 0.5 });
    }
    const total = this.items.reduce((t, c) => t + c.puffs.length, 0);
    const geo = new THREE.IcosahedronGeometry(1, 2);
    this.centers = new Float32Array(total * 4);
    geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(this.centers, 4));
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: true, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, total);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  /** Ease the cover toward `target`, drift with the wind, colour by the sky and the sun. */
  update(dt: number, target: number, tau: number, look: SkyLook, sunDir: THREE.Vector3, wind: THREE.Vector2, windStrength: number): void {
    this.cover += (target - this.cover) * (1 - Math.exp(-dt / tau));
    this.drift += dt * (2 + windStrength * 10);
    const u = this.u;
    u.uLit.value.copy(look.cloudLit);
    u.uShade.value.copy(look.cloudShade).lerp(look.zenith, 0.25);
    u.uHaze.value.copy(look.horizon).lerp(look.mid, 0.3);
    // By night the clouds take the soft light from overhead.
    u.uLight.value.copy(sunDir.y > -0.08 ? sunDir : new THREE.Vector3(0.2, 1, 0.3).normalize());
    u.uCover.value = this.cover;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    let i = 0;
    for (const c of this.items) {
      // More clouds as the cover rises, each swelling in rather than popping.
      const want = Math.max(0, Math.min(1, (this.cover - c.rank * 0.85) / 0.15));
      c.show += (want - c.show) * Math.min(1, dt * 1.5);
      const x = ((c.base.x + this.drift * wind.x + 1300) % 2600) - 1300;
      // Heavier cover: bigger, lower, flatter and wider.
      const k = c.size * (1 + this.cover * 0.45) * (0.35 + 0.65 * c.show);
      const y = c.base.y - this.cover * 40;
      const sx = k * c.stretch * (1 + this.cover * 0.4);
      for (const puff of c.puffs) {
        p.set(x + puff.o.x * sx, y + puff.o.y * k, c.base.z + puff.o.z * k);
        const r = puff.r * k * (c.show > 0.01 ? 1 : 0);
        s.set(r * (1 + this.cover * 0.2), r * (0.85 - this.cover * 0.15), r);
        m.compose(p, q, s);
        this.mesh.setMatrixAt(i, m);
        this.centers.set([x, y, c.base.z, c.show], i * 4);
        i++;
      }
    }
    this.u.uFlat.value = 70;
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.mesh.geometry.getAttribute('aCenter') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}
