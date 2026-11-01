/**
 * The camera's eye (art direction: a polished, painterly indie look). The scene renders into a
 * linear HDR buffer; this pipeline turns it into the final picture:
 *
 *   bloom        a soft dual-filter bloom from the bright parts: fire, lamps, sun, fireflies
 *   shafts       light shafts radiating from the sun through gaps in the clouds, trees and peaks
 *   focus        a gentle depth of field around Ari, so the camp reads like a miniature
 *   grade        exposure, a filmic curve, warm highlights and cool shadows, saturation
 *   lens         vignette, a whisper of chromatic fringe at the edges, film grain, dither
 *
 * One full-screen composite plus a handful of small half- and quarter-res passes. The quality
 * tier picks what runs: tier 0 skips the pipeline entirely (the renderer tone-maps directly).
 */
import * as THREE from 'three';

const QUAD_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function pass(fs: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
}

const PREFILTER = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee;
varying vec2 vUv;
void main(){
  // A 4-tap box at half res, then a soft-knee threshold so bloom grows in rather than snapping.
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  c = min(c, vec3(40.0));
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(c * w, 1.0);
}`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  // Dual filtering (Kawase): 5 taps, cheap and smooth.
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv - uTexel).rgb;
  s += texture2D(tSrc, vUv + uTexel).rgb;
  s += texture2D(tSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb;
  s += texture2D(tSrc, vUv - vec2(uTexel.x, -uTexel.y)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

const UP = /* glsl */ `
uniform sampler2D tSrc; uniform sampler2D tBase; uniform vec2 uTexel; uniform float uMix; varying vec2 vUv;
void main(){
  vec3 s = texture2D(tSrc, vUv + vec2(-uTexel.x * 2.0, 0.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(-uTexel.x, uTexel.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0, uTexel.y * 2.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(uTexel.x, uTexel.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(uTexel.x * 2.0, 0.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0, -uTexel.y * 2.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(-uTexel.x, -uTexel.y)).rgb * 2.0;
  gl_FragColor = vec4(texture2D(tBase, vUv).rgb + s / 12.0 * uMix, 1.0);
}`;

const SHAFT_MASK = /* glsl */ `
uniform sampler2D tSrc; uniform sampler2D tDepth; uniform vec2 uSun; uniform float uAspect; varying vec2 vUv;
void main(){
  // Only open sky lets light through; brightest near the sun.
  float d = texture2D(tDepth, vUv).x;
  float sky = step(0.99995, d);
  vec2 off = (vUv - uSun) * vec2(uAspect, 1.0);
  float near = exp(-dot(off, off) * 9.0);
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.3, 0.55, 0.15));
  gl_FragColor = vec4(vec3(sky * (near * 1.6 + l * 0.15)), 1.0);
}`;

const SHAFT_BLUR = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uSun; uniform float uStep; varying vec2 vUv;
void main(){
  // Radial blur toward the sun: light spills out from every gap.
  vec2 dir = (uSun - vUv) * uStep;
  vec2 p = vUv;
  float acc = 0.0;
  float w = 1.0;
  for (int i = 0; i < 24; i++) {
    acc += texture2D(tSrc, p).r * w;
    w *= 0.955;
    p += dir;
  }
  gl_FragColor = vec4(vec3(acc / 12.0), 1.0);
}`;

const AO = /* glsl */ `
uniform sampler2D tDepth; uniform float uNear; uniform float uFar; uniform vec2 uTexel; uniform float uRadius; uniform float uProj;
varying vec2 vUv;
float viewZ(float d){ return (uNear * uFar) / ((uFar - uNear) * d - uFar); }
float lz(vec2 uv){ return -viewZ(texture2D(tDepth, uv).x); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  // Contact shadows from depth alone: compare each sample with the plane the centre lies on
  // (1/z is linear across a plane in screen space), so open ground stays clean and only real
  // creases, feet and the undersides of things darken.
  float d0 = texture2D(tDepth, vUv).x;
  if (d0 > 0.99999) { gl_FragColor = vec4(1.0); return; }
  float z0 = lz(vUv);
  float w0 = 1.0 / z0;
  float wl = 1.0 / lz(vUv - vec2(uTexel.x, 0.0)), wr = 1.0 / lz(vUv + vec2(uTexel.x, 0.0));
  float wd = 1.0 / lz(vUv - vec2(0.0, uTexel.y)), wu = 1.0 / lz(vUv + vec2(0.0, uTexel.y));
  float gx = abs(wr - w0) < abs(w0 - wl) ? wr - w0 : w0 - wl;
  float gy = abs(wu - w0) < abs(w0 - wd) ? wu - w0 : w0 - wd;
  float rpx = clamp(uRadius * uProj / z0, 3.0, 60.0);
  float rot = hash(gl_FragCoord.xy) * 6.2831;
  float occ = 0.0;
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    float a = rot + fi * 2.39996;
    float r = rpx * sqrt((fi + 0.5) / 10.0);
    vec2 o = vec2(cos(a), sin(a)) * r;
    vec2 suv = vUv + o * uTexel;
    float zs = lz(suv);
    float wp = w0 + gx * o.x + gy * o.y;
    float zp = 1.0 / max(wp, 1e-6);
    float dz = zp - zs;
    float rangeOk = 1.0 - smoothstep(uRadius * 1.5, uRadius * 3.0, dz);
    occ += smoothstep(0.015 + z0 * 0.004, 0.08 + z0 * 0.01, dz) * rangeOk;
  }
  float ao = 1.0 - occ / 10.0;
  gl_FragColor = vec4(vec3(ao), 1.0);
}`;

const AO_BLUR = /* glsl */ `
uniform sampler2D tSrc; uniform sampler2D tDepth; uniform float uNear; uniform float uFar; uniform vec2 uTexel; uniform vec2 uDir;
varying vec2 vUv;
float viewZ(float d){ return (uNear * uFar) / ((uFar - uNear) * d - uFar); }
void main(){
  // Depth-aware blur so the shading does not bleed across silhouettes.
  float z0 = -viewZ(texture2D(tDepth, vUv).x);
  float acc = 0.0; float wsum = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + uDir * uTexel * float(i) * 1.5;
    float z = -viewZ(texture2D(tDepth, uv).x);
    float w = exp(-float(i * i) * 0.18) * (1.0 - smoothstep(0.0, 0.06 * z0 + 0.05, abs(z - z0)));
    acc += texture2D(tSrc, uv).r * w;
    wsum += w;
  }
  gl_FragColor = vec4(vec3(acc / max(wsum, 1e-4)), 1.0);
}`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tShaft; uniform sampler2D tBlur; uniform sampler2D tDepth; uniform sampler2D tAO; uniform float uAO;
uniform float uExposure; uniform float uBloom; uniform vec3 uShaftColor; uniform float uShaft;
uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uFocusRange; uniform float uDof;
uniform float uTime; uniform float uVignette; uniform float uGrain; uniform float uSat; uniform float uContrast;
uniform vec3 uWarm; uniform vec3 uCool; uniform vec2 uRes; uniform float uFringe;
varying vec2 vUv;

float viewZ(float d){ return (uNear * uFar) / ((uFar - uNear) * d - uFar); }

// ACES fitted (Stephen Hill), with a gentle toe so shadows stay painted, not crushed.
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c){
  const mat3 i = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 o = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(o * RRTAndODTFit(i * c), 0.0, 1.0);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

void main(){
  vec2 uv = vUv;
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  // A whisper of lens fringe toward the corners.
  vec2 ca = cc * r2 * uFringe;
  vec3 col = vec3(texture2D(tScene, uv - ca).r, texture2D(tScene, uv).g, texture2D(tScene, uv + ca).b);
  // Contact shadows: ambient light is darkened in creases, under props and where things meet the ground.
  if (uAO > 0.001) col *= mix(1.0, texture2D(tAO, uv).r, uAO);
  // Focus: blend toward the soft buffer away from the focal distance.
  if (uDof > 0.001) {
    float z = -viewZ(texture2D(tDepth, uv).x);
    float coc = clamp(abs(z - uFocus) / uFocusRange - 0.35, 0.0, 1.0);
    coc *= coc;
    col = mix(col, texture2D(tBlur, uv).rgb, coc * uDof);
  }
  col += texture2D(tBloom, uv).rgb * uBloom;
  col += uShaftColor * texture2D(tShaft, uv).r * uShaft;
  col *= uExposure;
  col = aces(col);
  // Grade (in display-ish space): split toning, saturation, a soft S-curve.
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * uCool, (1.0 - smoothstep(0.0, 0.45, l)) * 0.6);
  col = mix(col, col * uWarm, smoothstep(0.45, 1.0, l) * 0.6);
  col = mix(vec3(l), col, uSat);
  col = clamp(col, 0.0, 1.0);
  col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);
  // Vignette: a soft, slightly warm falloff.
  float vig = smoothstep(0.85, 0.25, length(cc * vec2(uRes.x / uRes.y, 1.0) * 0.9));
  col *= mix(1.0 - uVignette, 1.0, vig);
  col = toSRGB(col);
  // Grain and dither.
  float g = hash(uv * uRes + fract(uTime * 7.31) * 113.0) - 0.5;
  col += g * uGrain + (hash(uv * uRes * 1.7) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

export interface PostParams {
  exposure: number;
  bloom: number;
  /** Sun in screen uv (0..1), and how strong the shafts are (0 off). */
  sun: THREE.Vector2;
  shaft: number;
  shaftColor: THREE.Color;
  /** Distance in metres that is sharp, and how much blur elsewhere (0 off). */
  focus: number;
  focusRange: number;
  dof: number;
  /** Contact shadows (ambient occlusion), 0 off to 1; and their reach in metres. */
  ao?: number;
  aoRadius?: number;
  vignette: number;
  grain: number;
  saturation: number;
  contrast: number;
  warm: THREE.Color;
  cool: THREE.Color;
  time: number;
}

export class Post {
  private readonly hdr: THREE.WebGLRenderTarget;
  private readonly mips: THREE.WebGLRenderTarget[] = [];
  private readonly ups: THREE.WebGLRenderTarget[] = [];
  private readonly shaftA: THREE.WebGLRenderTarget;
  private readonly shaftB: THREE.WebGLRenderTarget;
  private readonly blur: THREE.WebGLRenderTarget;
  private readonly blur2: THREE.WebGLRenderTarget;
  private readonly aoA: THREE.WebGLRenderTarget;
  private readonly aoB: THREE.WebGLRenderTarget;
  private readonly aoPass = pass(AO, { tDepth: { value: null }, uNear: { value: 0.05 }, uFar: { value: 5000 }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.4 }, uProj: { value: 500 } });
  private readonly aoBlur = pass(AO_BLUR, { tSrc: { value: null }, tDepth: { value: null }, uNear: { value: 0.05 }, uFar: { value: 5000 }, uTexel: { value: new THREE.Vector2() }, uDir: { value: new THREE.Vector2(1, 0) } });
  private readonly white: THREE.DataTexture;
  private readonly quad: THREE.Mesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly prefilter = pass(PREFILTER, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.1 }, uKnee: { value: 0.6 } });
  private readonly down = pass(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  private readonly up = pass(UP, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 1 } });
  private readonly mask = pass(SHAFT_MASK, { tSrc: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
  private readonly radial = pass(SHAFT_BLUR, { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uStep: { value: 0.03 } });
  private readonly comp: THREE.ShaderMaterial;
  private w = 1;
  private h = 1;
  private readonly black: THREE.DataTexture;

  constructor(private readonly renderer: THREE.WebGLRenderer, samples: number) {
    const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.hdr = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    this.hdr.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    for (let i = 0; i < 5; i++) {
      this.mips.push(new THREE.WebGLRenderTarget(1, 1, opts));
      this.ups.push(new THREE.WebGLRenderTarget(1, 1, opts));
    }
    this.shaftA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.shaftB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.blur = new THREE.WebGLRenderTarget(1, 1, opts);
    this.blur2 = new THREE.WebGLRenderTarget(1, 1, opts);
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;
    this.aoA = new THREE.WebGLRenderTarget(1, 1, { ...opts, type: THREE.UnsignedByteType });
    this.aoB = new THREE.WebGLRenderTarget(1, 1, { ...opts, type: THREE.UnsignedByteType });
    this.comp = pass(COMPOSITE, {
      tScene: { value: null },
      tBloom: { value: null },
      tShaft: { value: null },
      tBlur: { value: null },
      tDepth: { value: null },
      tAO: { value: null },
      uAO: { value: 0 },
      uExposure: { value: 1 },
      uBloom: { value: 0.6 },
      uShaftColor: { value: new THREE.Color() },
      uShaft: { value: 0 },
      uNear: { value: 0.05 },
      uFar: { value: 5000 },
      uFocus: { value: 4 },
      uFocusRange: { value: 4 },
      uDof: { value: 0 },
      uTime: { value: 0 },
      uVignette: { value: 0.3 },
      uGrain: { value: 0.03 },
      uSat: { value: 1.1 },
      uContrast: { value: 0.2 },
      uWarm: { value: new THREE.Color(1.06, 1.0, 0.92) },
      uCool: { value: new THREE.Color(0.92, 0.98, 1.08) },
      uRes: { value: new THREE.Vector2(1, 1) },
      uFringe: { value: 0.012 },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.comp);
    this.quad.frustumCulled = false;
  }

  setSize(w: number, h: number): void {
    this.w = Math.max(1, Math.floor(w));
    this.h = Math.max(1, Math.floor(h));
    this.hdr.setSize(this.w, this.h);
    let mw = this.w;
    let mh = this.h;
    for (let i = 0; i < this.mips.length; i++) {
      mw = Math.max(1, Math.floor(mw / 2));
      mh = Math.max(1, Math.floor(mh / 2));
      this.mips[i]!.setSize(mw, mh);
      this.ups[i]!.setSize(mw, mh);
    }
    this.shaftA.setSize(Math.max(1, this.w >> 2), Math.max(1, this.h >> 2));
    this.shaftB.setSize(Math.max(1, this.w >> 2), Math.max(1, this.h >> 2));
    this.blur.setSize(Math.max(1, this.w >> 2), Math.max(1, this.h >> 2));
    this.blur2.setSize(Math.max(1, this.w >> 3), Math.max(1, this.h >> 3));
    this.aoA.setSize(Math.max(1, this.w >> 1), Math.max(1, this.h >> 1));
    this.aoB.setSize(Math.max(1, this.w >> 1), Math.max(1, this.h >> 1));
  }

  private draw(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.cam);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, p: PostParams): void {
    const r = this.renderer;
    const prevTone = r.toneMapping;
    r.setRenderTarget(this.hdr);
    r.render(scene, camera);
    r.toneMapping = THREE.NoToneMapping;
    const src = this.hdr.texture;

    // Bloom: prefilter into mip 0, down the chain, back up accumulating.
    const texel = (t: THREE.WebGLRenderTarget): THREE.Vector2 => new THREE.Vector2(1 / t.width, 1 / t.height);
    this.prefilter.uniforms.tSrc!.value = src;
    this.prefilter.uniforms.uTexel!.value = new THREE.Vector2(1 / this.w, 1 / this.h);
    this.draw(this.prefilter, this.mips[0]!);
    for (let i = 1; i < this.mips.length; i++) {
      this.down.uniforms.tSrc!.value = this.mips[i - 1]!.texture;
      this.down.uniforms.uTexel!.value = texel(this.mips[i - 1]!);
      this.draw(this.down, this.mips[i]!);
    }
    let prev = this.mips[this.mips.length - 1]!;
    for (let i = this.mips.length - 2; i >= 0; i--) {
      this.up.uniforms.tSrc!.value = prev.texture;
      this.up.uniforms.tBase!.value = this.mips[i]!.texture;
      this.up.uniforms.uTexel!.value = texel(prev);
      this.draw(this.up, this.ups[i]!);
      prev = this.ups[i]!;
    }

    // Light shafts (only while the sun is near the frame).
    const onScreen = p.shaft > 0.002 && p.sun.x > -0.5 && p.sun.x < 1.5 && p.sun.y > -0.5 && p.sun.y < 1.5;
    if (onScreen) {
      this.mask.uniforms.tSrc!.value = src;
      this.mask.uniforms.tDepth!.value = this.hdr.depthTexture;
      this.mask.uniforms.uSun!.value.copy(p.sun);
      this.mask.uniforms.uAspect!.value = this.w / this.h;
      this.draw(this.mask, this.shaftA);
      this.radial.uniforms.uSun!.value.copy(p.sun);
      this.radial.uniforms.tSrc!.value = this.shaftA.texture;
      this.radial.uniforms.uStep!.value = 0.034;
      this.draw(this.radial, this.shaftB);
      this.radial.uniforms.tSrc!.value = this.shaftB.texture;
      this.radial.uniforms.uStep!.value = 0.012;
      this.draw(this.radial, this.shaftA);
    }

    // The soft buffer for focus: quarter res, blurred twice.
    if (p.dof > 0.001) {
      this.down.uniforms.tSrc!.value = this.mips[0]!.texture === src ? src : src;
      this.down.uniforms.uTexel!.value = new THREE.Vector2(2 / this.w, 2 / this.h);
      this.draw(this.down, this.blur);
      this.down.uniforms.tSrc!.value = this.blur.texture;
      this.down.uniforms.uTexel!.value = texel(this.blur);
      this.draw(this.down, this.blur2);
      this.up.uniforms.tSrc!.value = this.blur2.texture;
      this.up.uniforms.tBase!.value = this.black;
      this.up.uniforms.uTexel!.value = texel(this.blur2);
      this.up.uniforms.uMix!.value = 1;
      this.draw(this.up, this.blur);
    }
    this.up.uniforms.uMix!.value = 1;

    // Contact shadows at half resolution, blurred across then down, respecting depth edges.
    const ao = p.ao ?? 0;
    if (ao > 0.001) {
      const half = new THREE.Vector2(1 / this.aoA.width, 1 / this.aoA.height);
      const a = this.aoPass.uniforms;
      a.tDepth!.value = this.hdr.depthTexture;
      a.uNear!.value = camera.near;
      a.uFar!.value = camera.far;
      a.uTexel!.value = half;
      a.uRadius!.value = p.aoRadius ?? 0.4;
      a.uProj!.value = this.aoA.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      this.draw(this.aoPass, this.aoA);
      const b = this.aoBlur.uniforms;
      b.tDepth!.value = this.hdr.depthTexture;
      b.uNear!.value = camera.near;
      b.uFar!.value = camera.far;
      b.uTexel!.value = half;
      b.tSrc!.value = this.aoA.texture;
      (b.uDir!.value as THREE.Vector2).set(1, 0);
      this.draw(this.aoBlur, this.aoB);
      b.tSrc!.value = this.aoB.texture;
      (b.uDir!.value as THREE.Vector2).set(0, 1);
      this.draw(this.aoBlur, this.aoA);
    }

    const u = this.comp.uniforms;
    u.tAO!.value = ao > 0.001 ? this.aoA.texture : this.white;
    u.uAO!.value = ao;
    u.tScene!.value = src;
    u.tBloom!.value = this.ups[0]!.texture;
    u.tShaft!.value = onScreen ? this.shaftA.texture : this.black;
    u.tBlur!.value = this.blur.texture;
    u.tDepth!.value = this.hdr.depthTexture;
    u.uExposure!.value = p.exposure;
    u.uBloom!.value = p.bloom;
    u.uShaft!.value = onScreen ? p.shaft : 0;
    (u.uShaftColor!.value as THREE.Color).copy(p.shaftColor);
    u.uNear!.value = camera.near;
    u.uFar!.value = camera.far;
    u.uFocus!.value = p.focus;
    u.uFocusRange!.value = p.focusRange;
    u.uDof!.value = p.dof;
    u.uTime!.value = p.time;
    u.uVignette!.value = p.vignette;
    u.uGrain!.value = p.grain;
    u.uSat!.value = p.saturation;
    u.uContrast!.value = p.contrast;
    (u.uWarm!.value as THREE.Color).copy(p.warm);
    (u.uCool!.value as THREE.Color).copy(p.cool);
    (u.uRes!.value as THREE.Vector2).set(this.w, this.h);
    this.draw(this.comp, null);
    r.toneMapping = prevTone;
  }

  dispose(): void {
    for (const t of [this.hdr, ...this.mips, ...this.ups, this.shaftA, this.shaftB, this.blur, this.blur2, this.aoA, this.aoB]) t.dispose();
  }
}
