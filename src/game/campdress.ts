/**
 * The camp, dressed (art direction: a lived-in storybook camp). Everything here has a reason to
 * be where it is, so the camp reads as somebody's home at a glance:
 *
 *   the hearth      fire in its stone ring; the kettle on a flat stone at the edge, where it
 *                   keeps warm without boiling; smoke that leans with the wind
 *   Ari's place     her log; her pack on her right (the flask rides in it); a cloth with bread
 *                   and two apples on her left, in reach; mittens drying on a stick toward the heat
 *   your place      across the fire, your cup (kit.ts)
 *   the tent        behind her to the left, door turned to the fire: bedroll inside, boots left
 *                   outside, trekking poles leaned on the pole, guy lines pegged out; a candle
 *                   glows inside after dark
 *   the woodshed    a chopping stump with the hatchet in it, chips round it, off to the side
 *
 * Night is lit by things that belong on a mountain: the fire (key, warm), the tent's candle,
 * her own lamp (ari.ts), the camp lantern once it is built (kit.ts), fireflies, the moon and the
 * Ninth Hut's beacon. Nothing is lit for its own sake.
 */
import * as THREE from 'three';
import { glowTexture, groundHeight } from '../prototype/feel3d/world';
import { stoneGeometry } from './style';

const lam = (color: string, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color, ...extra });

function shadowed<T extends THREE.Object3D>(o: T, cast = true): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = cast;
      c.receiveShadow = true;
    }
  });
  return o;
}

/**
 * A ridge tent in painted canvas: two sagging side panels, a closed back, a front with the door
 * tied open, poles, guy lines and pegs, and a candle inside that glows after dark. Origin at the
 * middle of its footprint, door facing +z. children[0] is the canvas (the Shelter laces its door
 * with the same cloth).
 */
export function paintedTent(color = '#5f7d6e'): THREE.Group {
  const g = new THREE.Group();
  const W = 0.85;
  const H = 1.05;
  const D = 0.95;
  const cloth = lam(color, { side: THREE.DoubleSide });
  const seam = lam(new THREE.Color(color).multiplyScalar(0.72).getStyle(), { side: THREE.DoubleSide });
  // The two side panels as one sheet: from the eave on one side over the ridge to the other,
  // sagging between the poles and toward the eaves, as canvas does.
  const NU = 12;
  const NV = 10;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= NV; j++) {
    const v = (j / NV) * 2 - 1; // -1 left eave, 0 ridge, 1 right eave
    for (let i = 0; i <= NU; i++) {
      const u = (i / NU) * 2 - 1; // -1 back, 1 front
      const side = Math.abs(v);
      const sag = Math.sin(side * Math.PI) * 0.06 * (1 - u * u * 0.85) + (1 - u * u) * 0.03 * (1 - side);
      const x = v * W - Math.sign(v) * sag * 0.6;
      const y = H * (1 - side) - sag * 0.8 + (side > 0.98 ? 0 : 0);
      pos.push(x * (1 + side * 0.04 * u * u), Math.max(0.01, y), u * D);
    }
  }
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i;
      idx.push(a, a + NU + 1, a + 1, a + 1, a + NU + 1, a + NU + 2);
    }
  }
  const sheet = new THREE.BufferGeometry();
  sheet.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sheet.setIndex(idx);
  sheet.computeVertexNormals();
  const canvas = new THREE.Mesh(sheet, cloth);
  g.add(canvas);
  // The back: a closed triangle. The front: two panels either side of the door, tied back.
  const tri = (pts: Array<[number, number]>): THREE.ShapeGeometry => {
    const s = new THREE.Shape();
    s.moveTo(pts[0]![0], pts[0]![1]);
    for (const p of pts.slice(1)) s.lineTo(p[0], p[1]);
    return new THREE.ShapeGeometry(s);
  };
  const back = new THREE.Mesh(tri([[-W, 0.01], [0, H], [W, 0.01]]), cloth);
  back.position.z = -D;
  const left = new THREE.Mesh(tri([[-W, 0.01], [0, H], [-0.12, H * 0.86], [-0.42, 0.01]]), cloth);
  const right = new THREE.Mesh(tri([[W, 0.01], [0, H], [0.12, H * 0.86], [0.42, 0.01]]), cloth);
  left.position.z = right.position.z = D;
  // The door's rolled flaps, tied back either side.
  for (const sx of [-1, 1]) {
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.82, 7), seam);
    roll.position.set(sx * 0.27, 0.4, D + 0.02);
    roll.rotation.z = sx * 0.5;
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 4, 10), lam('#3a2c22'));
    tie.position.copy(roll.position).add(new THREE.Vector3(0, 0.05, 0));
    tie.rotation.set(Math.PI / 2, 0, sx * 0.5);
    g.add(roll, tie);
  }
  // The inside: dark by day; a candle's warmth after dark (setGlow).
  const insideMat = new THREE.MeshBasicMaterial({ color: '#16110d', fog: true });
  const inside = new THREE.Mesh(tri([[-0.42, 0.01], [0, H * 0.92], [0.42, 0.01]]), insideMat);
  inside.position.z = D - 0.25;
  const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.62, 10), lam('#9a4a32'));
  bedroll.rotation.z = Math.PI / 2;
  bedroll.position.set(0, 0.11, D - 0.38);
  g.add(back, left, right, inside, bedroll);
  // Poles front and back, the ridge line, guy lines out to pegs.
  const wood = lam('#6b5440');
  for (const z of [-D - 0.02, D + 0.02]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, H + 0.14, 6), wood);
    pole.position.set(0, (H + 0.14) / 2, z);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), wood);
    cap.position.set(0, H + 0.15, z);
    g.add(pole, cap);
  }
  const guyMat = new THREE.LineBasicMaterial({ color: '#d8ccb0', transparent: true, opacity: 0.7 });
  const guys: Array<[THREE.Vector3, THREE.Vector3]> = [
    [new THREE.Vector3(0, H + 0.1, D + 0.02), new THREE.Vector3(-0.3, 0, D + 0.45)],
    [new THREE.Vector3(0, H + 0.1, -D - 0.02), new THREE.Vector3(0, 0, -D - 0.75)],
    [new THREE.Vector3(-W * 0.55, H * 0.45, 0), new THREE.Vector3(-W - 0.55, 0, 0)],
    [new THREE.Vector3(W * 0.55, H * 0.45, 0), new THREE.Vector3(W + 0.55, 0, 0)],
  ];
  const pegMat = lam('#b0a48a');
  for (const [a, b] of guys) {
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), guyMat));
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.004, 0.12, 4), pegMat);
    peg.position.copy(b).setY(0.04);
    peg.rotation.z = 0.3;
    g.add(peg);
  }
  // Boots left by the door, toes out, and two trekking poles leaned against the front pole.
  const boot = lam('#4a3426');
  for (const sx of [-1, 1]) {
    const b = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.13, 8), boot);
    shaft.position.y = 0.075;
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), boot);
    foot.scale.set(0.9, 0.6, 1.7);
    foot.position.set(0, 0.03, 0.04);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.19), lam('#2a221c'));
    sole.position.set(0, 0.008, 0.04);
    b.add(shaft, foot, sole);
    b.position.set(0.55 + sx * 0.07, 0, D + 0.32);
    b.rotation.y = 0.4 + sx * 0.12;
    if (sx > 0) b.rotation.z = 0.08;
    g.add(b);
  }
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.15, 5), lam('#8a9099'));
    p.position.set(-0.08 + sx * 0.04, 0.56, D + 0.12);
    p.rotation.set(0.12, 0, sx * 0.08);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 6), lam('#2b2723'));
    grip.position.set(-0.08 + sx * 0.04 + sx * 0.04, 1.1, D + 0.19);
    g.add(p, grip);
  }
  // The candle's light: the inside warms, a soft glow spills out of the door.
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffb066', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  glow.position.set(0, 0.42, D + 0.05);
  glow.scale.setScalar(1.3);
  g.add(glow);
  const dark = new THREE.Color('#16110d');
  const warm = new THREE.Color('#a8582a');
  g.userData.setGlow = (k: number, t: number): void => {
    const f = k * (0.88 + 0.12 * Math.sin(t * 5.3) * Math.sin(t * 3.1 + 1));
    insideMat.color.copy(dark).lerp(warm, f * 0.75);
    glow.material.opacity = f * 0.4;
    glow.visible = f > 0.01;
  };
  shadowed(g);
  inside.castShadow = false;
  return g;
}

/** A bread loaf: a squashed, scored dome. */
function loaf(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), lam('#c08a4a'));
  m.scale.set(1.3, 0.62, 0.85);
  return m;
}

export interface CampDress {
  group: THREE.Group;
  /** `night` 0..1, `wind` along x, `fire` 0..1. */
  update(t: number, dt: number, night: number, wind: number, fire: number): void;
}

/** Dress the camp. Positions are in camp space (fire at the origin, Ari at z = -1.12 facing +z). */
export function dressCamp(scene: THREE.Scene, tent: THREE.Object3D | undefined): CampDress {
  const group = new THREE.Group();
  const at = (x: number, z: number, lift = 0): THREE.Vector3 => new THREE.Vector3(x, groundHeight(x, z) + lift, z);

  // The hearth: a flat stone at the fire's edge with the kettle keeping warm on it.
  const flat = new THREE.Mesh(stoneGeometry(41, '#6a6a48', '#7d766e'), lam('#ffffff', { vertexColors: true }));
  flat.scale.set(0.42, 0.14, 0.36);
  flat.position.copy(at(0.66, 0.24, 0.03));
  const kettle = new THREE.Group();
  const kmat = lam('#3c4a52');
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), kmat);
  body.scale.set(1, 0.8, 1);
  body.position.y = 0.08;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.03, 10), kmat);
  lid.position.y = 0.155;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 4), lam('#2b2723'));
  knob.position.y = 0.18;
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.022, 0.12, 6), kmat);
  spout.position.set(-0.1, 0.11, 0);
  spout.rotation.z = 0.9;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 4, 14, Math.PI), lam('#2b2723'));
  handle.position.y = 0.15;
  kettle.add(body, lid, knob, spout, handle);
  kettle.position.copy(at(0.66, 0.24, 0.07));
  kettle.rotation.y = -0.5;
  group.add(flat, kettle);

  // Ari's left: a cloth with bread and two apples.
  const clothGeo = new THREE.PlaneGeometry(0.42, 0.42, 6, 6);
  const cp = clothGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) cp.setZ(i, Math.sin(cp.getX(i) * 14) * Math.cos(cp.getY(i) * 11) * 0.008);
  clothGeo.computeVertexNormals();
  const cloth = new THREE.Mesh(clothGeo, lam('#c9b48a', { side: THREE.DoubleSide }));
  cloth.rotation.set(-Math.PI / 2, 0, 0.35);
  cloth.position.copy(at(-0.98, -0.72, 0.012));
  const bread = loaf();
  bread.position.copy(at(-1.0, -0.74, 0.05));
  bread.rotation.y = 0.5;
  group.add(cloth, bread);
  for (const [dx, dz, c] of [[0.11, 0.1, '#b8402a'], [-0.06, 0.15, '#9aae3c']] as const) {
    const apple = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), lam(c));
    apple.scale.set(1, 0.9, 1);
    apple.position.copy(at(-0.98 + dx, -0.72 + dz, 0.038));
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.025, 3), lam('#4a3426'));
    stalk.position.copy(apple.position).add(new THREE.Vector3(0, 0.038, 0));
    group.add(apple, stalk);
  }

  // Mittens drying on a stick pushed into the ground, leaning toward the heat.
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.75, 5), lam('#5b4636'));
  stick.position.copy(at(0.95, -0.25, 0.32));
  stick.rotation.z = 0.45;
  stick.rotation.x = 0.15;
  group.add(stick);
  const mitts: THREE.Object3D[] = [];
  for (let k = 0; k < 2; k++) {
    const mitt = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), lam(k ? '#a64a32' : '#b8603a'));
    palm.scale.set(0.85, 1.3, 0.55);
    palm.position.y = -0.06;
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.04, 8), lam('#e6dfd2'));
    mitt.add(palm, cuff);
    mitt.position.copy(at(0.95, -0.25, 0)).add(new THREE.Vector3(-0.1 - k * 0.12, 0.55 - k * 0.06, -0.02 + k * 0.02));
    group.add(mitt);
    mitts.push(mitt);
  }

  // The woodshed corner: a chopping stump with the hatchet bitten into it, chips scattered.
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.32, 10), lam('#5a3d28'));
  stump.position.copy(at(-2.75, 0.55, 0.15));
  const ring = new THREE.Mesh(new THREE.CircleGeometry(0.19, 12), lam('#b08a5a'));
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(stump.position).add(new THREE.Vector3(0, 0.161, 0));
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.38, 6), lam('#8a6a48'));
  haft.position.copy(stump.position).add(new THREE.Vector3(0.06, 0.32, 0.02));
  haft.rotation.z = -0.9;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.015), lam('#5c636b'));
  head.position.copy(stump.position).add(new THREE.Vector3(-0.07, 0.19, 0.02));
  head.rotation.z = -0.9 + Math.PI / 2;
  group.add(stump, ring, haft, head);
  const chipMat = lam('#c4a06a');
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39;
    const r = 0.3 + (i % 3) * 0.12;
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.03), chipMat);
    chip.position.copy(at(-2.75 + Math.cos(a) * r, 0.55 + Math.sin(a) * r, 0.008));
    chip.rotation.y = a * 1.7;
    group.add(chip);
  }

  // A coil of rope by her pack, and a few smaller stones bedded into the trodden ground.
  const rope = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 6, 16), lam('#c9a86a'));
  rope.rotation.x = -Math.PI / 2;
  rope.position.copy(at(1.08, -1.32, 0.02));
  const rope2 = rope.clone();
  rope2.scale.setScalar(0.8);
  rope2.position.y += 0.035;
  group.add(rope, rope2);
  const pebble = new THREE.MeshLambertMaterial({ vertexColors: true });
  const pebbles: Array<[number, number, number]> = [[1.4, 0.9, 0.18], [-1.7, 1.6, 0.26], [2.6, -0.9, 0.34], [-0.4, 2.1, 0.14], [3.0, 1.6, 0.4], [-3.3, 1.4, 0.3], [1.9, 2.6, 0.22]];
  pebbles.forEach(([x, z, sz], i) => {
    const s = new THREE.Mesh(stoneGeometry(60 + i * 3, '#647040', '#8a837a'), pebble);
    s.scale.set(sz * 1.2, sz * 0.7, sz);
    s.rotation.y = i * 1.3;
    s.position.copy(at(x, z, sz * 0.1));
    group.add(s);
  });
  shadowed(group);
  cloth.castShadow = false;

  // Smoke: soft puffs that rise from the fire, swell, lean with the wind and fade.
  const smokeTex = glowTexture();
  const puffs: Array<{ s: THREE.Sprite; age: number; life: number; x: number; z: number }> = [];
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: '#9a948c', transparent: true, depthWrite: false, opacity: 0 }));
    group.add(s);
    puffs.push({ s, age: (i / 9) * 4, life: 4, x: 0, z: 0 });
  }
  const fireBase = at(0, 0, 0);
  scene.add(group);

  return {
    group,
    update(t, dt, night, wind, fire) {
      (tent?.userData.setGlow as ((k: number, t: number) => void) | undefined)?.(night, t);
      for (const [i, m] of mitts.entries()) m.rotation.z = Math.sin(t * 1.3 + i) * 0.06 * (0.3 + Math.abs(wind));
      for (const p of puffs) {
        p.age += dt;
        if (p.age > p.life) {
          p.age = 0;
          p.life = 3.2 + Math.random() * 1.8;
          p.x = (Math.random() - 0.5) * 0.1;
          p.z = (Math.random() - 0.5) * 0.1;
        }
        const u = p.age / p.life;
        const rise = 0.6 + u * 2.6;
        p.s.position.set(fireBase.x + p.x + wind * u * u * 2.2 + Math.sin(t * 0.7 + p.z * 40) * 0.12 * u, fireBase.y + rise, fireBase.z + p.z);
        p.s.scale.setScalar(0.35 + u * 1.5);
        // Thicker over a low fire (smouldering), barely there over a bright one; pale by night.
        const thick = 0.1 + (1 - fire) * 0.16;
        p.s.material.opacity = Math.sin(u * Math.PI) * thick * (1 - night * 0.45);
        p.s.material.color.set(night > 0.5 ? '#5a5a66' : '#a8a29a');
      }
    },
  };
}
