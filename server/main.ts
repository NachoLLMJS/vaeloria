import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import {
  ensureSchema, pool, saveToken, accountForToken, accountById,
  listCharacters, getCharacter, createCharacter, deleteCharacter, closeOrphanSessions,
  pruneChatLogs, searchCharacters, characterCountsByRealm, moderationStatusForAccount, renameCharacter,
  findCharacterReportTargetByName, upsertPrivyAccount,
} from './db';
import { cleanReportReason, createPlayerReport } from './moderation_db';
import { resolveReportTarget } from './report_target';
import { newToken, validCharName } from './auth';
import { verifyPrivyRequest, validSolanaAddress, verifiedPrivySolanaWallet, privyUserProfile } from './privy';
import { json, readBody } from './http_util';
import { rateLimited } from './ratelimit';
import { handleAdminApi } from './admin';
import { GameServer } from './game';
import { REALM, REALM_DIRECTORY, REALM_ORIGINS, PREMIUM_REALM_MIN_VAELORIA, realmEntryFor, realmIsPremium, realmRewardMultiplier } from './realm';
import { cacheControlFor, etagFor, isNotModified } from './static_cache';

const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = path.join(__dirname, '..', 'dist');
// How long chat logs are kept (0 = forever); pruned at boot and daily.
const CHAT_LOG_RETENTION_DAYS = Number(process.env.CHAT_LOG_RETENTION_DAYS ?? 90);
const DEFAULT_VAELORIA_TOKEN_MINT = '1KbF7jpNt3Yj4n7DufPuuTGPBum7kobW9wkaAh1pump';
const VAELORIA_TOKEN_MINT = process.env.VAELORIA_TOKEN_MINT?.trim() || DEFAULT_VAELORIA_TOKEN_MINT;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const games = new Map(REALM_DIRECTORY.map((r) => [r.name, new GameServer(r.name, realmRewardMultiplier(r.name))]));
function gameForRealm(realm: string): GameServer {
  const entry = realmEntryFor(realm);
  let game = games.get(entry.name);
  if (!game) {
    game = new GameServer(entry.name, realmRewardMultiplier(entry.name));
    games.set(entry.name, game);
  }
  return game;
}
function selectedRealm(req: http.IncomingMessage, fallback = REALM): string {
  const fromHeader = typeof req.headers['x-vaeloria-realm'] === 'string' ? req.headers['x-vaeloria-realm'] : '';
  const fromQuery = new URL(req.url ?? '/', 'http://localhost').searchParams.get('realm') ?? '';
  return realmEntryFor(fromHeader || fromQuery || fallback).name;
}

async function vaeloriaHoldingsForWallet(wallet: string | null | undefined): Promise<number> {
  if (!wallet || !VAELORIA_TOKEN_MINT || VAELORIA_TOKEN_MINT.includes('111111111111')) return 0;
  try {
    const res = await fetch(SOLANA_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'vaeloria-server-holdings', method: 'getTokenAccountsByOwner',
        params: [wallet, { mint: VAELORIA_TOKEN_MINT }, { encoding: 'jsonParsed' }],
      }),
    });
    const data = await res.json();
    const accounts = Array.isArray(data?.result?.value) ? data.result.value : [];
    return accounts.reduce((sum: number, a: any) => sum + Number(a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
  } catch {
    return 0;
  }
}

async function vaeloriaHoldingsForAccount(accountId: number | null): Promise<number> {
  if (accountId === null) return 0;
  const account = await accountById(accountId);
  return vaeloriaHoldingsForWallet(account?.solana_wallet);
}

async function premiumAllowed(accountId: number | null, realm: string): Promise<boolean> {
  const entry = realmEntryFor(realm);
  if (!realmIsPremium(entry.name, entry.type)) return true;
  return (await vaeloriaHoldingsForAccount(accountId)) >= PREMIUM_REALM_MIN_VAELORIA;
}


async function bearerAccount(req: http.IncomingMessage): Promise<number | null> {
  const auth = req.headers.authorization ?? '';
  const m = /^Bearer ([a-f0-9]{64})$/.exec(auth);
  if (!m) return null;
  return accountForToken(m[1]);
}

async function bearerActiveAccount(req: http.IncomingMessage, res: http.ServerResponse): Promise<number | null> {
  const accountId = await bearerAccount(req);
  if (accountId === null) {
    json(res, 401, { error: 'not authenticated' });
    return null;
  }
  const status = await moderationStatusForAccount(accountId);
  if (status.locked) {
    json(res, 403, { error: status.message });
    return null;
  }
  return accountId;
}

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};

// The admin dashboard is reached via the admin.* subdomain (Caddy proxies it
// to this same port) or /admin for local dev. The hostname only picks which
// HTML shell is served — the admin API itself is gated by admin tokens.
function isAdminRequest(req: http.IncomingMessage): boolean {
  const host = String(req.headers.host ?? '').toLowerCase();
  const urlPath = (req.url ?? '/').split('?')[0];
  return host.startsWith('admin.') || urlPath === '/admin' || urlPath === '/admin/';
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const shell = isAdminRequest(req) ? 'admin.html' : 'index.html';
  let urlPath = (req.url ?? '/').split('?')[0];
  if (urlPath === '/' || urlPath === '/admin' || urlPath === '/admin/') urlPath = `/${shell}`;
  // normalize once and reuse for BOTH file resolution and cache policy —
  // otherwise /assets/../x would serve a mutable file with immutable caching
  urlPath = path.posix.normalize(urlPath).replace(/^([.][.][/\\])+/, '');
  const file = path.join(STATIC_DIR, urlPath);
  const stats = file.startsWith(STATIC_DIR) && fs.existsSync(file) ? fs.statSync(file) : null;
  if (!stats?.isFile()) {
    // Asset paths must 404, not SPA-fall-back: a missing .glb served as index.html
    // surfaces as a cryptic GLTFLoader parse error instead of a clear 404.
    if (path.extname(urlPath) && path.extname(urlPath) !== '.html') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    // SPA fallback
    const index = path.join(STATIC_DIR, shell);
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
      fs.createReadStream(index).pipe(res);
    } else {
      res.writeHead(404);
      res.end('not found (run `npm run build` to serve the client from the game server)');
    }
    return;
  }
  const isReadMethod = req.method === 'GET' || req.method === 'HEAD';
  const etag = etagFor(stats);
  const validators = {
    'Cache-Control': cacheControlFor(urlPath),
    'ETag': etag,
    'Last-Modified': stats.mtime.toUTCString(),
  };
  if (isReadMethod && isNotModified(req.headers, etag, stats.mtime)) {
    res.writeHead(304, validators);
    res.end();
    return;
  }
  res.writeHead(200, {
    ...validators,
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': stats.size,
  });
  if (req.method === 'HEAD') {
    // don't read a multi-MB asset from disk just to discard the bytes
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

// Cross-realm CORS: a client served by one realm may call another realm's API
// after switching realms in the picker. Only the configured realm origins are
// allowed; auth is via bearer token (no cookies), so reflecting these specific
// origins is safe.
function allowedCorsOrigin(origin: string): boolean {
  if (REALM_ORIGINS.has(origin)) return true;
  // Local dev: the Vite frontend runs on 5173 and calls realm servers on
  // 8787/8788/8789 directly after the player picks a realm. Those requests use
  // bearer auth, not cookies, so allowing the local frontend origin is safe.
  return /^https?:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin);
}

function maybeCors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && allowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Vaeloria-Realm');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = (req.url ?? '').split('?')[0];
  const realm = selectedRealm(req);
  const game = gameForRealm(realm);
  try {
    if (req.method === 'POST' && (url === '/api/register' || url === '/api/login' || url === '/api/privy-login') && rateLimited(req)) {
      return json(res, 429, { error: 'too many attempts — wait a minute and try again' });
    }
    if (req.method === 'POST' && (url === '/api/register' || url === '/api/login')) {
      return json(res, 410, { error: 'classic username/password login is disabled. Use Privy Solana login.' });
    }
    if (req.method === 'POST' && url === '/api/privy-login') {
      const body = await readBody(req);
      if (!validSolanaAddress(body.solanaWallet)) return json(res, 400, { error: 'invalid Solana wallet address' });
      try {
        const verified = await verifyPrivyRequest(req);
        const walletBelongsToUser = await verifiedPrivySolanaWallet(verified.userId, body.solanaWallet);
        if (!walletBelongsToUser) return json(res, 403, { error: 'Solana wallet is not linked to this Privy user' });
        const account = await upsertPrivyAccount(verified.userId, body.solanaWallet);
        const profile = await privyUserProfile(verified.userId).catch(() => ({ displayName: undefined, avatarUrl: undefined, twitterUsername: undefined }));
        const status = await moderationStatusForAccount(account.id);
        if (status.locked) return json(res, 403, { error: status.message });
        const token = newToken();
        await saveToken(token, account.id);
        return json(res, 200, {
          token,
          username: account.username,
          solanaWallet: account.solana_wallet ?? body.solanaWallet,
          privyDisplayName: profile.displayName,
          privyAvatarUrl: profile.avatarUrl,
          privyTwitterUsername: profile.twitterUsername,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 401, { error: message || 'Privy authentication failed' });
      }
    }
    if (url === '/api/characters') {
    const accountId = await bearerActiveAccount(req, res);
    if (accountId === null) return;
    if (!(await premiumAllowed(accountId, realm))) return json(res, 403, { error: `VAELORIA Premium requires ${PREMIUM_REALM_MIN_VAELORIA.toLocaleString()}+ VAELORIA in your Privy wallet.` });
if (req.method === 'GET') {
        const chars = await listCharacters(accountId, realm)
        return json(res, 200, {
          realm,
          characters: chars.map((c) => ({
            id: c.id, name: c.name, class: c.class, level: c.level,
            online: [...game.clients.values()].some((s) => s.characterId === c.id),
            forceRename: c.force_rename,
          })),
        });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!validCharName(body.name)) return json(res, 400, { error: 'invalid character name (2-16 letters)' });
        const validClasses = ['warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid'];
        if (!validClasses.includes(body.class)) return json(res, 400, { error: 'invalid class' });
        const chars = await listCharacters(accountId, realm)
        if (chars.length >= 10) return json(res, 400, { error: 'character limit reached' });
        try {
          const c = await createCharacter(accountId, body.name, body.class, realm);
          return json(res, 200, { id: c.id, name: c.name, class: c.class, level: c.level, forceRename: c.force_rename });
        } catch (err: any) {
          if (String(err?.message).includes('unique') || err?.code === '23505') {
            return json(res, 409, { error: 'that name is taken' });
          }
          throw err;
        }
      }
    }
    const delMatch = /^\/api\/characters\/(\d+)$/.exec(url);
    const renameMatch = /^\/api\/characters\/(\d+)\/rename$/.exec(url);
    if (req.method === 'POST' && renameMatch) {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      const body = await readBody(req);
      if (!validCharName(body.name)) return json(res, 400, { error: 'invalid character name (2-16 letters)' });
      try {
        const c = await renameCharacter(accountId, Number(renameMatch[1]), body.name, realm);
        if (!c) return json(res, 404, { error: 'character not found' });
        return json(res, 200, { id: c.id, name: c.name, class: c.class, level: c.level, forceRename: c.force_rename });
      } catch (err: any) {
        if (String(err?.message).includes('unique') || err?.code === '23505') {
          return json(res, 409, { error: 'that name is taken' });
        }
        throw err;
      }
    }
    if (req.method === 'DELETE' && delMatch) {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      const characterId = Number(delMatch[1]);
      if ([...game.clients.values()].some((s) => s.characterId === characterId)) {
        return json(res, 409, { error: 'log out before deleting that character' });
      }
      const ok = await deleteCharacter(accountId, characterId);
      return json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not found' });
    }
    if (req.method === 'GET' && url === '/api/realms') {
      // optionally authenticated: with a token we also return how many
      // characters the account has on each realm (for the realm-list screen)
      const accountId = await bearerAccount(req);
      const characters = accountId !== null ? await characterCountsByRealm(accountId) : {};
      const vaeloriaHoldings = await vaeloriaHoldingsForAccount(accountId);
      return json(res, 200, { current: realm, realms: REALM_DIRECTORY, characters, vaeloriaHoldings, premiumMinVaeloria: PREMIUM_REALM_MIN_VAELORIA });
    }
    if (req.method === 'GET' && url === '/api/search') {
      const accountId = await bearerAccount(req);
      if (accountId === null) return json(res, 401, { error: 'not authenticated' });
      const q = new URL(req.url ?? '/', 'http://localhost').searchParams.get('q') ?? '';
      const results = q.trim().length >= 1 ? await searchCharacters(q, 8, realm) : [];
      return json(res, 200, { results });
    }
    if (req.method === 'POST' && url === '/api/reports') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      const body = await readBody(req);
      const reason = cleanReportReason(body.reason);
      if (!reason) return json(res, 400, { error: 'choose a report reason' });
      const reporterCharacterId = Number(body.reporterCharacterId);
      if (!Number.isFinite(reporterCharacterId)) {
        return json(res, 400, { error: 'invalid report target' });
      }
      const reporter = await getCharacter(accountId, reporterCharacterId, realm);
      if (!reporter) return json(res, 404, { error: 'reporting character not found' });
      const resolved = await resolveReportTarget(body, {
        reportTargetForPid: (pid) => game.reportTargetForPid(pid),
        findCharacterReportTargetByName: (name) => findCharacterReportTargetByName(name, realm),
      });
      if (!resolved.ok) return json(res, resolved.status, { error: resolved.error });
      try {
        const report = await createPlayerReport({
          reporterAccountId: accountId,
          reporterCharacterId: reporter.id,
          reporterCharacterName: reporter.name,
          target: resolved.target,
          reason,
          details: body.details,
        });
        return json(res, 200, { ok: true, reportId: report.id });
      } catch (err) {
        return json(res, 400, { error: err instanceof Error ? err.message : 'could not submit report' });
      }
    }
    if (req.method === 'GET' && url === '/api/status') {
      return json(res, 200, {
        ok: true,
        realm,
        players_online: game.clients.size,
        names: [...game.clients.values()].map((s) => s.name),
      });
    }
    json(res, 404, { error: 'unknown endpoint' });
  } catch (err: any) {
    console.error('api error:', err);
    json(res, 500, { error: 'internal error' });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // wait for the database (it may still be starting in docker)
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (err) {
      if (attempt >= 30) throw err;
      console.log(`waiting for postgres (attempt ${attempt})...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await ensureSchema();
  const orphans = await closeOrphanSessions();
  if (orphans > 0) console.log(`closed ${orphans} orphaned play session(s) from a previous run`);
  const pruned = await pruneChatLogs(CHAT_LOG_RETENTION_DAYS);
  if (pruned > 0) console.log(`pruned ${pruned} chat log row(s) older than ${CHAT_LOG_RETENTION_DAYS} days`);
  setInterval(() => {
    void pruneChatLogs(CHAT_LOG_RETENTION_DAYS).catch((err) => console.error('chat log prune failed:', err));
  }, 24 * 3600 * 1000).unref();
  console.log('database ready');

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    const isApi = url.startsWith('/api/') || url.startsWith('/admin/api/');
    if (isApi) maybeCors(req, res);
    if (req.method === 'OPTIONS' && isApi) { res.writeHead(204); res.end(); return; }
    if (url.startsWith('/admin/api/')) void handleAdminApi(req, res, game);
    else if (url.startsWith('/api/')) void handleApi(req, res);
    else serveStatic(req, res);
  });

  // cap frame size: the largest legitimate client message is a small JSON
  // command; without this the ws default (~100 MiB) lets one socket force a
  // huge allocation + parse before any field-level validation runs
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void onConnection(ws);
    });
  });

  async function authenticateWebSocket(ws: WebSocket, raw: string): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ t: 'error', error: 'bad auth message' }));
      ws.close();
      return;
    }
    if (msg?.t !== 'auth') {
      ws.send(JSON.stringify({ t: 'error', error: 'authentication required' }));
      ws.close();
      return;
    }

    const token = typeof msg.token === 'string' ? msg.token : '';
    const characterId = Number(msg.character ?? 'NaN');
    const accountId = await accountForToken(token);
    if (accountId === null || !Number.isFinite(characterId)) {
      ws.send(JSON.stringify({ t: 'error', error: 'not authenticated' }));
      ws.close();
      return;
    }
    const realm = realmEntryFor(typeof msg.realm === 'string' ? msg.realm : undefined).name;
    const game = gameForRealm(realm);
    if (!(await premiumAllowed(accountId, realm))) {
      ws.send(JSON.stringify({ t: 'error', error: `VAELORIA Premium requires ${PREMIUM_REALM_MIN_VAELORIA.toLocaleString()}+ VAELORIA in your Privy wallet.` }));
      ws.close();
      return;
    }
    const status = await moderationStatusForAccount(accountId);
    if (status.locked) {
      ws.send(JSON.stringify({ t: 'error', error: status.message }));
      ws.close();
      return;
    }
    const character = await getCharacter(accountId, characterId, realm);
    if (!character) {
      ws.send(JSON.stringify({ t: 'error', error: 'no such character' }));
      ws.close();
      return;
    }
    if (character.force_rename) {
      ws.send(JSON.stringify({ t: 'error', error: 'This character must be renamed before entering the world.' }));
      ws.close();
      return;
    }
    const result = game.join(ws, accountId, character.id, character.name, character.class, character.state, character.is_gm);
    if ('error' in result) {
      ws.send(JSON.stringify({ t: 'error', error: result.error }));
      ws.close();
      return;
    }
    const session = result;
    console.log(`[${realm}] + ${character.name} (${character.class}) joined — ${game.clients.size} online`);
    ws.on('message', (data) => {
      game.handleMessage(session, String(data));
    });
    ws.on('close', () => {
      void game.leave(session, 'disconnected');
      console.log(`[${realm}] - ${character.name} left — ${game.clients.size} online`);
    });
    ws.on('error', () => {
      void game.leave(session, 'connection error');
    });
  }

  async function onConnection(ws: WebSocket): Promise<void> {
    const authTimer = setTimeout(() => {
      ws.send(JSON.stringify({ t: 'error', error: 'authentication timed out' }));
      ws.close();
    }, 10_000);

    // Pre-auth socket errors (e.g. a first frame over maxPayload, which ws
    // surfaces as an 'error' event) would otherwise be an unhandled exception
    // and crash the process. Tear the connection down quietly instead. The
    // post-auth game.leave handler is attached separately once joined.
    ws.on('error', () => {
      clearTimeout(authTimer);
      try { ws.close(); } catch { /* already closing */ }
    });

    ws.once('message', (data) => {
      clearTimeout(authTimer);
      void authenticateWebSocket(ws, String(data));
    });
  }

  for (const game of games.values()) game.start();
  server.listen(PORT, () => {
    console.log(`VAELORIA server listening on http://localhost:${PORT}`);
    console.log(`  REST: /api/privy-login /api/characters /api/status`);
    console.log(`  WS:   /ws, then first message {t:"auth",token,character}`);
  });

  const shutdown = async () => {
    console.log('shutting down: saving characters...');
    for (const game of games.values()) game.stop();
    for (const game of games.values()) await game.saveAll('shutdown');
    for (const game of games.values()) await game.endAllPlaySessions();
    for (const game of games.values()) await game.chatLog.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Last-resort net: one player's request must never crash the process and
  // disconnect everyone. handleMessage already guards itself, but any future
  // uncaught throw in a timer or async path would otherwise be fatal. Log and
  // keep serving — a live world staying up beats a clean crash-loop. Genuinely
  // fatal startup errors are still handled by main().catch() below.
  process.on('uncaughtException', (err) => {
    console.error('uncaughtException (kept alive):', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('unhandledRejection (kept alive):', reason);
  });
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
