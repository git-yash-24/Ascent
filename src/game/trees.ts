/**
 * Trees in the painted style (art direction): built in code, instanced, one draw call per kind.
 *
 *   fir        a trunk and six drooping tiers with jagged, feathered skirts; dark inside, light
 *              at the tips; normals pushed out from the trunk so each tree shades as one soft form
 *   broadleaf  a forked trunk and a canopy of lumpy cloud-like blobs; the canopy turns gold and
 *              rust in autumn and falls bare in winter
 *   bush       a low cluster of blobs at the clearing's edge
 *
 * Every tree sways in the shared wind (by height, each on its own phase), and snow settles on
 * what faces up. Presentation only.
 */
import * as THREE from 'three';
import { fbm, mulberry32 } from '../prototype/shared/noise';
import { STREAM_HALF, groundHeight, pathX, streamDistance, treeWind, weatherFx } from '../prototype/feel3d/world';

export const treeU = {
  /** The broadleaf canopy's colour this season (multiplied with each tree's own tint). */
  uLeaf: { value: new THREE.Color('#6f9a44') },
  /** 0 full canopy, 1 bare (winter): the canopy shrinks into the branches. */
  uBare: { value: 0 },
};

interface Parts {
  pos: number[];
  nor: number[];
  col: number[];
  leaf: number[];
  idx: number[];
}

const parts = (): Parts => ({ pos: [], nor: [], col: [], leaf: [], idx: [] });

function addGeometry(p: Parts, g: THREE.BufferGeometry, color: (pos: THREE.Vector3, n: THREE.Vector3) => THREE.Color, leaf: number, normal?: (pos: THREE.Vector3, n: THREE.Vector3) => THREE.Vector3): void {
  const gp = g.attributes.position as THREE.BufferAttribute;
  const gn = g.attributes.normal as THREE.BufferAttribute;
  const base = p.pos.length / 3;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < gp.count; i++) {
    v.fromBufferAttribute(gp, i);
    n.fromBufferAttribute(gn, i);
    const nn = normal ? normal(v, n) : n;
    const c = color(v, n);
    p.pos.push(v.x, v.y, v.z);
    p.nor.push(nn.x, nn.y, nn.z);
    p.col.push(c.r, c.g, c.b);
    p.leaf.push(leaf);
  }
  const index = g.index;
  if (index) for (let i = 0; i < index.count; i++) p.idx.push(base + index.getX(i));
  else for (let i = 0; i < gp.count; i++) p.idx.push(base + i);
}

function build(p: Parts): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(p.col, 3));
  g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(p.leaf, 1));
  g.setIndex(p.idx);
  return g;
}

/** A fir of height 1: trunk plus drooping, jagged tiers. */
export function firGeometry(seed: number, tiers = 6, radial = 12): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const p = parts();
  const bark = new THREE.Color('#4a3020');
  const trunk = new THREE.CylinderGeometry(0.018, 0.035, 0.34, 7);
  trunk.translate(0, 0.17, 0);
  addGeometry(p, trunk, () => bark, 0);
  const dark = new THREE.Color('#1c3424');
  const mid = new THREE.Color('#2f5a3a');
  const tip = new THREE.Color('#6f9a5a');
  for (let t = 0; t < tiers; t++) {
    const u = t / (tiers - 1);
    const y0 = 0.16 + u * 0.66;
    const h = 0.3 - u * 0.12;
    const r = 0.27 * (1 - u * 0.78) + 0.03;
    const pos: number[] = [];
    const idx: number[] = [];
    // Apex, an outer jagged skirt that droops, and an inner underside ring back to the trunk.
    pos.push(0, y0 + h, 0);
    const phase = rnd() * 6.28;
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2 + phase;
      const jag = i % 2 === 0 ? 1 : 0.78 + rnd() * 0.08;
      const rr = r * jag * (0.92 + rnd() * 0.16);
      pos.push(Math.cos(a) * rr, y0 - (jag > 0.9 ? 0.04 : 0.015) + (rnd() - 0.5) * 0.015, Math.sin(a) * rr);
    }
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2 + phase;
      pos.push(Math.cos(a) * r * 0.35, y0 + h * 0.12, Math.sin(a) * r * 0.35);
    }
    for (let i = 0; i < radial; i++) {
      const a = 1 + i;
      const b = 1 + ((i + 1) % radial);
      idx.push(0, b, a);
      const ia = 1 + radial + i;
      const ib = 1 + radial + ((i + 1) % radial);
      idx.push(a, b, ib, a, ib, ia);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    addGeometry(
      p,
      g,
      (v) => {
        const out = Math.min(1, Math.hypot(v.x, v.z) / Math.max(0.001, r));
        const top = (v.y - y0) / h;
        const c = dark.clone().lerp(mid, Math.min(1, out * 0.8 + top * 0.5));
        return c.lerp(tip, Math.max(0, out - 0.75) * 2.2 * (0.6 + u * 0.4));
      },
      0.5,
      (v, n) => {
        // Push the normal out from the trunk and up: one soft, rounded form.
        const out = new THREE.Vector3(v.x, (v.y - 0.45) * 0.35 + 0.25, v.z).normalize();
        return n.clone().lerp(out, 0.7).normalize();
      },
    );
  }
  return build(p);
}

/** A broadleaf of height 1: a forked trunk and a canopy of lumpy blobs. */
export function broadleafGeometry(seed: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const p = parts();
  const bark = new THREE.Color('#5a4030');
  const trunk = new THREE.CylinderGeometry(0.022, 0.045, 0.5, 8);
  trunk.translate(0, 0.25, 0);
  addGeometry(p, trunk, () => bark, 0);
  for (const s of [-1, 1]) {
    const br = new THREE.CylinderGeometry(0.012, 0.022, 0.28, 6);
    br.translate(0, 0.14, 0);
    br.rotateZ(s * 0.6);
    br.translate(0, 0.42, 0);
    addGeometry(p, br, () => bark, 0);
  }
  const centre = new THREE.Vector3(0, 0.7, 0);
  const n = 6 + Math.floor(rnd() * 3);
  const shade = new THREE.Color(0.55, 0.62, 0.6);
  const lit = new THREE.Color(1.15, 1.12, 0.95);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd();
    const up = rnd();
    const c = new THREE.Vector3(Math.cos(a) * 0.17 * (1 - up * 0.5), 0.6 + up * 0.25, Math.sin(a) * 0.17 * (1 - up * 0.5));
    if (i === 0) c.set(0, 0.85, 0);
    const r = 0.13 + rnd() * 0.07 + (i === 0 ? 0.04 : 0);
    const blob = new THREE.IcosahedronGeometry(r, 2);
    const bp = blob.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < bp.count; k++) {
      const x = bp.getX(k);
      const y = bp.getY(k);
      const z = bp.getZ(k);
      const s = 1 + (fbm(x * 9 + seed + i, y * 9 + z * 7, 2) - 0.5) * 0.45;
      bp.setXYZ(k, x * s + c.x, y * s * 0.9 + c.y, z * s + c.z);
    }
    blob.computeVertexNormals();
    addGeometry(
      p,
      blob,
      (v) => shade.clone().lerp(lit, THREE.MathUtils.clamp((v.y - 0.5) * 2.4, 0, 1)),
      1,
      (v, nn) => nn.clone().lerp(v.clone().sub(centre).normalize(), 0.75).normalize(),
    );
  }
  return build(p);
}

/** A bush: a low cluster of blobs, unit size. */
export function bushGeometry(seed: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const p = parts();
  const centre = new THREE.Vector3(0, 0.25, 0);
  const shade = new THREE.Color('#284a2a');
  const lit = new THREE.Color('#7aa04e');
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd();
    const c = new THREE.Vector3(Math.cos(a) * 0.22, 0.2 + rnd() * 0.12, Math.sin(a) * 0.22);
    if (i === 0) c.set(0, 0.34, 0);
    const blob = new THREE.IcosahedronGeometry(0.24 + rnd() * 0.08, 1);
    const bp = blob.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < bp.count; k++) {
      const s = 1 + (fbm(bp.getX(k) * 6 + seed, bp.getY(k) * 6 + bp.getZ(k) * 5 + i, 2) - 0.5) * 0.4;
      bp.setXYZ(k, bp.getX(k) * s + c.x, bp.getY(k) * s * 0.8 + c.y, bp.getZ(k) * s + c.z);
    }
    blob.computeVertexNormals();
    addGeometry(p, blob, (v) => shade.clone().lerp(lit, THREE.MathUtils.clamp(v.y * 1.6, 0, 1)), 0.5, (v, nn) => nn.clone().lerp(v.clone().sub(centre).normalize(), 0.7).normalize());
  }
  return build(p);
}

/** The shared tree material: painted Lambert with wind sway, seasons and snow. */
export function treeMaterial(sway: number): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = treeWind.wind;
    sh.uniforms.uTime = treeWind.time;
    sh.uniforms.uSnow = weatherFx.snow;
    sh.uniforms.uLeaf = treeU.uLeaf;
    sh.uniforms.uBare = treeU.uBare;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'attribute float aLeaf; uniform vec2 uWind; uniform float uTime; uniform float uBare; varying float vLeaf; varying float vUp;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3( position );
        vLeaf = aLeaf;
        // Winter: the canopy draws into the branches.
        if ( aLeaf > 0.75 ) transformed = mix( transformed, vec3( transformed.x * 0.25, 0.62 + ( transformed.y - 0.62 ) * 0.3, transformed.z * 0.25 ), uBare );`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 wp = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
        vec4 root = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
        float hgt = max( 0.0, transformed.y - 0.15 );
        float ph = root.x * 0.13 + root.z * 0.11;
        float ws = length( uWind );
        vec2 sway = uWind * ( 0.65 + 0.35 * sin( uTime * 1.6 + ph ) ) * ${sway.toFixed(3)};
        // Leaves shimmer on top of the sway.
        float shimmer = aLeaf * sin( uTime * 7.0 + wp.x * 3.0 + wp.y * 5.0 ) * 0.015 * ( 0.3 + ws );
        wp.xz += ( sway + vec2( shimmer ) ) * hgt * hgt * ( wp.y - root.y + 0.01 );
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;`,
      )
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = wp;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vUp = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal ).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float uSnow; uniform vec3 uLeaf; varying float vLeaf; varying float vUp;\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if ( vLeaf > 0.75 ) diffuseColor.rgb *= uLeaf * 1.6;
        float sn = clamp( ( uSnow * 1.3 - ( 1.0 - vUp ) * 2.0 ) * 2.5, 0.0, 1.0 ) * step( 0.25, vLeaf );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.88, 0.91, 0.97 ), sn );`,
      );
  };
  mat.customProgramCacheKey = () => `tree-${sway}`;
  return mat;
}

export interface Forest {
  group: THREE.Group;
  triangles: number;
  /** The bushes' material: its colour is the season's tint (stage.ts BUSH). */
  bushes: THREE.MeshLambertMaterial;
}

/** The near forest: firs and broadleaves within `radius` of camp, bushes at the clearing's edge. */
export function buildForest(radius: number): Forest {
  const group = new THREE.Group();
  const rnd = mulberry32(4242);
  const spots: Array<{ x: number; z: number; s: number; r: number; k: 'fir' | 'leaf' }> = [];
  let guard = 0;
  while (spots.length < 110 && guard++ < 12000) {
    const a = rnd() * Math.PI * 2;
    const d = 11 + Math.pow(rnd(), 0.7) * (radius - 11);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (Math.abs(x - pathX(z)) < 4.5) continue;
    // Keep the view to the mountain open: a wide gap ahead of camp.
    if (z < -6 && Math.abs(x) < 8 + Math.abs(z) * 0.75) continue;
    if (fbm(x * 0.05 + 11, z * 0.05 + 4, 2) < 0.4) continue; // groves, not a carpet
    if (spots.some((o) => Math.hypot(o.x - x, o.z - z) < 2.6)) continue;
    if (streamDistance(x, z).d < STREAM_HALF + 2.5) continue;
    const leafy = fbm(x * 0.03 + 50, z * 0.03, 2) > 0.52;
    spots.push({ x, z, s: leafy ? 4.2 + rnd() * 2.6 : 5 + rnd() * 4.5, r: rnd() * Math.PI * 2, k: leafy ? 'leaf' : 'fir' });
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  let triangles = 0;
  const kinds: Array<['fir' | 'leaf', THREE.BufferGeometry[], number]> = [
    ['fir', [firGeometry(3), firGeometry(17, 7), firGeometry(29, 5)], 0.035],
    ['leaf', [broadleafGeometry(5), broadleafGeometry(41)], 0.05],
  ];
  for (const [kind, geos, sway] of kinds) {
    const mine = spots.filter((o) => o.k === kind);
    const mat = treeMaterial(sway);
    geos.forEach((geo, gi) => {
      const list = mine.filter((_, i) => i % geos.length === gi);
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((o, i) => {
        q.setFromAxisAngle(up, o.r);
        m4.compose(new THREE.Vector3(o.x, groundHeight(o.x, o.z) - 0.15, o.z), q, new THREE.Vector3(o.s * (0.85 + rnd() * 0.3), o.s, o.s * (0.85 + rnd() * 0.3)));
        mesh.setMatrixAt(i, m4);
        // Each tree a little different: some darker, some sun-warmed, a few yellowing early.
        c.setRGB(1, 1, 1).multiplyScalar(0.82 + rnd() * 0.32);
        if (kind === 'leaf' && rnd() < 0.25) c.multiply(new THREE.Color(1.15, 1.05, 0.75));
        mesh.setColorAt(i, c);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      triangles += (geo.index?.count ?? 0) / 3 * list.length;
      group.add(mesh);
    });
  }
  // Bushes at the clearing's edge and along the path.
  const bushMat = treeMaterial(0.08);
  bushMat.color.set('#ffffff');
  const bushGeo = bushGeometry(9);
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, 46);
  let b = 0;
  guard = 0;
  while (b < 46 && guard++ < 4000) {
    const a = rnd() * Math.PI * 2;
    const d = 6.5 + rnd() * 28;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (Math.abs(x - pathX(z)) < 2.2 || Math.hypot(x, z) < 6.5) continue;
    if (Math.hypot(x + 2.3, z + 2.1) < 3) continue;
    if (streamDistance(x, z).d < STREAM_HALF + 1.2) continue;
    const s = 0.8 + rnd() * 1.1;
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    m4.compose(new THREE.Vector3(x, groundHeight(x, z) - 0.05, z), q, new THREE.Vector3(s * 1.3, s, s * 1.3));
    bushes.setMatrixAt(b++, m4);
  }
  bushes.count = b;
  bushes.receiveShadow = true;
  bushes.castShadow = true;
  group.add(bushes);
  triangles += (bushGeo.index?.count ?? 0) / 3 * b;
  return { group, triangles, bushes: bushMat };
}

/**
 * The far forest beyond the near groves: simpler firs (fewer tiers) in clusters across the
 * valley, out of the path's way and clear of the near forest's radius.
 */
export function buildFarForest(clear: number): THREE.Group {
  const g = new THREE.Group();
  const rnd = mulberry32(21);
  const geos = [firGeometry(61, 5, 8), firGeometry(67, 4, 8)];
  const mat = treeMaterial(0.035);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  const list: THREE.Matrix4[][] = [[], []];
  const tints: THREE.Color[][] = [[], []];
  let guard = 0;
  let n = 0;
  while (n < 420 && guard++ < 30000) {
    const x = (rnd() - 0.5) * 320;
    const z = -175 + rnd() * 330;
    if (Math.abs(x - pathX(z)) < 4.5) continue;
    if (Math.hypot(x, z) < clear) continue;
    if (streamDistance(x, z).d < STREAM_HALF + 2.5) continue;
    if (fbm(x * 0.02 + 40, z * 0.02, 2) < 0.47) continue;
    const s = (0.8 + rnd() * 1.1) * 4.6;
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    m4.compose(new THREE.Vector3(x, groundHeight(x, z) - 0.2, z), q, new THREE.Vector3(s * (0.85 + rnd() * 0.3), s * (0.9 + rnd() * 0.3), s * (0.85 + rnd() * 0.3)));
    const k = n % 2;
    list[k]!.push(m4.clone());
    tints[k]!.push(c.setRGB(1, 1, 1).multiplyScalar(0.8 + rnd() * 0.35).clone());
    n++;
  }
  geos.forEach((geo, k) => {
    const mesh = new THREE.InstancedMesh(geo, mat, list[k]!.length);
    list[k]!.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, tints[k]![i]!);
    });
    mesh.receiveShadow = true;
    g.add(mesh);
  });
  return g;
}
