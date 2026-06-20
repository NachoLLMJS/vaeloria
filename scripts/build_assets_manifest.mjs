// Scans public/ for game assets and writes public/assets-manifest.json, the
// list the standalone Asset Gallery (assets-gallery.html) renders. Run by the
// gallery build (see vercel.json) and runnable by hand: `node scripts/build_assets_manifest.mjs`.
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, basename, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pub = join(root, 'public');

function walk(dir, exts) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, exts));
    else if (exts.includes(extname(e).toLowerCase())) out.push(full);
  }
  return out;
}

const toEntry = (full) => {
  const rel = relative(pub, full).replace(/\\/g, '/'); // e.g. models/foliage/Tree.glb
  const group = dirname(rel);                           // e.g. models/foliage
  // top-level category under the asset type, for section grouping in the UI
  const parts = group.split('/');
  const category = parts.length > 1 ? parts[1] : parts[0];
  return { path: rel, name: basename(rel, extname(rel)), group, category };
};

const IMG = ['.png', '.jpg', '.jpeg', '.webp'];

const models = walk(join(pub, 'models'), ['.glb']).map(toEntry);
const textures = walk(join(pub, 'textures'), IMG).map(toEntry);
// 2D art: standalone images + the gear icon sheets that live under models/
const seen = new Set();
const images = [...walk(join(pub, 'images'), IMG), ...walk(join(pub, 'models'), IMG)]
  .map(toEntry)
  .filter((e) => (seen.has(e.path) ? false : (seen.add(e.path), true)));

const byName = (a, b) => a.path.localeCompare(b.path);
models.sort(byName); textures.sort(byName); images.sort(byName);

const manifest = {
  generatedAt: new Date().toISOString(),
  counts: { models: models.length, textures: textures.length, images: images.length },
  models, textures, images,
};

writeFileSync(join(pub, 'assets-manifest.json'), JSON.stringify(manifest));
console.log(`assets-manifest.json -> ${models.length} models, ${textures.length} textures, ${images.length} images`);
