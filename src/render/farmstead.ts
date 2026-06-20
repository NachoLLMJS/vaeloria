import * as THREE from 'three';
import type { IWorld } from '../world_api';
import type { FarmPlot } from '../sim/types';
import { terrainHeight } from '../sim/world';
import { loadGltf } from './assets/loader';

const FARM_TEMPLE_URL = '/models/props/custom/chinese_maple_temple.glb';
const FARM_FOOTPRINT = 6.8;

let templeTemplate: THREE.Object3D | null = null;
let templeLoading = false;

function prep(o: THREE.Object3D): void {
  o.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const maybe = mat as THREE.MeshStandardMaterial;
        if ('side' in maybe) maybe.side = THREE.DoubleSide;
      }
    }
  });
}

function makeCenteredTemplate(source: THREE.Object3D): THREE.Object3D {
  const root = source.clone(true);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error('farm temple model has no meshes');
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = FARM_FOOTPRINT / Math.max(size.x, size.z, 0.001);
  const wrapper = new THREE.Group();
  root.position.set(-center.x, -box.min.y, -center.z);
  root.scale.setScalar(scale);
  wrapper.add(root);
  wrapper.name = 'farm-chinese-maple-temple';
  prep(wrapper);
  return wrapper;
}

function loadFarmTemple(onReady: () => void): void {
  if (templeTemplate || templeLoading) return;
  templeLoading = true;
  loadGltf(FARM_TEMPLE_URL).then((gltf) => {
    templeTemplate = makeCenteredTemplate(gltf.scene);
  }).catch((err) => console.warn('[farmstead] chinese maple temple failed to load', err))
    .finally(() => { templeLoading = false; onReady(); });
}

function buildFallbackMarker(parent: THREE.Group): void {
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x5a321b, roughness: 0.95 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xae3423, roughness: 0.75 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.35, 4.8), baseMat);
  base.position.y = 0.18;
  base.castShadow = base.receiveShadow = true;
  parent.add(base);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.3, 1.2, 4), roofMat);
  roof.position.y = 1.05;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = roof.receiveShadow = true;
  parent.add(roof);
}

function addFarmTemple(parent: THREE.Group): boolean {
  if (!templeTemplate) return false;
  const temple = templeTemplate.clone(true);
  temple.position.y = 0.02;
  parent.add(temple);
  return true;
}

function buildPlaceableFarm(f: FarmPlot, seed: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(f.x, terrainHeight(f.x, f.z, seed) + 0.02, f.z);
  g.rotation.y = f.facing;
  g.userData.farmId = f.id;
  if (!addFarmTemple(g)) buildFallbackMarker(g);
  return g;
}

export class FarmsteadView {
  private group = new THREE.Group();
  private signature = '';
  private dirty = true;

  constructor(private scene: THREE.Scene, private world: IWorld, private seed: number) {
    this.group.name = 'player-placeable-farm-temples';
    this.scene.add(this.group);
    loadFarmTemple(() => { this.dirty = true; });
  }

  update(): void {
    const sig = this.world.farms.map((f) => `${f.id}:${f.x.toFixed(1)}:${f.z.toFixed(1)}:${f.facing.toFixed(2)}`).join('|');
    if (!this.dirty && sig === this.signature) return;
    this.dirty = false;
    this.signature = sig;
    this.group.clear();
    for (const farm of this.world.farms) this.group.add(buildPlaceableFarm(farm, this.seed));
  }
}
