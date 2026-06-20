// Online play: REST auth client + WebSocket world mirror.

import { NPCS, QUESTS, abilitiesKnownAt } from '../sim/data';
import { computeQuestState, ResolvedAbility } from '../sim/sim';
import {
  Entity, EquipSlot, FarmPlot, InvSlot, MoveInput, PlayerClass, QuestProgress, QuestState, SimEvent,
  emptyMoveInput,
} from '../sim/types';
import type { CharacterSearchResult, DuelInfo, IWorld, PartyInfo, SocialInfo, TradeInfo } from '../world_api';

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

export interface CharacterSummary {
  id: number;
  name: string;
  class: PlayerClass;
  level: number;
  online: boolean;
  forceRename: boolean;
}

export function buildWebSocketUrl(protocol: string, host: string): string {
  const proto = protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${host}/ws`;
}

export function buildWebSocketAuthMessage(token: string, characterId: number, realm?: string | null): { t: 'auth'; token: string; character: number; realm?: string } {
  return realm ? { t: 'auth', token, character: characterId, realm } : { t: 'auth', token, character: characterId };
}

export type RealmType = 'Normal' | 'PvP' | 'RP' | 'RP-PvP';

export interface RealmEntry {
  name: string;
  url: string;
  type: RealmType | 'Premium';
  premium?: boolean;
  minVaeloria?: number;
}

export interface RealmDirectory {
  current: string;
  realms: RealmEntry[];
  characters: Record<string, number>; // realm name -> how many characters you have
  vaeloriaHoldings: number;
  premiumMinVaeloria: number;
}

export class Api {
  token: string | null = null;
  username: string | null = null;
  solanaWallet: string | null = null;
  privyDisplayName: string | null = null;
  privyAvatarUrl: string | null = null;
  privyTwitterUsername: string | null = null;
  realm: string | null = null;
  // base origin for realm-scoped calls (characters, search, ws). '' = the page
  // origin; set to another realm's origin when the player picks a realm
  base = '';

  setRealm(url: string, name?: string): void {
    this.base = url || '';
    if (name) this.realm = name;
  }

  // The realm directory is always read from the page's own server. Sending the
  // token (when logged in) also returns per-realm character counts.
  async realms(): Promise<RealmDirectory> {
    try {
      const res = await fetch('/api/realms', { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} });
      if (!res.ok) return { current: '', realms: [], characters: {}, vaeloriaHoldings: 0, premiumMinVaeloria: 1000 };
      const d = await res.json();
      return { current: d.current ?? '', realms: d.realms ?? [], characters: d.characters ?? {}, vaeloriaHoldings: Number(d.vaeloriaHoldings ?? 0), premiumMinVaeloria: Number(d.premiumMinVaeloria ?? 1000) };
    } catch {
      return { current: '', realms: [], characters: {}, vaeloriaHoldings: 0, premiumMinVaeloria: 1000 };
    }
  }

  // Live status for a realm (population + reachability), for the realm picker.
  async realmStatus(url: string, realm?: string): Promise<{ online: boolean; players: number }> {
    try {
      const target = `${url}/api/status${realm ? `?realm=${encodeURIComponent(realm)}` : ''}`;
      const res = await fetch(target, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { online: false, players: 0 };
      const d = await res.json();
      return { online: true, players: d.players_online ?? 0 };
    } catch {
      return { online: false, players: 0 };
    }
  }

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(this.realm ? { 'X-Vaeloria-Realm': this.realm } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
    return data;
  }

  private async get(path: string): Promise<any> {
    const res = await fetch(this.base + path, {
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(this.realm ? { 'X-Vaeloria-Realm': this.realm } : {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
    return data;
  }

  async register(_username: string, _password: string): Promise<void> {
    throw new Error('Classic username/password registration is disabled. Use Privy Solana login.');
  }

  async login(_username: string, _password: string): Promise<void> {
    throw new Error('Classic username/password login is disabled. Use Privy Solana login.');
  }

  usePrivySession(session: { token: string; username: string; solanaWallet: string; privyDisplayName?: string; privyAvatarUrl?: string; privyTwitterUsername?: string }): void {
    this.token = session.token;
    this.username = session.username;
    this.solanaWallet = session.solanaWallet;
    this.privyDisplayName = session.privyDisplayName ?? null;
    this.privyAvatarUrl = session.privyAvatarUrl ?? null;
    this.privyTwitterUsername = session.privyTwitterUsername ?? null;
  }

  async characters(): Promise<CharacterSummary[]> {
    const data = await this.get('/api/characters');
    if (typeof data.realm === 'string') this.realm = data.realm;
    return data.characters;
  }

  async createCharacter(name: string, cls: PlayerClass): Promise<void> {
    await this.post('/api/characters', { name, class: cls });
  }

  async renameCharacter(characterId: number, name: string): Promise<void> {
    await this.post(`/api/characters/${characterId}/rename`, { name });
  }

  async deleteCharacter(characterId: number): Promise<void> {
    const res = await fetch(`${this.base}/api/characters/${characterId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  }

  async reportPlayer(reporterCharacterId: number, targetPid: number, reason: string, details: string): Promise<void> {
    await this.post('/api/reports', { reporterCharacterId, targetPid, reason, details });
  }

  async reportPlayerByName(reporterCharacterId: number, targetCharacterName: string, reason: string, details: string): Promise<void> {
    await this.post('/api/reports', { reporterCharacterId, targetCharacterName, reason, details });
  }
}

// ---------------------------------------------------------------------------
// World mirror
// ---------------------------------------------------------------------------

function wrapAngle(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function blankEntity(id: number): Entity {
  return {
    id, kind: 'mob', templateId: '', name: '', level: 1,
    pos: { x: 0, y: 0, z: 0 }, prevPos: { x: 0, y: 0, z: 0 }, facing: 0, prevFacing: 0,
    vy: 0, onGround: true, fallStartY: 0,
    hp: 1, maxHp: 1, resource: 0, maxResource: 0, resourceType: null,
    stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 },
    weapon: { min: 1, max: 2, speed: 2 },
    attackPower: 0, rangedPower: 0, critChance: 0.05, dodgeChance: 0.05, moveSpeed: 7, hostile: false,
    targetId: null, autoAttack: false, swingTimer: 0,
    inCombat: false, combatTimer: 99,
    auras: [], castingAbility: null, castRemaining: 0, castTotal: 0,
    channeling: false, choppingTreeKey: null, choppingTreeX: 0, choppingTreeZ: 0,
    channelTickTimer: 0, channelTickEvery: 0,
    gcdRemaining: 0, cooldowns: new Map(), queuedOnSwing: null, fiveSecondRule: 99,
    comboPoints: 0, comboTargetId: null, overpowerUntil: -1, savedMana: 0,
    chargeTargetId: null, chargeTimeLeft: 0, chargePath: [],
    sitting: false, eating: null, drinking: null,
    aiState: 'idle', tappedById: null, pulseTimer: 0, firedSummons: 0, summonedIds: [], enraged: false,
    threat: new Map(), forcedTargetId: null, forcedTargetTimer: 0, ownerId: null, petTauntTimer: 0,
    spawnPos: { x: 0, y: 0, z: 0 }, wanderTarget: null, wanderTimer: 0,
    aggroTargetId: null, respawnTimer: 0, corpseTimer: 0, lootable: false, loot: null,
    xpValue: 0, questIds: [], vendorItems: [], objectItemId: null, dungeonId: null,
    dead: false, scale: 1, color: 0xffffff,
  };
}

export class ClientWorld implements IWorld {
  cfg: { seed: number; playerClass: PlayerClass };
  entities = new Map<number, Entity>();
  playerId = -1;
  moveInput: MoveInput = emptyMoveInput();
  inventory: InvSlot[] = [];
  choppedTrees = new Map<string, number>();
  farms: FarmPlot[] = [];
  equipment: Partial<Record<EquipSlot, string>> = {};
  copper = 0;
  xp = 0;
  known: ResolvedAbility[] = [];
  questLog = new Map<string, QuestProgress>();
  questsDone = new Set<string>();
  partyInfo: PartyInfo | null = null;
  tradeInfo: TradeInfo | null = null;
  duelInfo: DuelInfo | null = null;
  socialInfo: SocialInfo | null = null;
  realm = '';
  // bumped whenever a fresh social snapshot lands, so an open panel re-renders
  private socialDirty = false;
  // snapshot interpolation
  lastSnapAt = 0;
  snapInterval = 50; // ms, adapts to measured cadence
  // camera follow for keyboard turns applied by the main loop
  pendingFacingDelta = 0;
  connected = false;
  onDisconnect: ((reason: string) => void) | null = null;
  readonly characterId: number;

  private ws: WebSocket;
  private readonly token: string;
  private readonly base: string;
  private readonly selectedRealm: string | null;
  private eventQueue: SimEvent[] = [];
  private lastTreeTimerSync = 0;
  // inventory deltas arrive in snapshots, separate from the event frames the
  // HUD redraws on — the frame loop polls this so open panels re-render
  private invChanged = false;
  private mouselookFacing: number | null = null;
  private sendTimer: number | undefined;

  constructor(token: string, characterId: number, cls: PlayerClass, base = '', realm: string | null = null) {
    this.characterId = characterId;
    this.token = token;
    this.base = base;
    this.selectedRealm = realm;
    this.cfg = { seed: 20061, playerClass: cls };
    // when a realm was picked, connect to that realm's origin; otherwise the
    // page's own host
    const wsUrl = base
      ? base.replace(/^http/, 'ws') + '/ws'
      : buildWebSocketUrl(location.protocol, location.host);
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify(buildWebSocketAuthMessage(token, characterId, this.selectedRealm)));
    };
    this.ws.onmessage = (ev) => this.onMessage(String(ev.data));
    this.ws.onclose = () => {
      this.connected = false;
      clearInterval(this.sendTimer);
      this.onDisconnect?.('Connection to the server was lost.');
    };
    // input stream at sim rate
    this.sendTimer = window.setInterval(() => this.sendInput(), 50);
  }

  close(): void {
    clearInterval(this.sendTimer);
    this.ws.onclose = null;
    this.ws.close();
  }

  get player(): Entity {
    return this.entities.get(this.playerId) ?? blankEntity(-1);
  }

  drainEvents(): SimEvent[] {
    const out = this.eventQueue;
    this.eventQueue = [];
    return out;
  }

  setMouselookFacing(facing: number | null): void {
    this.mouselookFacing = facing;
  }

  // -----------------------------------------------------------------------
  // Socket
  // -----------------------------------------------------------------------

  private sendInput(): void {
    if (!this.connected || this.ws.readyState !== WebSocket.OPEN) return;
    const mi = this.moveInput;
    const msg: Record<string, unknown> = {
      t: 'input',
      mi: {
        f: mi.forward ? 1 : 0, b: mi.back ? 1 : 0,
        tl: mi.turnLeft ? 1 : 0, tr: mi.turnRight ? 1 : 0,
        sl: mi.strafeLeft ? 1 : 0, sr: mi.strafeRight ? 1 : 0,
        j: mi.jump ? 1 : 0,
      },
    };
    if (this.mouselookFacing !== null) msg.facing = this.mouselookFacing;
    this.ws.send(JSON.stringify(msg));
  }

  private cmd(payload: Record<string, unknown>): void {
    if (!this.connected || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: 'cmd', ...payload }));
  }

  private onMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.t === 'hello') {
      this.playerId = msg.pid;
      this.cfg.seed = msg.seed;
      if (typeof msg.realm === 'string') this.realm = msg.realm;
      this.connected = true;
      return;
    }
    if (msg.t === 'error') {
      this.connected = false;
      this.onDisconnect?.(msg.error ?? 'rejected by server');
      return;
    }
    if (msg.t === 'events') {
      for (const ev of msg.list) {
        this.applyWorldEvent(ev as SimEvent);
        this.eventQueue.push(ev as SimEvent);
      }
      return;
    }
    if (msg.t === 'social') {
      this.socialInfo = { friends: msg.friends ?? [], blocks: msg.blocks ?? [], guild: msg.guild ?? null };
      this.socialDirty = true;
      return;
    }
    if (msg.t === 'snap') {
      this.applySnapshot(msg);
    }
  }

  consumeSocialChanged(): boolean {
    const v = this.socialDirty;
    this.socialDirty = false;
    return v;
  }

  private applyWorldEvent(ev: SimEvent): void {
    if (ev.type === 'treeState') {
      if (ev.chopped) this.choppedTrees.set(ev.treeKey, ev.respawnSeconds ?? 180);
      else this.choppedTrees.delete(ev.treeKey);
    } else if (ev.type === 'farmPlaced') {
      const i = this.farms.findIndex((f) => f.id === ev.farm.id);
      if (i >= 0) this.farms[i] = ev.farm;
      else this.farms.push(ev.farm);
    } else if (ev.type === 'farmRemoved') {
      this.farms = this.farms.filter((f) => f.id !== ev.farmId);
    } else if (ev.type === 'treeChopStart') {
      const e = this.entities.get(ev.entityId);
      if (e) {
        e.choppingTreeKey = ev.treeKey;
        e.choppingTreeX = ev.x;
        e.choppingTreeZ = ev.z;
        e.castRemaining = ev.time;
        e.castTotal = ev.time;
      }
    } else if (ev.type === 'treeChopStop') {
      const e = this.entities.get(ev.entityId);
      if (e?.choppingTreeKey === ev.treeKey) {
        e.choppingTreeKey = null;
        e.castRemaining = 0;
        e.castTotal = 0;
      }
    }
  }

  private updateChoppedTreeTimers(worldTime: number): void {
    if (!this.choppedTrees) this.choppedTrees = new Map();
    if (this.lastTreeTimerSync <= 0) {
      this.lastTreeTimerSync = worldTime;
      return;
    }
    const dt = Math.max(0, worldTime - this.lastTreeTimerSync);
    this.lastTreeTimerSync = worldTime;
    if (dt <= 0 || this.choppedTrees.size === 0) return;
    for (const [key, remaining] of [...this.choppedTrees]) {
      const next = remaining - dt;
      if (next <= 0) this.choppedTrees.delete(key);
      else this.choppedTrees.set(key, next);
    }
  }

  private applySnapshot(snap: any): void {
    const now = performance.now();
    if (typeof snap.time === 'number') this.updateChoppedTreeTimers(snap.time);
    // the interpolation alpha the render loop reached on its last frame
    // (same formula and caps as main.ts); used below to re-anchor the new
    // interpolation segment at the pose currently on screen
    const contAlpha = this.lastSnapAt > 0
      ? Math.min(1.25, (now - this.lastSnapAt) / Math.max(20, this.snapInterval))
      : 1;
    if (this.lastSnapAt > 0) {
      const gap = now - this.lastSnapAt;
      if (gap > 5 && gap < 500) this.snapInterval = this.snapInterval * 0.9 + gap * 0.1;
    }
    this.lastSnapAt = now;

    const seen = new Set<number>();
    const prevSelf = this.entities.get(this.playerId);
    const prevSelfFacing = prevSelf?.facing;

    const applyWire = (w: any): Entity | null => {
      let e = this.entities.get(w.id);
      // identity fields ride only in "full" records: first sight and changes
      const hasIdentity = w.k !== undefined;
      if (!e) {
        // a lite record for an entity we never met would render as a
        // half-initialized ghost; skip it (the server sends identity first)
        if (!hasIdentity) return null;
        e = blankEntity(w.id);
        e.pos = { x: w.x, y: w.y, z: w.z };
        e.prevPos = { x: w.x, y: w.y, z: w.z };
        e.facing = w.f;
        e.prevFacing = w.f;
        this.entities.set(w.id, e);
      }
      if (hasIdentity) {
        e.kind = w.k;
        e.templateId = w.tid;
        e.name = w.nm;
        e.level = w.lv;
        e.scale = w.sc ?? 1;
        e.color = w.c ?? 0xffffff;
        e.dungeonId = w.dgn ?? null;
        if (e.kind === 'npc') {
          const def = NPCS[e.templateId];
          e.questIds = def ? [...def.questIds] : [];
          e.vendorItems = def?.vendorItems ? [...def.vendorItems] : [];
        }
      }
      // interpolation bases: re-anchor at the pose the renderer last drew,
      // not at the previous server pose — when a frame extrapolated past the
      // last update, restarting from the server pose snapped entities
      // backwards every snapshot (visible rubber-banding while running).
      // Non-self entities are drawn on their per-entity clock (renderer.sync),
      // so the continuation alpha comes from that same clock; self stays on
      // the global snapshot clock the camera follow uses.
      const prevUpdatedAt = e.netUpdatedAt;
      const prevInterval = e.netInterval;
      const entAlpha = w.id !== this.playerId && prevUpdatedAt !== undefined && prevInterval !== undefined
        ? Math.min(1.25, (now - prevUpdatedAt) / Math.max(20, prevInterval))
        : contAlpha;
      const entFacingAlpha = Math.min(1, entAlpha);
      // per-entity update clock: distant entities are sent below snapshot
      // rate, so each one interpolates over its own measured cadence. Only
      // gaps within the slowest legitimate cadence count — records also
      // pause while an entity's state is unchanged, and folding an idle
      // period into the estimate would smear its next steps in slow motion
      if (prevUpdatedAt !== undefined) {
        const gap = now - prevUpdatedAt;
        if (gap > 5 && gap < 450) {
          e.netInterval = prevInterval === undefined ? gap : prevInterval * 0.7 + gap * 0.3;
        }
      }
      e.netUpdatedAt = now;
      e.prevPos = {
        x: e.prevPos.x + (e.pos.x - e.prevPos.x) * entAlpha,
        y: e.prevPos.y + (e.pos.y - e.prevPos.y) * entAlpha,
        z: e.prevPos.z + (e.pos.z - e.prevPos.z) * entAlpha,
      };
      e.prevFacing = e.prevFacing + wrapAngle(e.facing - e.prevFacing) * entFacingAlpha;
      e.pos.x = w.x; e.pos.y = w.y; e.pos.z = w.z;
      e.facing = w.f;
      e.hp = w.hp;
      e.maxHp = w.mhp;
      e.dead = !!w.dead;
      e.lootable = !!w.loot;
      e.hostile = !!w.h;
      e.castingAbility = w.cast ?? null;
      e.castRemaining = w.castRem ?? 0;
      e.castTotal = w.castTot ?? 0;
      e.channeling = !!w.chan;
      e.choppingTreeKey = w.chop ?? null;
      e.choppingTreeX = w.chopX ?? 0;
      e.choppingTreeZ = w.chopZ ?? 0;
      e.sitting = !!w.sit;
      e.aggroTargetId = w.aggro ?? null;
      e.tappedById = w.tap ?? null;
      e.ownerId = w.own ?? null;
      e.threat = new Map(w.thr ?? []);
      e.auras = (w.auras ?? []).map((a: any) => ({
        id: a.id, name: a.name, kind: a.kind, remaining: a.rem, duration: a.dur,
        value: 0, sourceId: 0, school: 'physical' as const,
      }));
      e.loot = w.lootList ?? null;
      return e;
    };

    for (const w of snap.ents) {
      if (applyWire(w) !== null) seen.add(w.id);
    }
    // entities listed in keep are alive but unchanged (or not due an update
    // at their distance tier this snapshot) — just protect them from pruning
    for (const id of snap.keep ?? []) {
      seen.add(id);
    }

    // self with extended state (always a full record)
    const s = snap.self;
    const e = s ? applyWire(s) : null;
    if (s && e) {
      seen.add(s.id);
      e.resource = s.res;
      e.maxResource = s.mres;
      e.resourceType = s.rtype;
      // delta fields: the server omits them while unchanged, so only the
      // snapshots that carry them rebuild the local structures
      if (s.cds !== undefined) e.cooldowns = new Map(Object.entries(s.cds).map(([k, v]) => [k, Number(v)]));
      e.gcdRemaining = s.gcd ?? 0;
      e.comboPoints = s.combo ?? 0;
      e.comboTargetId = s.comboTgt ?? null;
      e.targetId = s.target ?? null;
      e.autoAttack = !!s.auto;
      e.queuedOnSwing = s.queued ?? null;
      e.stats = s.stats ?? e.stats;
      e.attackPower = s.ap ?? 0;
      e.critChance = s.crit ?? 0.05;
      e.dodgeChance = s.dodge ?? 0.05;
      e.weapon = s.weapon ?? e.weapon;
      e.eating = s.eat
        ? { itemId: '', kind: 'food', hpPer2s: 0, manaPer2s: 0, remaining: s.eat.remaining }
        : null;
      e.drinking = s.drk
        ? { itemId: '', kind: 'drink', hpPer2s: 0, manaPer2s: 0, remaining: s.drk.remaining }
        : null;
      this.xp = s.xp ?? 0;
      this.copper = s.copper ?? 0;
      if (s.inv !== undefined) { this.inventory = s.inv; this.invChanged = true; }
      if (s.equip !== undefined) this.equipment = s.equip;
      if (s.qlog !== undefined) this.questLog = new Map((s.qlog as QuestProgress[]).map((q) => [q.questId, q]));
      if (s.qdone !== undefined) this.questsDone = new Set(s.qdone);
      if (s.farms !== undefined) this.farms = s.farms;
      this.known = abilitiesKnownAt(this.cfg.playerClass, e.level);
      if (s.party !== undefined) this.partyInfo = s.party;
      if (s.trade !== undefined) this.tradeInfo = s.trade;
      if (s.duel !== undefined) this.duelInfo = s.duel;
      // camera follows server-side facing changes when not mouselooking
      if (prevSelfFacing !== undefined && this.mouselookFacing === null) {
        let d = e.facing - prevSelfFacing;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        this.pendingFacingDelta += d;
      }
    }

    // prune entities that left our interest area
    for (const [id, e] of this.entities) {
      if (!seen.has(id)) this.entities.delete(id);
    }
  }

  // -----------------------------------------------------------------------
  // IWorld commands -> network
  // -----------------------------------------------------------------------

  questState(questId: string): QuestState {
    return computeQuestState(questId, this.questLog, this.questsDone, this.player.level);
  }

  consumeInventoryChanged(): boolean {
    const v = this.invChanged;
    this.invChanged = false;
    return v;
  }

  castAbility(abilityId: string): void {
    this.cmd({ cmd: 'cast', ability: abilityId });
  }
  castAbilityBySlot(slot: number): void {
    this.cmd({ cmd: 'castSlot', slot });
  }
  targetEntity(id: number | null): void {
    // optimistic local update for snappy UI
    const p = this.entities.get(this.playerId);
    if (p) {
      if (id === null) p.targetId = null;
      else {
        const e = this.entities.get(id);
        if (e && (!e.dead || e.lootable)) p.targetId = id;
      }
    }
    this.cmd({ cmd: 'target', id });
  }
  tabTarget(): void {
    this.cmd({ cmd: 'tab' });
  }
  startAutoAttack(): void {
    this.cmd({ cmd: 'attack' });
  }
  stopAutoAttack(): void {
    this.cmd({ cmd: 'stopattack' });
  }
  interact(): void {
    this.cmd({ cmd: 'interact' });
  }
  chopNearestTree(): boolean {
    this.cmd({ cmd: 'chop_tree' });
    // Online mode cannot know client-side whether a visible harvest tree is
    // actually in range, so let the interact chain also try fishing. The server
    // ignores the second command if chopping already started.
    return false;
  }
  fishNearestWater(): boolean {
    this.cmd({ cmd: 'fish' });
    return true;
  }
  lootCorpse(id: number): void {
    this.cmd({ cmd: 'loot', id });
  }
  pickUpObject(id: number): void {
    this.cmd({ cmd: 'pickup', id });
  }
  pickUpFarm(id: string): void {
    this.cmd({ cmd: 'pickup_farm', id });
  }
  // Quest commands update local state optimistically so the dialog can't be
  // re-used in the window before the next server snapshot lands. The server
  // remains authoritative; the following snapshot overwrites this state.
  acceptQuest(questId: string): void {
    const quest = QUESTS[questId];
    if (quest && !this.questLog.has(questId) && !this.questsDone.has(questId)) {
      this.questLog.set(questId, { questId, counts: quest.objectives.map(() => 0), state: 'active' });
    }
    this.cmd({ cmd: 'accept', quest: questId });
  }
  turnInQuest(questId: string): void {
    if (this.questLog.get(questId)?.state === 'ready') {
      this.questLog.delete(questId);
      this.questsDone.add(questId);
    }
    this.cmd({ cmd: 'turnin', quest: questId });
  }
  abandonQuest(questId: string): void {
    this.cmd({ cmd: 'abandon', quest: questId });
  }
  equipItem(itemId: string): void {
    this.cmd({ cmd: 'equip', item: itemId });
  }
  useItem(itemId: string): void {
    this.cmd({ cmd: 'use', item: itemId });
  }
  craftClassWeapon(tier: 'normal' | 'golden'): void {
    this.cmd({ cmd: 'craft_class_weapon', tier });
  }
  buyItem(npcId: number, itemId: string): void {
    this.cmd({ cmd: 'buy', npc: npcId, item: itemId });
  }
  sellItem(itemId: string): void {
    this.cmd({ cmd: 'sell', item: itemId });
  }
  marketplaceLockItem(itemId: string): void {
    this.cmd({ cmd: 'market_lock', item: itemId });
  }
  marketplaceRestoreItem(itemId: string): void {
    this.cmd({ cmd: 'market_restore', item: itemId });
  }
  releaseSpirit(): void {
    this.cmd({ cmd: 'release' });
  }
  chat(text: string): void {
    this.cmd({ cmd: 'chat', text });
  }
  // social systems
  partyInvite(targetPid: number): void {
    this.cmd({ cmd: 'pinvite', id: targetPid });
  }
  partyAccept(): void {
    this.cmd({ cmd: 'paccept' });
  }
  partyDecline(): void {
    this.cmd({ cmd: 'pdecline' });
  }
  partyLeave(): void {
    this.cmd({ cmd: 'pleave' });
  }
  partyKick(targetPid: number): void {
    this.cmd({ cmd: 'pkick', id: targetPid });
  }
  tradeRequest(targetPid: number): void {
    this.cmd({ cmd: 'trade_req', id: targetPid });
  }
  tradeAccept(): void {
    this.cmd({ cmd: 'trade_accept' });
  }
  tradeSetOffer(items: InvSlot[], copper: number): void {
    this.cmd({ cmd: 'trade_offer', items, copper });
  }
  tradeConfirm(): void {
    this.cmd({ cmd: 'trade_confirm' });
  }
  tradeCancel(): void {
    this.cmd({ cmd: 'trade_cancel' });
  }
  duelRequest(targetPid: number): void {
    this.cmd({ cmd: 'duel_req', id: targetPid });
  }
  duelAccept(): void {
    this.cmd({ cmd: 'duel_accept' });
  }
  duelDecline(): void {
    this.cmd({ cmd: 'duel_decline' });
  }
  // persistent social (resolved server-side by character name)
  friendAdd(name: string): void { this.cmd({ cmd: 'friend_add', name }); }
  friendRemove(name: string): void { this.cmd({ cmd: 'friend_remove', name }); }
  blockAdd(name: string): void { this.cmd({ cmd: 'block_add', name }); }
  blockRemove(name: string): void { this.cmd({ cmd: 'block_remove', name }); }
  guildCreate(name: string): void { this.cmd({ cmd: 'guild_create', name }); }
  guildInvite(name: string): void { this.cmd({ cmd: 'guild_invite', name }); }
  guildAccept(): void { this.cmd({ cmd: 'guild_accept' }); }
  guildDecline(): void { this.cmd({ cmd: 'guild_decline' }); }
  guildLeave(): void { this.cmd({ cmd: 'guild_leave' }); }
  guildKick(name: string): void { this.cmd({ cmd: 'guild_kick', name }); }
  guildPromote(name: string): void { this.cmd({ cmd: 'guild_promote', name }); }
  guildDemote(name: string): void { this.cmd({ cmd: 'guild_demote', name }); }
  guildTransfer(name: string): void { this.cmd({ cmd: 'guild_transfer', name }); }
  guildDisband(): void { this.cmd({ cmd: 'guild_disband' }); }
  async searchCharacters(query: string): Promise<CharacterSearchResult[]> {
    const q = query.trim();
    if (!q) return [];
    try {
      const res = await fetch(`${this.base}/api/search?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${this.token}` } });
      if (!res.ok) return [];
      return (await res.json()).results ?? [];
    } catch {
      return [];
    }
  }
  enterDungeon(dungeonId: string): void {
    this.cmd({ cmd: 'enter_dungeon', dungeon: dungeonId });
  }
  leaveDungeon(): void {
    this.cmd({ cmd: 'leave_dungeon' });
  }
  // legacy aliases kept for older scripts
  enterCrypt(): void {
    this.enterDungeon('hollow_crypt');
  }
  leaveCrypt(): void {
    this.leaveDungeon();
  }
}
