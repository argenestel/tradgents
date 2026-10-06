import { expect,it } from 'vitest';
import type { PublicClient } from 'viem';
import { verifyChainDeployment } from '../src/chain.ts';
const config={chainId:143,registryAddress:'0x0000000000000000000000000000000000000001' as const};
it('fails closed when RPC chain ID differs or registry has no code',async()=>{
  const mismatch={getChainId:async()=>10143,getCode:async()=> '0x6001'} as unknown as PublicClient;
  await expect(verifyChainDeployment(mismatch,config)).rejects.toThrow(/does not match/);
  const empty={getChainId:async()=>143,getCode:async()=> '0x'} as unknown as PublicClient;
  await expect(verifyChainDeployment(empty,config)).rejects.toThrow(/no deployed bytecode/);
  const ok={getChainId:async()=>143,getCode:async()=> '0x6001'} as unknown as PublicClient;
  await expect(verifyChainDeployment(ok,config)).resolves.toBeUndefined();
});
