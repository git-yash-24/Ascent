/**
 * The meadow's grass as a field of individual blades (art direction: "alive"). One instanced
 * mesh, every blade a curved, tapering strip of five segments, drawn with the world's painted
 * Lambert so it takes the sun, the moon, the fire, shadows and fog like everything else.
 *
 * In the vertex shader:
 *   wind     the shared wind bends every blade, and gusts roll across the meadow as visible waves
 *   flutter  each blade trembles on its own phase
 *   part     grass leans away from Ari's feet and the trodden ground round the fire
 *   snow     blades sink under lying snow (the shared `grow`)
 * In the fragment shader:
 *   colour   dark cool roots to warm light tips, patches of lush, dry and sun-bleached grass
 *   light    tips glow when the sun is behind them (translucency), the classic backlit meadow
 */
import * as THREE from 'three';
import { fbm, mulberry32 } from '../prototype/shared/noise';
import { groundHeight, pathX, treeWind, weatherFx } from '../prototype/feel3d/world';

export const grassU = {
  /** Ari's feet (x, z) and how far the grass parts round them. */
  uPush: { value: new THREE.Vector3(0, -1.12, 0.55) },
  /** The season's grass colour, multiplied in (green spring, gold late summer, rust autumn). */
  uSeason: { value: new THREE.Color(1, 1, 1) },
};

function bladeGeometry(): THREE.BufferGeometry {
  const SEG = 5;
  const pos: number[] = [];
  const idx: number[] = [];
  const h: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    // Wide at the root, tapering to a point; a gentle forward curve built in.
    const w = 0.022 * (1 - t * 0.92) * (t < 0.15 ? 0.75 + t * 1.6 : 1);
    const z = t * t * 0.12;
    if (i < SEG) {
      pos.push(-w, t, z, w, t, z);
      h.push(t, t);
    } else {
      pos.push(0, 1, z);
      h.push(1);
    }
  }
  for (let i = 0; i < SEG - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (SEG - 1) * 2;
  idx.push(last, last + 1, last + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(h, 1));
  // Normals tilted up: a meadow shades as one soft surface, not as thousands of cards.
  const n: number[] = [];
  for (let i = 0; i < pos.length / 3; i++) n.push(0, 0.85, 0.5);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setIndex(idx);
  return g;
}

/** Somewhere grass can grow: not the path, the fire ring, the tent or the seats. */
const KEEP_CLEAR: Array<[number, number, number]> = [
  [-0.98, -0.72, 0.4], // the food cloth
  [0.66, 0.24, 0.35], // the kettle's stone
  [0.62, -0.95, 0.38], // her pack
  [1.08, -1.32, 0.25], // the rope
  [-2.75, 0.55, 0.55], // the chopping stump and chips
  [0.95, -0.25, 0.2], // the drying stick
  [1.9, 0.5, 0.6], // the carving rock
];
function free(x: number, z: number): boolean {
  if (Math.abs(x - pathX(z)) < 0.75) return false;
  if (Math.hypot(x + 2.3, z + 2.1) < 1.45) return false;
  if (Math.hypot(x, z) < 1.6) return false;
  if (Math.abs(x) < 0.9 && Math.abs(z + 1.12) < 0.38) return false; // Ari's log
  if (Math.abs(x - 0.25) < 0.8 && Math.abs(z - 1.3) < 0.38) return false; // your log
  for (const [cx, cz, r] of KEEP_CLEAR) if (Math.hypot(x - cx, z - cz) < r) return false;
  return true;
}

export interface GrassField {
  mesh: THREE.InstancedMesh;
  max: number;
}

export function buildGrassField(count: number): GrassField {
  const rnd = mulberry32(911);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: false, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = treeWind.wind;
    sh.uniforms.uTime = treeWind.time;
    sh.uniforms.uGrow = weatherFx.grow;
    sh.uniforms.uSnow = weatherFx.snow;
    sh.uniforms.uWet = weatherFx.wet;
    sh.uniforms.uPush = grassU.uPush;
    sh.uniforms.uSeason = grassU.uSeason;
    sh.vertexShader = sh.vertexShader
      .replace(
        'void main() {',
        `attribute float aH;
        uniform vec2 uWind; uniform float uTime; uniform float uGrow; uniform vec3 uPush;
        varying float vH; varying vec3 vTint;
        void main() {`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3( position );
        vH = aH;
        #ifdef USE_INSTANCING_COLOR
        vTint = instanceColor;
        #else
        vTint = vec3(1.0);
        #endif`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 wp = modelMatrix * instanceMatrix * vec4( transformed.x, transformed.y * uGrow, transformed.z, 1.0 );
        vec4 root = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
        float bladeH = max( 0.01, wp.y - root.y );
        float k = aH * aH;
        // Gusts: two waves rolling downwind, a stronger one now and then.
        float ws = length( uWind );
        vec2 wd = ws > 0.0001 ? uWind / ws : vec2( 1.0, 0.0 );
        float along = dot( root.xz, wd );
        float gust = 0.5 + 0.5 * sin( along * 0.42 - uTime * 2.3 ) * sin( along * 0.11 - uTime * 0.7 + root.x * 0.05 );
        gust = gust * gust;
        float bend = ( 0.18 + ws * 1.6 ) * ( 0.35 + gust * 1.3 );
        float flutter = sin( uTime * ( 3.0 + fract( root.x * 13.7 ) * 3.0 ) + root.z * 5.1 ) * 0.06 * ( 0.4 + ws );
        vec2 off = wd * bend * 0.32 + vec2( flutter, flutter * 0.6 );
        // Parting round Ari's feet and the hearth.
        vec2 fromAri = root.xz - uPush.xy;
        float dA = length( fromAri );
        off += ( dA > 0.001 ? fromAri / dA : vec2( 0.0 ) ) * smoothstep( uPush.z + 0.35, 0.0, dA ) * 0.45;
        float dF = length( root.xz );
        off += ( dF > 0.001 ? root.xz / dF : vec2( 0.0 ) ) * smoothstep( 1.9, 1.1, dF ) * 0.25;
        wp.xz += off * k * bladeH;
        // Keep the blade's length: bending lowers the tip.
        wp.y -= length( off ) * k * bladeH * 0.35;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;`,
      )
      .replace('#include <worldpos_vertex>', `vec4 worldPosition = wp;`);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        'void main() {',
        `uniform float uSnow; uniform float uWet; uniform vec3 uSeason;
        varying float vH; varying vec3 vTint;
        void main() {`,
      )
      .replace(
        '#include <color_fragment>',
        `vec3 rootC = vec3( 0.12, 0.2, 0.09 );
        vec3 midC = vec3( 0.32, 0.46, 0.16 );
        vec3 tipC = vec3( 0.78, 0.78, 0.38 );
        vec3 g = mix( rootC, midC, smoothstep( 0.0, 0.45, vH ) );
        g = mix( g, tipC, smoothstep( 0.45, 1.0, vH ) );
        diffuseColor.rgb = g * vTint * uSeason;
        diffuseColor.rgb *= 1.0 - uWet * 0.25;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.86, 0.9, 0.96 ), clamp( uSnow * 1.4 - 0.2, 0.0, 1.0 ) * smoothstep( 0.3, 1.0, vH ) );`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        #if defined( STYLE_LIT ) && NUM_DIR_LIGHTS > 0
        {
          // Translucency: the sun shining through the blades from behind.
          vec3 L = directionalLights[ 0 ].direction;
          vec3 V = normalize( vViewPosition );
          float back = pow( max( dot( -V, L ), 0.0 ), 3.0 );
          reflectedLight.directDiffuse += directionalLights[ 0 ].color * diffuseColor.rgb * back * smoothstep( 0.35, 1.0, vH ) * 1.6;
        }
        #endif
        // A little ambient occlusion down at the roots.
        reflectedLight.indirectDiffuse *= 0.55 + 0.45 * smoothstep( 0.0, 0.5, vH );
        reflectedLight.directDiffuse *= 0.65 + 0.35 * smoothstep( 0.0, 0.35, vH );`,
      );
  };
  mat.customProgramCacheKey = () => 'grass-field-v1';

  const mesh = new THREE.InstancedMesh(bladeGeometry(), mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const tilt = new THREE.Quaternion();
  const c = new THREE.Color();
  const lush = new THREE.Color(0.92, 1.08, 0.86);
  const dry = new THREE.Color(1.25, 1.05, 0.7);
  const pale = new THREE.Color(1.15, 1.12, 0.95);
  let n = 0;
  let guard = 0;
  while (n < count && guard++ < count * 6) {
    // Denser close in (where the camera looks), out to the meadow's edge.
    const a = rnd() * Math.PI * 2;
    const d = 1.2 + Math.pow(rnd(), 0.75) * 38;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!free(x, z)) continue;
    const dens = fbm(x * 0.18 + 7, z * 0.18 + 3, 3);
    if (dens < 0.36 - (d > 10 ? 0.06 : 0)) continue;
    // Trodden near the fire, knee-high in the lush hollows further out.
    const trodden = THREE.MathUtils.smoothstep(Math.hypot(x, z), 1.6, 5.5);
    if (trodden < 0.5 && rnd() > 0.35 + trodden) continue;
    const tall = (0.22 + rnd() * 0.24) * (0.28 + 0.72 * trodden) * (0.8 + dens * 0.9) * (d > 9 ? 1.25 : 1);
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    tilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (rnd() - 0.5) * 0.5);
    q.multiply(tilt);
    const w = 0.8 + rnd() * 0.7;
    m.compose(new THREE.Vector3(x, groundHeight(x, z) - 0.02, z), q, new THREE.Vector3(w, tall, w));
    mesh.setMatrixAt(n, m);
    // Patches: lush green in the hollows, dry gold on the rises, a few pale bleached blades.
    const patch = fbm(x * 0.07 + 31, z * 0.07 + 11, 2);
    c.setRGB(1, 1, 1).lerp(lush, THREE.MathUtils.smoothstep(dens, 0.5, 0.75)).lerp(dry, THREE.MathUtils.smoothstep(patch, 0.52, 0.72) * 0.9);
    if (rnd() < 0.06) c.lerp(pale, 0.7);
    c.multiplyScalar(0.88 + rnd() * 0.24);
    mesh.setColorAt(n, c);
    n++;
  }
  mesh.count = n;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  return { mesh, max: n };
}
