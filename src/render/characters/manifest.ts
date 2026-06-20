// Visual manifest: maps every sim identity (player class, mob template/family,
// NPC id, druid/polymorph form) onto a rigged glTF asset + clip names + kit.
// Pure data + dispatch — no three.js imports, no loading.
import type { Entity } from '../../sim/types';
import { MOBS } from '../../sim/data';

export interface ClipMap {
  idle: string;
  walk: string;
  run: string;
  /** one-shot swing clips, rotated per attack */
  attack: string[];
  death: string;
  /** hit-react one-shots (optional — spider/raptor rigs have none) */
  hit?: string[];
  /** looping cast channel */
  cast?: string;
  sitDown?: string;
  sitIdle?: string;
  /** swim base (prone pitch is procedural on top) */
  swim?: string;
  walkBack?: string;
  /** one-shot played on respawn (skeleton awaken / boss taunt) */
  flourish?: string;
}

export interface AttachDef {
  /** External GLB prop. Omit when cloning an existing object from the base model. */
  url?: string;
  /** Object/node name to clone from the assembled base model. Useful for mirrored built-in weapons. */
  sourceObject?: string;
  bone: string;
  position?: [number, number, number];
  rotationY?: number;
}

export interface VisualDef {
  url: string;
  /** world-unit height (pivot->crown) at e.scale = 1 */
  height: number;
  clips: ClipMap;
  /** floating rigs hover: mesh bottom sits this far above the pivot */
  hover?: number;
  /** yaw applied so the model faces +Z (facing-0 convention) */
  yaw?: number;
  /** KayKit chars ship every accessory visible: non-skinned mesh nodes to KEEP.
   *  undefined = keep everything (creature GLBs have no accessories). */
  show?: string[];
  /** non-skinned mesh nodes to hide after optional `show` filtering */
  hide?: string[];
  attach?: AttachDef[];
  /** material tint: explicit color, 'entity' (use e.color), or none */
  tint?: number | 'entity';
  /** recenters static multi-character GLBs whose chosen mesh is offset in a pack scene */
  centerXZ?: boolean;
  /** lerp amount toward the tint (default 0.4) */
  tintStrength?: number;
  /** u/s at which the walk/run cycles look right (timeScale matching) */
  walkRef?: number;
  runRef?: number;
  attackTimeScale?: number;
}

// ---------------------------------------------------------------------------
// Clip sets per source rig family
// ---------------------------------------------------------------------------

const kaykit = (attack: string[], idle = 'Idle'): ClipMap => ({
  idle,
  walk: 'Walking_A',
  run: 'Running_A',
  walkBack: 'Walking_Backwards',
  attack,
  hit: ['Hit_A'],
  death: 'Death_A',
  cast: 'Spellcasting',
  sitDown: 'Sit_Floor_Down',
  sitIdle: 'Sit_Floor_Idle',
  swim: 'Lie_Idle',
});

// Quaternius RPG Character Pack rigs (CC0). Clip names are package-native.
const QUATERNIUS_WARRIOR: ClipMap = {
  idle: 'Idle_Weapon', walk: 'Walk', run: 'Run_Weapon',
  attack: ['Sword_Attack', 'Sword_Attack2'], hit: ['RecieveHit'], death: 'Death',
  cast: 'Idle_Attacking', swim: 'Idle',
};

const QUATERNIUS_WIZARD: ClipMap = {
  idle: 'Idle_Weapon', walk: 'Walk', run: 'Run_Weapon',
  attack: ['Spell1', 'Spell2', 'Staff_Attack'], hit: ['RecieveHit', 'RecieveHit_2'], death: 'Death',
  cast: 'Spell1', swim: 'Idle',
};

const QUATERNIUS_MONK: ClipMap = {
  idle: 'Idle', walk: 'Walk', run: 'Run',
  attack: ['Attack', 'Attack2'], hit: ['RecieveHit', 'RecieveHit_2'], death: 'Death',
  cast: 'Idle_Attacking', swim: 'Idle',
};

const QUATERNIUS_CLERIC: ClipMap = {
  idle: 'Idle_Weapon', walk: 'Walk', run: 'Run',
  attack: ['Staff_Attack', 'Spell1'], hit: ['RecieveHit', 'RecieveHit_Attacking'], death: 'Death',
  cast: 'Spell1', swim: 'Idle',
};

const QUATERNIUS_RANGER: ClipMap = {
  idle: 'Idle_Weapon', walk: 'Walk', run: 'Run_Holding',
  attack: ['Bow_Draw', 'Bow_Shoot'], hit: ['RecieveHit', 'RecieveHit_2'], death: 'Death',
  cast: 'Bow_Draw', swim: 'Idle',
};

const QUATERNIUS_ROGUE: ClipMap = {
  idle: 'Attacking_Idle', walk: 'Walk', run: 'Run',
  attack: ['Dagger_Attack', 'Dagger_Attack2'], hit: ['RecieveHit', 'RecieveHit_2'], death: 'Death',
  cast: 'Attacking_Idle', swim: 'Idle',
};

const skeletonClips = (attack: string[], flourish = 'Skeletons_Awaken_Standing'): ClipMap => ({
  ...kaykit(attack, 'Idle_Combat'),
  flourish,
});

// Quaternius 2021 animal rig (wolf/bull/alpaca/fox/stag)
const animal = (attack: string[]): ClipMap => ({
  idle: 'Idle', walk: 'Walk', run: 'Gallop', attack,
  hit: ['Idle_HitReact_Left', 'Idle_HitReact_Right'], death: 'Death',
});

// 14-clip biped rig (orc/frog/demonalt/yetialt)
const BIPED14: ClipMap = {
  idle: 'Idle', walk: 'Walk', run: 'Run', attack: ['Punch', 'Weapon'],
  hit: ['HitReact'], death: 'Death',
};

// User-provided enemiesrpg.zip blob rigs. Verified in the source glTFs: Idle,
// Walk, Bite_Front, HitRecieve and Death are present before wiring them here.
const RPG_BLOB9: ClipMap = {
  idle: 'Idle', walk: 'Walk', run: 'Walk', attack: ['Bite_Front'],
  hit: ['HitRecieve'], death: 'Death',
};

// 2023 enemy rig (goblin/giant)
const ENEMY7: ClipMap = {
  idle: 'Idle', walk: 'Walk', run: 'Run', attack: ['Attack'],
  hit: ['HitRecieve'], death: 'Death',
};

// floating/flying rigs (goleling/dragon) — hover instead of walking
const FLOATING: ClipMap = {
  idle: 'Flying_Idle', walk: 'Fast_Flying', run: 'Fast_Flying',
  attack: ['Headbutt', 'Punch'], hit: ['HitReact'], death: 'Death',
};

const SPIDER: ClipMap = {
  idle: 'Spider_Idle', walk: 'Spider_Walk', run: 'Spider_Walk',
  attack: ['Spider_Attack'], death: 'Spider_Death', // no hit-react in asset
};

const RAPTOR: ClipMap = {
  idle: 'Velociraptor_Idle', walk: 'Velociraptor_Walk', run: 'Velociraptor_Run',
  attack: ['Velociraptor_Attack'], death: 'Velociraptor_Death',
};

// ---------------------------------------------------------------------------
// Asset urls
// ---------------------------------------------------------------------------

const CHARS = 'models/chars';
const NPC_MODELS = 'models/chars/npcs';
const LOW_POLY_NPCS = `${NPC_MODELS}/low_poly_characters.glb`;
const CREATURES = 'models/creatures';
const RPG_CREATURES = `${CREATURES}/rpg`;

const HUMANOID_H = 2.6;

// User-provided village NPC models are static GLBs: they have no embedded
// Idle/Walk/Run clips, so we leave clip names empty and let the renderer show
// their bind pose. These are for stationary town NPCs/dialog/vendors.
const STATIC_NPC: ClipMap = {
  idle: '', walk: '', run: '', attack: [], death: '',
};

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

export const VISUALS: Record<string, VisualDef> = {
  // -- player classes ------------------------------------------------------
  player_warrior: {
    url: `${CHARS}/quaternius_warrior.glb`, height: HUMANOID_H,
    clips: QUATERNIUS_WARRIOR,
  },
  player_paladin: {
    url: `${CHARS}/quaternius_cleric.glb`, height: HUMANOID_H,
    clips: QUATERNIUS_CLERIC,
    tint: 0xe3c06a, tintStrength: 0.28,
  },
  player_hunter: {
    url: `${CHARS}/quaternius_ranger.glb`, height: HUMANOID_H,
    clips: QUATERNIUS_RANGER,
  },
  player_rogue: {
    url: `${CHARS}/quaternius_rogue.glb`, height: HUMANOID_H,
    clips: QUATERNIUS_ROGUE,
    // Clone the model's own right-hand dagger setup, instead of mixing in the
    // generic weapon GLB, so both hands use the exact same Rogue_Dagger mesh.
    attach: [{ sourceObject: 'Weapon.R', bone: 'Fist1.L' }],
  },
  player_priest: {
    url: `${CHARS}/quaternius_cleric.glb`, height: HUMANOID_H,
    clips: QUATERNIUS_CLERIC,
    tint: 0xf0e9d6, tintStrength: 0.25,
  },
  player_shaman: {
    url: `${CHARS}/quaternius_monk.glb`, height: HUMANOID_H,
    clips: QUATERNIUS_MONK,
    tint: 0x6f8fc9, tintStrength: 0.25,
  },
  player_mage: {
    url: `${CHARS}/quaternius_wizard.glb`, height: HUMANOID_H,
    clips: QUATERNIUS_WIZARD,
  },
  player_warlock: {
    url: `${CHARS}/quaternius_wizard.glb`, height: HUMANOID_H,
    clips: QUATERNIUS_WIZARD,
    tint: 0x8d5fd3, tintStrength: 0.28,
  },
  player_druid: {
    url: `${CHARS}/quaternius_monk_druid_redbeard.glb`, height: HUMANOID_H,
    clips: QUATERNIUS_MONK,
    tint: 0x7da05c, tintStrength: 0.25,
  },

  // -- forms ---------------------------------------------------------------
  form_sheep: {
    url: `${CREATURES}/alpaca.glb`, height: 1.2,
    clips: animal(['Attack_Headbutt']),
  },
  form_bear: {
    url: `${CREATURES}/yetialt.glb`, height: 1.9,
    clips: BIPED14, tint: 0x5a4030, tintStrength: 0.55,
  },

  // -- mob families --------------------------------------------------------
  mob_wolf: {
    url: `${RPG_CREATURES}/blob_dog.glb`, height: 1.25,
    clips: RPG_BLOB9, tint: 'entity', tintStrength: 0.2,
  },
  mob_boar: {
    url: `${RPG_CREATURES}/blob_mushnub.glb`, height: 1.35,
    clips: RPG_BLOB9, tint: 'entity', tintStrength: 0.22,
  },
  mob_spider: {
    url: `${RPG_CREATURES}/blob_green_spiky.glb`, height: 1.55,
    clips: RPG_BLOB9, tint: 'entity', tintStrength: 0.2,
  },
  mob_murloc: {
    url: `${RPG_CREATURES}/big_frog.glb`, height: 2.15,
    clips: BIPED14, tint: 'entity', tintStrength: 0.18,
  },
  mob_kobold: {
    url: `${RPG_CREATURES}/big_cactoro.glb`, height: 2.2,
    clips: BIPED14, tint: 'entity', tintStrength: 0.16,
  },
  mob_troll: {
    url: `${RPG_CREATURES}/big_orc.glb`, height: 2.6,
    clips: BIPED14, tint: 'entity', tintStrength: 0.12,
  },
  mob_ogre: {
    url: `${RPG_CREATURES}/big_yeti.glb`, height: 2.85,
    clips: BIPED14, tint: 'entity', tintStrength: 0.14,
  },
  mob_elemental: {
    url: `${RPG_CREATURES}/flying_goleling_evolved.glb`, height: 2.25, hover: 0.3,
    clips: FLOATING, tint: 'entity', tintStrength: 0.4,
  },
  mob_dragonkin: {
    url: `${RPG_CREATURES}/flying_dragon_evolved.glb`, height: 2.65, hover: 0.25,
    clips: FLOATING, tint: 'entity', tintStrength: 0.16,
  },

  // -- undead (KayKit skeletons, shared 41-joint rig) ------------------------
  skel_minion: {
    url: `${RPG_CREATURES}/big_orc_skull.glb`, height: 2.55,
    clips: BIPED14, tint: 'entity', tintStrength: 0.18,
  },
  skel_warrior: {
    url: `${RPG_CREATURES}/big_blue_demon.glb`, height: 2.6,
    clips: BIPED14, tint: 'entity', tintStrength: 0.16,
  },
  skel_rogue: {
    url: `${RPG_CREATURES}/big_tribal.glb`, height: 2.55,
    clips: BIPED14, tint: 'entity', tintStrength: 0.16,
  },
  skel_mage: {
    url: `${RPG_CREATURES}/flying_ghost_skull.glb`, height: 2.45, hover: 0.25,
    clips: FLOATING, tint: 'entity', tintStrength: 0.18,
  },
  skel_boss: {
    url: `${RPG_CREATURES}/big_demon.glb`, height: 2.85,
    clips: BIPED14, tint: 'entity', tintStrength: 0.14,
  },

  // -- humanoid mobs (KayKit adventurers) ------------------------------------
  mob_bandit: {
    url: `${RPG_CREATURES}/big_ninja.glb`, height: 2.45,
    clips: BIPED14,
    tint: 0x6b3a32, tintStrength: 0.22,
  },
  mob_dark_caster: {
    url: `${RPG_CREATURES}/blob_wizard.glb`, height: 1.8,
    clips: RPG_BLOB9,
    tint: 'entity', tintStrength: 0.25,
  },
  mob_bruiser: {
    url: `${RPG_CREATURES}/big_mushroom_king.glb`, height: 2.8,
    clips: BIPED14,
    tint: 'entity', tintStrength: 0.16,
  },

  // -- NPCs ------------------------------------------------------------------
  // Town NPCs are intentionally reskinned with enemy models that were not used
  // by the active mob-family dispatch, so the pack's unused creatures appear in
  // the world without changing combat templates. Prefer their real idle clips
  // over static bind poses whenever the source GLB includes animation.
  npc_marshal: {
    url: `${CREATURES}/orc.glb`, height: 2.35,
    clips: BIPED14, centerXZ: true,
  },
  npc_trader: {
    url: `${CREATURES}/demon.glb`, height: 2.45, hover: 0.25,
    clips: FLOATING, centerXZ: true,
  },
  npc_fisherman: {
    url: `${CREATURES}/demonalt.glb`, height: 2.25,
    clips: BIPED14, centerXZ: true,
  },
  npc_knight: {
    url: `${CREATURES}/orcenemy.glb`, height: 2.55,
    clips: RPG_BLOB9, centerXZ: true,
  },
  npc_mage: {
    url: `${CREATURES}/glubevolved.glb`, height: 2.2,
    clips: FLOATING, centerXZ: true,
  },
  npc_smith: {
    url: `${CREATURES}/crabenemy.glb`, height: 1.45,
    clips: RPG_BLOB9, centerXZ: true,
  },
  npc_foreman: {
    url: `${RPG_CREATURES}/big_dino.glb`, height: 2.85,
    clips: BIPED14, centerXZ: true,
  },
  npc_scout: {
    url: `${CREATURES}/velociraptor.glb`, height: 1.85,
    clips: RAPTOR, centerXZ: true,
  },
  npc_villager: {
    url: `${CREATURES}/golelingevolved.glb`, height: 2.25,
    clips: FLOATING, centerXZ: true,
  },
  npc_villager_robed: {
    url: `${CREATURES}/dragonevolved.glb`, height: 2.65,
    clips: FLOATING, centerXZ: true,
  },
  npc_commoner_alt: {
    url: `${CREATURES}/orcenemy.glb`, height: 2.55,
    clips: RPG_BLOB9, centerXZ: true,
  },
  npc_merchant: {
    url: `${CREATURES}/glubevolved.glb`, height: 2.2,
    clips: FLOATING, centerXZ: true,
  },
  npc_guard_soldier: {
    url: `${CREATURES}/crabenemy.glb`, height: 1.45,
    clips: RPG_BLOB9, centerXZ: true,
  },
  npc_guard_soldier_alt: {
    url: `${CREATURES}/velociraptor.glb`, height: 1.85,
    clips: RAPTOR, centerXZ: true,
  },
  npc_guard_commander: {
    url: `${RPG_CREATURES}/big_dino.glb`, height: 2.85,
    clips: BIPED14, centerXZ: true,
  },
};

// ---------------------------------------------------------------------------
// Dispatch: entity -> visual key (mirrors the old buildRigFor selection:
// e.kind + e.templateId + MOBS[id].family)
// ---------------------------------------------------------------------------

const MOB_KEYS: Record<string, string> = {
  wild_boar: 'mob_boar',
  // gravecaller cult + necromancers: dark-robed casters
  gravecaller_cultist: 'mob_dark_caster',
  gravecaller_summoner: 'mob_dark_caster',
  deacon_voss: 'mob_dark_caster',
  wyrmcult_necromancer: 'mob_dark_caster',
  vael_the_mistcaller: 'mob_dark_caster',
  grand_necromancer_velkhar: 'mob_dark_caster',
  gorrak: 'mob_bruiser',
  // undead variants by role
  boneclad_revenant: 'skel_warrior',
  bastion_revenant: 'skel_warrior',
  knight_commander_olen: 'skel_warrior',
  sanctum_boneguard: 'skel_warrior',
  hollow_acolyte: 'skel_mage',
  sexton_marrow: 'skel_mage',
  morthen: 'skel_boss',
  crypt_shambler: 'skel_rogue',
};

const FAMILY_KEYS: Record<string, string> = {
  beast: 'mob_wolf',
  humanoid: 'mob_bandit',
  murloc: 'mob_murloc',
  spider: 'mob_spider',
  kobold: 'mob_kobold',
  undead: 'skel_minion',
  troll: 'mob_troll',
  ogre: 'mob_ogre',
  elemental: 'mob_elemental',
  dragonkin: 'mob_dragonkin',
};

const NPC_KEYS: Record<string, string> = {
  marshal_redbrook: 'npc_marshal',
  warden_fenwick: 'npc_guard_soldier',
  captain_thessaly: 'npc_guard_commander',
  loremaster_caddis: 'npc_mage',
  smith_haldren: 'npc_smith',
  armorer_hode: 'npc_guard_soldier',
  foreman_odell: 'npc_foreman',
  scout_maren: 'npc_scout',
  scout_maren_highwatch: 'npc_scout',
  apothecary_lin: 'npc_villager_robed',
  herbalist_yara: 'npc_villager_robed',
  trader_wilkes: 'npc_trader',
  fisherman_brandt: 'npc_fisherman',
  provisioner_hale: 'npc_villager',
  quartermaster_bree: 'npc_guard_soldier_alt',
};

export function visualKeyFor(e: Entity): string {
  if (e.kind === 'player') {
    return VISUALS[`player_${e.templateId}`] ? `player_${e.templateId}` : 'player_warrior';
  }
  if (e.kind === 'mob') {
    const override = MOB_KEYS[e.templateId];
    if (override) return override;
    const family = MOBS[e.templateId]?.family;
    return (family && FAMILY_KEYS[family]) || 'mob_bandit';
  }
  // npcs — Brother Aldric recurs in every hub under suffixed ids
  if (e.templateId.startsWith('brother_aldric')) return 'npc_mage';
  return NPC_KEYS[e.templateId] ?? 'npc_villager';
}

/** Every glb the manifest can reference (for preloading). */
export function manifestUrls(): string[] {
  const urls = new Set<string>();
  for (const def of Object.values(VISUALS)) {
    urls.add(def.url);
    for (const a of def.attach ?? []) if (a.url) urls.add(a.url);
  }
  return [...urls];
}
