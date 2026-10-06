import type { Address } from 'viem';
import type { Interaction, InteractionKind, PnlComponent, ProtocolId } from './types.ts';

// Mainnet entries were checked in monad-crypto/protocols mainnet JSONC:
// https://github.com/monad-crypto/protocols/blob/main/mainnet/uniswap.jsonc
// https://github.com/monad-crypto/protocols/blob/main/mainnet/kuru.jsonc
// https://github.com/monad-crypto/protocols/blob/main/mainnet/CANONICAL.jsonc
// Monad USDC is listed in https://github.com/monad-crypto/protocols/blob/main/mainnet/aave_v3.jsonc
// Pyth mainnet contract and feed IDs are in https://github.com/monad-crypto/protocols/blob/main/mainnet/pyth.jsonc
export const WMON = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A' as Address;
export const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' as Address;
export const UNISWAP_V2_FACTORY = '0x182a927119d56008d921126764bf884221b10f59' as Address;
export const UNISWAP_V2_ROUTER = '0x4b2ab38dbf28d31d467aa8993f6c2585981d6804' as Address;
export const KURU_FLOW_ROUTER = '0x465D06d4521ae9Ce724E0c182Daad5D8a2Ff7040' as Address;
export const PYTH_PRICE_FEED = '0x2880aB155794e7179c9eE2e38200202908C17B43' as Address;

export const TOKEN_CATALOG = {
  MON: { address: null, decimals: 18, feed: '0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1' },
  WMON: { address: WMON, decimals: 18, feed: '0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1' },
  USDC: { address: USDC, decimals: 6, feed: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a' },
} as const;

export const SUPPORTED_SWAP_TARGETS: ReadonlyMap<string, ProtocolId> = new Map([
  [KURU_FLOW_ROUTER.toLowerCase(), 'kuru'],
  [UNISWAP_V2_ROUTER.toLowerCase(), 'uniswap'],
]);
export const SUPPORTED_PROGRAMS = new Set([...SUPPORTED_SWAP_TARGETS.keys(), WMON.toLowerCase()]);

export const PROTOCOL_IDS = ['kuru','uniswap','morpho','curvance','magma','upshift','perpl','nadfun'] as const satisfies readonly ProtocolId[];
export const PROTOCOLS: Record<ProtocolId,{id:ProtocolId;name:string;category:string}> = {
  kuru:{id:'kuru',name:'Kuru',category:'Orderbook / spot'}, uniswap:{id:'uniswap',name:'Uniswap',category:'AMM / spot'},
  morpho:{id:'morpho',name:'Morpho',category:'Lending / leverage loops'}, curvance:{id:'curvance',name:'Curvance',category:'Lending'},
  magma:{id:'magma',name:'Magma',category:'Liquid staking'}, upshift:{id:'upshift',name:'Upshift',category:'Yield vaults'},
  perpl:{id:'perpl',name:'Perpl',category:'Perps'}, nadfun:{id:'nadfun',name:'nad.fun',category:'Launchpad / memecoins'},
};
export const COMPONENT_ORDER: PnlComponent[] = ['price','lpFee','il','interest','borrowCost','funding','stakingYield','rewards','swapFee','gas','mevLeak'];
export const SPENDER_LABEL: Record<ProtocolId,string> = {
  kuru:'Kuru Flow router',uniswap:'Uniswap V2 Router02',morpho:'Morpho',curvance:'Curvance market',magma:'Magma staking',upshift:'Upshift vault',perpl:'Perpl exchange',nadfun:'nad.fun curve',
};
const CLOSING: Record<string,boolean> = {
  'kuru.swap':true,'uniswap.swap':true,'morpho.lend_withdraw':true,'morpho.loop_close':true,
  'curvance.lend_withdraw':true,'magma.unstake':true,'upshift.vault_redeem':true,'perpl.perp_open':false,'perpl.perp_close':true,'nadfun.curve_sell':true,
};
export function isClosing(i: Interaction): boolean { return CLOSING[`${i.protocol}.${i.kind}`] ?? false; }
export function isProtocolId(s: string): s is ProtocolId { return (PROTOCOL_IDS as readonly string[]).includes(s); }
export type { InteractionKind };
