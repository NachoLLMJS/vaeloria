import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z, ZONES } from '../sim/data';
import { terrainHeight, WATER_LEVEL } from '../sim/world';
import { assetUrl } from './assets/media';

const BASE = '/models/fishing/';

interface FishDef {
  key: string;
  model: string;
  quality: 'common' | 'uncommon' | 'rare' | 'epic';
  scale: number;
}

const FISH: FishDef[] = [
  { key: 'clownfish', model: 'Clownfish', quality: 'common', scale: 0.018 },
  { key: 'blue_tang', model: 'BlueTang', quality: 'common', scale: 0.018 },
  { key: 'goldfish', model: 'Goldfish', quality: 'common', scale: 0.017 },
  { key: 'koi', model: 'Koi', quality: 'uncommon', scale: 0.018 },
  { key: 'puffer', model: 'Puffer', quality: 'uncommon', scale: 0.017 },
  { key: 'royal_gramma', model: 'RoyalGramma', quality: 'uncommon', scale: 0.018 },
  { key: 'red_snapper', model: 'RedSnapper', quality: 'rare', scale: 0.02 },
  { key: 'tuna', model: 'Tuna', quality: 'rare', scale: 0.022 },
  { key: 'swordfish', model: 'Swordfish', quality: 'rare', scale: 0.021 },
  { key: 'anglerfish', model: 'Anglerfish', quality: 'epic', scale: 0.018 },
  { key: 'shark', model: 'Shark', quality: 'epic', scale: 0.026 },
];

const QUALITY_GLOW = {
  common: 0xffffff,
  uncommon: 0x39ff6a,
  rare: 0x4aa3ff,
  epic: 0xb06cff,
} as const;

interface Swimmer {
  node: THREE.Group;
  def: FishDef;
  cx: number;
  cz: number;
  radius: number;
  speed: number;
  phase: number;
  y: number;
}

export interface FishingView {
  group: THREE.Group;
  update(time: number): void;
}

function applyQualityGlow(root: THREE.Object3D, quality: FishDef['quality']): void {
  const color = QUALITY_GLOW[quality];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = mats.map((m) => {
      const c = m.clone() as THREE.MeshStandardMaterial | THREE.MeshPhongMaterial | THREE.MeshLambertMaterial;
      if ('emissive' in c) {
        c.emissive = new THREE.Color(color);
        c.emissiveIntensity = quality === 'epic' ? 0.42 : quality === 'rare' ? 0.25 : quality === 'uncommon' ? 0.14 : 0.04;
      }
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  });
}

function fallbackFish(def: FishDef): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: QUALITY_GLOW[def.quality], emissive: QUALITY_GLOW[def.quality], emissiveIntensity: 0.2, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), mat);
  body.scale.set(1.6, 0.55, 0.65);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.75, 3), mat);
  tail.position.x = -0.75;
  tail.rotation.z = Math.PI / 2;
  g.add(body, tail);
  return g;
}

function loadFish(def: FishDef, target: THREE.Group): void {
  const mtl = new MTLLoader();
  mtl.load(assetUrl(`${BASE}${def.model}.mtl`), (materials) => {
    materials.preload();
    const obj = new OBJLoader();
    obj.setMaterials(materials);
    obj.load(assetUrl(`${BASE}${def.model}.obj`), (root) => {
      target.clear();
      applyQualityGlow(root, def.quality);
      root.scale.setScalar(def.scale);
      root.rotation.y = Math.PI / 2;
      target.add(root);
    });
  });
}

function rand(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453123;
  return x - Math.floor(x);
}

function addSwimmer(out: Swimmer[], group: THREE.Group, def: FishDef, cx: number, cz: number, radius: number, seed: number): void {
  const node = new THREE.Group();
  const fallback = fallbackFish(def);
  fallback.scale.setScalar(def.scale * 42);
  node.add(fallback);
  loadFish(def, node);
  group.add(node);
  out.push({
    node, def, cx, cz, radius,
    speed: 0.18 + rand(seed + 1) * 0.22,
    phase: rand(seed + 2) * Math.PI * 2,
    y: WATER_LEVEL - 0.55 - rand(seed + 3) * 0.8,
  });
}

export function buildFishingView(seed: number): FishingView {
  const group = new THREE.Group();
  group.name = 'fishing-visual-fish';
  const swimmers: Swimmer[] = [];
  let n = 0;

  // Lake fish: each lake gets a few colorful fish circling inside the water.
  for (const zone of ZONES) {
    for (const lake of zone.lakes) {
      for (let i = 0; i < 7; i++) {
        const def = FISH[(i + n) % FISH.length];
        addSwimmer(swimmers, group, def, lake.x, lake.z, Math.max(4, lake.radius * (0.25 + rand(seed + n) * 0.42)), seed + n * 17);
        n++;
      }
    }
  }

  // Coast/ocean swimmers near the playable shore, but just outside the land.
  const coastSpots = [
    ...Array.from({ length: 9 }, (_, i) => ({ x: WORLD_MIN_X - 5, z: WORLD_MIN_Z + 70 + i * 105 })),
    ...Array.from({ length: 9 }, (_, i) => ({ x: WORLD_MAX_X + 5, z: WORLD_MIN_Z + 70 + i * 105 })),
    ...Array.from({ length: 5 }, (_, i) => ({ x: -120 + i * 60, z: WORLD_MIN_Z - 5 })),
    ...Array.from({ length: 5 }, (_, i) => ({ x: -120 + i * 60, z: WORLD_MAX_Z + 5 })),
  ];
  for (const s of coastSpots) {
    const def = FISH[n % FISH.length];
    addSwimmer(swimmers, group, def, s.x, s.z, 5 + rand(seed + n) * 9, seed + n * 23);
    n++;
  }

  return {
    group,
    update(time: number): void {
      for (const f of swimmers) {
        const a = f.phase + time * f.speed;
        const wobble = Math.sin(time * 2.0 + f.phase) * 0.16;
        f.node.position.set(f.cx + Math.sin(a) * f.radius, f.y + wobble, f.cz + Math.cos(a) * f.radius);
        f.node.rotation.y = a + Math.PI / 2;
        f.node.visible = terrainHeight(Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X, f.node.position.x)), Math.max(WORLD_MIN_Z, Math.min(WORLD_MAX_Z, f.node.position.z)), seed) < WATER_LEVEL + 2
          || f.node.position.x < WORLD_MIN_X || f.node.position.x > WORLD_MAX_X || f.node.position.z < WORLD_MIN_Z || f.node.position.z > WORLD_MAX_Z;
      }
    },
  };
}
