import * as THREE from 'three';
import { dotTexture, glowTexture, groundHeight } from './world';
import { mulberry32, valueNoise } from '../shared/noise';
import { stoneGeometry } from '../../game/style';
import { paintedTent } from '../../game/campdress';

/**
 * A painted flame: a teardrop turned on a lathe, licked by noise in the vertex shader, leaning
 * with the wind, hot white at the core fading to red at the tips. Three nested layers make a fire.
 */
const flameU = { uT: { value: 0 }, uWind: { value: 0 } };
function flameMesh(color: string, tip: string, scale: number, seed: number, opacity: number): THREE.Mesh {
  const prof: Array<[number, number]> = [[0.001, 0], [0.1, 0.03], [0.16, 0.13], [0.15, 0.27], [0.11, 0.42], [0.06, 0.58], [0.02, 0.72], [0.001, 0.8]];
  const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 10, 0, Math.PI * 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...flameU, uCol: { value: new THREE.Color(color) }, uTip: { value: new THREE.Color(tip) }, uSeed: { value: seed }, uK: { value: 1 }, uA: { value: opacity } },
    transparent: true,
    depthWrite: false,
    fog: false,
    vertexShader: `uniform float uT; uniform float uWind; uniform float uSeed; uniform float uK; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 p = position;
        float y = p.y / 0.8;
        float t = uT * 7.0 + uSeed * 13.0;
        // Tongues: the flame's sides ripple upward, the tip whips.
        p.x += sin(y * 9.0 - t + uSeed) * 0.035 * y + sin(t * 1.7 + uSeed * 3.0) * 0.04 * y * y;
        p.z += cos(y * 7.0 - t * 1.2 + uSeed * 2.0) * 0.03 * y;
        p.y *= 1.0 + 0.18 * sin(t * 1.3 + uSeed * 5.0) * y;
        p.x += uWind * y * y * 0.35;
        p.xz *= 1.0 - y * 0.15 * sin(t * 0.9);
        p *= uK;
        vY = y;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uCol; uniform vec3 uTip; uniform float uA; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){
        float edge = pow(1.0 - abs(dot(normalize(vN), vV)), 1.5);
        vec3 c = mix(uCol, uTip, smoothstep(0.25, 0.95, vY));
        c = mix(c, uTip * 0.9, edge * 0.6);
        float a = uA * (1.0 - smoothstep(0.7, 1.0, vY) * 0.6) * (1.0 - edge * 0.35);
        gl_FragColor = vec4(c * 1.6, a);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.scale.setScalar(scale);
  return m;
}

export interface Fire {
  group: THREE.Group;
  light: THREE.PointLight;
  /** 0 = cold embers, 1 = full fire. Eased toward `target`. */
  level: number;
  target: number;
  /** The shared wind, -1..1 along x: flames lean with it. */
  wind: number;
  update(t: number, dt: number): void;
}

export function buildFire(shadowSize: number): Fire {
  const group = new THREE.Group();
  const rnd = mulberry32(11);

  // Stone ring
  // Round river stones, soot-dark on the inside, a few with a cap of moss on the outside.
  const stoneGeos = [0, 1, 2].map((k) => stoneGeometry(17 + k * 5, '#6a6a48', '#77706a'));
  const stoneMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rnd() * 0.15;
    const s = new THREE.Mesh(stoneGeos[i % 3]!, stoneMat);
    const sz = 0.2 + rnd() * 0.09;
    s.position.set(Math.cos(a) * 0.44, sz * 0.18, Math.sin(a) * 0.44);
    s.rotation.set((rnd() - 0.5) * 0.4, rnd() * 6.3, (rnd() - 0.5) * 0.4);
    s.scale.set(sz * (1 + rnd() * 0.3), sz * 0.8, sz);
    s.castShadow = false;
    s.receiveShadow = true;
    group.add(s);
  }
  // Logs
  // Split logs leaned into a cone: bark outside, charred black toward the heart of the fire.
  const logGeo = new THREE.CylinderGeometry(0.04, 0.055, 0.5, 8, 4);
  {
    const lp = logGeo.attributes.position as THREE.BufferAttribute;
    const lc = new Float32Array(lp.count * 3);
    const bark = new THREE.Color('#5a3d28');
    const char = new THREE.Color('#1c1512');
    const tmp = new THREE.Color();
    for (let i = 0; i < lp.count; i++) {
      tmp.copy(bark).lerp(char, THREE.MathUtils.smoothstep(lp.getY(i), -0.05, 0.25));
      lc.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    logGeo.setAttribute('color', new THREE.BufferAttribute(lc, 3));
  }
  const logMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (let i = 0; i < 5; i++) {
    // A pivot at each log's foot, turned to face the middle; the log leans in from it.
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * 0.32, 0.02, Math.sin(a) * 0.32);
    pivot.lookAt(0, 0.02, 0);
    const l = new THREE.Mesh(logGeo, logMat);
    l.position.y = 0.25;
    const lean = new THREE.Group();
    lean.rotation.x = 1.12 + (i % 2) * 0.1;
    lean.add(l);
    pivot.add(lean);
    l.castShadow = true;
    group.add(pivot);
  }
  // Embers bed
  const bed = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 10),
    new THREE.MeshBasicMaterial({ color: '#ff6a2a', transparent: true, opacity: 0.85 }),
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = 0.03;
  group.add(bed);

  // Flames: three painted layers, red outside to white-gold inside, and a few loose tongues.
  const flames = new THREE.Group();
  flames.position.y = 0.06;
  const layers = [
    flameMesh('#ff5a1e', '#c42a10', 1.0, 0.1, 0.85),
    flameMesh('#ff9a2e', '#ff5a1e', 0.72, 0.6, 0.9),
    flameMesh('#fff2b0', '#ffb040', 0.42, 1.3, 0.95),
  ];
  layers.forEach((m, i) => {
    m.renderOrder = 2 + i;
    flames.add(m);
  });
  const tongues: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const t = flameMesh('#ff8a28', '#d8361a', 0.38, 2 + i * 1.7, 0.85);
    const a = (i / 3) * Math.PI * 2;
    t.position.set(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1);
    t.renderOrder = 2;
    tongues.push(t);
    flames.add(t);
  }
  group.add(flames);
  // Ground glow
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff8a3d', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 }));
  glow.position.y = 0.35;
  group.add(glow);

  // Embers rising
  const EMBERS = 34;
  const ePos = new Float32Array(EMBERS * 3);
  const eLife = new Float32Array(EMBERS);
  const eVel = new Float32Array(EMBERS * 3);
  for (let i = 0; i < EMBERS; i++) eLife[i] = rnd() * 2;
  const eGeo = new THREE.BufferGeometry();
  eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  const eMat = new THREE.PointsMaterial({ color: '#ffb066', size: 0.045, map: dotTexture(), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
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
    wind: 0,
    update(t: number, dt: number) {
      fire.level += (fire.target - fire.level) * Math.min(1, dt * 1.6);
      const L = fire.level;
      const flick = 0.82 + valueNoise(t * 6.5, 1.3) * 0.36;
      light.intensity = (0.9 + L * 7.5) * flick;
      light.distance = 6 + L * 10;
      glow.material.opacity = (0.22 + L * 0.45) * flick;
      glow.scale.setScalar(1.6 + L * 3.2);
      bed.material.opacity = 0.55 + 0.35 * valueNoise(t * 2, 7);
      flameU.uT.value = t;
      flameU.uWind.value = fire.wind;
      // Low embers: only the inner flame stays, small. A full fire: tall, with tongues.
      const hgt = (0.22 + L * 0.95) * (0.9 + valueNoise(t * 3, 2.2) * 0.2);
      flames.scale.set(0.75 + L * 0.45, hgt, 0.75 + L * 0.45);
      layers[0]!.visible = L > 0.15;
      tongues.forEach((m, i) => {
        m.visible = L > 0.35;
        m.scale.setScalar(0.38 * (0.7 + valueNoise(t * 4 + i * 9, i) * 0.6));
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

/** The tent (game/campdress.ts paints it). */
export function buildTent(color = '#5f7d6e'): THREE.Group {
  return paintedTent(color);
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
    new THREE.CylinderGeometry(0.17, 0.19, 1.4, 12),
    new THREE.MeshLambertMaterial({ color: '#5a3f2a' }),
  );
  seat.rotation.z = Math.PI / 2;
  seat.position.set(0, 0.17, -1.12);
  seat.castShadow = true;
  seat.receiveShadow = true;
  group.add(seat);


  group.position.y = groundHeight(0, 0);
  scene.add(group);
  return { group, fire, seat, satchelSpot: new THREE.Vector3(0.62, 0.1, -0.95) };
}
