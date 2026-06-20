// Zone 1 — Dawnmere Vale (levels 1-7). The starter zone: town of Dawnmere,
// wolves and boars, the bandit camp, and Brother Aldric's Gravecaller chain
// leading to the Hollow Crypt.

import type { CampDef, GroundObjectDef, MobTemplate, NpcDef, QuestDef, ZoneDef, ZonePropsDef } from '../types';

export const TOWN_RADIUS = 48;
export const GRAVEYARD_POS = { x: -12, z: -14 };
const EASTBROOK_CAMPFIRE = { x: 3, z: -4 };
const facePoint = (from: { x: number; z: number }, to: { x: number; z: number }): number => (
  Math.atan2(to.x - from.x, to.z - from.z)
);
// Basin carved into the heightfield. Pushed to the far northeast so its
// shoreline meets the fishing dock and the murloc camp instead of drowning them.
export const LAKE = { x: -92, z: 88, radius: 30 };

export const ZONE1_ZONE: ZoneDef = {
  id: 'eastbrook_vale',
  name: 'Dawnmere Vale',
  zMin: -180,
  zMax: 180,
  levelRange: [1, 7],
  biome: 'vale',
  hub: { x: 0, z: 0, radius: TOWN_RADIUS, name: 'Dawnmere' },
  graveyard: GRAVEYARD_POS,
  lakes: [LAKE],
  pois: [
    { x: 0, z: -3, label: 'Dawnmere' },
    { x: -2, z: 70, label: 'Moonwolf Run' },
    { x: 65, z: 0, label: 'Sunboar Meadow' },
    { x: -88, z: 82, label: 'Starfall Lake' },
    { x: -60, z: 4, label: 'Silkshade Grove' },
    { x: -84, z: -64, label: 'Embervein Dig' },
    { x: 76, z: -76, label: 'Ravenknife Camp' },
    { x: 80, z: 80, label: 'Moonveil Chapel' },
  ],
  welcome: 'Find Marshal Ardent in town — he has work for you.',
};

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

export const ZONE1_MOBS: Record<string, MobTemplate> = {
  forest_wolf: {
    id: 'forest_wolf', name: 'Vale Blobdog', minLevel: 1, maxLevel: 2, family: 'beast',
    hpBase: 28, hpPerLevel: 14, dmgBase: 3, dmgPerLevel: 1.6, attackSpeed: 2.0,
    armorPerLevel: 10, moveSpeed: 8, aggroRadius: 10,
    loot: [
      { copper: 8, chance: 1 },
      { itemId: 'wolf_fang', chance: 0.45 },
    ],
    scale: 0.9, color: 0x7f8c8d,
  },
  old_greyjaw: {
    id: 'old_greyjaw', name: 'Old Greyblob', minLevel: 4, maxLevel: 4, family: 'beast', rare: true,
    hpBase: 110, hpPerLevel: 20, dmgBase: 5, dmgPerLevel: 2.0, attackSpeed: 1.8,
    armorPerLevel: 16, moveSpeed: 8.5, aggroRadius: 12,
    loot: [
      { copper: 60, chance: 1 },
      { itemId: 'greyjaw_fang', chance: 1, questId: 'q_greyjaw' },
      { itemId: 'wolf_fang', chance: 1 },
    ],
    scale: 1.25, color: 0x566061,
  },
  wild_boar: {
    id: 'wild_boar', name: 'Wild Mushnub', minLevel: 2, maxLevel: 3, family: 'beast',
    hpBase: 34, hpPerLevel: 16, dmgBase: 4, dmgPerLevel: 1.8, attackSpeed: 2.2,
    armorPerLevel: 14, moveSpeed: 7.5, aggroRadius: 9,
    loot: [
      { copper: 12, chance: 1 },
      { itemId: 'boar_hide', chance: 0.6, questId: 'q_boars' },
      { itemId: 'tough_jerky', chance: 0.3 },
    ],
    scale: 0.85, color: 0x935116,
  },
  webwood_spider: {
    id: 'webwood_spider', name: 'Silkshade Grove Spiker', minLevel: 2, maxLevel: 4, family: 'spider',
    hpBase: 30, hpPerLevel: 15, dmgBase: 4, dmgPerLevel: 1.7, attackSpeed: 1.8,
    armorPerLevel: 8, moveSpeed: 8, aggroRadius: 10,
    loot: [
      { copper: 14, chance: 1 },
      { itemId: 'webwood_silk', chance: 0.55, questId: 'q_spiders' },
      { itemId: 'spider_leg', chance: 0.4 },
    ],
    scale: 0.9, color: 0x4a235a,
  },
  mudfin_murloc: {
    id: 'mudfin_murloc', name: 'Mudfin Croaker', minLevel: 3, maxLevel: 5, family: 'murloc',
    hpBase: 36, hpPerLevel: 17, dmgBase: 5, dmgPerLevel: 1.9, attackSpeed: 1.9,
    armorPerLevel: 12, moveSpeed: 8, aggroRadius: 13, // murlocs aggro from far and bring friends
    loot: [
      { copper: 18, chance: 1 },
      { itemId: 'mudfin_scale', chance: 0.5 },
      { itemId: 'linen_scrap', chance: 0.2 },
    ],
    scale: 0.8, color: 0x52be80,
  },
  tunnel_rat: {
    id: 'tunnel_rat', name: 'Candle Cactoro', minLevel: 4, maxLevel: 6, family: 'kobold',
    hpBase: 42, hpPerLevel: 18, dmgBase: 6, dmgPerLevel: 2.0, attackSpeed: 2.1,
    armorPerLevel: 16, moveSpeed: 7, aggroRadius: 10,
    loot: [
      { copper: 22, chance: 1 },
      { itemId: 'tallow_candle', chance: 0.6 },
      { itemId: 'blessed_wax', chance: 0.45, questId: 'q_rite' },
      { itemId: 'linen_scrap', chance: 0.25 },
    ],
    scale: 0.85, color: 0x9c640c,
  },
  vale_bandit: {
    id: 'vale_bandit', name: 'Vale Shadowblade', minLevel: 3, maxLevel: 5, family: 'humanoid',
    hpBase: 40, hpPerLevel: 18, dmgBase: 5, dmgPerLevel: 2.0, attackSpeed: 2.0,
    armorPerLevel: 20, moveSpeed: 7, aggroRadius: 11,
    loot: [
      { copper: 25, chance: 1 },
      { itemId: 'bandit_bandana', chance: 0.5 },
      { itemId: 'linen_scrap', chance: 0.3 },
    ],
    scale: 1.0, color: 0x943126,
  },
  restless_bones: {
    id: 'restless_bones', name: 'Restless Skullfiend', minLevel: 5, maxLevel: 7, family: 'undead',
    hpBase: 46, hpPerLevel: 19, dmgBase: 7, dmgPerLevel: 2.1, attackSpeed: 2.3,
    armorPerLevel: 14, moveSpeed: 6.5, aggroRadius: 11,
    loot: [
      { copper: 30, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.6 },
      { itemId: 'ghostly_essence', chance: 0.55, questId: 'q_rite' },
    ],
    scale: 1.0, color: 0xd5dbdb,
  },
  gorrak: {
    id: 'gorrak', name: 'Gorrak the Sporelord', minLevel: 6, maxLevel: 6, family: 'humanoid',
    hpBase: 160, hpPerLevel: 30, dmgBase: 8, dmgPerLevel: 2.4, attackSpeed: 2.4,
    armorPerLevel: 30, moveSpeed: 7, aggroRadius: 13, boss: true,
    loot: [
      { copper: 250, chance: 1 },
      { itemId: 'bandit_bandana', chance: 1 },
      { itemId: 'oiled_boots', chance: 0.5 },
      { itemId: 'quilted_trousers', chance: 0.5 },
    ],
    scale: 1.25, color: 0x6c3483,
  },
};

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------

export const ZONE1_NPCS: Record<string, NpcDef> = {
  marshal_redbrook: {
    id: 'marshal_redbrook', name: 'Marshal Ardent', title: 'Town Marshal',
    // Open central plaza, pulled away from the castle-town house footprints.
    pos: { x: -16, z: 11 }, facing: facePoint({ x: -16, z: 11 }, EASTBROOK_CAMPFIRE), color: 0xb7950b,
    questIds: ['q_wolves', 'q_greyjaw', 'q_bandits', 'q_ringleader'],
    greeting: 'Keep your blade close, $C. The Vale is not what it was.',
  },
  trader_wilkes: {
    id: 'trader_wilkes', name: 'Trader Wilkes', title: 'Provisioner',
    pos: { x: -7, z: 3 }, facing: facePoint({ x: -7, z: 3 }, EASTBROOK_CAMPFIRE), color: 0x1e8449,
    questIds: ['q_boars', 'q_lumber_for_a_home', 'q_supplies'],
    vendorItems: ['baked_bread', 'spring_water', 'roasted_boar', 'tough_jerky'],
    greeting: 'Fresh bread, clean water, fair prices. What can I get you?',
  },
  apothecary_lin: {
    id: 'apothecary_lin', name: 'Apothecary Lin', title: 'Herbalist',
    pos: { x: 8, z: 7 }, facing: facePoint({ x: 8, z: 7 }, EASTBROOK_CAMPFIRE), color: 0x7d3c98,
    questIds: ['q_spiders'],
    greeting: 'Careful where you step in the eastern woods, friend.',
  },
  brother_aldric: {
    id: 'brother_aldric', name: 'Brother Aldric', title: 'Priest of the Vale',
    pos: { x: -8, z: -2 }, facing: facePoint({ x: -8, z: -2 }, EASTBROOK_CAMPFIRE), color: 0xf7f9f9,
    questIds: [
      'q_bones', 'q_whispers', 'q_names_of_the_dead', 'q_silence_the_call',
      'q_rite', 'q_sexton', 'q_hollow', 'q_gravecallers_trail', 'q_fenbridge_muster',
    ],
    greeting: 'The Light keep you. Even the dead find no rest here of late.',
  },
  smith_haldren: {
    id: 'smith_haldren', name: 'Smith Haldren', title: 'Armorer & Weaponsmith',
    // moved out of the imported castle-town wall/building footprint and onto
    // an open market-street spot near the centre so the vendor remains visible.
    pos: { x: 18, z: -4 }, facing: facePoint({ x: 18, z: -4 }, EASTBROOK_CAMPFIRE), color: 0x707b7c,
    questIds: ['q_craft_first_weapon', 'q_craft_golden_weapon'],
    vendorItems: [
      'eastbrook_arming_sword', 'bronzework_mace', 'vale_carving_knife', 'hickory_shortstaff',
      'eastbrook_chain_vest', 'valespun_robe', 'tanned_leather_jerkin',
      'hobnail_boots', 'eastbrook_wool_trousers',
    ],
    greeting: 'Mind the sparks, $C. Good steel is the difference between a scar and a grave.',
  },
  fisherman_brandt: {
    id: 'fisherman_brandt', name: 'Fisherman Brandt', title: 'Old Salt',
    // in town (east edge, glaring out at Starfall Lake) — his old spot by the
    // dock sat inside the Mudfin spawn radius and new players got ambushed
    // walking up to a quest giver
    pos: { x: -16, z: 6 }, facing: facePoint({ x: -16, z: 6 }, EASTBROOK_CAMPFIRE), color: 0x2471a3,
    questIds: ['q_murlocs'],
    greeting: 'Grlmurlgrl— sorry, been listening to those fish-men too long.',
  },
  foreman_odell: {
    id: 'foreman_odell', name: 'Foreman Odell', title: 'Mine Foreman',
    // in town (south edge, scowling toward his overrun dig) — his old spot
    // sat inside the Candle Cactoro spawn radius
    pos: { x: -4, z: -14 }, facing: facePoint({ x: -4, z: -14 }, EASTBROOK_CAMPFIRE), color: 0xa04000,
    questIds: ['q_mine'],
    greeting: "Whole dig's crawling with those candle-headed vermin!",
  },
};

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export const ZONE1_QUESTS: Record<string, QuestDef> = {
  q_wolves: {
    id: 'q_wolves', name: 'Wolves at the Door',
    giverNpcId: 'marshal_redbrook', turnInNpcId: 'marshal_redbrook',
    text: 'The forest wolves grow bold, snapping at travelers on the north road. Thin their numbers, $N. Slay 8 Forest Wolves and Dawnmere will breathe easier.',
    completionText: 'Fine work. The road feels safer already.',
    objectives: [{ type: 'kill', targetMobId: 'forest_wolf', count: 8, label: 'Vale Blobdog slain' }],
    xpReward: 250, copperReward: 75, itemRewards: {},
  },
  q_greyjaw: {
    id: 'q_greyjaw', name: 'The Old Wolf',
    giverNpcId: 'marshal_redbrook', turnInNpcId: 'marshal_redbrook',
    text: 'There is one wolf no trap has held: Old Greyblob. He has taken three hounds and a stable boy\'s arm. He prowls the deep woods north of the wolf runs. Bring me his fang.',
    completionText: 'So the old devil is dead at last. The stable boy will sleep easier — and so will I.',
    objectives: [{ type: 'collect', itemId: 'greyjaw_fang', count: 1, label: "Old Greyblob's Fang" }],
    xpReward: 450, copperReward: 150,
    itemRewards: { warrior: 'greyjaw_pelt_cloak', mage: 'greyjaw_pelt_cloak', rogue: 'greyjaw_pelt_cloak' },
    requiresQuest: 'q_wolves',
  },
  q_boars: {
    id: 'q_boars', name: 'Bristleback Hides',
    giverNpcId: 'trader_wilkes', turnInNpcId: 'trader_wilkes',
    text: 'Boar hide makes the finest travel packs, and the meadows west of town are crawling with the beasts. Bring me 5 Bristly Boar Hides and I will make it worth your time.',
    completionText: 'Ah, fine bristly hides! These will fetch a good price.',
    objectives: [{ type: 'collect', itemId: 'boar_hide', count: 5, label: 'Bristly Boar Hide' }],
    xpReward: 350, copperReward: 120, itemRewards: {},
  },
  q_lumber_for_a_home: {
    id: 'q_lumber_for_a_home', name: 'Lumber for a Home',
    giverNpcId: 'trader_wilkes', turnInNpcId: 'trader_wilkes',
    text: 'If you want a place of your own beyond Dawnmere\'s walls, you need timber first. Chop 10 trees and I will sign over a small farmstead deed. Plant it outside the castle walls, where there is room to work.',
    completionText: 'That is good straight lumber. Here is your deed — use it outside the walls and the land is yours.',
    objectives: [{ type: 'chop', count: 10, label: 'Trees chopped' }],
    xpReward: 250, copperReward: 0,
    itemRewards: { warrior: 'farmstead_deed', mage: 'farmstead_deed', rogue: 'farmstead_deed' },
  },
  q_craft_first_weapon: {
    id: 'q_craft_first_weapon', name: 'A Weapon of Your Own',
    giverNpcId: 'smith_haldren', turnInNpcId: 'smith_haldren',
    text: 'That old starter weapon will not carry you far. Use the crafting table beside my forge and make a class weapon. The first craft is cheap: 10 Wood and 10 fish.',
    completionText: 'Good. That one is fitted to your class and your hand. Keep it close.',
    objectives: [{ type: 'craft', craftTier: 'normal', count: 1, label: 'Class weapon crafted' }],
    xpReward: 200, copperReward: 50, itemRewards: {},
  },
  q_craft_golden_weapon: {
    id: 'q_craft_golden_weapon', name: 'The Golden Masterwork',
    giverNpcId: 'smith_haldren', turnInNpcId: 'smith_haldren',
    text: 'Now for the best weapon I can teach you to make. Bring patience and materials: a golden class weapon costs 200 Wood and 200 fish.',
    completionText: 'That golden weapon is the best craft in the Vale. No finer edge leaves my forge.',
    objectives: [{ type: 'craft', craftTier: 'golden', count: 1, label: 'Golden class weapon crafted' }],
    xpReward: 900, copperReward: 250, itemRewards: {},
    requiresQuest: 'q_craft_first_weapon',
  },
  q_spiders: {
    id: 'q_spiders', name: 'Silkshade Grove Menace',
    giverNpcId: 'apothecary_lin', turnInNpcId: 'apothecary_lin',
    text: 'The lurkers in the eastern woods spin a silk I need for my poultices — and they have grown far too numerous besides. Cull 6 Silkshade Grove Spikers and cut 4 silk glands from their bellies.',
    completionText: 'Ugh, still twitching. Perfect. Here, you\'ve earned this.',
    objectives: [
      { type: 'kill', targetMobId: 'webwood_spider', count: 6, label: 'Silkshade Grove Spiker slain' },
      { type: 'collect', itemId: 'webwood_silk', count: 4, label: 'Silkshade Grove Silk Gland' },
    ],
    xpReward: 420, copperReward: 140, itemRewards: {},
    minLevel: 2,
  },
  q_murlocs: {
    id: 'q_murlocs', name: 'Trouble at the Lake',
    giverNpcId: 'fisherman_brandt', turnInNpcId: 'fisherman_brandt',
    text: 'Twenty years I have fished Starfall Lake, and never lost a net until those gurgling fish-men crawled out of the shallows. Drive the Mudfin back — slay 8 of them. And watch yourself: where there is one murloc, there are five.',
    completionText: 'Hah! That will teach them to mind their own mudholes.',
    objectives: [{ type: 'kill', targetMobId: 'mudfin_murloc', count: 8, label: 'Mudfin Croaker slain' }],
    xpReward: 520, copperReward: 180, itemRewards: {},
    minLevel: 3,
  },
  q_mine: {
    id: 'q_mine', name: 'Rats in the Mine',
    giverNpcId: 'foreman_odell', turnInNpcId: 'foreman_odell',
    text: 'We struck a fine copper vein and then those kobold vermin came boiling out of the hillside. My crew will not set foot in the dig until it is cleared. Put down 10 Candle Cactoros.',
    completionText: 'Ha! Back to work, lads! You have my thanks — and my coin.',
    objectives: [{ type: 'kill', targetMobId: 'tunnel_rat', count: 10, label: 'Candle Cactoro slain' }],
    xpReward: 620, copperReward: 220, itemRewards: {},
    minLevel: 4,
  },
  q_bones: {
    id: 'q_bones', name: 'The Restless Dead',
    giverNpcId: 'brother_aldric', turnInNpcId: 'brother_aldric',
    text: 'The old ruin on the northwest hill was a chapel once, and its yard a resting place. Something has stirred the dead from their sleep. Grant them peace, $N — return 8 Restless Skullfiend to the earth.',
    completionText: 'May they rest now, and may the Light forgive whatever woke them.',
    objectives: [{ type: 'kill', targetMobId: 'restless_bones', count: 8, label: 'Restless Skullfiend laid to rest' }],
    xpReward: 700, copperReward: 260, itemRewards: {},
    minLevel: 5,
  },
  q_supplies: {
    id: 'q_supplies', name: 'Stolen Supplies',
    giverNpcId: 'trader_wilkes', turnInNpcId: 'trader_wilkes',
    text: 'Those bandits hit my last wagon and made off with four crates of goods — tools, salt, good Dawnmere linen. The crates are stacked around their camp in the southeast hills. Steal them back for me, would you?',
    completionText: 'My crates! Barely a scratch on them. You are a wonder.',
    objectives: [{ type: 'collect', itemId: 'supply_crate', count: 4, label: 'Stolen Supply Crate' }],
    xpReward: 550, copperReward: 250, itemRewards: {},
    minLevel: 3,
  },
  q_whispers: {
    id: 'q_whispers', name: 'Whispers Below',
    giverNpcId: 'brother_aldric', turnInNpcId: 'brother_aldric',
    text: 'You have laid the dead to rest, but they will not stay resting — something calls them back. Search the chapel ruin for any trace of the one doing the calling. If you find a sigil or seal, bring it to me untouched.',
    completionText: 'This sigil... it bears the mark of the Gravecallers, a sect I had prayed was extinct. This is worse than I feared, $N.',
    objectives: [{ type: 'collect', itemId: 'gravecaller_sigil', count: 1, label: "Gravecaller's Sigil" }],
    xpReward: 400, copperReward: 150, itemRewards: {},
    requiresQuest: 'q_bones',
  },
  q_names_of_the_dead: {
    id: 'q_names_of_the_dead', name: 'The Names of the Dead',
    giverNpcId: 'brother_aldric', turnInNpcId: 'brother_aldric',
    text: 'If the Gravecallers raised our dead, I must know whose graves they robbed. The chapel sexton kept a burial ledger, and the wind has scattered its pages across the chapel yard. Gather 3 of them for me, $N — the dead deserve to be called by their names.',
    completionText: 'These poor souls... and look here. Sexton Marrow-Skull — the chapel\'s own living caretaker — his grave the first disturbed. Morthen began with the very man who buried Dawnmere\'s dead.',
    objectives: [{ type: 'collect', itemId: 'weathered_ledger_page', count: 3, label: 'Weathered Ledger Page' }],
    xpReward: 600, copperReward: 250, itemRewards: {},
    requiresQuest: 'q_whispers',
  },
  q_silence_the_call: {
    id: 'q_silence_the_call', name: 'Silence the Call',
    giverNpcId: 'brother_aldric', turnInNpcId: 'brother_aldric',
    text: 'Every name in that ledger is a soul Morthen means to drag from the earth, and the chapel yard already crawls with those he has called. Return 12 Restless Skullfiend to their graves, $N, before the Gravecaller\'s whisper swells into a chorus.',
    completionText: 'The yard grows quieter — but the calling has not stopped. It rises from below now, $N. From the crypt itself.',
    objectives: [{ type: 'kill', targetMobId: 'restless_bones', count: 12, label: 'Restless Skullfiend silenced' }],
    xpReward: 750, copperReward: 300, itemRewards: {},
    requiresQuest: 'q_names_of_the_dead',
  },
  q_rite: {
    id: 'q_rite', name: 'The Binding Rite',
    giverNpcId: 'brother_aldric', turnInNpcId: 'brother_aldric',
    text: 'The crypt beneath the chapel must be unsealed if we are to stop the Gravecaller — but only a binding rite will let the living pass. I need 4 lumps of Blessed Tallow — the kobold diggers hoard candles by the crate — and 6 Ghostly Essences from the restless dead.',
    completionText: 'It is done. The way below stands open... and may the Light forgive me for opening it. Gather your strongest companions before you descend, $N. No one should face the Hollow alone.',
    objectives: [
      { type: 'collect', itemId: 'blessed_wax', count: 4, label: 'Blessed Tallow' },
      { type: 'collect', itemId: 'ghostly_essence', count: 6, label: 'Ghostly Essence' },
    ],
    xpReward: 700, copperReward: 500, itemRewards: {},
    requiresQuest: 'q_whispers',
  },
  q_hollow: {
    id: 'q_hollow', name: 'Into the Hollow',
    giverNpcId: 'brother_aldric', turnInNpcId: 'brother_aldric',
    text: 'Morthen the Grave Demon waits at the bottom of the Hollow Crypt, ringed by the elite dead he has raised. He is far beyond any one hero — take four companions, no fewer. End him, and the Vale\'s dead will finally sleep.',
    completionText: 'The whispering has stopped. You have done what the whole Vale could not, $N — the dead sleep, and Dawnmere owes you everything it has.',
    objectives: [{ type: 'kill', targetMobId: 'morthen', count: 1, label: 'Morthen the Grave Demon slain' }],
    xpReward: 1500, copperReward: 10000,
    itemRewards: { warrior: 'gravecaller_blade', rogue: 'widowfang_dirk', mage: 'gravecaller_staff' },
    requiresQuest: 'q_rite',
    suggestedPlayers: 5,
  },
  q_sexton: {
    id: 'q_sexton', name: "The Sexton's Bell",
    giverNpcId: 'brother_aldric', turnInNpcId: 'brother_aldric',
    text: 'The ledger named him and the crypt holds him: Sexton Marrow-Skull, the chapel\'s caretaker, the first man Morthen raised — guarding his master\'s door in death as faithfully as he kept the chapel in life. Take four companions into the Hollow Crypt and grant the old sexton the rest he was robbed of, $N.',
    completionText: 'So Marrow is free at last. Ring no bell for him — he heard enough of them in life.',
    objectives: [{ type: 'kill', targetMobId: 'sexton_marrow', count: 1, label: 'Sexton Marrow-Skull laid to rest' }],
    xpReward: 1000, copperReward: 600,
    itemRewards: { warrior: 'marrowtread_boots', mage: 'sextons_slippers', rogue: 'gravewalker_softboots' },
    requiresQuest: 'q_rite',
    suggestedPlayers: 5,
  },
  q_gravecallers_trail: {
    id: 'q_gravecallers_trail', name: "The Gravecaller's Trail",
    giverNpcId: 'brother_aldric', turnInNpcId: 'brother_aldric',
    text: 'Morthen is dead, yet a question gnaws at me: a sect that hid for a century does not spend itself on one village chapel. He kept a grimoire — his rites, his correspondence. If anything of it survives, it lies in the vestry of the ruined chapel above the crypt. Search the ruin and bring me whatever remains of his writings, $N.',
    completionText: 'Morthen wrote to a \'Mistcaller\' in the northern fen. The sect is not dead, $N — it has merely been patient.',
    objectives: [{ type: 'collect', itemId: 'morthen_grimoire', count: 1, label: "Morthen's Grimoire" }],
    xpReward: 900, copperReward: 400, itemRewards: {},
    requiresQuest: 'q_hollow',
  },
  q_bandits: {
    id: 'q_bandits', name: 'Bandits of the Vale',
    giverNpcId: 'marshal_redbrook', turnInNpcId: 'marshal_redbrook',
    text: 'A pack of cutthroats has made camp in the southwest hills. They have robbed three wagons this week. Drive them out — slay 10 Vale Shadowblades.',
    completionText: 'Ten fewer knives in the dark. Take this — you have earned it.',
    objectives: [{ type: 'kill', targetMobId: 'vale_bandit', count: 10, label: 'Vale Shadowblade slain' }],
    xpReward: 550, copperReward: 200,
    itemRewards: { warrior: 'redbrook_blade', mage: 'apprentice_staff', rogue: 'keen_dirk' },
    requiresQuest: 'q_wolves',
  },
  q_ringleader: {
    id: 'q_ringleader', name: 'The Ringleader',
    giverNpcId: 'marshal_redbrook', turnInNpcId: 'marshal_redbrook',
    text: 'The bandits answer to one man: Gorrak the Ruthless. Cut off the head and the body will scatter. He skulks at the heart of their camp. End him, $N.',
    completionText: 'Gorrak is dead? Then the Vale is free of his shadow. You have done Dawnmere a great service.',
    objectives: [{ type: 'kill', targetMobId: 'gorrak', count: 1, label: 'Gorrak the Ruthless slain' }],
    xpReward: 800, copperReward: 500,
    itemRewards: { warrior: 'militia_vest', mage: 'woven_robe', rogue: 'shadow_jerkin' },
    requiresQuest: 'q_bandits',
  },
};

export const ZONE1_QUEST_ORDER = [
  'q_wolves', 'q_boars', 'q_lumber_for_a_home', 'q_craft_first_weapon', 'q_craft_golden_weapon', 'q_spiders', 'q_greyjaw', 'q_murlocs',
  'q_supplies', 'q_bandits', 'q_mine', 'q_bones', 'q_ringleader',
  'q_whispers', 'q_names_of_the_dead', 'q_silence_the_call',
  'q_rite', 'q_sexton', 'q_hollow', 'q_gravecallers_trail',
];

// ---------------------------------------------------------------------------
// World layout. Town sits at origin. +z north, +x WEST (east is -x:
// facing 0 looks along +z and turning right decreases facing, so the
// rendered world and the corrected map both put -x on your right).
// ---------------------------------------------------------------------------

export const ZONE1_CAMPS: CampDef[] = [
  // Wolves: north woods
  // shifted north after the larger castle-town wall gained collision; the old
  // radii overlapped the walls and could trap wolves on the town perimeter.
  { mobId: 'forest_wolf', center: { x: -15, z: 78 }, radius: 18, count: 7 },
  { mobId: 'forest_wolf', center: { x: 20, z: 88 }, radius: 18, count: 6 },
  { mobId: 'old_greyjaw', center: { x: 0, z: 110 }, radius: 8, count: 1 },
  // Boars: east meadow
  { mobId: 'wild_boar', center: { x: 55, z: 12 }, radius: 22, count: 6 },
  { mobId: 'wild_boar', center: { x: 80, z: -15 }, radius: 18, count: 5 },
  // Spiders: western woods
  { mobId: 'webwood_spider', center: { x: -60, z: 5 }, radius: 22, count: 7 },
  // Murlocs: lake shore northwest — camp straddles the waterline
  { mobId: 'mudfin_murloc', center: { x: -75, z: 57 }, radius: 14, count: 8 },
  // Kobolds: mine southwest
  { mobId: 'tunnel_rat', center: { x: -82, z: -62 }, radius: 20, count: 9 },
  // Bandits: southeast camp
  { mobId: 'vale_bandit', center: { x: 65, z: -65 }, radius: 24, count: 7 },
  { mobId: 'vale_bandit', center: { x: 90, z: -90 }, radius: 16, count: 5 },
  { mobId: 'gorrak', center: { x: 92, z: -92 }, radius: 2, count: 1 },
  // Undead: ruins northeast
  { mobId: 'restless_bones', center: { x: 80, z: 78 }, radius: 18, count: 8 },
];


export const ZONE1_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'crafting_table', templateId: 'crafting_table', name: 'Crafting Table',
    positions: [{ x: 7, z: -5 }],
  },
  {
    itemId: 'supply_crate',
    name: 'Stolen Supply Crate',
    positions: [
      { x: 58, z: -58 }, { x: 73, z: -70 }, { x: 86, z: -82 }, { x: 95, z: -97 },
      { x: 64, z: -76 }, { x: 81, z: -94 },
    ],
  },
  {
    itemId: 'gravecaller_sigil',
    name: "Gravecaller's Sigil",
    positions: [{ x: 84, z: 88 }, { x: 76, z: 92 }],
  },
  {
    itemId: 'weathered_ledger_page',
    name: 'Weathered Ledger Page',
    positions: [{ x: 78, z: 84 }, { x: 83, z: 88 }, { x: 86, z: 92 }],
  },
  {
    itemId: 'morthen_grimoire',
    name: "Morthen's Grimoire",
    positions: [{ x: 78, z: 86 }],
  },
];

// Roads from town toward each hub — used for terrain painting and the map.
// Roads from town toward each hub — used for terrain painting and the map.
export const ZONE1_ROADS: { x: number; z: number }[][] = [
  [{ x: 0, z: 8 }, { x: -8, z: 30 }, { x: -15, z: 55 }, { x: -2, z: 78 }],          // north to wolves
  [{ x: 8, z: 2 }, { x: 30, z: 8 }, { x: 55, z: 12 }],                              // east to boars
  [{ x: 6, z: -6 }, { x: 30, z: -30 }, { x: 50, z: -50 }, { x: 65, z: -65 }],       // southeast to bandits
  [{ x: -8, z: 6 }, { x: -35, z: 25 }, { x: -58, z: 48 }, { x: -66, z: 58 }],       // northwest to lake
  [{ x: -6, z: -6 }, { x: -30, z: -28 }, { x: -55, z: -45 }, { x: -70, z: -55 }],   // southwest to mine
  [{ x: 6, z: 8 }, { x: 35, z: 35 }, { x: 60, z: 60 }, { x: 78, z: 74 }],           // northeast to ruins
];

// ---------------------------------------------------------------------------
// Static props (rendering + collision share this placement data)
// ---------------------------------------------------------------------------

export const ZONE1_PROPS: ZonePropsDef = {
  // Dawnmere's loose village buildings + well have been replaced visually by
  // the user-provided castle_town.glb shell in render/props.ts. Keep NPCs and
  // quest/service anchors in the same central positions, now inside the walls.
  buildings: [],
  wells: [],
  stalls: [
    { x: -8.5, z: 3, rot: Math.PI / 2, r: 1.7 },
    { x: 9.5, z: 17.5, rot: -2.7, r: 1.7 }, // Smith Haldren's smithy stall
  ],
  mines: [{ x: -88, z: -68, rot: 0.8 }],
  docks: [{ x: -64, z: 60, rot: -2.2, hutLocal: { x: 2.8, z: 2.4, hw: 1.7, hd: 1.5 } }],
  tents: [
    { x: 62, z: -61, rot: 0.4, scale: 1 },
    { x: 69, z: -69, rot: 2.1, scale: 1 },
    { x: 88, z: -86, rot: 1.2, scale: 1.3 },
    { x: 95, z: -94, rot: -0.6, scale: 1 },
  ],
  crates: [[60, -63], [66, -67], [87, -88], [93, -90], [70, -72]],
  campfires: [[3, -4], [65, -65], [90, -90], [-80, -60], [-61, 56]],
  mudHuts: [[-73, 59], [-78, 54], [-69, 55]],
  ruinRings: [{ x: 80, z: 78, ringR: 7, columns: 7 }],
  fences: [],
  graveyards: [],
};
