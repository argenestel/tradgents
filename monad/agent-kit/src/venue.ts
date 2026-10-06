import type { Address } from 'viem';

// Monad mainnet addresses verified in the official protocols registry:
// https://github.com/monad-crypto/protocols/blob/main/mainnet/uniswap.jsonc
// WMON is from https://github.com/monad-crypto/protocols/blob/main/mainnet/CANONICAL.jsonc
// USDC is from https://github.com/monad-crypto/protocols/blob/main/mainnet/aave_v3.jsonc
// Pyth contract and feed IDs are from https://github.com/monad-crypto/protocols/blob/main/mainnet/pyth.jsonc
export const UNISWAP_V2_FACTORY='0x182a927119d56008d921126764bf884221b10f59' as Address;
export const UNISWAP_V2_ROUTER='0x4b2ab38dbf28d31d467aa8993f6c2585981d6804' as Address;
export const WMON='0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A' as Address;
export const USDC='0x754704Bc059F8C67012fEd69BC8A327a5aafb603' as Address;
export const PYTH_PRICE_FEED='0x2880aB155794e7179c9eE2e38200202908C17B43' as Address;
export const PRICE_FEEDS={
  WMON:'0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1',
  USDC:'0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
} as const;

export type SignerNetwork='mainnet'|'testnet';
export interface SignerNetworkProfile {
  network:SignerNetwork;chainId:number;defaultRpcUrl:string;router:Address;factory:Address;
  wmon:Address;usdc:Address;usdcDecimals:6;pyth:Address;feeds:typeof PRICE_FEEDS;
  explorerBaseUrl:string;displayName:string;
}
const TESTNET_WMON='0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541' as Address;
const TESTNET_PYTH='0x2880aB155794e7179c9eE2e38200202908C17B43' as Address;
const testnetAddress=(value:string|undefined,name:string):Address=>{
  if(!value||!/^0x[0-9a-fA-F]{40}$/.test(value))throw new Error(`${name} is required and must be an EVM address for MONAD_NETWORK=testnet`);
  return value as Address;
};
export function getSignerNetworkProfile(network:SignerNetwork,env:Record<string,string|undefined>=process.env):SignerNetworkProfile {
  if(network==='mainnet')return {network,chainId:143,defaultRpcUrl:'https://rpc.monad.xyz',router:UNISWAP_V2_ROUTER,factory:UNISWAP_V2_FACTORY,wmon:WMON,usdc:USDC,usdcDecimals:6,pyth:PYTH_PRICE_FEED,feeds:PRICE_FEEDS,explorerBaseUrl:'https://monadvision.com',displayName:'Monad'};
  return {network,chainId:10143,defaultRpcUrl:'https://testnet-rpc.monad.xyz',router:testnetAddress(env.TESTNET_V2_ROUTER,'TESTNET_V2_ROUTER'),factory:testnetAddress(env.TESTNET_V2_FACTORY,'TESTNET_V2_FACTORY'),wmon:env.TESTNET_WMON?testnetAddress(env.TESTNET_WMON,'TESTNET_WMON'):TESTNET_WMON,usdc:testnetAddress(env.TESTNET_USDC,'TESTNET_USDC'),usdcDecimals:6,pyth:TESTNET_PYTH,feeds:PRICE_FEEDS,explorerBaseUrl:'https://testnet.monadexplorer.com',displayName:'Monad Testnet'};
}

export const FACTORY_ABI=[{type:'function',name:'getPair',stateMutability:'view',inputs:[{name:'tokenA',type:'address'},{name:'tokenB',type:'address'}],outputs:[{type:'address'}]}] as const;
export const PAIR_ABI=[
  {type:'function',name:'token0',stateMutability:'view',inputs:[],outputs:[{type:'address'}]},
  {type:'function',name:'token1',stateMutability:'view',inputs:[],outputs:[{type:'address'}]},
  {type:'function',name:'getReserves',stateMutability:'view',inputs:[],outputs:[{name:'reserve0',type:'uint112'},{name:'reserve1',type:'uint112'},{name:'blockTimestampLast',type:'uint32'}]},
] as const;
export const ROUTER_ABI=[
  {type:'function',name:'getAmountsOut',stateMutability:'view',inputs:[{name:'amountIn',type:'uint256'},{name:'path',type:'address[]'}],outputs:[{name:'amounts',type:'uint256[]'}]},
  {type:'function',name:'swapExactTokensForTokens',stateMutability:'nonpayable',inputs:[{name:'amountIn',type:'uint256'},{name:'amountOutMin',type:'uint256'},{name:'path',type:'address[]'},{name:'to',type:'address'},{name:'deadline',type:'uint256'}],outputs:[{name:'amounts',type:'uint256[]'}]},
] as const;
export const ERC20_ABI=[
  {type:'function',name:'allowance',stateMutability:'view',inputs:[{name:'owner',type:'address'},{name:'spender',type:'address'}],outputs:[{type:'uint256'}]},
  {type:'function',name:'approve',stateMutability:'nonpayable',inputs:[{name:'spender',type:'address'},{name:'amount',type:'uint256'}],outputs:[{type:'bool'}]},
  {type:'function',name:'balanceOf',stateMutability:'view',inputs:[{name:'owner',type:'address'}],outputs:[{type:'uint256'}]},
] as const;
export const PYTH_ABI=[{type:'function',name:'getPriceUnsafe',stateMutability:'view',inputs:[{name:'id',type:'bytes32'}],outputs:[{type:'tuple',components:[{name:'price',type:'int64'},{name:'conf',type:'uint64'},{name:'expo',type:'int32'},{name:'publishTime',type:'uint256'}]}]}] as const;
