import { generateDecorations } from './world';
import { DUNGEON_X_THRESHOLD, INSTANCE_SLOT_COUNT, PROPS, dungeonAt, instanceOrigin } from './data';
import { CRYPT_LAYOUT, SANCTUM_LAYOUT, TUTORIAL_LAYOUT, layoutColliders } from './dungeon_layout';
import { TUTORIAL_TREE } from './content/tutorial_resources';

// Static world collision. Prop placement comes from the per-zone content
// modules (merged into PROPS by sim/data.ts): the renderer builds its meshes
// from the same defs, so what you see is what you collide with.
// Sim layer: no three.js imports.

export interface CircleCollider {
  type: 'circle';
  x: number;
  z: number;
  r: number;
}

export interface ObbCollider {
  type: 'obb';
  x: number;
  z: number;
  hw: number; // half width (local x)
  hd: number; // half depth (local z)
  rot: number; // yaw, three.js rotation.y convention
}

export type Collider = CircleCollider | ObbCollider;

// rotate a local offset by a three.js rotation.y angle
function rotY(lx: number, lz: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

// ---------------------------------------------------------------------------
// Collider sets
// ---------------------------------------------------------------------------

// Approximate collision for the user-provided Dawnmere castle_town.glb visual
// shell. The renderer strips the Sketchfab base plane, centers the asset on the
// remaining walls/buildings, scales it to a ~96yd footprint, and rotates it by
// PI; these simple OBBs match that transformed footprint closely enough for
// gameplay while leaving the south gate/plaza walkable.
const castleBuilding = (x: number, z: number, hw: number, hd: number): Collider => ({
  type: 'obb', x, z,
  // GLB bounds include roof overhangs/awnings; use a slimmer walk collider so
  // players/NPCs don't feel like they hit invisible fat walls.
  hw: hw * 0.62, hd: hd * 0.62, rot: 0,
});

const castleWall = (x: number, z: number, length: number, rot: number): Collider => ({
  type: 'obb', x, z,
  // Use the real transformed GLB wall segment orientation instead of a fake
  // rectangular perimeter. A slim depth keeps the wall solid without eating the
  // walkable streets beside it.
  hw: length / 2, hd: 1.65, rot,
});

const EASTBROOK_CASTLE_COLLIDERS: Collider[] = [
  // Actual long wall segments extracted from castle_town.glb after the same
  // center/scale/PI transform used by the renderer. This preserves the angled
  // wall shape and leaves the real gate gaps open.
  castleWall(-9.7, 32.4, 31.5, 0.846),
  castleWall(-30.8, 31.7, 31.5, -0.901),
  castleWall(25.1, -29.5, 31.5, -0.379),
  castleWall(35.1, -8.1, 31.5, -1.939),
  castleWall(14.4, 13.5, 31.5, -2.717),
  castleWall(-12.9, -27.1, 21.0, 0.781),
  castleWall(-33.8, 11.4, 21.0, 0.826),
  castleWall(-23.9, -7.5, 21.0, 1.341),

  // major castle-town buildings / towers (slim approximations of GLB parts)
  castleBuilding(-22, 18.6, 14.3, 13.4),
  castleBuilding(9.1, -17.9, 4.9, 6.4),
  castleBuilding(-17.1, -0.8, 5.0, 5.1),
  castleBuilding(6.1, 1.4, 4.9, 5.2),
  castleBuilding(-1.6, 9.5, 5.1, 4.7),
  castleBuilding(5.4, -27.1, 4.5, 5.2),
  castleBuilding(-7.6, -7.7, 4.1, 3.8),
  castleBuilding(3.3, -35.3, 5.3, 3.0),
  castleBuilding(-6, -22.5, 3.0, 4.9),
];

function staticWorldColliders(seed: number): Collider[] {
  const out: Collider[] = [...EASTBROOK_CASTLE_COLLIDERS];

  for (const b of PROPS.buildings) {
    out.push({ type: 'obb', x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, rot: b.rot });
  }
  for (const w of PROPS.wells) out.push({ type: 'circle', x: w.x, z: w.z, r: w.r });
  for (const s of PROPS.stalls) out.push({ type: 'circle', x: s.x, z: s.z, r: s.r });

  // mines: mound behind the timber portal
  for (const m of PROPS.mines) {
    const mound = rotY(0, -3.4, m.rot);
    out.push({ type: 'circle', x: m.x + mound.x, z: m.z + mound.z, r: 5 });
  }

  // dock huts
  for (const d of PROPS.docks) {
    const hut = rotY(d.hutLocal.x, d.hutLocal.z, d.rot);
    out.push({ type: 'obb', x: d.x + hut.x, z: d.z + hut.z, hw: d.hutLocal.hw, hd: d.hutLocal.hd, rot: d.rot });
  }

  for (const t of PROPS.tents) out.push({ type: 'circle', x: t.x, z: t.z, r: 1.5 * t.scale });
  for (const [x, z] of PROPS.crates) out.push({ type: 'circle', x, z, r: 0.65 });
  for (const [x, z] of PROPS.campfires) out.push({ type: 'circle', x, z, r: 0.85 });
  for (const [x, z] of PROPS.mudHuts) out.push({ type: 'circle', x, z, r: 1.1 });
  for (const ruin of PROPS.ruinRings) {
    for (let i = 0; i < ruin.columns; i++) {
      const ang = (i / ruin.columns) * Math.PI * 2;
      out.push({ type: 'circle', x: ruin.x + Math.sin(ang) * ruin.ringR, z: ruin.z + Math.cos(ang) * ruin.ringR, r: 0.6 });
    }
  }

  // trees & large rocks from the deterministic decoration field
  for (const d of generateDecorations(seed)) {
    if (d.kind === 'rock') {
      if (d.scale >= 0.8) out.push({ type: 'circle', x: d.x, z: d.z, r: 0.7 * d.scale });
    } else {
      // tree trunks only — canopies don't block
      out.push({ type: 'circle', x: d.x, z: d.z, r: 0.55 * d.scale });
    }
  }
  return out;
}

// Interior collision sets, in instance-local coordinates. Derived from the
// SAME plain-data layouts the renderer builds the KayKit modules from
// (sim/dungeon_layout.ts), so render geometry and collision can no longer
// drift apart. The boss dais is walkable and deliberately has no collider.
const CRYPT_COLLIDERS: Collider[] = layoutColliders(CRYPT_LAYOUT);
const TUTORIAL_COLLIDERS: Collider[] = [
  ...layoutColliders(TUTORIAL_LAYOUT),
  { type: 'circle', x: TUTORIAL_TREE.x, z: TUTORIAL_TREE.z, r: TUTORIAL_TREE.r },
];
const SANCTUM_COLLIDERS: Collider[] = layoutColliders(SANCTUM_LAYOUT);

// Interior collider sets keyed by DungeonDef.interior.
const INTERIOR_COLLIDERS: Record<string, Collider[]> = {
  crypt: CRYPT_COLLIDERS,
  tutorial: TUTORIAL_COLLIDERS,
  sanctum: SANCTUM_COLLIDERS,
};

// ---------------------------------------------------------------------------
// Spatial grid + movement resolution
// ---------------------------------------------------------------------------

const GRID_CELL = 16;
const MAX_BODY_RADIUS = 0.8; // largest mover we resolve for

interface ColliderGrid {
  cells: Map<string, Collider[]>;
}

const gridCache = new Map<number, ColliderGrid>();

function colliderBounds(c: Collider): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (c.type === 'circle') {
    return { minX: c.x - c.r, maxX: c.x + c.r, minZ: c.z - c.r, maxZ: c.z + c.r };
  }
  const ext = Math.hypot(c.hw, c.hd);
  return { minX: c.x - ext, maxX: c.x + ext, minZ: c.z - ext, maxZ: c.z + ext };
}

function gridFor(seed: number): ColliderGrid {
  let grid = gridCache.get(seed);
  if (grid) return grid;
  grid = { cells: new Map() };
  for (const c of staticWorldColliders(seed)) {
    const b = colliderBounds(c);
    const x0 = Math.floor((b.minX - MAX_BODY_RADIUS) / GRID_CELL);
    const x1 = Math.floor((b.maxX + MAX_BODY_RADIUS) / GRID_CELL);
    const z0 = Math.floor((b.minZ - MAX_BODY_RADIUS) / GRID_CELL);
    const z1 = Math.floor((b.maxZ + MAX_BODY_RADIUS) / GRID_CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const key = gx + ',' + gz;
        const list = grid.cells.get(key);
        if (list) list.push(c);
        else grid.cells.set(key, [c]);
      }
    }
  }
  gridCache.set(seed, grid);
  return grid;
}

// Push (x,z) out of one collider. Returns the corrected point, or null if clear.
function pushOut(c: Collider, x: number, z: number, r: number): { x: number; z: number } | null {
  if (c.type === 'circle') {
    const dx = x - c.x, dz = z - c.z;
    const min = c.r + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-6) return { x: c.x + min, z: c.z };
    const k = min / d;
    return { x: c.x + dx * k, z: c.z + dz * k };
  }
  // OBB: into local frame
  const local = rotY(x - c.x, z - c.z, -c.rot);
  const ex = c.hw + r, ez = c.hd + r;
  if (Math.abs(local.x) >= ex || Math.abs(local.z) >= ez) return null;
  const pushX = ex - Math.abs(local.x);
  const pushZ = ez - Math.abs(local.z);
  const out = { x: local.x, z: local.z };
  if (pushX < pushZ) out.x = Math.sign(local.x || 1) * ex;
  else out.z = Math.sign(local.z || 1) * ez;
  const world = rotY(out.x, out.z, c.rot);
  return { x: c.x + world.x, z: c.z + world.z };
}

function resolveAgainst(list: Collider[], x: number, z: number, r: number): { x: number; z: number } {
  let px = x, pz = z;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const c of list) {
      const res = pushOut(c, px, pz, r);
      if (res) {
        px = res.x;
        pz = res.z;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}

function instanceLocal(x: number, z: number): { ox: number; oz: number; interior: string } {
  const dungeon = dungeonAt(x);
  const index = dungeon?.index ?? 0;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < INSTANCE_SLOT_COUNT; i++) {
    const o = instanceOrigin(index, i);
    const d = Math.abs(z - o.z);
    if (d < bestD) { bestD = d; best = i; }
  }
  const o = instanceOrigin(index, best);
  return { ox: o.x, oz: o.z, interior: dungeon?.interior ?? 'crypt' };
}

// Resolve a movement destination against all static geometry. Movers slide
// along obstacles. `r` is the body radius.
export function resolvePosition(seed: number, x: number, z: number, r = 0.5): { x: number; z: number } {
  if (x > DUNGEON_X_THRESHOLD) {
    const { ox, oz, interior } = instanceLocal(x, z);
    const colliders = INTERIOR_COLLIDERS[interior] ?? CRYPT_COLLIDERS;
    const local = resolveAgainst(colliders, x - ox, z - oz, r);
    return { x: local.x + ox, z: local.z + oz };
  }
  const grid = gridFor(seed);
  const key = Math.floor(x / GRID_CELL) + ',' + Math.floor(z / GRID_CELL);
  const list = grid.cells.get(key);
  if (!list) return { x, z };
  return resolveAgainst(list, x, z, r);
}

export function isBlocked(seed: number, x: number, z: number, r = 0.5): boolean {
  const res = resolvePosition(seed, x, z, r);
  return Math.abs(res.x - x) > 1e-4 || Math.abs(res.z - z) > 1e-4;
}
