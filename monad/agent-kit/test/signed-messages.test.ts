import { expect,it,vi } from 'vitest';
import type { PrivateKeyAccount } from 'viem/accounts';
import { DEFAULT_POLICY,parsePolicy } from '../src/policy.ts';
import { signTradgentsMessage } from '../src/signed-messages.ts';
const wallet='0x00000000000000000000000000000000000000aa' as const;
const signTypedData=vi.fn(async()=>`0x${'11'.repeat(65)}`);
const account={address:wallet,signTypedData} as unknown as PrivateKeyAccount;
const policy=parsePolicy({...DEFAULT_POLICY,walletAddress:wallet});
it('pins registration owner to the root-owned wallet policy',async()=>{
  signTypedData.mockClear();
  const owner='0x00000000000000000000000000000000000000bb' as const,policy=parsePolicy({...DEFAULT_POLICY,walletAddress:wallet,ownerAddress:owner}),deadline=String(Math.floor(Date.now()/1000)+300);
  const message={primaryType:'Register',message:{agentWallet:wallet,ownerWallet:owner,metadataHash:`0x${'22'.repeat(32)}`,nonce:'0',deadline}};
  await signTradgentsMessage(account,policy,message);expect(account.signTypedData).toHaveBeenCalledOnce();
  await expect(signTradgentsMessage(account,policy,{...message,message:{...message.message,ownerWallet:wallet}})).rejects.toThrow(/owner wallet/);
});
it('signs only wallet-bound, domain-separated Tradgents EIP-712 payloads',async()=>{
  signTypedData.mockClear();
  const deadline=String(Math.floor(Date.now()/1000)+300);
  const signature=await signTradgentsMessage(account,policy,{primaryType:'Post',message:{agentWallet:wallet,contentHash:`0x${'11'.repeat(32)}`,nonce:'0',deadline}});
  expect(signature).toMatch(/^0x[0-9a-f]{130}$/i);expect(account.signTypedData).toHaveBeenCalledOnce();
  await expect(signTradgentsMessage(account,policy,{primaryType:'PersonalSign',message:'arbitrary bytes'})).rejects.toThrow(/approved Tradgents/);
  await expect(signTradgentsMessage(account,policy,{primaryType:'Post',message:{agentWallet:'0x0000000000000000000000000000000000000001',contentHash:`0x${'11'.repeat(32)}`,nonce:'0',deadline}})).rejects.toThrow(/wallet/);
  await expect(signTradgentsMessage(account,policy,{primaryType:'Post',domain:{name:'Mallory',chainId:1},message:{agentWallet:wallet,contentHash:`0x${'11'.repeat(32)}`,nonce:'0',deadline}})).rejects.toThrow(/approved Tradgents/);
});
