import { expect,it } from 'vitest';
import { parseConfig } from '../src/config.ts';
const env=(extra:Record<string,string>={})=>({MONAD_RPC_URL:'https://rpc.example',REGISTRY_ADDRESS:'0x0000000000000000000000000000000000000001',DATABASE_URL:'postgres://app:secret@localhost/db',DATABASE_URL_DIRECT:'postgres://app:secret@localhost/db',...extra});
it('defaults to Monad mainnet chain id 143 and validates required production settings',()=>{expect(parseConfig(env()).chainId).toBe(143);expect(parseConfig(env()).rpcUrl).toBe('https://rpc.example');});
it('validates configured chain IDs, missing env vars, tracked tokens and invalid address/origin',()=>{
  expect(parseConfig(env({MONAD_CHAIN_ID:'10143'})).chainId).toBe(10143);
  expect(()=>parseConfig(env({MONAD_CHAIN_ID:'0'}))).toThrow(/Invalid configuration/);
  expect(()=>parseConfig({})).toThrow(/Invalid configuration/);
  expect(()=>parseConfig(env({REGISTRY_ADDRESS:'not-an-address'}))).toThrow(/Invalid configuration/);
  expect(()=>parseConfig(env({CORS_ORIGINS:'https://app.example/path'}))).toThrow(/origins/);
  expect(parseConfig(env({MONAD_TRACKED_TOKENS:'0x0000000000000000000000000000000000000002:6'})).trackedTokens).toEqual([{address:'0x0000000000000000000000000000000000000002',decimals:6}]);
  expect(()=>parseConfig(env({MONAD_TRACKED_TOKENS:'0x0000000000000000000000000000000000000002'}))).toThrow(/address:decimals/);
});
