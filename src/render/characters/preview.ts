import * as THREE from 'three';
import { CharacterVisual } from './visual';
import { PlayerClass } from '../../sim/types';
import { loadGltf, loadTexture } from '../assets/loader';
import { buildSky, SkyView } from '../sky';
import { SUN_ANCHOR, GFX } from '../gfx';
import { EffectComposer, RenderPass, EffectPass, GodRaysEffect, KernelSize } from 'postprocessing';

const PREVIEW_ANIM_STATE = {
  speed: 0,
  moving: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  sitting: false,
};

export class CharacterPreview {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private characterGroup: THREE.Group;
  private currentVisual: CharacterVisual | null = null;
  private clock = new THREE.Clock();
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Drag controls
  private isDragging = false;
  private previousMouseX = 0;
  // last synced container size, so a full-screen resize re-fixes the aspect
  private lastW = 0;
  private lastH = 0;
  private skyView: SkyView | null = null; // real game sky dome (follows camera)
  // real volumetric god rays via the postprocessing GodRaysEffect; sunMesh is the
  // light source the effect samples (trees/castle occluding it carve the shafts)
  private composer!: EffectComposer;
  private sunMesh!: THREE.Mesh;
  // sun direction: far back (z) so it sits well beyond the castle, low enough to
  // peek just above the wall and stay inside the camera frame (source for rays)
  private psun = new THREE.Vector3(0.31, 0.218, -0.925).normalize();
  private time = 0;

  constructor(container: HTMLElement, canvas: HTMLCanvasElement) {
    this.container = container;
    this.canvas = canvas;

    // 1. Initialize WebGLRenderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight, false);
    this.renderer.shadowMap.enabled = true; // soft sun shadows on the yard (one extra pass)
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // match the in-game vale look: ACES tone mapping + the game's exposure
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    // 2. Initialize Scene
    this.scene = new THREE.Scene();

    // 3. Initialize Camera (far plane must clear the 560u sky dome + big ground)
    this.camera = new THREE.PerspectiveCamera(
      45,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      2000
    );
    this.camera.position.set(0, 1.62, 4.0);
    this.camera.lookAt(new THREE.Vector3(0, 1.25, 0));

    // 4. Initialize Character Group
    this.characterGroup = new THREE.Group();
    this.scene.add(this.characterGroup);

    // 5. Lights — hemi ambient + a visible sun (upper-front) that rim-lights
    // the hero and feeds the god-rays, plus a camera-side fill for the front.
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x46603a, 0.45);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffdda2, 2.7); // warm golden back-sun
    sun.position.copy(this.psun).multiplyScalar(60);
    // the sun is the single shadow caster; frustum tightened to the yard so the
    // shadows stay crisp, with normalBias to kill acne on the low grazing angle
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 24;
    sun.shadow.camera.far = 110;
    sun.shadow.camera.left = -26;
    sun.shadow.camera.right = 26;
    sun.shadow.camera.top = 26;
    sun.shadow.camera.bottom = -26;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xeae0d2, 1.05);
    fill.position.set(0.6, 3, 9);
    this.scene.add(fill);
    this.buildSunAndGodRays();

    // 6. The real game sky dome + HDRI image-based lighting (what makes the
    // live world look good). buildSky reads preloaded HDRIs; envTexture is null
    // on the low tier, in which case we just keep the lit dome + lights.
    const lowGfx = !GFX.standardMaterials;
    this.skyView = buildSky(lowGfx, SUN_ANCHOR);
    this.scene.add(this.skyView.dome);
    // lift the sky's radiance gain a touch (only in this preview) for a lighter,
    // clearer sky than the in-game vale tune — the static camera never triggers a
    // biome change, so setCameraZ won't reset this back to the default tune.
    {
      const skyMat = this.skyView.dome.material as THREE.ShaderMaterial;
      if (skyMat.uniforms?.uTuneA) skyMat.uniforms.uTuneA.value.x = 0.92;
      if (skyMat.uniforms?.uTuneB) skyMat.uniforms.uTuneB.value.x = 0.92;
    }
    const envEq = this.skyView.envTexture('vale');
    if (envEq) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const rt = pmrem.fromEquirectangular(envEq);
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = 0.42;
      this.scene.environmentRotation.y = this.skyView.envRotationY('vale');
      pmrem.dispose();
    }
    this.scene.fog = new THREE.Fog(0xa6c6e0, 75, 340);

    // 7. Ground — a big grass plane with anisotropy + mipmaps + a normal map so
    // it stops striping/streaking the way the naive tiled circle did.
    Promise.all([
      loadTexture('/textures/terrain/Grass001_Color.jpg', { srgb: true, repeat: true }),
      loadTexture('/textures/terrain/Grass001_NormalGL.jpg', { srgb: false, repeat: true }),
    ]).then(([col, norm]) => {
      const aniso = this.renderer.capabilities.getMaxAnisotropy();
      for (const t of [col, norm]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(80, 80); t.anisotropy = aniso; }
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(560, 560),
        new THREE.MeshStandardMaterial({ map: col, normalMap: norm, normalScale: new THREE.Vector2(0.7, 0.7), color: 0x6f8a4a, roughness: 0.97, metalness: 0 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      this.scene.add(ground);
    }).catch(() => {});

    // 8. The real castle town behind the hero — stripped of the embedded base
    // plane + NPC/animal meshes (the same regex the game uses) and scaled big.
    loadGltf('/models/props/castle_town.glb').then((g) => {
      const m = g.scene.clone(true);
      const strip = /^(65\.002|Object_339|CharTxt_MAT|Animals_MAT)$/;
      const kill: THREE.Object3D[] = [];
      m.traverse((o) => { if (strip.test(o.name)) kill.push(o); });
      kill.forEach((o) => o.parent && o.parent.remove(o));
      const sz = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
      m.scale.setScalar(120 / Math.max(sz.x, sz.z)); // big walls looming behind
      m.rotation.y = Math.PI; // gate faces the camera (game convention)
      const minY = new THREE.Box3().setFromObject(m).min.y;
      // sink it a bit so the model's pale base slab hides under the grass
      m.position.set(0, -minY - 2.6, -68);
      this.scene.add(m);
    }).catch(() => {});

    // 9. Foliage framing the hero
    const placeModel = (url: string, x: number, z: number, scale: number, ry: number) => {
      loadGltf(url).then((g) => {
        const t = g.scene.clone(true);
        t.position.set(x, 0, z);
        t.scale.setScalar(scale);
        t.rotation.y = ry;
        t.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
        this.scene.add(t);
      }).catch(() => {});
    };
    // Only the boxy-canopy trees (woc_new/Tree_*). They flank BOTH sides of the
    // yard and recede toward the castle like the grass — shrinking as they near
    // the wall — kept off-centre so they never block the hero or the gate.
    const scatterTrees = async () => {
      const trees = await Promise.all([
        loadGltf('/models/foliage/woc_new/Tree_1.glb'),
        loadGltf('/models/foliage/woc_new/Tree_2.glb'),
        loadGltf('/models/foliage/woc_new/Tree_3.glb'),
      ]);
      let ti = 0;
      for (let z = -1; z >= -17; z -= 1.0) {
        const depth = Math.min(1, -(z + 1) / 16);   // 0 front .. 1 near the wall
        const scale = 2.0 - depth * 1.5;            // big in front -> small by the castle
        // two lanes per side near the camera fill the side bands; one lane far
        // away (perspective compresses them anyway) — denser, no empty zones
        const lanes = depth < 0.55 ? 2 : 1;
        for (const sign of [-1, 1]) {
          for (let lane = 0; lane < lanes; lane++) {
            const src = trees[ti % 3];
            const t = src.scene.clone(true);
            const x = sign * (4.4 + lane * 2.9 + depth * 3.0 + Math.random() * 1.0);
            // keep a clear gap on the right around the camera->sun ray so the
            // deterministic occluder tree (added after this) is the only canopy
            // biting the sun — random trees here would bury it (kills the shafts)
            const xRay = (4 - z) / (-this.psun.z) * this.psun.x;
            if (sign > 0 && z < -6 && z > -15 && Math.abs(x - xRay) < 2.4) continue;
            t.position.set(x, 0, z + (Math.random() - 0.5) * 1.1);
            t.scale.setScalar(scale * (0.82 + Math.random() * 0.32));
            t.rotation.y = Math.random() * Math.PI * 2;
            t.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
            this.scene.add(t);
            ti++;
          }
        }
      }
    };
    scatterTrees().catch(() => {});
    // the god-ray occluder: the sun ray passes ~(x5.2, y5.4) at z-10. Tree_2 is
    // 6.65 tall, so scale 1.18 (canopy ~y3..7.8) sits it at the sun's height;
    // planted right of the ray so the sun peeks at its LEFT edge (the bulk hides
    // behind the right panel) — that bright sliver throws the dramatic shafts.
    placeModel('/models/foliage/woc_new/Tree_2.glb', 7.25, -10, 1.07, 0.7);
    // rocks scattered in the yard (also shrinking toward the castle)
    placeModel('/models/foliage/rock_1.glb', -5.2, -2.6, 0.9, 0.3);
    placeModel('/models/foliage/rock_2.glb', 5.4, -3.0, 0.85, 1.5);
    placeModel('/models/foliage/rock_3.glb', -3.4, -5.6, 0.55, 1.1);
    placeModel('/models/foliage/rock_1.glb', 3.6, -6.4, 0.45, 0.6);
    // Dense grass carpet covering the whole yard up to the castle wall. The wall
    // base is sunk underground (fine) — grass should reach the visible wall, so we
    // scatter clones in a jittered grid out to ~z-11. Each GLB loads once (then
    // many cheap clones). Tufts shrink toward the wall to keep the depth reading.
    const scatterGrass = async () => {
      const [big, small] = await Promise.all([
        loadGltf('/models/foliage/woc_new/Grass_Big.glb'),
        loadGltf('/models/foliage/woc_new/Grass_Small.glb'),
      ]);
      let gi = 0;
      for (let z = -0.5; z >= -30; z -= 0.95) {
        const depth = Math.min(1, -z / 30);        // 0 front .. 1 by the wall
        const rowScale = 0.85 - depth * 0.35;      // shorter overall, front trimmed most; gentle taper to the wall
        const halfW = 12 - depth * 5;              // taper with distance (stays wide enough to meet the wall)
        for (let x = -halfW; x <= halfW; x += 1.5) {
          // keep the hero's footprint a little clearer in the very near rows
          if (Math.abs(x) < 1.5 && z > -2.3) continue;
          const src = (gi % 3 === 0) ? small : big;
          const t = src.scene.clone(true);
          t.position.set(x + (Math.random() - 0.5) * 1.2, 0, z + (Math.random() - 0.5) * 0.7);
          t.scale.setScalar(rowScale * (0.72 + Math.random() * 0.4));
          t.rotation.y = Math.random() * Math.PI * 2;
          t.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.receiveShadow = true; });
          this.scene.add(t);
          gi++;
        }
      }
    };
    scatterGrass().catch(() => {});
    // a little ground dressing up close
    placeModel('/models/foliage/woc_new/Bush.glb', -5.8, -3.4, 0.9, 0.5);
    placeModel('/models/foliage/woc_new/Flowers_1.glb', 2.9, -2.0, 1.0, 1.5);
    placeModel('/models/foliage/woc_new/Plant_2.glb', -3.0, -2.2, 1.0, 2.1);

    // 6. Setup Drag Controls
    this.setupDragControls();

    // 7. Setup Resize Observer
    this.setupResizeObserver();

    // 8. Start loop
    this.animate();
  }

  /** Set the active character model by player class. */
  setClass(cls: PlayerClass): void {
    // Clean up current visual if it exists
    if (this.currentVisual) {
      this.characterGroup.remove(this.currentVisual.root);
      // CharacterVisual dispose only releases mixer listeners
      this.currentVisual = null;
    }

    try {
      // Load the CharacterVisual from preloaded assets (e.g. player_warrior)
      const visualKey = `player_${cls}`;
      this.currentVisual = new CharacterVisual(visualKey, 0xffffff);
      this.characterGroup.add(this.currentVisual.root);
      this.currentVisual.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      // relaxed front-facing idle for the hero shot (not the combat stance)
      this.currentVisual.setIdleClip('Idle');

      // Face the camera (WoW-style hero shot).
      this.characterGroup.rotation.y = 0;
      // a touch left of dead-centre to sit in the gap between the side panels
      this.characterGroup.position.set(-0.25, 0, 0);
    } catch (err) {
      console.error(`Failed to load preview character visual for ${cls}:`, err);
    }
  }

  /** Dynamically shift the canvas to a new container */
  setContainer(container: HTMLElement): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.container = container;
    this.container.appendChild(this.canvas);

    // Sync once now and again after layout/transition. The start-screen panels
    // fade between hidden/visible states, so the first measurement can be 0x0
    // when entering Offline Mode directly or after returning from Privy login.
    this.syncSize();
    requestAnimationFrame(() => this.syncSize());
    window.setTimeout(() => this.syncSize(), 250);

    // Re-observe the new container
    this.setupResizeObserver();
  }

  private syncSize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width > 0 && height > 0) {
      this.renderer.setSize(width, height, false);
      if (this.composer) this.composer.setSize(width, height);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  private setupDragControls(): void {
    const onMouseDown = (e: MouseEvent) => {
      this.isDragging = true;
      this.previousMouseX = e.clientX;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this.isDragging) return;
      const deltaX = e.clientX - this.previousMouseX;
      this.characterGroup.rotation.y += deltaX * 0.01;
      this.previousMouseX = e.clientX;
    };

    const onMouseUp = () => {
      this.isDragging = false;
    };

    // Touch support
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.previousMouseX = e.touches[0].clientX;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!this.isDragging || e.touches.length !== 1) return;
      const deltaX = e.touches[0].clientX - this.previousMouseX;
      this.characterGroup.rotation.y += deltaX * 0.01;
      this.previousMouseX = e.touches[0].clientX;
    };

    const onTouchEnd = () => {
      this.isDragging = false;
    };

    this.canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    this.canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.syncSize();
    });
    this.resizeObserver.observe(this.container);
  }

  // Real volumetric god rays: a bright sun disc placed far behind the castle is
  // the light source; GodRaysEffect radial-blurs it from its screen position and
  // the trees/castle that occlude it carve out the shafts. Renders through a
  // dedicated EffectComposer (RenderPass keeps the scene's ACES tone mapping).
  private buildSunAndGodRays(): void {
    // light-source disc — far back (beyond the castle), peeking above it. The
    // GodRaysEffect requires it to be transparent and to not write depth.
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffdca6, transparent: true, depthWrite: false, fog: false });
    this.sunMesh = new THREE.Mesh(new THREE.SphereGeometry(16, 24, 24), sunMat);
    this.sunMesh.position.copy(this.camera.position).addScaledVector(this.psun, 250);
    this.scene.add(this.sunMesh);

    // The shafts come from a DARK occluder biting the sun (the hero's silhouette
    // used to do this); on the right there's none, so a tree is placed on the
    // camera->sun ray below. Keep the effect moderate — the edge does the work.
    const godRays = new GodRaysEffect(this.camera, this.sunMesh, {
      density: 0.96,
      decay: 0.94,
      weight: 0.46,
      exposure: 0.46,
      samples: 100,
      clampMax: 0.6,
      resolutionScale: 0.9,
      kernelSize: KernelSize.LARGE,
      blur: true,
    });

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new EffectPass(this.camera, godRays));
    // The full-screen backdrop often has no layout size yet at construction, so
    // the composer's targets (and the GodRaysEffect's) would be created 0x0 and
    // render an incomplete framebuffer (transparent canvas -> orange backdrop).
    // Seed a valid size now; syncSize keeps it in sync afterwards.
    this.composer.setSize(
      Math.max(1, this.container.clientWidth || window.innerWidth || 1280),
      Math.max(1, this.container.clientHeight || window.innerHeight || 720),
    );
  }

  private animate = (): void => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    const dt = Math.min(this.clock.getDelta(), 0.1); // cap dt to prevent huge jumps
    this.time += dt;

    // keep the renderer/camera matched to the container (the full-screen
    // backdrop resizes after the ResizeObserver's first read, which left the
    // aspect stale and pushed the hero off-centre)
    const cw = this.container.clientWidth, ch = this.container.clientHeight;
    if (cw > 0 && ch > 0 && (cw !== this.lastW || ch !== this.lastH)) {
      this.lastW = cw; this.lastH = ch;
      this.syncSize();
    }

    // keep the sky dome centred on the camera (it's an infinite backdrop)
    if (this.skyView) this.skyView.setCameraZ(this.camera.position.z, dt);

    // No auto-spin: the hero stands facing the camera (WoW-style); the player
    // can still turn it by dragging (see setupDragControls).

    // Update animations inside visual
    if (this.currentVisual) {
      this.currentVisual.update(dt, PREVIEW_ANIM_STATE, true);
    }

    // only drive the post chain once the backdrop has a real size, otherwise the
    // composer renders an incomplete (zero-size) framebuffer and the canvas goes
    // transparent (showing the orange backdrop behind it)
    if (this.container.clientWidth > 0 && this.container.clientHeight > 0) {
      this.composer.render(dt);
    }
  };

  /** Cleanup resources */
  destroy(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.currentVisual) {
      this.characterGroup.remove(this.currentVisual.root);
      this.currentVisual = null;
    }

    // Clean up event listeners is handled by window/document GC or manual tracking if necessary,
    // but canvas event listeners are garbage collected when canvas is removed.
    // Window listeners need explicit removal to avoid memory leaks:
    // However, since we keep a single canvas alive and move it, we don't destroy often.
  }
}
