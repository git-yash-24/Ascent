/**
 * The travelling home: the objects that make any camp Ari's, and the improvements earned by
 * story days (core/world.ts CAMP_SCHEDULE). Built from primitives, flat-shaded like the rest.
 *
 * Layout (camp space, fire at the origin, Ari's seat at z = -1.12 facing +z):
 *   your place: a log seat across the fire at z = +1.25, your cup beside it
 *   the flag with your symbol beside the tent; the first-camp carving on a flat rock
 */
import * as THREE from 'three';
import { groundHeight } from '../prototype/feel3d/world';
import type { Accent, TrailSymbol } from '../core/model/types';

export const ACCENTS: Record<Accent, string> = {
  ember: '#c4552d',
  moss: '#5f7d3a',
  glacier: '#4f8fb0',
  plum: '#7d4a7a',
  ochre: '#c08a2a',
  ash: '#7f7c74',
};

export const SYMBOLS: TrailSymbol[] = ['peak', 'star', 'wave', 'pine', 'flame'];

const lambert = (color: string, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

const ground = (x: number, z: number, lift = 0): THREE.Vector3 => new THREE.Vector3(x, groundHeight(x, z) + lift, z);

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

/** The symbol drawn on a canvas, in `ink` on transparent (or on `bg`). Also used as an SVG path for the interface. */
export function symbolPath(s: TrailSymbol): string {
  switch (s) {
    case 'peak':
      return 'M12 3 L21 20 H3 Z M8.5 12.5 L12 9 L15.5 12.5';
    case 'star':
      return 'M12 2.5 L14.6 9 L21.5 9.3 L16.1 13.6 L18 20.5 L12 16.6 L6 20.5 L7.9 13.6 L2.5 9.3 L9.4 9 Z';
    case 'wave':
      return 'M2.5 9 C5.5 5.5 8.5 12.5 12 9 S18.5 5.5 21.5 9 M2.5 15 C5.5 11.5 8.5 18.5 12 15 S18.5 11.5 21.5 15';
    case 'pine':
      return 'M12 2.5 L18 10 H15 L19.5 16 H13.5 V21 H10.5 V16 H4.5 L9 10 H6 Z';
    case 'flame':
      return 'M12 2.5 C15 7 18.5 9.5 18.5 14.5 A6.5 6.5 0 0 1 5.5 14.5 C5.5 11 8 9.5 8.5 6.5 C10 8.5 10.5 10 12 11 C12.5 8 12 5.5 12 2.5 Z';
  }
}

export function symbolTexture(s: TrailSymbol, ink: string, bg: string | null = null): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  if (ctx) {
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 128, 128);
    }
    ctx.save();
    ctx.translate(16, 16);
    ctx.scale(4, 4);
    const p = new Path2D(symbolPath(s));
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (s === 'wave' || s === 'peak') ctx.stroke(p);
    else {
      ctx.fillStyle = ink;
      ctx.fill(p);
    }
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildCup(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.038, 0.08, 8, 1, true), lambert('#8a9099', { side: THREE.DoubleSide }));
  body.position.y = 0.04;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.038, 8), lambert('#5a6068'));
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.002;
  const tea = new THREE.Mesh(new THREE.CircleGeometry(0.042, 8), lambert('#6b3f1e', { emissive: '#2a1206' }));
  tea.rotation.x = -Math.PI / 2;
  tea.position.y = 0.065;
  tea.name = 'tea';
  tea.visible = false;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 4, 8, Math.PI), lambert('#8a9099'));
  handle.position.set(0.05, 0.045, 0);
  handle.rotation.z = -Math.PI / 2;
  g.add(body, bottom, tea, handle);
  return shadowed(g);
}

export interface Kit {
  group: THREE.Group;
  yourCup: THREE.Group;
  ariCup: THREE.Group;
  yourSeat: THREE.Vector3;
  map: THREE.Group;
  rope: THREE.Mesh;
  setSymbol(s: TrailSymbol | undefined, accent: string): void;
  setBuilt(ids: string[]): void;
  /** World position of an improvement, for the reveal shot. */
  where(id: string): THREE.Vector3 | null;
  /** `wind` 0..1: how hard the flag and pennants move. */
  update(t: number, wind?: number): void;
}

export function buildKit(scene: THREE.Scene): Kit {
  const group = new THREE.Group();

  // Your place across the fire: a log seat and a cup.
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 1.2, 7), lambert('#4a3628'));
  seat.rotation.z = Math.PI / 2;
  seat.rotation.y = 0.2;
  seat.position.copy(ground(0.25, 1.3, 0.16));
  group.add(shadowed(seat));
  const yourCup = buildCup();
  yourCup.position.copy(ground(0.85, 1.05));
  group.add(yourCup);
  const ariCup = buildCup();
  ariCup.position.copy(ground(-0.5, -0.78));
  group.add(ariCup);

  // The flag with your symbol, beside the tent.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.9, 5), lambert('#6b5440'));
  pole.position.copy(ground(-3.5, -0.9, 0.95));
  const clothGeo = new THREE.PlaneGeometry(0.56, 0.36, 8, 2);
  clothGeo.translate(0.28, 0, 0);
  const clothMat = new THREE.MeshLambertMaterial({ color: '#7f7c74', side: THREE.DoubleSide });
  const cloth = new THREE.Mesh(clothGeo, clothMat);
  cloth.position.copy(ground(-3.5, -0.9, 1.68));
  cloth.rotation.y = 0.6;
  const base = Float32Array.from((clothGeo.attributes.position as THREE.BufferAttribute).array);
  group.add(shadowed(pole), cloth);

  // The first-camp carving: your symbol cut into a flat rock.
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), lambert('#6e6a63'));
  rock.scale.set(1.2, 0.35, 0.9);
  rock.position.copy(ground(1.9, 0.5, 0.06));
  const carveMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false });
  const carve = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), carveMat);
  carve.rotation.x = -Math.PI / 2;
  carve.position.copy(rock.position).add(new THREE.Vector3(0, 0.16, 0));
  carve.visible = false;
  group.add(shadowed(rock), carve);

  // Props for the opening scene.
  const map = new THREE.Group();
  const sheet = (x: number, rz: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.26), lambert('#d8c9a3', { side: THREE.DoubleSide }));
    m.position.x = x;
    m.rotation.set(-Math.PI / 2, 0, rz);
    return m;
  };
  map.add(sheet(-0.1, 0.05), sheet(0.1, -0.05));
  map.visible = false;
  const rope = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 4, 10), lambert('#b39a6b'));
  rope.visible = false;

  // Improvements: hidden until their story day.
  const parts = new Map<string, THREE.Object3D>();
  const add = (id: string, o: THREE.Object3D): void => {
    o.visible = false;
    parts.set(id, shadowed(o));
    group.add(o);
  };
  {
    const w = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const x = -0.4 + i * 0.28;
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.9 + (i % 3) * 0.12, 5), lambert('#5b4636'));
      stake.position.copy(ground(x, -2.25 - Math.sin(i * 0.4) * 0.2, 0.42));
      stake.rotation.z = (i % 2 ? 1 : -1) * 0.06;
      w.add(stake);
    }
    for (let k = 0; k < 2; k++) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.5, 5), lambert('#4a3628'));
      rail.rotation.z = Math.PI / 2;
      rail.position.copy(ground(0.72, -2.3, 0.35 + k * 0.35));
      w.add(rail);
    }
    add('windbreak', w);
  }
  {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.08, 7), lambert('#5f5a52'));
    st.position.copy(ground(-0.62, 0.22, 0.04));
    add('stone', st);
  }
  {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.5, 5), lambert('#5b4636'));
    post.position.copy(ground(1.5, -1.5, 0.75));
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 5), lambert('#5b4636'));
    arm.rotation.z = Math.PI / 2;
    arm.position.copy(ground(1.5, -1.5, 1.45)).add(new THREE.Vector3(-0.16, 0, 0));
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.14, 6), lambert('#2d2f33', { emissive: '#ffb066', emissiveIntensity: 0.9 }));
    lamp.position.copy(ground(1.5, -1.5, 1.3)).add(new THREE.Vector3(-0.3, 0, 0));
    lamp.name = 'lamp';
    g.add(post, arm, lamp);
    add('lantern', g);
  }
  {
    const g = new THREE.Group();
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 4 - r; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.7, 6), lambert(i % 2 ? '#6b4f38' : '#5b4636'));
        log.rotation.x = Math.PI / 2;
        log.position.copy(ground(-1.55 + i * 0.15 + r * 0.075, -0.3, 0.07 + r * 0.13));
        g.add(log);
      }
    }
    add('woodpile', g);
  }
  const pennantMats: THREE.MeshLambertMaterial[] = [];
  {
    const g = new THREE.Group();
    const a = ground(-3.5, -0.9, 1.8);
    const b = ground(-1.4, -2.6, 1.0);
    for (let i = 0; i < 7; i++) {
      const u = (i + 0.5) / 7;
      const p = a.clone().lerp(b, u);
      p.y -= Math.sin(u * Math.PI) * 0.25;
      const m = new THREE.MeshLambertMaterial({ color: '#7f7c74', side: THREE.DoubleSide });
      pennantMats.push(m);
      const tri = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 3), m);
      tri.rotation.x = Math.PI;
      tri.position.copy(p).add(new THREE.Vector3(0, -0.1, 0));
      g.add(tri);
    }
    add('pennants', g);
  }
  {
    const g = new THREE.Group();
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.28), lambert('#6b5440'));
    plank.position.copy(ground(-1.2, 1.1, 0.36));
    plank.rotation.y = 0.5;
    for (const dx of [-0.4, 0.4]) {
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.34, 6), lambert('#4a3628'));
      stump.position.copy(plank.position).add(new THREE.Vector3(Math.cos(0.5) * dx, -0.18, -Math.sin(0.5) * dx));
      g.add(stump);
    }
    g.add(plank);
    add('bench', g);
  }
  {
    const tarp = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.7), lambert('#6a6f5a', { side: THREE.DoubleSide }));
    tarp.position.copy(ground(-2.3, -2.1, 1.55));
    tarp.rotation.set(-Math.PI / 2 + 0.18, 0, 0.75);
    add('tarp', tarp);
  }
  {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16 + i * 0.03, 5), lambert('#9aa3ad'));
      tube.position.copy(ground(1.5, -1.5, 1.2 - i * 0.015)).add(new THREE.Vector3(0.06 + i * 0.035, 0, 0));
      g.add(tube);
    }
    add('chime', g);
  }

  scene.add(group);
  scene.add(map, rope);
  return {
    group,
    yourCup,
    ariCup,
    yourSeat: seat.position.clone(),
    map,
    rope,
    setSymbol(s, accent) {
      clothMat.color.set(accent);
      for (const m of pennantMats) m.color.set(accent);
      if (clothMat.map) clothMat.map.dispose();
      clothMat.map = s ? symbolTexture(s, '#efe6d2') : null;
      clothMat.needsUpdate = true;
      if (carveMat.map) carveMat.map.dispose();
      carve.visible = !!s;
      if (s) {
        carveMat.map = symbolTexture(s, '#2b2723');
        carveMat.needsUpdate = true;
      }
    },
    setBuilt(ids) {
      for (const [id, o] of parts) o.visible = ids.includes(id);
    },
    where(id) {
      const o = parts.get(id);
      if (!o) return null;
      const b = new THREE.Box3().setFromObject(o);
      return b.getCenter(new THREE.Vector3());
    },
    update(t, wind = 0.25) {
      // The flag moves in the shared wind: faster and wider in a gust.
      const pa = clothGeo.attributes.position as THREE.BufferAttribute;
      const amp = 0.02 + wind * 0.09;
      const sp = 2 + wind * 5;
      for (let i = 0; i < pa.count; i++) {
        const x = base[i * 3] ?? 0;
        pa.setZ(i, Math.sin(t * sp + x * 9) * amp * x * 2.2);
      }
      pa.needsUpdate = true;
    },
  };
}
