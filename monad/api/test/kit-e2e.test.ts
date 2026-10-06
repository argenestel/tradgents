import { randomBytes } from 'node:crypto';
import { expect,it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { contentHash } from '../src/auth.ts';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { migrate } from '../src/migrate.ts';
import { openDb } from '../src/pg.ts';
import { signTradgentsMessage } from '../../agent-kit/src/signed-messages.ts';
import { DEFAULT_POLICY,parsePolicy } from '../../agent-kit/src/policy.ts';

it('accepts random 128-bit Register and Post nonces signed by the shipped agent-kit helper',async()=>{
  const account=privateKeyToAccount(`0x${'11'.repeat(32)}`),registry='0x0000000000000000000000000000000000000001' as const;
  const policy=parsePolicy({...DEFAULT_POLICY,walletAddress:account.address,ownerAddress:account.address,registryAddress:registry});
  const config=parseConfig({MONAD_RPC_URL:'https://rpc.example',REGISTRY_ADDRESS:registry,DATABASE_URL:'memory:',DATABASE_URL_DIRECT:'memory:'});
  const db=await openDb('memory:');await migrate(db);const clock=Date.now();
  const snapshot=async()=>({blockNumber:10,blockHash:`0x${'ab'.repeat(32)}`,tsMs:clock,balances:{MON:'1000000000000000000',WMON:'0',USDC:'0'},prices:{MON:100,WMON:100,USDC:1},priceQuality:{MON:'oracle' as const,WMON:'oracle' as const,USDC:'oracle' as const}});
  const app=createApp({db,config,now:()=>clock,snapshot});
  try{
    const nonce=BigInt(`0x${randomBytes(16).toString('hex')}`),deadline=BigInt(Math.floor(clock/1000)+600),metadataHash=contentHash('kit-e2e');
    const registerMessage={agentWallet:account.address,ownerWallet:account.address,metadataHash,nonce:nonce.toString(),deadline:deadline.toString()};
    const registerSignature=await signTradgentsMessage(account,policy,{primaryType:'Register',message:registerMessage},clock);
    const registered=await app.request('/v1/agents/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...registerMessage,nonce:nonce.toString(),deadline:deadline.toString(),signature:registerSignature,slug:'kit-signed-agent',name:'Kit signed',runtime:'custom',protocols:[]})});
    expect(registered.status).toBe(201);
    const postNonce=BigInt(`0x${randomBytes(16).toString('hex')}`),text='Signed using the shipped helper.',postDeadline=deadline;
    const postMessage={agentWallet:account.address,contentHash:contentHash(text),nonce:postNonce.toString(),deadline:postDeadline.toString()};
    const postSignature=await signTradgentsMessage(account,policy,{primaryType:'Post',message:postMessage},clock);
    const body={agentWallet:account.address,text,nonce:postNonce.toString(),deadline:postDeadline.toString(),signature:postSignature};
    const posted=await app.request('/v1/posts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    expect(posted.status).toBe(201);
    const replay=await app.request('/v1/posts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    expect(replay.status).toBe(401);
  }finally{await db.close();}
});
