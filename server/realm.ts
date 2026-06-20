// The realm (world/shard) this server process serves. In the process-per-realm
// model each instance hosts exactly one realm — set REALM_NAME per deployment
// (e.g. a Caddy vhost or compose service per realm), all pointing at the same
// database. Characters, friends, guilds, and presence are all scoped to this
// value, so two processes with different REALM_NAME share a DB yet form fully
// isolated worlds. Defaults to a single realm for local dev / single-shard prod.

export const DEFAULT_REALM_NAME = 'VAELORIA1';
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

function realmIsPremium(name: string, type: RealmType): boolean {
  return type === 'Premium' || /^VAELORIA\s*PREMIUM$/i.test(name);
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
    const type = resolveRealmType(fields[2]);
    const premium = realmIsPremium(name, type);
    out.push({ name, url, type, premium, minVaeloria: premium ? PREMIUM_REALM_MIN_VAELORIA : undefined });
  }
  return out;
}

export const REALM_DIRECTORY: RealmEntry[] = (() => {
  const parsed = parseRealms(process.env.REALMS);
  const realms = parsed.length > 0 ? parsed : [{ name: REALM, url: '', type: REALM_TYPE, premium: IS_PREMIUM_REALM, minVaeloria: IS_PREMIUM_REALM ? PREMIUM_REALM_MIN_VAELORIA : undefined }];
  return [...realms].sort((a, b) => Number(Boolean(b.premium)) - Number(Boolean(a.premium)));
})();

export const REALM_ORIGINS: ReadonlySet<string> = new Set(REALM_DIRECTORY.map((r) => r.url).filter(Boolean));
