import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { toSolanaWalletConnectors, useCreateWallet, useExportWallet, useWallets } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

export interface PrivyRealmSession {
  token: string;
  username: string;
  solanaWallet: string;
  privyDisplayName?: string;
  privyAvatarUrl?: string;
  privyTwitterUsername?: string;
}

interface PrivyRealmLoginProps {
  onAuthenticated(session: PrivyRealmSession): Promise<void> | void;
  onError(message: string): void;
}

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;
const PRIVY_CLIENT_ID = import.meta.env.VITE_PRIVY_CLIENT_ID as string | undefined;
const SOLANA_RPC_URL = (import.meta.env.VITE_SOLANA_RPC_URL as string | undefined) || 'https://api.mainnet-beta.solana.com';
const SOLANA_RPC_WS_URL = (import.meta.env.VITE_SOLANA_RPC_WS_URL as string | undefined) || 'wss://api.mainnet-beta.solana.com';

declare global {
  interface Window {
    __vaeloriaExportPrivyWallet?: (address?: string) => Promise<void>;
  }
}

async function createRealmSession(accessToken: string, solanaWallet: string): Promise<PrivyRealmSession> {
  const res = await fetch('/api/privy-login', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ solanaWallet }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Privy realm login failed (${res.status})`);
  return data as PrivyRealmSession;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function validSolanaAddress(address: unknown): address is string {
  return typeof address === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

function solanaAddressFromWalletHook(wallet: unknown): string | null {
  const w = wallet as { address?: unknown; accounts?: Array<{ address?: unknown }> };
  if (validSolanaAddress(w.address)) return w.address;
  const accountAddress = w.accounts?.find((a) => validSolanaAddress(a.address))?.address;
  return validSolanaAddress(accountAddress) ? accountAddress : null;
}

function solanaAddressFromLinkedAccount(account: unknown): string | null {
  const linked = account as { address?: unknown; chain_type?: unknown; chainType?: unknown; type?: unknown };
  const chainType = linked.chain_type ?? linked.chainType;
  // Privy linkedAccounts also contains Twitter/email records. Only trust actual
  // wallet linked accounts, otherwise the game can send OAuth ids/usernames to
  // /api/privy-login and loop on 400/401.
  if (linked.type !== 'wallet' || chainType !== 'solana') return null;
  return validSolanaAddress(linked.address) ? linked.address : null;
}

function solanaAddressOfCreatedWallet(created: unknown): string | null {
  return solanaAddressFromWalletHook((created as { wallet?: unknown }).wallet) ?? solanaAddressFromWalletHook(created);
}

function stringField(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function privyProfileFromUser(user: unknown): Pick<PrivyRealmSession, 'privyDisplayName' | 'privyAvatarUrl' | 'privyTwitterUsername'> {
  const u = (user ?? {}) as Record<string, unknown>;
  const linked = Array.isArray(u.linkedAccounts) ? u.linkedAccounts as unknown[] : [];
  const twitter = linked.map((x) => x as Record<string, unknown>).find((x) => {
    const type = String(x.type ?? '').toLowerCase();
    const provider = String(x.provider ?? x.providerId ?? '').toLowerCase();
    return type.includes('twitter') || type.includes('x') || provider.includes('twitter') || provider === 'x';
  });
  const displayName = twitter
    ? stringField(twitter, ['name', 'displayName', 'display_name', 'fullName', 'username'])
    : undefined;
  const twitterUsername = twitter ? stringField(twitter, ['username', 'screenName', 'screen_name', 'handle']) : undefined;
  const avatarUrl = twitter
    ? stringField(twitter, ['profilePictureUrl', 'profile_picture_url', 'profileImageUrl', 'profile_image_url', 'avatarUrl', 'pictureUrl'])
    : undefined;
  return {
    privyDisplayName: displayName ?? stringField(u, ['name', 'displayName', 'username']),
    privyTwitterUsername: twitterUsername,
    privyAvatarUrl: avatarUrl ?? stringField(u, ['profilePictureUrl', 'profileImageUrl', 'avatarUrl', 'pictureUrl']),
  };
}

function PrivyRealmLogin({ onAuthenticated, onError }: PrivyRealmLoginProps): React.ReactElement {
  const { ready, authenticated, login, logout, user, getAccessToken } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { exportWallet } = useExportWallet();
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const inFlightRef = useRef(false);

  const solanaWallet = useMemo(() => {
    const fromWalletHook = wallets.map(solanaAddressFromWalletHook).find(Boolean);
    if (fromWalletHook) return fromWalletHook;
    const linkedAccounts = (user as { linkedAccounts?: unknown[] } | null | undefined)?.linkedAccounts ?? [];
    return linkedAccounts.map(solanaAddressFromLinkedAccount).find(Boolean) ?? null;
  }, [wallets, user]);

  const linkAndEnterRealm = useCallback(async () => {
    if (!ready || !authenticated || !walletsReady || linked || authFailed || inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    onError('');
    try {
      let wallet = solanaWallet;
      if (!wallet) {
        const created = await withTimeout(
          createWallet({ createAdditional: false }),
          15000,
          'Timed out while Privy was creating the Solana wallet. Refresh and try Multiplayer again.',
        );
        wallet = solanaAddressOfCreatedWallet(created);
      }
      if (!wallet) throw new Error('Privy did not return a Solana wallet. Check that the app supports Solana embedded wallets.');
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Privy did not return an access token.');
      const session = await createRealmSession(accessToken, wallet);
      const enrichedSession: PrivyRealmSession = { ...session, solanaWallet: wallet, ...privyProfileFromUser(user) };
      try { localStorage.setItem('vaeloria_privy_profile', JSON.stringify(enrichedSession)); } catch {}
      setLinked(true);
      await onAuthenticated(enrichedSession);
    } catch (err: unknown) {
      setAuthFailed(true);
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }, [ready, authenticated, walletsReady, linked, authFailed, solanaWallet, createWallet, getAccessToken, onAuthenticated, onError]);

  useEffect(() => {
    void linkAndEnterRealm();
  }, [linkAndEnterRealm]);

  useEffect(() => {
    window.__vaeloriaExportPrivyWallet = async (address?: string) => {
      if (!ready || !authenticated) throw new Error('Login with Privy before exporting your wallet.');
      const target = address || solanaWallet || undefined;
      await exportWallet(target ? { address: target } : undefined);
    };
    return () => {
      if (window.__vaeloriaExportPrivyWallet) delete window.__vaeloriaExportPrivyWallet;
    };
  }, [ready, authenticated, solanaWallet, exportWallet]);

  const label = !ready
    ? 'Loading Privy...'
    : busy
      ? 'Linking Solana wallet...'
      : authenticated
        ? authFailed ? 'Retry Enter Realm' : 'Enter Realm'
        : 'Login with X / Twitter';

  return React.createElement(
    'div',
    { className: 'privy-realm-login' },
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'btn btn-primary',
        disabled: !ready || busy,
        onClick: () => {
          onError('');
          if (authenticated) {
            setAuthFailed(false);
            setLinked(false);
          } else {
            void login();
          }
        },
      },
      label,
    ),
    authenticated && React.createElement(
      'button',
      {
        type: 'button',
        className: 'btn btn-secondary',
        disabled: busy,
        onClick: () => {
          setAuthFailed(false);
          setLinked(false);
          void logout();
        },
      },
      'Logout',
    ),
    user && React.createElement('div', { className: 'privy-user-hint' }, solanaWallet ? `Solana: ${solanaWallet.slice(0, 6)}...${solanaWallet.slice(-4)}` : 'Solana wallet will be created automatically'),
  );
}

let root: Root | null = null;

export function mountPrivyRealmLogin(target: HTMLElement, props: PrivyRealmLoginProps): void {
  if (!PRIVY_APP_ID) {
    target.textContent = 'Privy is not configured. Set VITE_PRIVY_APP_ID in .env.';
    return;
  }
  root?.unmount();
  root = createRoot(target);
  const Provider = PrivyProvider as unknown as React.ComponentType<React.PropsWithChildren<any>>;
  root.render(
    React.createElement(
      Provider,
      {
        appId: PRIVY_APP_ID,
        ...(PRIVY_CLIENT_ID ? { clientId: PRIVY_CLIENT_ID } : {}),
        config: {
          appearance: {
            showWalletLoginFirst: false,
            walletChainType: 'solana-only',
            walletList: ['phantom', 'solflare', 'backpack'],
          },
          loginMethodsAndOrder: {
            primary: ['twitter', 'email', 'phantom', 'solflare'],
            overflow: ['backpack', 'detected_solana_wallets'],
          },
          externalWallets: {
            solana: {
              connectors: toSolanaWalletConnectors(),
            },
          },
          embeddedWallets: {
            solana: {
              createOnLogin: 'all-users',
            },
          },
          solana: {
            rpcs: {
              'solana:mainnet': {
                rpc: createSolanaRpc(SOLANA_RPC_URL),
                rpcSubscriptions: createSolanaRpcSubscriptions(SOLANA_RPC_WS_URL),
              },
            },
          },
        },
      },
      React.createElement(PrivyRealmLogin, props),
    ),
  );
}
