import { keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { MESSAGE_TYPES, signTradgentsMessage } from '../src/signed-messages.ts';

// Cross-check with monad/api/src/auth.ts: contentHash = keccak256(utf8(text)), domain {name:'Tradgents', version:'1', chainId, verifyingContract: registry}
describe('what the CLI sends matches what the API verifies', () => {
  const account = privateKeyToAccount('0x' + '11'.repeat(32) as `0x${string}`);
  const registry = '0x00000000000000000000000000000000000000aa' as const;
  const policy = { chainId: 143, registryAddress: registry, walletAddress: account.address, ownerAddress: account.address } as never;
  it('signs a Post over keccak256(utf8(text)) with the registry domain, and the signature recovers to the agent wallet', async () => {
    const now = Date.now(), message = { agentWallet: account.address, contentHash: keccak256(toBytes('hello')), nonce: '5', deadline: String(Math.floor(now / 1000) + 600) };
    const signature = await signTradgentsMessage(account, policy, { primaryType: 'Post', message }, now);
    const { recoverTypedDataAddress } = await import('viem');
    const recovered = await recoverTypedDataAddress({ domain: { name: 'Tradgents', version: '1', chainId: 143, verifyingContract: registry }, types: { Post: MESSAGE_TYPES.Post }, primaryType: 'Post',
      message: { ...message, nonce: 5n, deadline: BigInt(message.deadline) }, signature });
    expect(recovered).toBe(account.address);
  });
});
