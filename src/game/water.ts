/**
 * The brook (art direction: "alive"): a painted ribbon of water in the carved channel.
 *
 *   flow      layered ripples drift downstream; faster in the middle, lazy at the banks
 *   colour    clear and pale over the shallows, deep teal in the middle
 *   sky       the sky reflects more at grazing angles (fresnel), in the sky's own colours
 *   glints    the sun (or the moon) sparkles on the ripples; through the bloom they shine
 *   foam      lace along the banks and round the stones, moving with the current
 *
 * One mesh, one draw call; the stones are the world's painted stones.
 */
import * as THREE from 'three';
import { STREAM, STREAM_HALF, glowTexture, groundHeight, pathX as pathXAt } from '../prototype/feel3d/world';
import { stoneGeometry } from './style';

export const waterU = {
  uTime: { value: 0 },
  uSky: { value: new THREE.Color('#9ab8d0') },
  uZenith: { value: new THREE.Color('#3a6fa8') },
  uLight: { value: new THREE.Vector3(0, 1, 0) },
  uLightCol: { value: new THREE.Color('#ffffff') },
  uDeep: { value: new THREE.Color('#1e4a52') },
  uShallow: { value: new THREE.Color('#5f9a8a') },
  uNight: { value: 0 },
};

const VS = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FS = /* glsl */ `
uniform float uTime; uniform vec3 uSky; uniform vec3 uZenith; uniform vec3 uLight; uniform vec3 uLightCol;
uniform vec3 uDeep; uniform vec3 uShallow; uniform float uNight;
varying vec2 vUv;
varying vec3 vW;
#include <fog_pars_fragment>
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float across = vUv.x;            // 0 left bank, 1 right bank
  float mid = 1.0 - abs(across - 0.5) * 2.0; // 1 in the middle
  float speed = 0.6 + mid * 1.1;
  vec2 q = vec2(across * 4.0, vUv.y * 0.9 - uTime * speed);
  float n1 = noise(q * vec2(1.0, 1.6));
  float n2 = noise(q * vec2(2.3, 3.1) + 7.3 - uTime * 0.3);
  float n3 = noise(q * vec2(5.0, 7.0) + 3.1);
  float h = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;
  // A rippled normal from the height field's slopes.
  vec3 N = normalize(vec3((n2 - 0.5) * 0.6 + (n3 - 0.5) * 0.3, 1.0, (n1 - 0.5) * 0.6));
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 body = mix(uShallow, uDeep, smoothstep(0.1, 0.75, mid)) * (0.85 + h * 0.3);
  vec3 sky = mix(uSky, uZenith, clamp(reflect(-V, N).y * 1.5, 0.0, 1.0));
  vec3 col = mix(body, sky, 0.25 + fres * 0.6);
  // Glints of sun or moon on the ripples.
  vec3 R = reflect(-uLight, N);
  float glint = pow(max(dot(R, V), 0.0), 120.0) * smoothstep(0.55, 0.8, n3 + n2 * 0.4);
  col += uLightCol * glint * (uNight > 0.5 ? 2.5 : 6.0);
  // Foam: lace along the banks, flecks riding the current.
  float bank = 1.0 - smoothstep(0.0, 0.16, min(across, 1.0 - across));
  float lace = smoothstep(0.55, 0.75, noise(vec2(across * 18.0, vUv.y * 3.0 - uTime * speed * 2.0)));
  float fleck = smoothstep(0.86, 0.95, noise(vec2(across * 9.0, vUv.y * 2.2 - uTime * speed * 1.6) + 11.0)) * mid;
  float foam = clamp(bank * (0.35 + lace * 0.8) + fleck * 0.7, 0.0, 1.0);
  col = mix(col, vec3(0.92, 0.96, 0.98) * (1.0 - uNight * 0.75), foam * 0.85);
  float alpha = smoothstep(0.0, 0.14, min(across, 1.0 - across)) * 0.9;
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}`;

export class Brook {
  readonly group = new THREE.Group();
  private readonly mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    // The ribbon: two edges per centre-line point, the water a little under the banks.
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let along = 0;
    // The water's edge is where the banks rise through its level.
    const W = STREAM_HALF + 0.55;
    for (let i = 0; i < STREAM.length; i++) {
      const p = STREAM[i]!;
      const a = STREAM[Math.max(0, i - 1)]!;
      const b = STREAM[Math.min(STREAM.length - 1, i + 1)]!;
      const tx = b[0] - a[0];
      const tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl;
      const nz = tx / tl;
      if (i > 0) along += Math.hypot(p[0] - STREAM[i - 1]![0], p[1] - STREAM[i - 1]![1]);
      const y = groundHeight(p[0], p[1]) + 0.27;
      for (const side of [-1, 1]) {
        pos.push(p[0] + nx * W * side, y, p[1] + nz * W * side);
        uv.push(side < 0 ? 0 : 1, along);
      }
    }
    for (let i = 0; i < STREAM.length - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
    });
    Object.assign(this.mat.uniforms, waterU);
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.renderOrder = 1;
    this.group.add(mesh);

    // Stones in the current and on the banks, a few wet and dark.
    const stoneMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const geos = [stoneGeometry(71, '#4f6040', '#6e6a66'), stoneGeometry(83, '#56663e', '#7a746c')];
    let s = 3;
    const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 4; i < STREAM.length - 2; i += 2) {
      const p = STREAM[i]!;
      const b = STREAM[i + 1]!;
      const tl = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
      const nx = -(b[1] - p[1]) / tl;
      const nz = (b[0] - p[0]) / tl;
      const off = (rnd() - 0.5) * 2 * W * 1.1;
      const x = p[0] + nx * off;
      const z = p[1] + nz * off;
      const sz = 0.25 + rnd() * 0.45;
      const st = new THREE.Mesh(geos[i % 2]!, stoneMat);
      st.scale.set(sz * 1.2, sz * 0.75, sz);
      st.rotation.y = rnd() * 6.3;
      st.position.set(x, groundHeight(x, z) + sz * 0.12, z);
      st.castShadow = true;
      st.receiveShadow = true;
      this.group.add(st);
    }
    // The ford: flat stepping stones across the brook where the route crosses it.
    {
      const fordZ = -12.4;
      for (let k = 0; k < 5; k++) {
        const z = fordZ + 1.7 - k * 0.85;
        const x = pathXAt(z) + (k % 2 ? 0.18 : -0.15);
        const st = new THREE.Mesh(geos[k % 2]!, stoneMat);
        st.scale.set(0.62, 0.32, 0.5);
        st.rotation.y = k * 1.1;
        const waterY = groundHeight(x, z) + 0.27;
        st.position.set(x, Math.max(groundHeight(x, z) + 0.12, waterY - 0.02), z);
        st.castShadow = true;
        st.receiveShadow = true;
        this.group.add(st);
      }
    }
    // A soft mist over the water in the cool hours (sprites, very faint).
    const tex = glowTexture();
    for (let i = 6; i < STREAM.length - 4; i += 5) {
      const p = STREAM[i]!;
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#dfe8ee', transparent: true, depthWrite: false, opacity: 0.0 }));
      m.position.set(p[0], groundHeight(p[0], p[1]) + 0.6, p[1]);
      m.scale.set(5, 1.4, 1);
      m.userData.mist = true;
      this.group.add(m);
    }
    scene.add(this.group);
  }

  /** `mist` 0..1: morning and evening haze over the water. */
  update(t: number, mist: number): void {
    waterU.uTime.value = t;
    for (const o of this.group.children) {
      if (o.userData.mist) (o as THREE.Sprite).material.opacity = mist * (0.16 + 0.06 * Math.sin(t * 0.3 + o.position.z));
    }
  }
}
