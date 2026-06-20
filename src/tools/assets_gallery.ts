// Standalone Asset Gallery — renders every game asset on a blank white space.
// 3D models can't each own a live WebGL canvas (232 of them), so ONE shared
// renderer draws each model to a thumbnail when its tile scrolls into view
// (lazy queue), and a click opens an interactive (drag-to-rotate) modal viewer.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

type Entry = { path: string; name: string; group: string; category: string };
type Manifest = {
  counts: { models: number; textures: number; images: number };
  models: Entry[]; textures: Entry[]; images: Entry[];
};

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const assetUrl = (path: string) => '/' + path; // public/ is served at the deploy root

// ---- shared GLB loader (meshopt-compressed, same as the game) ----
const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
function loadGLB(path: string): Promise<THREE.Group> {
  return new Promise((res, rej) =>
    gltfLoader.load(assetUrl(path), (g) => res(g.scene), undefined, () => rej(new Error('load failed: ' + path))));
}
function disposeObject(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}
function frame(obj: THREE.Object3D, cam: THREE.PerspectiveCamera, fill: number) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  obj.position.sub(center); // recentre at origin
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = (maxDim / 2) / Math.tan((cam.fov * Math.PI) / 180 / 2) * fill;
  cam.position.set(dist * 0.62, dist * 0.5, dist * 0.92);
  cam.lookAt(0, 0, 0);
  cam.near = dist / 200; cam.far = dist * 200; cam.updateProjectionMatrix();
  return maxDim;
}
function studioLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d8e0, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(4, 6, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.8); fill.position.set(-5, 2, -4); scene.add(fill);
}

// ---- shared thumbnail renderer ----
const THUMB = 320;
const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
thumbRenderer.setSize(THUMB, THUMB);
thumbRenderer.setPixelRatio(1);
thumbRenderer.setClearColor(0xffffff, 1);
thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
thumbRenderer.toneMappingExposure = 1.1;
const thumbScene = new THREE.Scene();
studioLights(thumbScene);
const thumbCam = new THREE.PerspectiveCamera(34, 1, 0.01, 5000);

async function renderThumb(path: string, canvas: HTMLCanvasElement) {
  const obj = await loadGLB(path);
  frame(obj, thumbCam, 1.45);
  thumbScene.add(obj);
  thumbRenderer.render(thumbScene, thumbCam);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, THUMB, THUMB);
  ctx.drawImage(thumbRenderer.domElement, 0, 0);
  thumbScene.remove(obj);
  disposeObject(obj);
}

// ---- lazy render queue (sequential, GPU-friendly) ----
const queue: Array<() => Promise<void>> = [];
let pumping = false;
async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length) {
    const job = queue.shift()!;
    try { await job(); } catch { /* leave the placeholder on failure */ }
  }
  pumping = false;
}
const io = new IntersectionObserver((entries, obs) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target as HTMLElement;
    obs.unobserve(el);
    const path = el.dataset.model!;
    const canvas = el.querySelector('canvas') as HTMLCanvasElement;
    const spin = el.querySelector('.spin') as HTMLElement;
    queue.push(async () => {
      await renderThumb(path, canvas);
      spin?.remove();
      canvas.style.display = 'block';
    });
    pump();
  }
}, { rootMargin: '300px' });

// ---- modal interactive viewer ----
const modal = $('#modal');
const modalCanvas = $<HTMLCanvasElement>('#modal canvas');
const mRenderer = new THREE.WebGLRenderer({ antialias: true, canvas: modalCanvas });
mRenderer.setClearColor(0xffffff, 1);
mRenderer.outputColorSpace = THREE.SRGBColorSpace;
mRenderer.toneMapping = THREE.ACESFilmicToneMapping;
mRenderer.toneMappingExposure = 1.1;
const mScene = new THREE.Scene();
studioLights(mScene);
const mCam = new THREE.PerspectiveCamera(34, 1, 0.01, 5000);
const mPivot = new THREE.Group();
mScene.add(mPivot);
let mCurrent: THREE.Object3D | null = null;
let mDragging = false, mAutoSpin = true, mPX = 0, mRunning = false;

function mResize() {
  const r = modalCanvas.getBoundingClientRect();
  mRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  mRenderer.setSize(r.width, r.height, false);
  mCam.aspect = r.width / r.height; mCam.updateProjectionMatrix();
}
function mLoop() {
  if (!mRunning) return;
  requestAnimationFrame(mLoop);
  if (mAutoSpin && !mDragging) mPivot.rotation.y += 0.006;
  mRenderer.render(mScene, mCam);
}
async function openModal(entry: Entry) {
  modal.classList.add('open');
  ($('#modal .mlabel') as HTMLElement).innerHTML = `${entry.name}<small>${entry.category}</small>`;
  ($('#modal .mpath') as HTMLElement).textContent = entry.path;
  if (mCurrent) { mPivot.remove(mCurrent); disposeObject(mCurrent); mCurrent = null; }
  mResize();
  mRunning = true; mLoop();
  try {
    const obj = await loadGLB(entry.path);
    frame(obj, mCam, 1.7);
    mPivot.rotation.set(0, 0, 0);
    mPivot.add(obj);
    mCurrent = obj;
  } catch { /* ignore */ }
}
function closeModal() {
  modal.classList.remove('open');
  mRunning = false;
  if (mCurrent) { mPivot.remove(mCurrent); disposeObject(mCurrent); mCurrent = null; }
}
$('#modal .close').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
modalCanvas.addEventListener('pointerdown', (e) => { mDragging = true; mAutoSpin = false; mPX = e.clientX; });
window.addEventListener('pointerup', () => { mDragging = false; });
window.addEventListener('pointermove', (e) => {
  if (!mDragging) return;
  mPivot.rotation.y += (e.clientX - mPX) * 0.01; mPX = e.clientX;
});
window.addEventListener('resize', () => { if (mRunning) mResize(); });

// ---- tiles ----
function modelTile(e: Entry): HTMLElement {
  const tile = document.createElement('div');
  tile.className = 'tile'; tile.dataset.model = e.path; tile.dataset.name = e.name.toLowerCase();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = THUMB; canvas.style.display = 'none';
  tile.innerHTML = `<div class="thumb"><div class="spin"></div></div><div class="label">${e.name}<small>${e.category}</small></div>`;
  tile.querySelector('.thumb')!.appendChild(canvas);
  tile.addEventListener('click', () => openModal(e));
  io.observe(tile);
  return tile;
}
function imageTile(e: Entry): HTMLElement {
  const tile = document.createElement('div');
  tile.className = 'tile'; tile.dataset.name = e.name.toLowerCase();
  tile.innerHTML = `<div class="thumb"><img loading="lazy" src="${assetUrl(e.path)}" alt="${e.name}"></div>` +
    `<div class="label">${e.name}<small>${e.category}</small></div>`;
  tile.addEventListener('click', () => window.open(assetUrl(e.path), '_blank'));
  return tile;
}

// ---- build sections grouped by category ----
function sectionsFor(entries: Entry[], make: (e: Entry) => HTMLElement, typeKey: string): HTMLElement[] {
  const byCat = new Map<string, Entry[]>();
  for (const e of entries) { (byCat.get(e.category) ?? byCat.set(e.category, []).get(e.category)!).push(e); }
  const out: HTMLElement[] = [];
  for (const [cat, list] of [...byCat].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sec = document.createElement('section');
    sec.className = 'section'; sec.dataset.type = typeKey; sec.dataset.cat = cat;
    const title = document.createElement('div');
    title.className = 'section-title';
    title.innerHTML = `${typeKey} · <b>${cat}</b> <span style="color:var(--muted)">(${list.length})</span>`;
    const grid = document.createElement('div'); grid.className = 'grid';
    list.forEach((e) => grid.appendChild(make(e)));
    sec.appendChild(title); sec.appendChild(grid); out.push(sec);
  }
  return out;
}

let currentTab = 'all';
function applyFilters() {
  const q = ($('#search') as HTMLInputElement).value.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>('.section').forEach((sec) => {
    const typeOk = currentTab === 'all' || sec.dataset.type === currentTab;
    let visible = 0;
    sec.querySelectorAll<HTMLElement>('.tile').forEach((t) => {
      const match = typeOk && (!q || (t.dataset.name || '').includes(q));
      t.style.display = match ? '' : 'none';
      if (match) visible++;
    });
    sec.style.display = visible ? '' : 'none';
  });
}

async function main() {
  let mani: Manifest;
  try {
    mani = await (await fetch('/assets-manifest.json')).json();
  } catch {
    $('#main').innerHTML = '<p class="empty">No se pudo cargar assets-manifest.json (corré <code>node scripts/build_assets_manifest.mjs</code>).</p>';
    return;
  }
  $('#count').textContent = `${mani.counts.models} modelos · ${mani.counts.textures} texturas · ${mani.counts.images} imágenes`;

  const tabs = [
    ['all', 'Todo'], ['models', 'Modelos 3D'], ['textures', 'Texturas'], ['images', 'Imágenes'],
  ] as const;
  const tabsEl = $('#tabs');
  tabs.forEach(([key, label]) => {
    const b = document.createElement('div');
    b.className = 'tab' + (key === 'all' ? ' active' : ''); b.textContent = label; b.dataset.tab = key;
    b.addEventListener('click', () => {
      currentTab = key; document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      b.classList.add('active'); applyFilters();
    });
    tabsEl.appendChild(b);
  });

  const main = $('#main'); main.innerHTML = '';
  sectionsFor(mani.models, modelTile, 'models').forEach((s) => main.appendChild(s));
  sectionsFor(mani.textures, imageTile, 'textures').forEach((s) => main.appendChild(s));
  sectionsFor(mani.images, imageTile, 'images').forEach((s) => main.appendChild(s));

  ($('#search') as HTMLInputElement).addEventListener('input', applyFilters);
}

main();
