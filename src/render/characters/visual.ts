// Per-entity character visual: a SkeletonUtils clone of a manifest asset with
// its own AnimationMixer, a clip-driven state machine fed by renderer-derived
// state, a baked static idle-pose far LOD, and a shadow-only proxy for the
// mid-distance band. All geometry/materials are shared caches — dispose()
// only releases mixer bindings.
import * as THREE from 'three';
import { GFX } from '../gfx';
import { VisualDef } from './manifest';
import {
  applyMaterials, assembleModel, prepareVisual, tintedFarMaterials,
} from './assets';

/** Renderer-derived animation inputs (same facts the old pose machine used). */
export interface AnimState {
  /** horizontal speed, world units/sec */
  speed: number;
  moving: boolean;
  /** moving against facing (players backpedaling) */
  backwards: boolean;
  dead: boolean;
  casting: boolean;
  chopping?: boolean;
  fishing?: boolean;
  swimming: boolean;
  sitting: boolean;
}

export interface HeldWeaponTransform {
  scale: number;
  px?: number; py?: number; pz?: number;
  rx?: number; ry?: number; rz?: number;
}

type BaseState = 'idle' | 'walk' | 'walkBack' | 'run' | 'cast' | 'chop' | 'swim' | 'sit';

const FADE = 0.22;
const ONESHOT_FADE = 0.1;
// Keep the run gate comfortably above slowed locomotion. Backpedal is
// RUN_SPEED*0.65 ~= 4.55 and rogue Stealth is RUN_SPEED*0.7 ~= 4.9; both sit
// near the old 4.5 cutoff, so tiny interpolation/smoothing dips could flip
// walk<->run every few frames and restart the clip. Only full-speed travel
// should enter the run loop.
const RUN_SPEED_THRESHOLD = 5.5; // u/s — sim walk/wander/slowed movement sit below
const HIT_REACT_COOLDOWN = 0.9;
const DEFAULT_WALK_REF = 2.2;
const DEFAULT_RUN_REF = 7;
// Lie_Idle already lays the rig flat — a touch of extra pitch reads as a
// surface glide; clip-less rigs (creatures) get the full procedural prone
const SWIM_PITCH_CLIP = 0.35;
const SWIM_PITCH_PROCEDURAL = 1.18;
const SWIM_RISE = 0.95; // body must break the surface or only the hat floats
const MIXER_DT_CAP = 0.3; // throttled entities never integrate a huge step
const GHOST_OPACITY = 0.34;

// shared invisible click capsule — raycaster ignores `visible`, render doesn't
let clickGeoSingleton: THREE.CylinderGeometry | null = null;
function clickGeo(): THREE.CylinderGeometry {
  if (!clickGeoSingleton) {
    clickGeoSingleton = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
    clickGeoSingleton.translate(0, 0.5, 0);
  }
  return clickGeoSingleton;
}
let clickMatSingleton: THREE.Material | null = null;
function clickMat(): THREE.Material {
  clickMatSingleton ??= new THREE.MeshBasicMaterial();
  return clickMatSingleton;
}

// shadow-only material: writes neither color nor depth so the main pass
// rasterizes nothing while the shadow pass still renders the proxy
let shadowOnlySingleton: THREE.Material | null = null;
function shadowOnlyMat(): THREE.Material {
  shadowOnlySingleton ??= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  return shadowOnlySingleton;
}

export class CharacterVisual {
  /** add to the entity group; pivot at feet, faces +Z; renderer applies e.scale */
  readonly root = new THREE.Group();
  /** unscaled world-unit height — nameplate anchor = height * e.scale + 0.5 */
  readonly height: number;
  /** invisible capsule for picking (userData.entityId set by the renderer) */
  readonly clickProxy: THREE.Mesh;

  private def: VisualDef;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private model: THREE.Object3D;
  private modelWrap = new THREE.Group();
  private poseWrap = new THREE.Group();
  private farMesh: THREE.Mesh | null = null;
  private farMaterials: THREE.Material | THREE.Material[] | null = null;
  private shadowProxy: THREE.Mesh | null = null;
  private casters: THREE.Mesh[] = [];
  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private ghostMaterials = new Map<THREE.Material, THREE.Material>();
  private originalWeaponVisibility = new Map<THREE.Object3D, boolean>();
  private authoredBowNodes: THREE.Object3D[] = [];
  private authoredBowScaleRoots: THREE.Object3D[] = [];
  private authoredBowOriginalScales = new Map<THREE.Object3D, THREE.Vector3>();
  private craftedBowMaterials = new Map<THREE.Material, THREE.Material>();
  private equippedWeapon: THREE.Object3D | null = null;
  private equippedWeaponTemplate: THREE.Object3D | null = null;
  private hideEquippedWeaponForHarvest = false;
  private harvestTool: THREE.Object3D | null = null;
  private harvestToolTemplate: THREE.Object3D | null = null;
  private fishingPoseBones: { shoulder: THREE.Object3D | null; arm: THREE.Object3D | null; forearm: THREE.Object3D | null; hand: THREE.Object3D | null } | null = null;
  private fishingPoseBase: {
    shoulder: THREE.Quaternion | null;
    arm: THREE.Quaternion | null;
    forearm: THREE.Quaternion | null;
    hand: THREE.Quaternion | null;
    shoulderPos: THREE.Vector3 | null;
    armPos: THREE.Vector3 | null;
    forearmPos: THREE.Vector3 | null;
    handPos: THREE.Vector3 | null;
  } | null = null;
  private fishingPoseActive = false;
  private fishingPoseEuler = new THREE.Euler();
  private fishingPoseQuat = new THREE.Quaternion();
  private fishingPoseShift = new THREE.Vector3();
  private bowBox = new THREE.Box3();
  private bowSize = new THREE.Vector3();
  private bowCenter = new THREE.Vector3();

  private baseState: BaseState = 'idle';
  // preview-only: swap the idle clip (e.g. relaxed 'Idle' instead of the
  // combat 'Idle_Weapon') without touching the in-game clip map.
  private idleClipOverride: string | null = null;
  private current: THREE.AnimationAction | null = null;
  private currentIsOneShot = false;
  private deadLock = false;
  private wasDead = false;
  private initialized = false;
  private attackIdx = 0;
  private hitCooldown = 0;
  private pendingDt = 0;
  private swimPitch = 0;

  private shadowOn = true;
  private far = false;
  private bobPhase = Math.random() * Math.PI * 2;

  constructor(key: string, entityColor: number) {
    const prep = prepareVisual(key);
    this.def = prep.def;
    this.height = prep.def.height;

    // model: yaw/scale/feet normalization wrapper around the skinned clone
    this.model = assembleModel(prep.def);
    applyMaterials(this.model, prep.def, entityColor);
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) this.originalMaterials.set(mesh, mesh.material);
      if (isVisibleWeaponNode(o)) this.originalWeaponVisibility.set(o, o.visible);
      if (/ranger_bow|bow/i.test(o.name)) {
        this.authoredBowNodes.push(o);
        this.authoredBowOriginalScales.set(o, o.scale.clone());
      }
    });
    this.authoredBowScaleRoots = this.authoredBowNodes.filter((node) => {
      for (let p = node.parent; p; p = p.parent) {
        if (this.authoredBowNodes.includes(p)) return false;
      }
      return true;
    });
    this.modelWrap.rotation.y = prep.def.yaw ?? 0;
    this.modelWrap.scale.setScalar(prep.normScale);
    this.modelWrap.position.set(prep.xOffset, prep.yOffset, prep.zOffset);
    this.modelWrap.add(this.model);
    this.poseWrap.add(this.modelWrap);
    this.root.add(this.poseWrap);

    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      // skinned bounds drift outside bind-pose spheres; entity-level culling
      // (80u draw range) already bounds the cost
      if ((mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
      this.casters.push(mesh);
    });

    // far LOD + shadow proxy share the baked idle-pose geometry per key
    if (prep.idleGeo) {
      this.farMesh = new THREE.Mesh(prep.idleGeo, tintedFarMaterials(prep.def, entityColor, prep.idleSrcMats));
      this.farMaterials = this.farMesh.material;
      this.farMesh.visible = false;
      this.poseWrap.add(this.farMesh);
      if (GFX.tier !== 'low') {
        this.shadowProxy = new THREE.Mesh(prep.idleGeo, shadowOnlyMat());
        this.shadowProxy.castShadow = true;
        this.shadowProxy.visible = false;
        this.poseWrap.add(this.shadowProxy);
      }
    }

    // capsule from measured body extents — long/wide creatures (wolves,
    // dragons) were nearly unclickable with a height-derived sliver
    const r = prep.clickRadius;
    this.clickProxy = new THREE.Mesh(clickGeo(), clickMat());
    this.clickProxy.scale.set(r * 2, this.height, r * 2);
    this.clickProxy.visible = false;
    this.root.add(this.clickProxy);

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const name of clipNamesOf(prep.def)) {
      const clip = prep.clips.get(name);
      if (clip) this.actions.set(name, this.mixer.clipAction(clip));
    }
    this.mixer.addEventListener('finished', (ev) => this.onFinished(ev.action));

    const idle = this.action(this.def.clips.idle);
    if (idle) {
      idle.play();
      this.current = idle;
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  /** `animate=false` skips mixer integration (distance throttling); state
   *  edges still latch so the pose catches up when the entity nears. */
  update(dt: number, s: AnimState, animate: boolean): void {
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);

    // death is a level sim-side — edge-trigger the clip locally
    if (s.dead && !this.wasDead) this.enterDeath();
    else if (!s.dead && this.wasDead) this.revive();
    this.wasDead = s.dead;
    this.initialized = true;

    if (!this.deadLock) {
      const desired = this.desiredBase(s);
      if (desired !== this.baseState) {
        this.baseState = desired;
        if (!this.currentIsOneShot) this.fadeTo(this.baseAction(), FADE, false);
      }
      // foot-speed matching on locomotion cycles
      if (!this.currentIsOneShot && this.current) {
        if (this.baseState === 'walk' || this.baseState === 'walkBack') {
          this.current.timeScale = clamp(s.speed / (this.def.walkRef ?? DEFAULT_WALK_REF), 0.6, 1.8);
        } else if (this.baseState === 'run') {
          this.current.timeScale = clamp(s.speed / (this.def.runRef ?? DEFAULT_RUN_REF), 0.6, 1.6);
        }
      }
    }

    // swim pose: Lie_Idle (when the rig has it) + pitch and surface bob
    const proneAngle = this.action(this.def.clips.swim) ? SWIM_PITCH_CLIP : SWIM_PITCH_PROCEDURAL;
    const wantPitch = s.swimming && !s.dead ? proneAngle : 0;
    this.swimPitch += (wantPitch - this.swimPitch) * Math.min(1, dt * 8);
    this.poseWrap.rotation.x = this.swimPitch;
    this.poseWrap.position.y = s.swimming && !s.dead
      ? SWIM_RISE + Math.sin(performance.now() / 500 + this.bobPhase) * 0.08
      : 0;

    // distant corpses show the static idle far mesh — tip it over
    if (this.farMesh && this.farMesh.visible) {
      if (s.dead) {
        this.farMesh.rotation.z = Math.PI / 2;
        this.farMesh.position.y = this.height * 0.16;
      } else {
        this.farMesh.rotation.z = 0;
        this.farMesh.position.y = 0;
      }
    }

    this.pendingDt = Math.min(MIXER_DT_CAP, this.pendingDt + dt);
    if (animate) {
      this.mixer.update(this.pendingDt);
      this.pendingDt = 0;
    }
    this.applyFishingArmPose(s.fishing && !s.dead ? 1 : 0);
  }

  // -------------------------------------------------------------------------
  // One-shot triggers (sim events)
  // -------------------------------------------------------------------------

  playAttack(): void {
    if (this.deadLock) return;
    const clips = this.def.clips.attack;
    if (clips.length === 0) return;
    const name = clips[this.attackIdx++ % clips.length];
    this.playOneShot(name, this.def.attackTimeScale ?? 1.3);
  }

  playHit(): void {
    if (this.deadLock || this.currentIsOneShot || this.hitCooldown > 0) return;
    const clips = this.def.clips.hit;
    if (!clips || clips.length === 0) return;
    this.hitCooldown = HIT_REACT_COOLDOWN;
    this.playOneShot(clips[Math.floor(Math.random() * clips.length)], 1.2);
  }

  // -------------------------------------------------------------------------
  // LOD / shadow plumbing (memoized — called every frame by the renderer)
  // -------------------------------------------------------------------------

  setShadow(on: boolean): void {
    if (on === this.shadowOn) return;
    this.shadowOn = on;
    for (const m of this.casters) m.castShadow = on;
  }

  setProxyShadow(on: boolean): void {
    if (this.shadowProxy) this.shadowProxy.visible = on;
  }

  setFar(far: boolean): void {
    if (far === this.far) return;
    this.far = far;
    this.modelWrap.visible = !far || !this.farMesh;
    if (this.farMesh) this.farMesh.visible = far;
  }

  get isFar(): boolean {
    return this.far;
  }

  setGhost(on: boolean): void {
    for (const [mesh, original] of this.originalMaterials) {
      mesh.material = on ? this.toGhostMaterial(original) : original;
    }
    if (this.farMesh && this.farMaterials) {
      this.farMesh.material = on ? this.toGhostMaterial(this.farMaterials) : this.farMaterials;
    }
  }

  setHarvestTool(template: THREE.Object3D | null, active: boolean, progress: number): void {
    this.hideEquippedWeaponForHarvest = active;
    for (const [node, wasVisible] of this.originalWeaponVisibility) {
      node.visible = active ? false : wasVisible;
    }
    if (!active) {
      if (this.harvestTool) this.harvestTool.visible = false;
      if (this.equippedWeapon) this.equippedWeapon.visible = !!this.equippedWeaponTemplate;
      return;
    }
    if (this.equippedWeapon) this.equippedWeapon.visible = false;
    if (this.harvestTool && this.harvestToolTemplate !== template) {
      this.harvestTool.removeFromParent();
      this.harvestTool = null;
      this.harvestToolTemplate = null;
    }
    if (!this.harvestTool && template) {
      const bone = this.findHandBone();
      if (bone) {
        const tool = template.clone(true);
        tool.name = template.name || 'Harvest_Tool_Attached';
        tool.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = false;
          }
        });
        // WeaponR already carries the authored Warrior_Sword transform. Use the
        // same local basis so tools sit in the palm. The fishing pose is now a
        // steady hold: no cast snap, and the rod's long axis is flipped upward
        // instead of hanging toward the floor.
        const isRod = /rod|fishing/i.test(template.name);
        if (isRod) tool.scale.setScalar(0.30);
        else tool.scale.setScalar(0.42);
        tool.position.set(isRod ? -0.055 : -0.05, isRod ? 0.18 : 0.085, isRod ? -0.11 : -0.045);
        tool.rotation.set(isRod ? -1.08 : -3.03, isRod ? 0.28 : 0, isRod ? 1.42 : 1.57);
        bone.add(tool);
        this.harvestTool = tool;
        this.harvestToolTemplate = template;
      }
    }
    if (!this.harvestTool) return;
    this.harvestTool.visible = true;
    const swing = Math.sin(progress * Math.PI * 12);
    const isRod = /rod|fishing/i.test(this.harvestTool.name);
    if (isRod) {
      // Fishing should be a stable hold only. Do not derive rod rotation from
      // cast progress: network snapshots can make progress jump visually, which
      // reads as a repeated cast/throw reset.
      this.harvestTool.rotation.set(-1.08, 0.28, 1.42);
      this.harvestTool.position.set(-0.055, 0.18, -0.11);
    } else this.harvestTool.rotation.set(-3.03 + swing * 0.22, 0, 1.57 + swing * 0.12);
  }

  setEquippedWeapon(template: THREE.Object3D | null, transform: HeldWeaponTransform | null): void {
    const active = !!template && !!transform;
    const useAuthoredBow = active && !!template && /bow/i.test(template.name) && this.authoredBowNodes.length > 0;
    if (this.hideEquippedWeaponForHarvest) {
      for (const [node] of this.originalWeaponVisibility) node.visible = false;
      for (const node of this.authoredBowNodes) node.visible = false;
      if (this.equippedWeapon) this.equippedWeapon.visible = false;
      return;
    }
    for (const [node, wasVisible] of this.originalWeaponVisibility) node.visible = active && !useAuthoredBow ? false : wasVisible;
    if (!useAuthoredBow) this.applyAuthoredBowStyle(false);
    if (useAuthoredBow) {
      // Quaternius ranger already has a correctly socketed/animated bow on
      // Weapon.R. External bow models had incompatible pivots, so crafted/golden
      // hunter weapons reuse the authored bow pose. The crafted bow gets a
      // chunky purple skin on that stable default geometry.
      const craftedPurpleBow = /bow_wooden|wooden/i.test(template.name);
      this.applyAuthoredBowStyle(craftedPurpleBow);
      for (const node of this.authoredBowNodes) node.visible = true;
      if (this.equippedWeapon) this.equippedWeapon.visible = false;
      return;
    }
    if (!active) {
      if (this.equippedWeapon) this.equippedWeapon.visible = false;
      return;
    }
    if (this.equippedWeapon && this.equippedWeaponTemplate !== template) {
      this.equippedWeapon.removeFromParent();
      this.equippedWeapon = null;
      this.equippedWeaponTemplate = null;
    }
    if (!this.equippedWeapon && template && transform) {
      const bone = this.findHandBone();
      if (!bone) return;
      const weapon = this.cloneEquippedWeapon(template);
      weapon.name = template.name || 'Equipped_Weapon_Attached';
      weapon.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = false;
        }
      });
      bone.add(weapon);
      this.equippedWeapon = weapon;
      this.equippedWeaponTemplate = template;
    }
    if (!this.equippedWeapon || !transform) return;
    this.equippedWeapon.visible = true;
    this.equippedWeapon.scale.setScalar(transform.scale);
    this.equippedWeapon.position.set(transform.px ?? -0.05, transform.py ?? 0.085, transform.pz ?? -0.045);
    this.equippedWeapon.rotation.set(transform.rx ?? -3.03, transform.ry ?? 0, transform.rz ?? 1.57);
  }

  private applyAuthoredBowStyle(craftedPurple: boolean): void {
    const scale = craftedPurple ? 1.32 : 1;
    for (const node of this.authoredBowScaleRoots) {
      const original = this.authoredBowOriginalScales.get(node);
      if (original) node.scale.copy(original).multiplyScalar(scale);
    }
    for (const node of this.authoredBowNodes) {
      node.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const original = this.originalMaterials.get(mesh);
        if (!original) return;
        if (!craftedPurple) {
          mesh.material = original;
          return;
        }
        const applyPurple = (mat: THREE.Material): THREE.Material => {
          let purple = this.craftedBowMaterials.get(mat);
          if (!purple) {
            purple = mat.clone();
            const maybeColored = purple as THREE.MeshStandardMaterial | THREE.MeshPhongMaterial;
            if ('color' in maybeColored) maybeColored.color.setHex(0x8b2cff);
            if ('emissive' in maybeColored) maybeColored.emissive.setHex(0x240044);
            if ('roughness' in maybeColored) maybeColored.roughness = 0.55;
            if ('metalness' in maybeColored) maybeColored.metalness = 0.18;
            this.craftedBowMaterials.set(mat, purple);
          }
          return purple;
        };
        mesh.material = Array.isArray(original) ? original.map(applyPurple) : applyPurple(original);
      });
    }
  }

  private cloneEquippedWeapon(template: THREE.Object3D): THREE.Object3D {
    const clone = template.clone(true);
    if (!/bow/i.test(template.name)) return clone;

    clone.updateMatrixWorld(true);
    this.bowBox.setFromObject(clone);
    this.bowBox.getSize(this.bowSize);
    this.bowBox.getCenter(this.bowCenter);

    const root = new THREE.Group();
    root.name = template.name || 'Equipped_Bow_GripRoot';
    // The armaduras FBX bows have their origin around the model centre, while
    // the rig socket expects the origin to be at the grip. Re-anchor the model
    // inside a wrapper so local 0,0,0 is the hand grip, matching the authored
    // bow that already sits correctly on WeaponR.
    clone.position.set(
      -this.bowCenter.x,
      -this.bowCenter.y,
      -this.bowCenter.z,
    );
    // Move the visible bow slightly forward/down from the grip so the handle,
    // not the string/tip, lands inside the palm. These are pre-scale local FBX
    // units, intentionally proportional to the measured bounds.
    clone.position.x += this.bowSize.x * 0.10;
    clone.position.y -= this.bowSize.y * 0.03;
    clone.position.z += this.bowSize.z * 0.38;
    root.add(clone);
    return root;
  }

  private applyFishingArmPose(amount: number): void {
    if (amount <= 0) {
      const bones = this.getFishingPoseBones();
      const base = this.fishingPoseBase;
      if (base) {
        if (bones.shoulder && base.shoulderPos) bones.shoulder.position.copy(base.shoulderPos);
        if (bones.arm && base.armPos) bones.arm.position.copy(base.armPos);
        if (bones.forearm && base.forearmPos) bones.forearm.position.copy(base.forearmPos);
        if (bones.hand && base.handPos) bones.hand.position.copy(base.handPos);
      }
      this.fishingPoseActive = false;
      this.fishingPoseBase = null;
      return;
    }
    const bones = this.getFishingPoseBones();
    if (!this.fishingPoseActive || !this.fishingPoseBase) {
      // Capture the current local bone quaternions once when fishing starts.
      // The hold pose is then applied from this frozen base every frame, so the
      // idle clip can loop underneath without resetting the arm/rod visually.
      this.fishingPoseBase = {
        shoulder: bones.shoulder ? bones.shoulder.quaternion.clone() : null,
        arm: bones.arm ? bones.arm.quaternion.clone() : null,
        forearm: bones.forearm ? bones.forearm.quaternion.clone() : null,
        hand: bones.hand ? bones.hand.quaternion.clone() : null,
        shoulderPos: bones.shoulder ? bones.shoulder.position.clone() : null,
        armPos: bones.arm ? bones.arm.position.clone() : null,
        forearmPos: bones.forearm ? bones.forearm.position.clone() : null,
        handPos: bones.hand ? bones.hand.position.clone() : null,
      };
      this.fishingPoseActive = true;
    }
    const base = this.fishingPoseBase;
    if (!base) return;
    const apply = (bone: THREE.Object3D | null, baseQuat: THREE.Quaternion | null, x: number, y: number, z: number): void => {
      if (!bone || !baseQuat) return;
      this.fishingPoseEuler.set(x * amount, y * amount, z * amount, 'XYZ');
      this.fishingPoseQuat.setFromEuler(this.fishingPoseEuler);
      bone.quaternion.copy(baseQuat).multiply(this.fishingPoseQuat);
    };
    const shift = (bone: THREE.Object3D | null, basePos: THREE.Vector3 | null, x: number, y: number, z: number): void => {
      if (!bone || !basePos) return;
      bone.position.copy(basePos).addScaledVector(this.fishingPoseShift.set(x, y, z), amount);
    };
    // Move the visible right-arm chain away from the torso. For the Quaternius
    // Rogue rig, positive local X/Z is the direction that pulls the fist out of
    // the belly and toward the water; the previous negative shift pushed it in.
    shift(bones.shoulder, base.shoulderPos, 0.010, 0.004, 0.008);
    shift(bones.arm, base.armPos, 0.095, 0.018, 0.080);
    shift(bones.forearm, base.forearmPos, 0.125, 0.010, 0.105);
    shift(bones.hand, base.handPos, 0.110, 0.006, 0.095);
    // Fishing hold: use the real fist bones for the pose and keep the wrist
    // forward/outside instead of folded into the waist.
    apply(bones.shoulder, base.shoulder, -0.18, 0.18, 0.28);
    apply(bones.arm, base.arm, -0.62, 0.42, 0.62);
    apply(bones.forearm, base.forearm, -0.68, -0.10, -0.22);
    apply(bones.hand, base.hand, -0.14, -0.08, 0.08);
  }

  private getFishingPoseBones(): { shoulder: THREE.Object3D | null; arm: THREE.Object3D | null; forearm: THREE.Object3D | null; hand: THREE.Object3D | null } {
    if (this.fishingPoseBones) return this.fishingPoseBones;
    const find = (...names: string[]): THREE.Object3D | null => {
      for (const name of names) {
        const direct = this.model.getObjectByName(name) ?? this.model.getObjectByName(name.replace(/[.[\]:]/g, ''));
        if (direct) return direct;
      }
      const lowered = names.map((n) => n.toLowerCase().replace(/[.[\]:]/g, ''));
      let found: THREE.Object3D | null = null;
      this.model.traverse((o) => {
        if (found) return;
        const n = o.name.toLowerCase().replace(/[.[\]:]/g, '');
        if (lowered.some((want) => n === want || n.endsWith(want))) found = o;
      });
      return found;
    };
    this.fishingPoseBones = {
      shoulder: find('ShoulderR', 'Shoulder.R', 'mixamorigRightShoulder', 'RightShoulder'),
      arm: find('ArmR', 'Arm1R', 'UpperArmR', 'Arm.R', 'mixamorigRightArm', 'RightArm'),
      forearm: find('ForeArmR', 'ForearmR', 'LowerArmR', 'Arm2R', 'ForeArm.R', 'mixamorigRightForeArm', 'RightForeArm'),
      hand: find('Fist2R', 'Fist2.R', 'Fist1R', 'Fist1.R', 'FistR', 'Fist.R', 'HandR', 'Hand.R', 'mixamorigRightHand', 'RightHand'),
    };
    return this.fishingPoseBones;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.root.removeFromParent();
    // SkeletonUtils.clone gives each instance exclusive Skeletons whose GPU
    // bone textures the renderer allocates lazily — release them here or
    // online interest churn strands one per despawned entity. Geometries and
    // materials remain shared per-asset caches and are never disposed.
    const skeletons = new Set<THREE.Skeleton>();
    this.model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh && sm.skeleton) skeletons.add(sm.skeleton);
    });
    for (const skeleton of skeletons) skeleton.dispose();
  }

  // -------------------------------------------------------------------------
  // State machine internals
  // -------------------------------------------------------------------------

  private desiredBase(s: AnimState): BaseState {
    if (s.swimming) return 'swim';
    // Fishing should not play the generic spell-cast/launch animation. Keep the
    // base body calm; the fixed right-arm fishing pose below holds the rod.
    if (s.fishing) return 'idle';
    if (s.chopping) return 'chop';
    if (s.casting) return 'cast';
    if (s.sitting) return 'sit';
    if (s.moving) {
      if (s.backwards) return this.def.clips.walkBack ? 'walkBack' : 'walk';
      return s.speed >= RUN_SPEED_THRESHOLD ? 'run' : 'walk';
    }
    return 'idle';
  }

  private toGhostMaterial<T extends THREE.Material | THREE.Material[]>(material: T): T {
    if (Array.isArray(material)) return material.map((m) => this.ghostMaterial(m)) as T;
    return this.ghostMaterial(material) as T;
  }

  private ghostMaterial(material: THREE.Material): THREE.Material {
    const cached = this.ghostMaterials.get(material);
    if (cached) return cached;
    const ghost = material.clone();
    ghost.transparent = true;
    ghost.opacity = GHOST_OPACITY;
    ghost.depthWrite = false;
    this.ghostMaterials.set(material, ghost);
    return ghost;
  }

  private action(name: string | undefined): THREE.AnimationAction | null {
    return name ? this.actions.get(name) ?? null : null;
  }

  private baseAction(): THREE.AnimationAction | null {
    const c = this.def.clips;
    switch (this.baseState) {
      case 'walk': return this.action(c.walk) ?? this.action(c.idle);
      case 'walkBack': return this.action(c.walkBack) ?? this.action(c.walk);
      case 'run': return this.action(c.run) ?? this.action(c.walk);
      case 'cast': return this.action(c.cast) ?? this.action(c.idle);
      case 'chop': return this.action(c.attack[0]) ?? this.action(c.cast) ?? this.action(c.idle);
      case 'swim': return this.action(c.swim) ?? this.action(c.idle);
      case 'sit': return this.action(c.sitDown) ?? this.action(c.sitIdle) ?? this.action(c.idle);
      default: return this.action(this.idleClipOverride ?? c.idle) ?? this.action(c.idle);
    }
  }

  /** Preview-only: force a different idle clip (relaxed front-facing pose).
   *  Pass null to restore the clip-map idle. */
  setIdleClip(name: string | null): void {
    this.idleClipOverride = name;
    if (this.baseState === 'idle' && !this.currentIsOneShot) {
      const a = this.action(name ?? this.def.clips.idle) ?? this.action(this.def.clips.idle);
      if (a && a !== this.current) this.fadeTo(a, 0.2, false);
    }
  }

  private fadeTo(next: THREE.AnimationAction | null, fade: number, oneShot: boolean): void {
    if (!next) return;
    if (next === this.current && !oneShot) return;
    const prev = this.current;
    next.reset();
    next.setLoop(oneShot || this.isOnce(next) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = true;
    next.timeScale = 1;
    if (prev && prev !== next) prev.fadeOut(fade);
    next.fadeIn(fade).play();
    this.current = next;
    this.currentIsOneShot = oneShot;
  }

  /** sit-down transitions play once, then hand off to the sit-idle loop */
  private isOnce(a: THREE.AnimationAction): boolean {
    return this.baseState === 'sit' && a === this.action(this.def.clips.sitDown);
  }

  private playOneShot(name: string, timeScale: number): void {
    const a = this.action(name);
    if (!a) return;
    const prev = this.current;
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    // clamp on the last frame: an unclamped LoopOnce action zeroes its weight
    // the instant it finishes, which blends the rig toward bind pose for the
    // whole 0.18s hand-off fade (a visible T-pose pop after every swing)
    a.clampWhenFinished = true;
    a.timeScale = timeScale;
    if (prev && prev !== a) prev.fadeOut(ONESHOT_FADE);
    a.fadeIn(ONESHOT_FADE).play();
    this.current = a;
    this.currentIsOneShot = true;
  }

  private onFinished(a: THREE.AnimationAction): void {
    if (this.deadLock) return; // death clip clamps on its last frame
    if (this.baseState === 'sit' && a === this.action(this.def.clips.sitDown)) {
      this.fadeTo(this.action(this.def.clips.sitIdle) ?? a, 0.25, false);
      return;
    }
    if (a === this.current) {
      this.currentIsOneShot = false;
      this.fadeTo(this.baseAction(), 0.18, false);
    }
  }

  private enterDeath(): void {
    this.deadLock = true;
    this.currentIsOneShot = false;
    const death = this.action(this.def.clips.death);
    if (!death) return;
    const prev = this.current;
    death.reset();
    death.setLoop(THREE.LoopOnce, 1);
    death.clampWhenFinished = true;
    death.timeScale = 1.15;
    if (!this.initialized) {
      // created already-dead (corpse entering interest): snap to the end pose
      if (prev && prev !== death) prev.stop();
      death.play();
      death.time = Math.max(0, death.getClip().duration - 1e-3);
      this.current = death;
      this.mixer.update(0);
      return;
    }
    if (prev && prev !== death) prev.fadeOut(ONESHOT_FADE);
    death.fadeIn(ONESHOT_FADE).play();
    this.current = death;
  }

  private revive(): void {
    this.deadLock = false;
    this.baseState = 'idle';
    const death = this.action(this.def.clips.death);
    if (death) death.stop();
    const flourish = this.action(this.def.clips.flourish);
    if (flourish) {
      // skeletons claw back out of the ground; bosses taunt
      this.current = null;
      this.playOneShot(this.def.clips.flourish!, 1);
    } else {
      this.fadeTo(this.action(this.def.clips.idle), 0.2, false);
    }
  }

  private findHandBone(): THREE.Object3D | null {
    // Quaternius rigs use names without punctuation (WeaponR/Fist1R), while
    // some KayKit rigs use dotted suffixes. Prefer the dedicated weapon socket
    // when present so held tools follow the authored hand/weapon animation.
    return this.model.getObjectByName('WeaponR')
      ?? this.model.getObjectByName('Fist1R')
      ?? this.model.getObjectByName('FistR')
      ?? this.model.getObjectByName('HandR')
      ?? this.model.getObjectByName('Weapon.R')
      ?? this.model.getObjectByName('Fist1.R')
      ?? this.model.getObjectByName('Fist.R')
      ?? this.model.getObjectByName('Hand.R')
      ?? null;
  }
}

function isVisibleWeaponNode(o: THREE.Object3D): boolean {
  // Only hide visible weapon meshes. Do not hide weapon/hand bones like
  // WeaponR, or any newly attached tool becomes invisible with its parent.
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh) return false;
  const n = o.name.toLowerCase();
  if (n.includes('shoulder')) return false;
  return /weapon|sword|dagger|bow|staff|mace|axe/.test(n);
}

function clipNamesOf(def: VisualDef): string[] {
  const c = def.clips;
  return [
    c.idle, c.walk, c.run, c.death,
    ...(c.attack ?? []), ...(c.hit ?? []),
    c.cast, c.sitDown, c.sitIdle, c.swim, c.walkBack, c.flourish,
  ].filter((n): n is string => !!n);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
