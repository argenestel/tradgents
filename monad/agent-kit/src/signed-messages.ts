import { z } from 'zod';
import { isAddress } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { SignerPolicy } from './policy.ts';

export const MESSAGE_TYPES={
  Register:[{name:'agentWallet',type:'address'},{name:'ownerWallet',type:'address'},{name:'metadataHash',type:'bytes32'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}],
  Post:[{name:'agentWallet',type:'address'},{name:'contentHash',type:'bytes32'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}],
  Call:[{name:'agentWallet',type:'address'},{name:'contentHash',type:'bytes32'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}],
} as const;
const bytes32=z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address=z.string().refine(isAddress,'invalid wallet address');
const uint=z.union([z.string().regex(/^\d+$/),z.number().int().nonnegative().safe()]).transform(BigInt);
const register=z.object({primaryType:z.literal('Register'),message:z.object({agentWallet:address,ownerWallet:address,metadataHash:bytes32,nonce:uint,deadline:uint}).strict()}).strict();
const social=z.object({primaryType:z.enum(['Post','Call']),message:z.object({agentWallet:address,contentHash:bytes32,nonce:uint,deadline:uint}).strict()}).strict();
export async function signTradgentsMessage(account:PrivateKeyAccount,policy:SignerPolicy,input:unknown,nowMs=Date.now()):Promise<`0x${string}`> {
  const r=register.safeParse(input),s=social.safeParse(input);
  const parsed=r.success?r:s.success?s:undefined;if(!parsed)throw new Error('only approved Tradgents EIP-712 message types may be signed');
  if(parsed.data.message.agentWallet.toLowerCase()!==account.address.toLowerCase()||parsed.data.message.agentWallet.toLowerCase()!==policy.walletAddress.toLowerCase())throw new Error('message agent wallet does not match signer policy');
  if(r.success&&r.data.message.ownerWallet.toLowerCase()!==policy.ownerAddress.toLowerCase())throw new Error('registration owner wallet does not match signer policy');
  const seconds=BigInt(Math.floor(nowMs/1000));if(parsed.data.message.deadline<seconds||parsed.data.message.deadline>seconds+900n)throw new Error('signed message deadline is outside the allowed window');
  const primaryType=parsed.data.primaryType,types=primaryType==='Register'?{Register:MESSAGE_TYPES.Register}:primaryType==='Post'?{Post:MESSAGE_TYPES.Post}:{Call:MESSAGE_TYPES.Call};
  const message=Object.fromEntries(Object.entries(parsed.data.message).map(([k,v])=>[k,typeof v==='bigint'?v:v]));
  return account.signTypedData({domain:{name:'Tradgents',version:'1',chainId:policy.chainId,verifyingContract:policy.registryAddress},types,primaryType,message} as never);
}
