import * as THREE from 'three';
import { fbm, mulberry32 } from '../shared/noise';

/** Where the route runs: a gentle S through the foothills, rising toward the mountain (-z). */
export function pathX(z: number): number {
  return 3 * Math.sin(z * 0.045) + 1.5 * Math.sin(z * 0.11);
}

/**
 * Ground height at (x, z). The slope rises toward -z; the camp clearing at the origin is flat.
 * Around camp the valley opens into a wide, uneven meadow (Xander, 13 Oct: "mostly flat but with
 * unequal spaces, so we can see the sky while camping"): low hummocks and hollows, the walls
 * pushed back, so the sky, the clouds and the stars come down to a low horizon.
 */
export function groundHeight(x: number, z: number): number {
  const meadow = 1 - THREE.MathUtils.smoothstep(Math.hypot(x * 0.35, z), 80, 420);
  const slope = -z * 0.14 * (1 - meadow * 0.8);
  const hills = (fbm(x * 0.03 + 11, z * 0.03 + 7) - 0.5) * 14;
  const fromPath = Math.abs(x - pathX(z));
  // Toward the sunset (west and north-west, as the sky is turned) the hills stay low, a long
  // saddle, so the evening sun and its glow are seen from camp instead of a wall.
  const r = Math.hypot(x, z) || 1;
  const west = Math.max(0, (-x * 0.87 - z * 0.5) / r);
  const saddle = 1 - 0.95 * west * west * (1 - THREE.MathUtils.smoothstep(r, 1400, 2000));
  const valley = Math.pow(Math.max(0, fromPath - 3) * 0.09, 1.35) * 6 * (1 - meadow * 0.97) * saddle;
  const fine = (fbm(x * 0.35, z * 0.35, 2) - 0.5) * 0.35;
  // Hummocks and hollows: knee- to head-high, never under the camp or the path.
  const hummock = (fbm(x * 0.11 + 3, z * 0.11 + 5, 3) - 0.45) * 2.6 * meadow * THREE.MathUtils.smoothstep(Math.hypot(x, z), 7, 16);
  let h = slope + hills * Math.min(1, fromPath / 14) * (1 - meadow * 0.9) + valley + fine + hummock;
  // Flatten the camp clearing and the path so he walks on even ground.
  const camp = Math.hypot(x, z);
  const campBlend = THREE.MathUtils.smoothstep(camp, 4, 9);
  h = THREE.MathUtils.lerp(0.02 * fine, h, campBlend);
  const pathBlend = THREE.MathUtils.smoothstep(fromPath, 0.8, 2.6);
  const onPath = slope + (fbm(z * 0.05, 3) - 0.5) * 1.2 * Math.min(1, Math.abs(z) / 10);
  const out = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0, onPath, campBlend), h, pathBlend);
  // The valley walls level off into high, rolling shoulders instead of climbing without end:
  // unchanged below 200 m (everything the camp and the trail see), a soft ceiling above it, so
  // the year view looks over them rather than into a kilometre-high wall.
  if (out <= 200) return out;
  const ceiling = 110 + 90 * fbm(x * 0.004 + 5, z * 0.004 + 9, 2);
  return 200 + ceiling * (1 - Math.exp(-(out - 200) / ceiling));
}

const COL = {
  grassLow: new THREE.Color('#4c5332'),
  grassDry: new THREE.Color('#6f6338'),
  rock: new THREE.Color('#5a5650'),
  dirt: new THREE.Color('#5b4636'),
  snow: new THREE.Color('#d9dde4'),
  forest: new THREE.Color('#2c3826'),
};

function buildTerrain(): THREE.Mesh {
  const size = 360;
  const seg = 120;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -20);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
  }
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  const fp = flat.attributes.position as THREE.BufferAttribute;
  const fn = flat.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(fp.count * 3);
  // Where snow can lie: not on the trodden path or by the fire, patchy elsewhere.
  const snowK = new Float32Array(fp.count);
  const c = new THREE.Color();
  const rnd = mulberry32(7);
  for (let i = 0; i < fp.count; i += 3) {
    const cx = (fp.getX(i) + fp.getX(i + 1) + fp.getX(i + 2)) / 3;
    const cz = (fp.getZ(i) + fp.getZ(i + 1) + fp.getZ(i + 2)) / 3;
    const ny = (fn.getY(i) + fn.getY(i + 1) + fn.getY(i + 2)) / 3;
    const steep = 1 - ny;
    c.copy(COL.grassLow).lerp(COL.grassDry, fbm(cx * 0.05, cz * 0.05, 2) * 1.2 + rnd() * 0.15);
    if (steep > 0.22) c.lerp(COL.rock, THREE.MathUtils.smoothstep(steep, 0.22, 0.45));
    const dp = Math.abs(cx - pathX(cz));
    if (dp < 1.1 && cz < 160) c.lerp(COL.dirt, 1 - dp / 1.1);
    if (Math.hypot(cx, cz) < 3.2) c.lerp(COL.dirt, 0.7);
    const sk = dp < 1.1 && cz < 160 ? 0.25 : Math.hypot(cx, cz) < 2.2 ? 0 : 0.75 + 0.25 * fbm(cx * 0.2, cz * 0.2, 2);
    for (let k = 0; k < 3; k++) {
      colors.set([c.r, c.g, c.b], (i + k) * 3);
      snowK[i + k] = sk;
    }
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  flat.setAttribute('aSnow', new THREE.BufferAttribute(snowK, 1));
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  patchMaterial(groundMat, { snow: 1, tint: true, mask: true });
  const mesh = new THREE.Mesh(flat, groundMat);
  mesh.receiveShadow = true;
  return mesh;
}

/** `clear`: no cone trees within this radius of camp (a modelled forest stands there instead). */
function buildTrees(clear = 11): THREE.Group {
  const g = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.08, 0.12, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const crownGeo = new THREE.ConeGeometry(0.9, 2.6, 6);
  crownGeo.translate(0, 2.2, 0);
  const crown2 = new THREE.ConeGeometry(0.65, 1.8, 6);
  crown2.translate(0, 3.2, 0);
  const count = 340;
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#3b2c22', flatShading: true }), count);
  const crownMat = new THREE.MeshLambertMaterial({ color: '#28372c', flatShading: true });
  // Crowns sway in the shared wind: bent in world space by height, each tree on its own phase.
  swayInWind(crownMat, 1.0, 0.035, 1);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, count);
  const crowns2 = new THREE.InstancedMesh(crown2, crownMat, count);
  const rnd = mulberry32(21);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let n = 0;
  let guard = 0;
  while (n < count && guard++ < 20000) {
    const x = (rnd() - 0.5) * 300;
    const z = -170 + rnd() * 320;
    if (Math.abs(x - pathX(z)) < 4.5) continue;
    if (Math.hypot(x, z) < clear) continue;
    if (fbm(x * 0.02 + 40, z * 0.02, 2) < 0.48) continue; // clusters, not a carpet
    const scale = 0.8 + rnd() * 1.1;
    p.set(x, groundHeight(x, z) - 0.1, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
    s.set(scale, scale * (0.9 + rnd() * 0.3), scale);
    m.compose(p, q, s);
    trunks.setMatrixAt(n, m);
    crowns.setMatrixAt(n, m);
    crowns2.setMatrixAt(n, m);
    n++;
  }
  trunks.count = crowns.count = crowns2.count = n;
  // Trees near the camp catch firelight and cast shadow into it.
  g.add(trunks, crowns, crowns2);
  return g;
}

function buildRocks(): THREE.InstancedMesh {
  const geo = new THREE.DodecahedronGeometry(0.5, 0);
  const count = 120;
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#6b665e', flatShading: true }), count);
  const rnd = mulberry32(5);
  const m = new THREE.Matrix4();
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  let n = 0;
  let guard = 0;
  while (n < count && guard++ < 5000) {
    const x = (rnd() - 0.5) * 160;
    const z = -120 + rnd() * 240;
    if (Math.abs(x - pathX(z)) < 1.6) continue;
    if (Math.hypot(x, z) < 3.6) continue;
    const sc = 0.25 + rnd() * rnd() * 2.2;
    e.set(rnd() * 3, rnd() * 3, rnd() * 3);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, groundHeight(x, z) + sc * 0.15, z), q, new THREE.Vector3(sc, sc * 0.7, sc));
    mesh.setMatrixAt(n++, m);
  }
  mesh.count = n;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * The far range as one height-field, like the near terrain: Ambar's peak (with the Ninth Hut's light
 * near the top) and its shoulders. Faceted like the foreground, softened by distance fog.
 */
const AMBAR = { x: -120, z: -900, h: 360 };
const PEAKS: Array<{ x: number; z: number; h: number; s: number }> = [
  { x: AMBAR.x, z: AMBAR.z, h: AMBAR.h, s: 210 },
  { x: 230, z: -780, h: 210, s: 160 },
  { x: -440, z: -760, h: 190, s: 170 },
  { x: 140, z: -560, h: 110, s: 120 },
  { x: -260, z: -540, h: 100, s: 130 },
];

export function rangeHeight(x: number, z: number): number {
  let h = 0;
  for (const p of PEAKS) {
    const d = Math.hypot(x - p.x, z - p.z) / p.s;
    // A sharp-ish peak: exponential falloff, with ridges cut by noise.
    const ridge = 0.75 + 0.5 * fbm(x * 0.006 + p.x, z * 0.006 + p.z, 3);
    h = Math.max(h, p.h * Math.exp(-d * 1.6) * ridge);
  }
  return h - 40 + fbm(x * 0.01, z * 0.01, 3) * 40;
}

function buildMountains(): { group: THREE.Group; summit: THREE.Vector3 } {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1800, 760, 150, 64);
  geo.rotateX(-Math.PI / 2);
  geo.translate(-60, 0, -860);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, rangeHeight(pos.getX(i), pos.getZ(i)));
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  const fp = flat.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(fp.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < fp.count; i += 3) {
    const y = (fp.getY(i) + fp.getY(i + 1) + fp.getY(i + 2)) / 3;
    const x = fp.getX(i);
    const z = fp.getZ(i);
    const snowLine = 150 + (fbm(x * 0.02, z * 0.02, 2) - 0.5) * 50;
    c.set('#3b404d');
    if (y > snowLine) c.lerp(COL.snow, Math.min(0.9, (y - snowLine) / 40));
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.add(new THREE.Mesh(flat, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  const summit = new THREE.Vector3(AMBAR.x, rangeHeight(AMBAR.x, AMBAR.z) - 8, AMBAR.z + 14);
  return { group: g, summit };
}

/** Height anywhere on the map: the near terrain, the far range, and the midlands between. */
export function heightAt(x: number, z: number): number {
  if (z > -190) return groundHeight(x, z);
  if (z < -500) return rangeHeight(x, z);
  return midHeight(x, z);
}

/**
 * The midlands: the band between the near terrain and the far range, so the whole route can be
 * seen from above without a gap. Same faceted look and palette.
 */
function buildMidlands(): THREE.Mesh {
  // One wide ground from the foothills to the range: around and beyond the near terrain (which
  // sits on top of it), so the map has no edge from above.
  const geo = new THREE.PlaneGeometry(1560, 960, 120, 74);
  geo.rotateX(-Math.PI / 2);
  geo.translate(-40, 0, -30);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const inside = Math.abs(x) < 172 && z < 152 && z > -192;
    pos.setY(i, inside ? groundHeight(x, z) - 3 : heightAt(x, z));
  }
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  const fp = flat.attributes.position as THREE.BufferAttribute;
  const fn = flat.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(fp.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < fp.count; i += 3) {
    const cx = (fp.getX(i) + fp.getX(i + 1) + fp.getX(i + 2)) / 3;
    const cz = (fp.getZ(i) + fp.getZ(i + 1) + fp.getZ(i + 2)) / 3;
    const cy = (fp.getY(i) + fp.getY(i + 1) + fp.getY(i + 2)) / 3;
    const ny = (fn.getY(i) + fn.getY(i + 1) + fn.getY(i + 2)) / 3;
    c.copy(COL.grassLow).lerp(COL.grassDry, fbm(cx * 0.03, cz * 0.03, 2));
    // Rock on steep faces; height alone only greys it a little, so the high shoulders stay
    // land (grass, dark forest floor) seen from above, not a pale slab.
    if (cy > 170) c.lerp(COL.forest, 0.55 * fbm(cx * 0.02 + 7, cz * 0.02 + 3, 2));
    c.lerp(COL.rock, THREE.MathUtils.clamp((1 - ny) * 2.4 + Math.min(0.3, (cy - 60) / 500), 0, 1));
    // Snow only on the high shoulders, patchy, so the walls read as land from above.
    const snowLine = 345 + (fbm(cx * 0.01 + 2, cz * 0.01, 2) - 0.5) * 70;
    if (cy > snowLine) c.lerp(COL.snow, Math.min(0.6, (cy - snowLine) / 60));
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const midMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  patchMaterial(midMat, { snow: 0.9, tint: true });
  const mesh = new THREE.Mesh(flat, midMat);
  mesh.receiveShadow = false;
  return mesh;
}

function midHeight(x: number, z: number): number {
  // Continue the near slope's rise, then hand over to the range.
  const t = THREE.MathUtils.smoothstep(z, -180, -500);
  const slope = -z * 0.14 + (fbm(x * 0.012 + 3, z * 0.012, 3) - 0.5) * 40;
  return THREE.MathUtils.lerp(slope, rangeHeight(x, z), t);
}

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  if (ctx) {
    const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, inner);
    gr.addColorStop(1, outer);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const glowTexture = (): THREE.CanvasTexture => radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');

/** A round particle with a soft rim: points drawn with it read as flakes and sparks, not squares. */
let dot: THREE.CanvasTexture | null = null;
export function dotTexture(): THREE.CanvasTexture {
  if (dot) return dot;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(16, 16, 16, 0, Math.PI * 2);
  g.fill();
  dot = new THREE.CanvasTexture(c);
  return dot;
}

/**
 * The sky dome: gradient, the sun's glow and disc, crepuscular rays fanning from a low sun, and
 * the moon as a small sphere lit by the sun, so its phase and the tilt of the crescent are real.
 */
function buildSky(): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(1800, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color('#141a33') },
      mid: { value: new THREE.Color('#4a3a5c') },
      horizon: { value: new THREE.Color('#d8875a') },
      sunDir: { value: new THREE.Vector3(-0.9, 0.05, -0.4).normalize() },
      sunColor: { value: new THREE.Color('#ff9a5c') },
      sunDisc: { value: 0 },
      moonDir: { value: new THREE.Vector3(0.5, 0.6, 0.3).normalize() },
      moonI: { value: 0 },
      moonLit: { value: 1 },
      rays: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunDisc; uniform vec3 moonDir; uniform float moonI; uniform float moonLit; uniform float rays; varying vec3 vDir;
      vec2 basis(vec3 d, vec3 c, float r, out float along){ vec3 t = normalize(cross(c, vec3(0.0001, 1.0, 0.0))); vec3 b = cross(t, c); along = dot(d, c); vec3 o = d - c * along; return vec2(dot(o, t), dot(o, b)) / r; }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, zenith, smoothstep(0.12, 0.65, h));
        float s = max(dot(d, sunDir), 0.0);
        float low = 1.0 - smoothstep(0.0, 0.45, h);
        col += sunColor * (pow(s, 6.0) * 0.45 * low + pow(s, 48.0) * 0.35 * sunDisc);
        col += sunColor * smoothstep(0.99935, 0.9997, s) * sunDisc * 1.6;
        if (rays > 0.001) {
          float al; vec2 q = basis(d, sunDir, 1.0, al);
          float a = atan(q.y, q.x);
          float st = (0.5 + 0.5 * sin(a * 17.0 + sin(a * 5.0) * 3.0)) * (0.55 + 0.45 * sin(a * 43.0 + 1.7));
          col += sunColor * st * pow(s, 2.5) * (1.0 - smoothstep(0.995, 0.9995, s)) * rays * (0.25 + low * 0.6);
        }
        if (moonI > 0.001) {
          float m; vec2 uv = basis(d, moonDir, 0.021, m);
          float r2 = dot(uv, uv);
          if (r2 < 1.0 && m > 0.0) {
            vec3 t = normalize(cross(moonDir, vec3(0.0001, 1.0, 0.0))); vec3 b = cross(t, moonDir);
            vec3 n = normalize(uv.x * t + uv.y * b - sqrt(1.0 - r2) * moonDir);
            float lit = smoothstep(-0.04, 0.1, dot(n, sunDir));
            float maria = 0.8 + 0.2 * sin(uv.x * 5.0 + 1.3) * sin(uv.y * 4.0 + 0.4);
            col = mix(col, vec3(0.93, 0.95, 1.0) * maria * (0.05 + lit * 1.1) * min(1.0, moonI), smoothstep(1.0, 0.82, r2));
          }
          col += vec3(0.22, 0.27, 0.42) * (pow(max(m, 0.0), 300.0) * 0.6 + pow(max(m, 0.0), 30.0) * 0.12) * moonI * moonLit;
        }
        if (h < 0.0) col = mix(horizon * 0.6, horizon, 1.0 + h * 5.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  g.add(new THREE.Mesh(geo, mat));
  g.add(buildStars());
  return g;
}

/**
 * The night sky: about 2,600 stars of different brightness and colour, a faint Milky Way, all
 * turning slowly about the pole (the stage sets the rotation from the hour). Drawn before the
 * clouds, so clouds cover them.
 */
function buildStars(): THREE.Points {
  const rnd = mulberry32(3);
  const pos: number[] = [];
  const size: number[] = [];
  const tw: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const put = (x: number, y: number, z: number, sz: number, hue: number): void => {
    const l = Math.hypot(x, y, z);
    pos.push((x / l) * 1700, (y / l) * 1700, (z / l) * 1700);
    size.push(sz);
    tw.push(rnd());
    c.setHSL(hue, 0.55, 0.85);
    col.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < 2600; i++) {
    const y = rnd() * 1.15 - 0.15;
    const th = rnd() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const bright = Math.pow(rnd(), 7);
    put(Math.cos(th) * r, y, Math.sin(th) * r, 3.0 + bright * 6.0, rnd() < 0.3 ? 0.08 : 0.6);
  }
  // The Milky Way: dust of faint points along a tilted great circle, and a few soft clouds.
  const n = new THREE.Vector3(0.62, 0.3, 0.72).normalize();
  const t = new THREE.Vector3(1, 0, 0).cross(n).normalize();
  const b = n.clone().cross(t);
  for (let i = 0; i < 1700; i++) {
    const a = rnd() * Math.PI * 2;
    const spread = (rnd() + rnd() + rnd() - 1.5) * 0.16;
    const p = t.clone().multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a)).addScaledVector(n, spread);
    const cloud = i % 12 === 0;
    put(p.x, p.y, p.z, cloud ? 26 + rnd() * 34 : 2.0 + rnd() * 1.4, cloud ? 0.62 : 0.58);
    if (cloud) tw[tw.length - 1] = -1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  g.setAttribute('aTw', new THREE.Float32BufferAttribute(tw, 1));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: { opacity: { value: 0 }, time: { value: 0 }, pr: { value: 1 } },
    vertexShader: `attribute float aSize; attribute float aTw; attribute vec3 aCol; uniform float time; uniform float pr; varying vec3 vCol; varying float vA;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float el = wp.y / 1700.0;
        bool cloud = aTw < 0.0;
        float tw = cloud ? 1.0 : 0.72 + 0.28 * sin(time * (1.3 + aTw * 2.5) + aTw * 40.0);
        vA = smoothstep(0.0, 0.14, el) * tw * (cloud ? 0.16 : 1.5) * (1.0 - 0.45 * smoothstep(0.1, 0.0, el));
        vCol = aCol;
        gl_PointSize = aSize * pr;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `uniform float opacity; varying vec3 vCol; varying float vA;
      void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r); a = max(a * a, step(r, 0.16) * 0.9); gl_FragColor = vec4(vCol * a * vA * opacity, 1.0); }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.renderOrder = -3;
  pts.frustumCulled = false;
  return pts;
}

/** Shared by every tree crown and by the weather on the ground: the wind, time, snow, wetness, the season's tint. */
export const treeWind = { wind: { value: new THREE.Vector2(0, 0) }, time: { value: 0 } };
export const weatherFx = { snow: { value: 0 }, wet: { value: 0 }, tint: { value: new THREE.Color(1, 1, 1) } };

export interface Patch {
  /** Bend with the wind: [base height, strength]. */
  sway?: [number, number];
  /** Snow settles on upward faces, times this. */
  snow?: number;
  /** The season's tint (ground only). */
  tint?: boolean;
  /** A per-vertex `aSnow` attribute masks the snow (the path stays trodden). */
  mask?: boolean;
}

/**
 * One shader patch for the world's Lambert materials: the wind bends crowns, snow settles on what
 * faces up, rain darkens, the season tints the ground. Uniforms are shared, so weather changes
 * cost nothing per material.
 */
export function patchMaterial(mat: THREE.Material, o: Patch): void {
  mat.userData.patched = true;
  mat.onBeforeCompile = (shader) => {
    let vs = shader.vertexShader;
    let fs = shader.fragmentShader;
    if (o.sway) {
      shader.uniforms.uWind = treeWind.wind;
      shader.uniforms.uTime = treeWind.time;
      vs = vs.replace('void main() {', 'uniform vec2 uWind; uniform float uTime;\nvoid main() {').replace(
        '#include <project_vertex>',
        THREE.ShaderChunk.project_vertex.replace(
          'mvPosition = modelViewMatrix * mvPosition;',
          `vec4 wp = modelMatrix * mvPosition;
          float hgt = max(0.0, transformed.y - ${o.sway[0].toFixed(3)});
          float ph = wp.x * 0.13 + wp.z * 0.11;
          wp.xz += uWind * hgt * hgt * ${o.sway[1].toFixed(4)} * (0.65 + 0.35 * sin(uTime * 1.9 + ph));
          mvPosition = viewMatrix * wp;`,
        ),
      );
    }
    if (o.snow !== undefined) {
      shader.uniforms.uSnow = weatherFx.snow;
      shader.uniforms.uWet = weatherFx.wet;
      shader.uniforms.uTint = weatherFx.tint;
      vs = vs
        .replace('void main() {', `varying float vUp;${o.mask ? ' attribute float aSnow; varying float vMask;' : ''}\nvoid main() {`)
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          vec3 wn = objectNormal;
          #ifdef USE_INSTANCING
          wn = mat3(instanceMatrix) * wn;
          #endif
          vUp = normalize(mat3(modelMatrix) * wn).y;${o.mask ? ' vMask = aSnow;' : ''}`,
        );
      fs = fs.replace('void main() {', `uniform float uSnow; uniform float uWet; uniform vec3 uTint; varying float vUp;${o.mask ? ' varying float vMask;' : ''}\nvoid main() {`).replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        ${o.tint ? 'diffuseColor.rgb *= uTint;' : ''}
        diffuseColor.rgb *= 1.0 - uWet * 0.3;
        float sn = clamp((uSnow * 1.3 - (1.0 - vUp) * 2.2${o.mask ? ' - (1.0 - vMask) * 1.2' : ''}) * 2.5, 0.0, 1.0) * ${o.snow.toFixed(2)};
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.95), sn);`,
      );
    }
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `patch-${JSON.stringify(o)}`;
}

/** Bend a material's vertices with the shared wind, by height above `base` squared times `k`. */
export function swayInWind(mat: THREE.Material, base: number, k: number, snow?: number): void {
  patchMaterial(mat, snow === undefined ? { sway: [base, k] } : { sway: [base, k], snow });
}

export interface World {
  group: THREE.Group;
  /** The sky shader's sun and moon. */
  skySun: { dir: THREE.Vector3; color: THREE.Color; disc: { value: number }; moonDir: THREE.Vector3; moonI: { value: number }; moonLit: { value: number }; rays: { value: number } };
  summitLight: THREE.Sprite;
  /** The sky dome's colours, for time of day. */
  sky: { zenith: THREE.Color; mid: THREE.Color; horizon: THREE.Color };
  stars: THREE.Points;
  starU: { opacity: { value: number }; time: { value: number }; pr: { value: number } };
  update(t: number): void;
}

export function buildWorld(scene: THREE.Scene, opts: { nearForest?: number } = {}): World {
  const group = new THREE.Group();
  const skyGroup = buildSky();
  group.add(skyGroup);
  const skyMat = (skyGroup.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
  const stars = skyGroup.children[1] as THREE.Points;
  group.add(buildTerrain());
  group.add(buildTrees(opts.nearForest ?? 11));
  group.add(buildRocks());
  const { group: mountains, summit } = buildMountains();
  group.add(mountains);
  group.add(buildMidlands());

  // The Ninth Hut's light: a small lamp near the summit that signals the weather every dusk.
  const summitLight = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: '#7dffb0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  summitLight.position.copy(summit);
  summitLight.scale.setScalar(26);
  group.add(summitLight);

  scene.add(group);
  return {
    group,
    summitLight,
    sky: { zenith: skyMat.uniforms.zenith!.value as THREE.Color, mid: skyMat.uniforms.mid!.value as THREE.Color, horizon: skyMat.uniforms.horizon!.value as THREE.Color },
    stars,
    starU: (stars.material as THREE.ShaderMaterial).uniforms as World['starU'],
    skySun: {
      dir: skyMat.uniforms.sunDir!.value as THREE.Vector3,
      color: skyMat.uniforms.sunColor!.value as THREE.Color,
      disc: skyMat.uniforms.sunDisc as { value: number },
      moonDir: skyMat.uniforms.moonDir!.value as THREE.Vector3,
      moonI: skyMat.uniforms.moonI as { value: number },
      moonLit: skyMat.uniforms.moonLit as { value: number },
      rays: skyMat.uniforms.rays as { value: number },
    },
    update(t: number) {
      // Two slow green flashes every 7 seconds, then a faint steady glow.
      const cycle = t % 7;
      const flash = (s: number): number => Math.exp(-Math.pow((cycle - s) / 0.25, 2));
      const k = Math.max(flash(1.0), flash(1.9));
      const mat = summitLight.material;
      mat.opacity = 0.5 + k * 0.5;
      summitLight.scale.setScalar(24 + k * 40);
    },
  };
}
