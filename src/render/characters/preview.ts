import * as THREE from 'three';
import { CharacterVisual } from './visual';
import { PlayerClass } from '../../sim/types';
import { loadGltf, loadTexture } from '../assets/loader';
import { buildSky, SkyView } from '../sky';
import { SUN_ANCHOR, GFX } from '../gfx';

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
  // visible sun disc + god-ray shafts (sprite-based, like the live renderer)
  private sunSprites: THREE.Sprite[] = [];
  private godRaySprites: THREE.Sprite[] = [];
  private psun = new THREE.Vector3(-0.2, 0.24, -0.78).normalize();
  private time = 0;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();

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
    this.renderer.shadowMap.enabled = false; // Preview doesn't need heavy shadows
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
    const sun = new THREE.DirectionalLight(0xfff0d2, 2.7);
    sun.position.copy(this.psun).multiplyScalar(60);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xeaf2ff, 1.0);
    fill.position.set(0.6, 3, 9);
    this.scene.add(fill);
    this.buildSunAndGodRays();

    // 6. The real game sky dome + HDRI image-based lighting (what makes the
    // live world look good). buildSky reads preloaded HDRIs; envTexture is null
    // on the low tier, in which case we just keep the lit dome + lights.
    const lowGfx = !GFX.standardMaterials;
    this.skyView = buildSky(lowGfx, SUN_ANCHOR);
    this.scene.add(this.skyView.dome);
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
        this.scene.add(t);
      }).catch(() => {});
    };
    placeModel('/models/foliage/pine_1.glb', -7.5, -7.5, 1.7, 0.5);
    placeModel('/models/foliage/pine_3.glb', 7.6, -7.5, 1.7, -0.8);
    placeModel('/models/foliage/pine_2.glb', -12.0, -12.0, 2.0, 1.2);
    placeModel('/models/foliage/pine_4.glb', 12.0, -12.0, 1.9, 2.0);
    placeModel('/models/foliage/rock_1.glb', -5.2, -3.6, 0.9, 0.3);
    placeModel('/models/foliage/rock_2.glb', 5.4, -3.3, 0.8, 1.5);

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

  // sprite sun disc + halo + god-ray shafts (mirrors the live renderer's cheap
  // volumetric look without a post-processing pass)
  private buildSunAndGodRays(): void {
    const sunCanvas = (core: boolean): THREE.CanvasTexture => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
      if (core) { g.addColorStop(0, 'rgba(255,252,238,1)'); g.addColorStop(0.35, 'rgba(255,238,180,0.95)'); g.addColorStop(1, 'rgba(255,220,140,0)'); }
      else { g.addColorStop(0, 'rgba(255,236,180,0.6)'); g.addColorStop(1, 'rgba(255,220,150,0)'); }
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    };
    for (const [tex, scale] of [[sunCanvas(true), 70], [sunCanvas(false), 240]] as const) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      sp.scale.set(scale, scale, 1); sp.renderOrder = -9;
      this.sunSprites.push(sp); this.scene.add(sp);
    }
    const shaft = document.createElement('canvas'); shaft.width = 64; shaft.height = 256;
    const sctx = shaft.getContext('2d')!;
    const gh = sctx.createLinearGradient(0, 0, 0, 256);
    gh.addColorStop(0, 'rgba(255,240,200,0)'); gh.addColorStop(0.45, 'rgba(255,240,200,0.55)'); gh.addColorStop(0.6, 'rgba(255,240,200,0.5)'); gh.addColorStop(1, 'rgba(255,240,200,0)');
    sctx.fillStyle = gh; sctx.fillRect(0, 0, 64, 256);
    const gw = sctx.createLinearGradient(0, 0, 64, 0);
    gw.addColorStop(0, 'rgba(0,0,0,1)'); gw.addColorStop(0.5, 'rgba(0,0,0,0)'); gw.addColorStop(1, 'rgba(0,0,0,1)');
    sctx.globalCompositeOperation = 'destination-out'; sctx.fillStyle = gw; sctx.fillRect(0, 0, 64, 256);
    const shaftTex = new THREE.CanvasTexture(shaft);
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: shaftTex, transparent: true, opacity: 0, fog: false, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, rotation: 0.42 + i * 0.13 }));
      sp.scale.set(30 + i * 18, 170 + i * 40, 1); sp.renderOrder = -8;
      this.godRaySprites.push(sp); this.scene.add(sp);
    }
  }

  private updateSunGodRays(): void {
    const cam = this.camera.position;
    for (const sp of this.sunSprites) sp.position.copy(cam).addScaledVector(this.psun, 760);
    const sunAz = this.tmpA.set(this.psun.x, 0, this.psun.z).normalize();
    const side = this.tmpB.set(sunAz.z, 0, -sunAz.x);
    this.camera.getWorldDirection(this.tmpC); this.tmpC.y = 0; this.tmpC.normalize();
    const facing = Math.max(0, this.tmpC.dot(sunAz));
    for (let i = 0; i < this.godRaySprites.length; i++) {
      const sp = this.godRaySprites[i];
      const sway = Math.sin(this.time * 0.2 + i * 2.1) * 9;
      sp.position.copy(cam).addScaledVector(sunAz, 38 + i * 22).addScaledVector(side, (i - 1.5) * 24 + sway);
      sp.position.y = cam.y + 10 + i * 7;
      (sp.material as THREE.SpriteMaterial).opacity = (0.28 + facing * facing * 0.32) * (1 - i * 0.1);
    }
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
    this.updateSunGodRays();

    // No auto-spin: the hero stands facing the camera (WoW-style); the player
    // can still turn it by dragging (see setupDragControls).

    // Update animations inside visual
    if (this.currentVisual) {
      this.currentVisual.update(dt, PREVIEW_ANIM_STATE, true);
    }

    this.renderer.render(this.scene, this.camera);
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
