import type { Address } from 'viem';

export type MonadNetwork = 'mainnet' | 'testnet';
export interface NetworkProfile {
  network: MonadNetwork;
  chainId: number;
  defaultRpcUrl: string;
  wmon: Address;
  usdc: { address: Address; decimals: 6 };
  router: Address;
  factory: Address;
  pyth: Address;
  feeds: { mon: `0x${string}`; usdc: `0x${string}` };
  explorerBaseUrl: string;
  displayName: string;
  additionalPinnedAddresses: readonly Address[];
}

const mainnet: NetworkProfile = {
  network: 'mainnet', chainId: 143, defaultRpcUrl: 'https://rpc.monad.xyz',
  wmon: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
  usdc: { address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', decimals: 6 },
  router: '0x4b2ab38dbf28d31d467aa8993f6c2585981d6804',
  factory: '0x182a927119d56008d921126764bf884221b10f59',
  pyth: '0x2880aB155794e7179c9eE2e38200202908C17B43',
  feeds: {
    mon: '0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1',
    usdc: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  },
  explorerBaseUrl: 'https://monadvision.com', displayName: 'Monad',
  additionalPinnedAddresses: ['0x465D06d4521ae9Ce724E0c182Daad5D8a2Ff7040'],
};

const TESTNET_WMON = '0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541' as Address;
const TESTNET_PYTH = '0x2880aB155794e7179c9eE2e38200202908C17B43' as Address;
const TESTNET_FEEDS = {
  mon: '0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1',
  usdc: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
} as const;

const address = (value: string | undefined, name: string): Address => {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} is required and must be an EVM address for MONAD_NETWORK=testnet`);
  return value as Address;
};

export function getNetworkProfile(network: MonadNetwork, env: Record<string, string | undefined> = process.env): NetworkProfile {
  if (network === 'mainnet') return mainnet;
  return {
    network: 'testnet', chainId: 10143, defaultRpcUrl: 'https://testnet-rpc.monad.xyz',
    wmon: env.TESTNET_WMON ? address(env.TESTNET_WMON, 'TESTNET_WMON') : TESTNET_WMON,
    usdc: { address: address(env.TESTNET_USDC, 'TESTNET_USDC'), decimals: 6 },
    router: address(env.TESTNET_V2_ROUTER, 'TESTNET_V2_ROUTER'),
    factory: address(env.TESTNET_V2_FACTORY, 'TESTNET_V2_FACTORY'),
    pyth: TESTNET_PYTH, feeds: TESTNET_FEEDS,
    explorerBaseUrl: 'https://testnet.monadexplorer.com', displayName: 'Monad Testnet',
    additionalPinnedAddresses: [],
  };
}

export const MAINNET_PROFILE = mainnet;
export const profilePinnedAddresses = (profile: NetworkProfile): Address[] => [
  profile.wmon, profile.usdc.address, profile.router, profile.factory, profile.pyth,
  ...profile.additionalPinnedAddresses,
];
