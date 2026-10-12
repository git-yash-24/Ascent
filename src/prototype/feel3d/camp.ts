import * as THREE from 'three';
import { glowTexture, groundHeight } from './world';
import { mulberry32, valueNoise } from '../shared/noise';

function flameTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  if (ctx) {
    // A teardrop: a radial gradient squashed upward.
    ctx.translate(32, 96);
    ctx.scale(1, 2.2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
    g.addColorStop(0, 'rgba(255,240,200,1)');
    g.addColorStop(0.35, 'rgba(255,170,70,0.9)');
    g.addColorStop(0.7, 'rgba(230,80,20,0.35)');
    g.addColorStop(1, 'rgba(200,40,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface Fire {
  group: THREE.Group;
  light: THREE.PointLight;
  /** 0 = cold embers, 1 = full fire. Eased toward `target`. */
  level: number;
  target: number;
  update(t: number, dt: number): void;
}

export function buildFire(shadowSize: number): Fire {
  const group = new THREE.Group();
  const rnd = mulberry32(11);

  // Stone ring
  const stoneGeo = new THREE.DodecahedronGeometry(0.11, 0);
  const stoneMat = new THREE.MeshLambertMaterial({ color: '#59544d', flatShading: true });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const s = new THREE.Mesh(stoneGeo, stoneMat);
    s.position.set(Math.cos(a) * 0.42, 0.05, Math.sin(a) * 0.42);
    s.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    s.scale.set(1 + rnd() * 0.5, 0.7, 1 + rnd() * 0.4);
    s.castShadow = false;
    s.receiveShadow = true;
    group.add(s);
  }
  // Logs
  const logGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.62, 6);
  const logMat = new THREE.MeshLambertMaterial({ color: '#3a2a20', flatShading: true });
  for (let i = 0; i < 4; i++) {
    const l = new THREE.Mesh(logGeo, logMat);
    l.rotation.z = Math.PI / 2 - 0.55;
    l.rotation.y = (i / 4) * Math.PI * 2;
    l.position.y = 0.12;
    group.add(l);
  }
  // Embers bed
  const bed = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 10),
    new THREE.MeshBasicMaterial({ color: '#ff6a2a', transparent: true, opacity: 0.85 }),
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = 0.03;
  group.add(bed);

  // Flames: additive sprites that flicker in scale.
  const ftex = flameTexture();
  const flames: THREE.Sprite[] = [];
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: ftex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    f.center.set(0.5, 0.2);
    f.position.set((rnd() - 0.5) * 0.18, 0.1, (rnd() - 0.5) * 0.18);
    group.add(f);
    flames.push(f);
  }
  // Ground glow
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff8a3d', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 }));
  glow.position.y = 0.35;
  group.add(glow);

  // Embers rising
  const EMBERS = 60;
  const ePos = new Float32Array(EMBERS * 3);
  const eLife = new Float32Array(EMBERS);
  const eVel = new Float32Array(EMBERS * 3);
  for (let i = 0; i < EMBERS; i++) eLife[i] = rnd() * 2;
  const eGeo = new THREE.BufferGeometry();
  eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  const eMat = new THREE.PointsMaterial({ color: '#ffb066', size: 0.035, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const embers = new THREE.Points(eGeo, eMat);
  group.add(embers);

  const light = new THREE.PointLight('#ff9a52', 10, 16, 1.6);
  light.position.set(0, 0.55, 0);
  light.castShadow = true;
  light.shadow.mapSize.set(shadowSize, shadowSize);
  light.shadow.bias = -0.002;
  light.shadow.radius = 2;
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = 14;
  group.add(light);

  const fire: Fire = {
    group,
    light,
    level: 0.18,
    target: 0.18,
    update(t: number, dt: number) {
      fire.level += (fire.target - fire.level) * Math.min(1, dt * 1.6);
      const L = fire.level;
      const flick = 0.82 + valueNoise(t * 6.5, 1.3) * 0.36;
      light.intensity = (0.9 + L * 7.5) * flick;
      light.distance = 6 + L * 10;
      glow.material.opacity = (0.22 + L * 0.45) * flick;
      glow.scale.setScalar(1.6 + L * 3.2);
      bed.material.opacity = 0.55 + 0.35 * valueNoise(t * 2, 7);
      flames.forEach((f, i) => {
        const n = valueNoise(t * 7 + i * 13.1, i * 3.7);
        const h = (0.16 + L * 1.05) * (0.65 + n * 0.6) * (i === 0 ? 1.2 : 0.85);
        f.scale.set(h * 0.62, h, 1);
        f.material.opacity = Math.min(1, 0.55 + L * 0.6);
        f.position.x += Math.sin(t * 3 + i) * 0.0008;
      });
      // Embers: spawn rate rises with the fire.
      for (let i = 0; i < EMBERS; i++) {
        eLife[i] = (eLife[i] ?? 0) - dt;
        const k = i * 3;
        if ((eLife[i] ?? 0) <= 0) {
          if (rnd() < 0.15 + L * 0.85) {
            ePos[k] = (rnd() - 0.5) * 0.25;
            ePos[k + 1] = 0.2;
            ePos[k + 2] = (rnd() - 0.5) * 0.25;
            eVel[k] = (rnd() - 0.5) * 0.15;
            eVel[k + 1] = 0.5 + rnd() * 0.9 * (0.4 + L);
            eVel[k + 2] = (rnd() - 0.5) * 0.15;
            eLife[i] = 0.8 + rnd() * 1.8;
          } else {
            ePos[k + 1] = -10;
            eLife[i] = 0.2;
          }
        } else {
          ePos[k] = (ePos[k] ?? 0) + (eVel[k] ?? 0) * dt + Math.sin(t * 2 + i) * 0.002;
          ePos[k + 1] = (ePos[k + 1] ?? 0) + (eVel[k + 1] ?? 0) * dt;
          ePos[k + 2] = (ePos[k + 2] ?? 0) + (eVel[k + 2] ?? 0) * dt;
        }
      }
      eGeo.attributes.position!.needsUpdate = true;
      eMat.opacity = 0.4 + L * 0.6;
    },
  };
  return fire;
}

/** A small A-frame tent. */
export function buildTent(color = '#7a6a4a'): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-0.85, 0);
  shape.lineTo(0, 1.05);
  shape.lineTo(0.85, 0);
  shape.lineTo(-0.85, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.9, bevelEnabled: false });
  geo.translate(0, 0, -0.95);
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true, side: THREE.DoubleSide });
  const tent = new THREE.Mesh(geo, mat);
  tent.castShadow = true;
  tent.receiveShadow = true;
  g.add(tent);
  // Dark doorway
  const door = new THREE.Mesh(
    new THREE.ShapeGeometry(
      (() => {
        const s = new THREE.Shape();
        s.moveTo(-0.3, 0);
        s.lineTo(0, 0.62);
        s.lineTo(0.3, 0);
        s.lineTo(-0.3, 0);
        return s;
      })(),
    ),
    new THREE.MeshBasicMaterial({ color: '#0d0c0b' }),
  );
  door.position.z = 0.96;
  g.add(door);
  return g;
}

export interface Camp {
  group: THREE.Group;
  fire: Fire;
  seat: THREE.Mesh;
  satchelSpot: THREE.Vector3;
}

export function buildCamp(scene: THREE.Scene, shadowSize: number): Camp {
  const group = new THREE.Group();
  const fire = buildFire(shadowSize);
  group.add(fire.group);

  const tent = buildTent();
  tent.position.set(-2.3, 0, -2.1);
  tent.rotation.y = 0.75;
  group.add(tent);

  const seat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.19, 1.4, 7),
    new THREE.MeshLambertMaterial({ color: '#4a3628', flatShading: true }),
  );
  seat.rotation.z = Math.PI / 2;
  seat.position.set(0, 0.17, -1.12);
  seat.castShadow = true;
  seat.receiveShadow = true;
  group.add(seat);

  // A pot and a couple of stones to make the camp lived-in.
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.14, 8), new THREE.MeshLambertMaterial({ color: '#2d2f33', flatShading: true }));
  pot.position.set(0.62, 0.07, 0.35);
  pot.castShadow = true;
  group.add(pot);

  group.position.y = groundHeight(0, 0);
  scene.add(group);
  return { group, fire, seat, satchelSpot: new THREE.Vector3(0.62, 0.1, -0.95) };
}
