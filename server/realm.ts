// Realm/shard configuration.
//
// Historically VAELORIA used one Node process per realm. Railway's first public
// test uses a cheaper/simpler single service, so this module also supports an
// internal multi-realm directory: several isolated GameServer instances inside
// one process, selected by the client via X-Vaeloria-Realm / websocket auth.

export const DEFAULT_REALM_NAME = 'VAELORIA1';
export const PREMIUM_REALM_NAME = 'VAELORIA Premium';
export const PREMIUM_REALM_MIN_VAELORIA = Number(process.env.PREMIUM_REALM_MIN_VAELORIA ?? 1000);

export function resolveRealm(rawName: string | undefined): string {
  const raw = (rawName ?? '').trim();
  if (raw && raw.length <= 24 && /^[A-Za-z0-9][A-Za-z0-9 '_-]*$/.test(raw)) return raw;
  return DEFAULT_REALM_NAME;
}

export const REALM = resolveRealm(process.env.REALM_NAME);
export const IS_PREMIUM_REALM = /^VAELORIA\s*PREMIUM$/i.test(REALM) || process.env.REALM_PREMIUM === '1';
export const REALM_REWARD_MULTIPLIER = IS_PREMIUM_REALM ? 1.5 : 1;

// WoW realm types. Normal == PvE. Premium is token-gated PvE.
export type RealmType = 'Premium' | 'Normal' | 'PvP' | 'RP' | 'RP-PvP';
const REALM_TYPES: readonly RealmType[] = ['Premium', 'Normal', 'PvP', 'RP', 'RP-PvP'];

function resolveRealmType(raw: string | undefined): RealmType {
  const t = (raw ?? '').trim();
  return (REALM_TYPES as readonly string[]).includes(t) ? (t as RealmType) : 'Normal';
}

export const REALM_TYPE: RealmType = IS_PREMIUM_REALM ? 'Premium' : resolveRealmType(process.env.REALM_TYPE);

export interface RealmEntry {
  name: string;
  url: string;
  type: RealmType;
  premium?: boolean;
  minVaeloria?: number;
}

export function realmIsPremium(name: string, type?: RealmType): boolean {
  return type === 'Premium' || /^VAELORIA\s*PREMIUM$/i.test(name);
}

function entry(name: string, url: string, type: RealmType): RealmEntry {
  const premium = realmIsPremium(name, type);
  return { name, url, type, premium, minVaeloria: premium ? PREMIUM_REALM_MIN_VAELORIA : undefined };
}

// Configure REALMS as comma-separated `Name=https://host=Type` entries.
function parseRealms(raw: string | undefined): RealmEntry[] {
  const out: RealmEntry[] = [];
  for (const part of (raw ?? '').split(',')) {
    const seg = part.trim();
    if (!seg) continue;
    const fields = seg.split('=').map((s) => s.trim());
    if (fields.length < 2) continue;
    const name = resolveRealm(fields[0]);
    let url = fields[1];
    if (url && !/^https?:\/\/[^/]+$/.test(url.replace(/\/+$/, ''))) continue;
    url = url.replace(/\/+$/, '');
    if (out.some((e) => e.name === name)) continue;
    out.push(entry(name, url, resolveRealmType(fields[2])));
  }
  return out;
}

// In single-service mode both realms live behind the same public origin. The
// empty URL means "use this page's origin"; the client sends the chosen realm in
// headers/websocket auth so the same host can route internally.
const DEFAULT_INTERNAL_REALMS: RealmEntry[] = [
  entry(PREMIUM_REALM_NAME, '', 'Premium'),
  entry(DEFAULT_REALM_NAME, '', 'Normal'),
  entry('VAELORIA2', '', 'Normal'),
  entry('VAELORIA3', '', 'Normal'),
];

export const REALM_DIRECTORY: RealmEntry[] = (() => {
  const parsed = parseRealms(process.env.REALMS);
  const realms = parsed.length > 0
    ? parsed
    : (process.env.SINGLE_REALM === '1'
      ? [entry(REALM, '', REALM_TYPE)]
      : DEFAULT_INTERNAL_REALMS);
  return [...realms].sort((a, b) => Number(Boolean(b.premium)) - Number(Boolean(a.premium)));
})();

const REALM_BY_NAME = new Map(REALM_DIRECTORY.map((r) => [r.name, r]));

export function realmEntryFor(name: string | undefined): RealmEntry {
  const resolved = resolveRealm(name);
  return REALM_BY_NAME.get(resolved) ?? REALM_BY_NAME.get(REALM) ?? REALM_DIRECTORY[0] ?? entry(DEFAULT_REALM_NAME, '', 'Normal');
}

export function realmRewardMultiplier(name: string): number {
  const r = realmEntryFor(name);
  return realmIsPremium(r.name, r.type) ? 1.5 : 1;
}

export const REALM_ORIGINS: ReadonlySet<string> = new Set(REALM_DIRECTORY.map((r) => r.url).filter(Boolean));
