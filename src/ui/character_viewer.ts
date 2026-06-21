// Live 3D character view for the Character Info window — a small WebGL canvas
// that shows the player's class model (idle, drag to rotate), WoW-style.
// Created when the window opens, disposed on close.
import * as THREE from 'three';
import { CharacterVisual } from '../render/characters/visual';
import type { PlayerClass } from '../sim/types';

const ANIM = { speed: 0, moving: false, backwards: false, dead: false, casting: false, swimming: false, sitting: false };

export class CharacterViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam: THREE.PerspectiveCamera;
  private visual: CharacterVisual | null = null;
  private pivot = new THREE.Group();
  private raf = 0;
  private clock = new THREE.Clock();
  private dragging = false;
  private px = 0;
  private onUp = () => { this.dragging = false; };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.pivot.rotation.y += (e.clientX - this.px) * 0.012;
    this.px = e.clientX;
  };

  constructor(private canvas: HTMLCanvasElement, cls: PlayerClass) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x44505e, 1.15));
    const key = new THREE.DirectionalLight(0xfff2dc, 2.3); key.position.set(2.5, 4, 5); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.75); fill.position.set(-3, 2, 3); this.scene.add(fill);

    this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.scene.add(this.pivot);

    this.visual = new CharacterVisual(`player_${cls}`, 0xffffff);
    this.visual.setIdleClip('Idle');
    this.visual.root.rotation.y = 0; // face the camera
    this.pivot.add(this.visual.root);

    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.px = e.clientX; });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointermove', this.onMove);

    this.resize();
    this.loop();
  }

  resize(): void {
    const w = this.canvas.clientWidth || 170;
    const h = this.canvas.clientHeight || 250;
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    // frame the full body with extra padding so armor/hood never clips.
    const dist = 5.55;
    this.cam.position.set(0, 1.28, dist);
    this.cam.lookAt(0, 1.06, 0);
    this.cam.updateProjectionMatrix();
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.visual) this.visual.update(dt, ANIM, true);
    this.renderer.render(this.scene, this.cam);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointermove', this.onMove);
    if (this.visual) { this.visual.root.removeFromParent(); this.visual = null; }
    this.renderer.dispose();
  }
}
