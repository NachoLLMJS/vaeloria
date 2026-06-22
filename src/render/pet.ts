import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { Entity } from '../sim/types';
import { groundHeight, WATER_LEVEL } from '../sim/world';
import { loadGltf } from './assets/loader';

export const BAT_PET_MODEL_URL = '/models/pets/rpg_monster_bat.glb';

export class PetFollowerView {
  private root = new THREE.Group();
  private loaded = false;
  private fallback: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private followPos = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private seed: number) {
    this.root.visible = false;
    this.scene.add(this.root);
    this.createFallback();
    void this.load();
  }

  private createFallback(): void {
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 16, 10),
      new THREE.MeshStandardMaterial({ color: 0x6f35d8, roughness: 0.58, emissive: 0x241044, emissiveIntensity: 0.35 }),
    );
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x3f1b7e, roughness: 0.64, side: THREE.DoubleSide, emissive: 0x15051e, emissiveIntensity: 0.2 });
    const wingGeo = new THREE.ConeGeometry(0.42, 0.85, 3);
    const left = new THREE.Mesh(wingGeo, wingMat);
    left.position.set(-0.42, 0.02, 0);
    left.rotation.set(0, 0, Math.PI / 2);
    const right = left.clone();
    right.position.x = 0.42;
    right.rotation.z = -Math.PI / 2;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeMat);
    eyeL.position.set(-0.09, 0.08, 0.28);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.09;
    const g = new THREE.Group();
    g.add(body, left, right, eyeL, eyeR);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    this.fallback = g;
    this.root.add(g);
  }

  private async load(): Promise<void> {
    try {
      const gltf = await loadGltf(BAT_PET_MODEL_URL);
      const model = cloneSkeleton(gltf.scene);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      model.rotation.y = Math.PI;
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      model.scale.setScalar(1.95 / maxDim);
      model.traverse((o) => {
        o.frustumCulled = false;
        if ((o as THREE.Mesh).isMesh) {
          const m = o as THREE.Mesh;
          m.castShadow = true;
          m.receiveShadow = false;
          m.frustumCulled = false;
        }
      });
      if (this.fallback) this.fallback.visible = false;
      this.root.add(model);
      this.mixer = new THREE.AnimationMixer(model);
      const idle = gltf.animations.find((a) => /idle/i.test(a.name)) ?? gltf.animations[0];
      if (idle) this.mixer.clipAction(idle).play();
      this.loaded = true;
    } catch (err) {
      console.warn('Failed to load bat pet model; using fallback', err);
      this.loaded = true;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.mixer = null;
    this.fallback = null;
  }

  update(dt: number, player: Entity, enabled: boolean, time: number): void {
    this.root.visible = enabled && !player.dead;
    if (!this.root.visible) return;
    this.mixer?.update(dt);
    if (this.fallback?.visible) {
      this.fallback.rotation.z = Math.sin(time * 8) * 0.18;
      this.fallback.scale.setScalar(1 + Math.sin(time * 7) * 0.04);
    }

    const side = new THREE.Vector3(Math.cos(player.facing), 0, -Math.sin(player.facing));
    const back = new THREE.Vector3(-Math.sin(player.facing), 0, -Math.cos(player.facing));
    const desired = this.tmp.copy(player.pos)
      .addScaledVector(back, 1.55)
      .addScaledVector(side, 2.45);
    const ground = groundHeight(desired.x, desired.z, this.seed);
    desired.y = Math.max(ground + 3.15, WATER_LEVEL + 1.8) + Math.sin(time * 4.5) * 0.22;

    if (this.followPos.lengthSq() === 0) this.followPos.copy(desired);
    const follow = 1 - Math.exp(-dt * 4.5);
    this.followPos.lerp(desired, follow);
    this.root.position.copy(this.followPos);

    const dx = player.pos.x - this.root.position.x;
    const dz = player.pos.z - this.root.position.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.001) this.root.rotation.y = Math.atan2(dx, dz);
  }
}
