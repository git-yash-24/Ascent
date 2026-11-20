import * as THREE from 'three';
import { buildTent } from './camp';
import { glowTexture, groundHeight, pathX } from './world';

export type Outcome = 'closed' | 'partial' | 'rested' | 'missed';

export interface WeekCamp {
  label: string;
  outcome: Outcome;
  position: THREE.Vector3;
}

const OUTCOME_GLOW: Record<Outcome, { color: string; size: number; opacity: number }> = {
  closed: { color: '#ff8a3d', size: 7, opacity: 0.95 },
  partial: { color: '#ff8a3d', size: 3.6, opacity: 0.55 },
  rested: { color: '#ffe3a1', size: 3, opacity: 0.7 },
  missed: { color: '#8899aa', size: 0, opacity: 0 },
};

/**
 * Six earlier days as camps down the slope (sample data), today being the climber himself.
 * A missed day leaves no camp: he stayed where he was, so the previous camp is shown twice.
 */
export function buildWeek(scene: THREE.Scene, days: Array<{ label: string; outcome: Outcome }>): {
  group: THREE.Group;
  camps: WeekCamp[];
  setVisible(v: number): void;
} {
  const group = new THREE.Group();
  const camps: WeekCamp[] = [];
  const glowTex = glowTexture();
  const glows: THREE.Sprite[] = [];
  // Oldest camp is lowest (largest z). Missed days do not move the camp.
  let step = 0;
  const zFor = (k: number): number => 24 * k;
  const placed: number[] = [];
  const nMoves = days.filter((d) => d.outcome !== 'missed').length;
  days.forEach((d) => {
    if (d.outcome !== 'missed') step++;
    placed.push(nMoves - step + 1);
  });
  days.forEach((d, i) => {
    const k = placed[i] ?? 1;
    const z = zFor(k);
    const x = pathX(z) + 2.2;
    const y = groundHeight(x, z);
    const pos = new THREE.Vector3(x, y, z);
    camps.push({ label: d.label, outcome: d.outcome, position: pos.clone() });
    if (d.outcome === 'missed') return; // he stayed put; no new camp
    const tent = buildTent(d.outcome === 'rested' ? '#8a7a55' : '#7a6a4a');
    tent.position.copy(pos).add(new THREE.Vector3(-1.4, 0, -0.6));
    tent.rotation.y = 0.6;
    group.add(tent);
    const o = OUTCOME_GLOW[d.outcome];
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: o.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: o.opacity }));
    glow.position.copy(pos).add(new THREE.Vector3(0, 0.8, 0));
    glow.scale.setScalar(o.size);
    glow.userData.base = o.opacity;
    group.add(glow);
    glows.push(glow);
    if (d.outcome === 'closed' || d.outcome === 'partial') {
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 5), new THREE.MeshBasicMaterial({ color: '#ffb066' }));
      core.position.copy(pos).add(new THREE.Vector3(0, 0.3, 0));
      core.scale.setScalar(d.outcome === 'closed' ? 1 : 0.5);
      group.add(core);
    }
  });

  // The trail: a dashed line along the route from the oldest camp to today.
  const pts: THREE.Vector3[] = [];
  const zStart = zFor(nMoves) + 6;
  for (let z = zStart; z >= -70; z -= 1) {
    const x = pathX(z);
    pts.push(new THREE.Vector3(x, groundHeight(x, z) + 0.25, z));
  }
  const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: '#f1d8b8', dashSize: 1.2, gapSize: 0.9, transparent: true, opacity: 0.55 }));
  line.computeLineDistances();
  group.add(line);

  scene.add(group);
  group.visible = false;
  return {
    group,
    camps,
    setVisible(v: number) {
      group.visible = v > 0.01;
      (line.material as THREE.LineDashedMaterial).opacity = 0.55 * v;
      for (const g of glows) g.material.opacity = (g.userData.base as number) * v;
    },
  };
}
