import { lstatSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { getSignerNetworkProfile, UNISWAP_V2_FACTORY, UNISWAP_V2_ROUTER, USDC, WMON, type SignerNetwork, type SignerNetworkProfile } from './venue.ts';

const addr = z.string().refine(isAddress, 'invalid EVM address').transform(x => x as Address);
export const POLICY_SCHEMA = z.object({
  version: z.literal(1), network: z.enum(['mainnet', 'testnet']).default('mainnet'),
  chainId: z.number().int().positive(), registryAddress: addr,
  venue: z.literal('uniswap-v2'), router: addr, factory: addr,
  walletAddress: addr, ownerAddress: addr,
  tokens: z.array(z.object({ symbol: z.enum(['WMON', 'USDC']), address: addr, decimals: z.number().int().min(0).max(36) }).strict()).min(2).max(2),
  perTradeLimitUsd: z.number().positive().finite(), perDayLimitUsd: z.number().positive().finite(),
  maxSlippageBps: z.number().int().min(1).max(100), maxGasLimit: z.string().regex(/^\d+$/), maxGasPriceWei: z.string().regex(/^\d+$/),
  maxPriceAgeSeconds: z.object({ WMON: z.number().int().min(1).max(7200).default(3600), USDC: z.number().int().min(1).max(7200).default(3600) }).strict().default({ WMON: 3600, USDC: 3600 }),
  minPoolLiquidityUsd: z.number().positive().finite().default(10_000),
}).strict();
export type SignerPolicy = z.infer<typeof POLICY_SCHEMA>;

export const DEFAULT_POLICY: SignerPolicy = {
  version: 1, network: 'mainnet', chainId: 143, registryAddress: '0x0000000000000000000000000000000000000000',
  venue: 'uniswap-v2', router: UNISWAP_V2_ROUTER, factory: UNISWAP_V2_FACTORY,
  walletAddress: '0x0000000000000000000000000000000000000001', ownerAddress: '0x0000000000000000000000000000000000000000',
  tokens: [{ symbol: 'WMON', address: WMON, decimals: 18 }, { symbol: 'USDC', address: USDC, decimals: 6 }],
  perTradeLimitUsd: 50, perDayLimitUsd: 150, maxSlippageBps: 100, maxGasLimit: '500000', maxGasPriceWei: '100000000000',
  maxPriceAgeSeconds: { WMON: 3600, USDC: 3600 }, minPoolLiquidityUsd: 10_000,
};

function matchesProfile(policy: SignerPolicy, profile: SignerNetworkProfile): void {
  if (policy.chainId !== profile.chainId) throw new Error(`signer policy chain ${policy.chainId} does not match ${profile.network} profile chain ${profile.chainId}`);
  if (policy.router.toLowerCase() !== profile.router.toLowerCase()) throw new Error(`router is not the pinned ${profile.displayName} Uniswap V2 Router02`);
  if (policy.factory.toLowerCase() !== profile.factory.toLowerCase()) throw new Error(`factory is not the pinned ${profile.displayName} Uniswap V2 factory`);
  const w = policy.tokens.find(t => t.symbol === 'WMON'), u = policy.tokens.find(t => t.symbol === 'USDC');
  if (policy.tokens.length !== 2 || !w || !u || w.address.toLowerCase() !== profile.wmon.toLowerCase() || w.decimals !== 18 || u.address.toLowerCase() !== profile.usdc.toLowerCase() || u.decimals !== profile.usdcDecimals)
    throw new Error(`token set must be exactly profile WMON (18) and USDC (${profile.usdcDecimals})`);
  if (BigInt(policy.maxGasLimit) <= 0n || BigInt(policy.maxGasPriceWei) <= 0n) throw new Error('gas policy limits must be positive');
}
export function parsePolicy(input: unknown, env: Record<string, string | undefined> = process.env): SignerPolicy {
  const parsed = POLICY_SCHEMA.safeParse(input);
  if (!parsed.success) throw new Error(`invalid signer policy: ${parsed.error.issues.map(i => i.message).join('; ')}`);
  const policy = parsed.data;
  const selectedNetwork = (env.MONAD_NETWORK ?? policy.network) as SignerNetwork;
  if (selectedNetwork !== policy.network) throw new Error(`signer policy network ${policy.network} does not match MONAD_NETWORK=${selectedNetwork}`);
  const profile = getSignerNetworkProfile(policy.network, env);
  matchesProfile(policy, profile);
  return policy;
}
export function assertRootOwnedPolicyFile(path: string, ownerUid = 0): void {
  const st = lstatSync(path); if (st.isSymbolicLink() || !st.isFile()) throw new Error('policy must be a regular file');
  if (st.uid !== ownerUid) throw new Error(`policy file must be owned by uid ${ownerUid}`);
  if ((st.mode & 0o137) !== 0) throw new Error('policy file permissions must be no looser than 0640 and must not be world-readable');
}
export function loadPolicy(path: string, env: Record<string, string | undefined> = process.env): SignerPolicy {
  assertRootOwnedPolicyFile(path, 0);
  return parsePolicy(JSON.parse(readFileSync(path, 'utf8')), env);
}
