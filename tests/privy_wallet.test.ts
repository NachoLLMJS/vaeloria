import { describe, expect, it } from 'vitest';
import { isMatchingSolanaWalletAccount } from '../server/privy';

const SOLANA_ADDRESS = '4Nd1m5Y4Kkzd9xuY7HDiP1nq2ZWiiRZBzJd3vCwDy7Ys';

describe('Privy Solana wallet ownership matching', () => {
  it('accepts a linked external Solana wallet returned by Privy', () => {
    expect(isMatchingSolanaWalletAccount({
      type: 'wallet',
      chain_type: 'solana',
      connector_type: 'injected',
      wallet_client: 'phantom',
      address: SOLANA_ADDRESS,
    }, SOLANA_ADDRESS)).toBe(true);
  });

  it('accepts a linked embedded Solana wallet returned by Privy', () => {
    expect(isMatchingSolanaWalletAccount({
      type: 'wallet',
      chainType: 'solana',
      connector_type: 'embedded',
      wallet_client: 'privy',
      address: SOLANA_ADDRESS,
    }, SOLANA_ADDRESS)).toBe(true);
  });

  it('rejects non-wallet, wrong-chain, or wrong-address accounts', () => {
    expect(isMatchingSolanaWalletAccount({ type: 'twitter_oauth', username: 'nacho' }, SOLANA_ADDRESS)).toBe(false);
    expect(isMatchingSolanaWalletAccount({ type: 'wallet', chain_type: 'ethereum', address: SOLANA_ADDRESS }, SOLANA_ADDRESS)).toBe(false);
    expect(isMatchingSolanaWalletAccount({ type: 'wallet', chain_type: 'solana', address: '11111111111111111111111111111111' }, SOLANA_ADDRESS)).toBe(false);
  });
});
