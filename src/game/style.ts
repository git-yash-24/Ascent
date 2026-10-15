/**
 * Art direction (docs/design/art-direction.md): a painted, storybook mountain in the spirit of
 * Little Devil Inside. Soft forms, smooth gouache-like shading with a painted terminator, warm
 * light and cool, saturated shade, a soft rim on every silhouette, and a paper grain over it all.
 *
 * The look is one shading model shared by every Lambert material in the world, so the terrain,
 * Ari, the camp, the trees and the clouds can never drift apart in style. Installed once, before
 * any material compiles.
 */
import * as THREE from 'three';

/**
 * The painted light, replacing three's Lambert term:
 *   - wrapped diffuse (light creeps round forms the way paint does);
 *   - a soft painted terminator and a second, brighter highlight band;
 *   - shade that keeps a little gradient, so forms read in shadow;
 *   - a rim where a surface turns away from you, strongest toward the light (the "halo" edge);
 *   - indirect light tinted cool, so shadows are blue-violet, never grey.
 */
const PAINTED = /* glsl */ `varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float nl = dot( geometryNormal, directLight.direction );
	float w = nl * 0.5 + 0.5;
	float lit = smoothstep( 0.40, 0.60, w );
	float hi = smoothstep( 0.80, 0.95, w );
	float band = lit * 0.78 + hi * 0.22 + ( 1.0 - lit ) * w * 0.16;
	float fres = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 3.0 );
	float rim = fres * smoothstep( -0.35, 0.4, nl ) * 0.32;
	vec3 irradiance = ( band + rim ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 d = material.diffuseColor;
	float l = dot( d, vec3( 0.3, 0.55, 0.15 ) );
	vec3 rich = clamp( mix( vec3( l ), d, 1.25 ), 0.0, 1.0 );
	reflectedLight.indirectDiffuse += irradiance * vec3( 0.92, 0.96, 1.1 ) * BRDF_Lambert( rich );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`;

let installed = false;

export function installStyle(): void {
  if (installed) return;
  installed = true;
  (THREE.ShaderChunk as Record<string, string>).lights_lambert_pars_fragment = PAINTED;
}

/**
 * Soften what is organic: cloth, wood, bodies, leaves. Smooth normals instead of facets (rocks
 * and ice keep theirs: `keep` names materials to leave faceted).
 */
export function soften(root: THREE.Object3D, keep: Set<THREE.Material> = new Set()): void {
  const seen = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    let soft = false;
    for (const mat of mats) {
      if (mat instanceof THREE.MeshLambertMaterial && !keep.has(mat) && mat.flatShading) {
        mat.flatShading = false;
        mat.needsUpdate = true;
        soft = true;
      } else if (mat instanceof THREE.MeshLambertMaterial && !keep.has(mat)) soft = true;
    }
    const g = m.geometry;
    if (soft && g.index && !seen.has(g)) {
      seen.add(g);
      g.computeVertexNormals();
    }
  });
}

/** A smooth, lumpy stone: an icosphere pushed about by noise, moss settling on its top. */
export function stoneGeometry(seed: number, moss = '#5f6b3a', rock = '#7a746a', detail = 2): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, detail);
  const p = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const a = new THREE.Color(rock);
  const b = new THREE.Color(moss);
  const dark = new THREE.Color(rock).multiplyScalar(0.72);
  const c = new THREE.Color();
  const n = (x: number, y: number, z: number): number =>
    Math.sin(x * 3.1 + seed) * Math.sin(y * 2.7 + seed * 1.7) * Math.sin(z * 3.3 + seed * 0.6);
  // Vertices shared by position get the same push, so the surface stays closed.
  const key = (i: number): string => `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
  const pushed = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = key(i);
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    let s = pushed.get(k);
    if (s === undefined) {
      s = 1 + n(x, y, z) * 0.22 + Math.sin(x * 7 + z * 5 + seed) * 0.05;
      pushed.set(k, s);
    }
    const flat = y < 0 ? 0.55 : 0.82; // a flatter base that sits on the ground
    p.setXYZ(i, x * s, y * s * flat, z * s);
    c.copy(a).lerp(dark, Math.max(0, -y) * 0.9);
    const up = y / 0.5;
    if (up > 0.35) c.lerp(b, Math.min(1, (up - 0.35) * 2.2) * (0.6 + 0.4 * Math.sin(x * 9 + seed)));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const merged = mergeByPosition(g);
  merged.computeVertexNormals();
  return merged;
}

/** Weld duplicated vertices of a non-indexed geometry, so normals can be smoothed across faces. */
export function mergeByPosition(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const p = src.attributes.position as THREE.BufferAttribute;
  const c = src.attributes.color as THREE.BufferAttribute | undefined;
  const map = new Map<string, number>();
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let j = map.get(k);
    if (j === undefined) {
      j = pos.length / 3;
      map.set(k, j);
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (c) col.push(c.getX(i), c.getY(i), c.getZ(i));
    }
    idx.push(j);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (c) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

/**
 * The paper: a soft grain and a painted vignette over the world (CSS, no extra render pass).
 * Returns the element to place right above the canvas.
 */
export function paperOverlay(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'paper';
  el.setAttribute('aria-hidden', 'true');
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const g = c.getContext('2d');
    if (g) {
      const img = g.createImageData(160, 160);
      let s = 9;
      const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < img.data.length; i += 4) {
        // Grain with a few longer fibres, like cold-pressed paper.
        const v = 128 + (rnd() - 0.5) * 70 + (rnd() < 0.02 ? 40 : 0);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      el.style.setProperty('--paper', `url(${c.toDataURL()})`);
    }
  } catch {
    /* no canvas: the vignette alone */
  }
  return el;
}
