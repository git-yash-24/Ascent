import * as THREE from 'three';
import { fbm, mulberry32 } from '../shared/noise';

/** Where the route runs: a gentle S through the foothills, rising toward the mountain (-z). */
export function pathX(z: number): number {
  return 3 * Math.sin(z * 0.045) + 1.5 * Math.sin(z * 0.11);
}

/** Ground height at (x, z). The slope rises toward -z; the camp clearing at the origin is flat. */
export function groundHeight(x: number, z: number): number {
  const slope = -z * 0.14;
  const hills = (fbm(x * 0.03 + 11, z * 0.03 + 7) - 0.5) * 14;
  const fromPath = Math.abs(x - pathX(z));
  const valley = Math.pow(Math.max(0, fromPath - 3) * 0.09, 1.35) * 6;
  const fine = (fbm(x * 0.35, z * 0.35, 2) - 0.5) * 0.35;
  let h = slope + hills * Math.min(1, fromPath / 14) + valley + fine;
  // Flatten the camp clearing and the path so he walks on even ground.
  const camp = Math.hypot(x, z);
  const campBlend = THREE.MathUtils.smoothstep(camp, 4, 9);
  h = THREE.MathUtils.lerp(0.02 * fine, h, campBlend);
  const pathBlend = THREE.MathUtils.smoothstep(fromPath, 0.8, 2.6);
  const onPath = slope + (fbm(z * 0.05, 3) - 0.5) * 1.2 * Math.min(1, Math.abs(z) / 10);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(0, onPath, campBlend), h, pathBlend);
}

const COL = {
  grassLow: new THREE.Color('#4c5332'),
  grassDry: new THREE.Color('#6f6338'),
  rock: new THREE.Color('#5a5650'),
  dirt: new THREE.Color('#5b4636'),
  snow: new THREE.Color('#d9dde4'),
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
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(flat, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.receiveShadow = true;
  return mesh;
}

function buildTrees(): THREE.Group {
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
    if (Math.hypot(x, z) < 11) continue;
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
    c.lerp(COL.rock, THREE.MathUtils.clamp((1 - ny) * 2.4 + (cy - 60) / 160, 0, 1));
    if (cy > 150) c.lerp(COL.snow, Math.min(0.8, (cy - 150) / 50));
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(flat, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
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

/** Dusk sky: a gradient dome plus faint first stars. */
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
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, zenith, smoothstep(0.12, 0.65, h));
        float sun = pow(max(dot(normalize(vDir), sunDir), 0.0), 6.0);
        col += vec3(0.55, 0.28, 0.12) * sun * (1.0 - smoothstep(0.0, 0.35, h));
        if (h < 0.0) col = mix(horizon * 0.6, horizon, 1.0 + h * 5.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  g.add(new THREE.Mesh(geo, mat));
  const rnd = mulberry32(3);
  const starPos: number[] = [];
  for (let i = 0; i < 500; i++) {
    const th = rnd() * Math.PI * 2;
    const y = 0.35 + rnd() * 0.65;
    const r = Math.sqrt(1 - y * y);
    starPos.push(Math.cos(th) * r * 1700, y * 1700, Math.sin(th) * r * 1700);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#cfd6ff', size: 2.6, sizeAttenuation: false, map: dotTexture(), transparent: true, opacity: 0.55, fog: false, depthWrite: false }));
  g.add(stars);
  return g;
}

export interface World {
  group: THREE.Group;
  summitLight: THREE.Sprite;
  /** The sky dome's colours, for time of day. */
  sky: { zenith: THREE.Color; mid: THREE.Color; horizon: THREE.Color };
  stars: THREE.PointsMaterial;
  update(t: number): void;
}

export function buildWorld(scene: THREE.Scene): World {
  const group = new THREE.Group();
  const skyGroup = buildSky();
  group.add(skyGroup);
  const skyMat = (skyGroup.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
  const starMat = (skyGroup.children[1] as THREE.Points).material as THREE.PointsMaterial;
  group.add(buildTerrain());
  group.add(buildTrees());
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
    stars: starMat,
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
