import { createPublicClient, defineChain, http, type PublicClient } from 'viem';
import type { Config } from './config.ts';
import { TOKEN_CATALOG } from './protocols.ts';
import { MAINNET_PROFILE, profilePinnedAddresses, type NetworkProfile } from './profiles.ts';

export const monadMainnet = defineChain({
  id: 143, name: 'Monad', nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [MAINNET_PROFILE.defaultRpcUrl] } },
  blockExplorers: { default: { name: 'MonadVision', url: MAINNET_PROFILE.explorerBaseUrl } },
});
export const createMonadClient = (cfg: Config): PublicClient => {
  const profile = cfg.profile;
  const chain = defineChain({
    id: profile.chainId, name: profile.displayName, nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [profile.defaultRpcUrl] } },
    blockExplorers: { default: { name: profile.displayName, url: profile.explorerBaseUrl } },
  });
  return createPublicClient({ chain, transport: http(cfg.rpcUrl, { timeout: 15_000, retryCount: 3 }) });
};
export async function finalizedBlockNumber(client: PublicClient): Promise<bigint> { return (await client.getBlock({ blockTag: 'finalized' })).number; }
export async function safeBlockNumber(client: PublicClient): Promise<bigint> { return (await client.getBlock({ blockTag: 'safe' })).number; }
export async function verifyChainDeployment(client: PublicClient, cfg: Pick<Config, 'chainId' | 'registryAddress' | 'profile'>): Promise<void> {
  const chainId = await client.getChainId();
  if (chainId !== cfg.profile.chainId || chainId !== cfg.chainId)
    throw new Error(`RPC chain id ${chainId} does not match MONAD_NETWORK=${cfg.profile.network} profile chain ${cfg.profile.chainId}`);
  const addresses = [...new Set([cfg.registryAddress, ...profilePinnedAddresses(cfg.profile)].map(a => a.toLowerCase()))];
  for (const address of addresses) {
    const code = await client.getCode({ address: address as `0x${string}` });
    if (!code || code === '0x') throw new Error(`pinned address ${address} has no deployed bytecode on chain ${chainId}`);
  }
}
const DECIMALS_ABI = [{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }] as const;
const SYMBOL_ABI = [{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }] as const;
export async function verifyUsdcDecimals(client: PublicClient, expected = 6, profile: NetworkProfile = MAINNET_PROFILE): Promise<void> {
  const chainId = await client.getChainId();
  if (chainId !== profile.chainId) throw new Error(`stable token decimals must be verified on chain ${profile.chainId}, got ${chainId}`);
  const decimals = Number(await client.readContract({ address: profile.usdc.address, abi: DECIMALS_ABI, functionName: 'decimals' }));
  if (decimals !== expected || decimals !== profile.usdc.decimals || decimals !== 6)
    throw new Error(`on-chain ${profile.network} USDC decimals are ${decimals}; expected policy/profile value 6`);
}
export async function verifyWmonMetadata(client: PublicClient, profile: NetworkProfile): Promise<void> {
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address: profile.wmon, abi: DECIMALS_ABI, functionName: 'decimals' }),
    client.readContract({ address: profile.wmon, abi: SYMBOL_ABI, functionName: 'symbol' }),
  ]);
  if (Number(decimals) !== 18 || symbol !== 'WMON') throw new Error(`on-chain ${profile.network} WMON metadata is ${String(symbol)}/${String(decimals)}; expected WMON/18`);
}

const PYTH_ABI = [{ type: 'function', name: 'getPriceUnsafe', stateMutability: 'view', inputs: [{ name: 'id', type: 'bytes32' }], outputs: [{ type: 'tuple', components: [{ name: 'price', type: 'int64' }, { name: 'conf', type: 'uint64' }, { name: 'expo', type: 'int32' }, { name: 'publishTime', type: 'uint256' }] }] }] as const;
export interface OraclePrice { usd: number; tsMs: number; quality: 'oracle' | 'estimated'; source: string; liquidityUsd?: number }
export async function readPythPrice(
  client: PublicClient, feedId: `0x${string}`, now = Date.now(), staleAfterMs = 3_600_000, blockNumber?: bigint,
  pythAddress: `0x${string}` = MAINNET_PROFILE.pyth, usdcFeedId: `0x${string}` = TOKEN_CATALOG.USDC.feed,
): Promise<OraclePrice> {
  const p = await client.readContract({ address: pythAddress, abi: PYTH_ABI, functionName: 'getPriceUnsafe', args: [feedId], ...(blockNumber === undefined ? {} : { blockNumber }) });
  let usd = Number(p.price) * 10 ** p.expo; const tsMs = Number(p.publishTime) * 1000;
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(tsMs)) throw new Error(`invalid Pyth sample for ${feedId}`);
  const ageMs = now - tsMs;
  let quality: OraclePrice['quality'] = ageMs >= -60_000 && ageMs <= staleAfterMs && Number(p.conf) / Math.max(1, Number(p.price)) <= 0.01 ? 'oracle' : 'estimated';
  if (feedId.toLowerCase() === usdcFeedId.toLowerCase()) {
    if (usd >= 0.97 && usd <= 1.03) usd = 1;
    else quality = 'estimated';
  }
  return { usd, tsMs, quality, source: 'pyth-monad-onchain' };
}
export async function readConfiguredPrice(client: PublicClient, cfg: Config, symbol: 'MON' | 'USDC', now = Date.now(), blockNumber?: bigint): Promise<OraclePrice> {
  const feed = symbol === 'MON' ? cfg.monadPriceFeedId : cfg.usdcPriceFeedId;
  const staleAfterMs = symbol === 'MON' ? cfg.monPriceStaleMs : cfg.usdcPriceStaleMs;
  let result: OraclePrice | undefined;
  try { result = await readPythPrice(client, feed, now, staleAfterMs, blockNumber, cfg.profile.pyth, cfg.usdcPriceFeedId); }
  catch (error) {
    if (!cfg.testnetFixedPrices) throw error;
  }
  if (result?.quality === 'oracle') return result;
  if (cfg.testnetFixedPrices) {
    const usd = symbol === 'USDC' ? 1 : cfg.testnetMonPriceUsd;
    if (usd === undefined || !Number.isFinite(usd) || usd <= 0) throw new Error('testnet fixed MON price is not configured');
    return { usd, tsMs: now, quality: 'estimated', source: 'testnet-fixed-prices' };
  }
  if (result) return result;
  throw new Error(`no usable ${symbol} price is available`);
}
export { PYTH_ABI };
