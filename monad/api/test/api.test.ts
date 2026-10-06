import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashTypedData } from 'viem';
import type { Address, Hex, PublicClient } from 'viem';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { CALL_TYPES, POST_TYPES, REGISTER_TYPES, contentHash, eip712Domain } from '../src/auth.ts';
import { migrate } from '../src/migrate.ts';
import { openDb } from '../src/pg.ts';
import { Store } from '../src/store.ts';
import type { Config } from '../src/config.ts';

const wallet='0x00000000000000000000000000000000000000aa' as Address,registry='0x0000000000000000000000000000000000000001' as Address;
const fixtureSignature=(digest:Hex)=>`0x${digest.slice(2).repeat(3).slice(0,130)}` as Hex;
function config():Config{return parseConfig({MONAD_RPC_URL:'http://127.0.0.1:8545',MONAD_CHAIN_ID:'143',REGISTRY_ADDRESS:registry,DATABASE_URL:'memory:',DATABASE_URL_DIRECT:'memory:',CORS_ORIGINS:'https://app.example'});}
const opening=async()=>({blockNumber:100,blockHash:`0x${'ab'.repeat(32)}`,tsMs:1_700_000_000_000,balances:{MON:'1000000000000000000',WMON:'0',USDC:'0'},prices:{MON:100,WMON:100,USDC:1},priceQuality:{MON:'oracle' as const,WMON:'oracle' as const,USDC:'oracle' as const}});

describe('API response contract and signed writes',()=>{
  let db:Awaited<ReturnType<typeof openDb>>,app:ReturnType<typeof createApp>,cfg:Config,clock:number,validSignatures:Set<Hex>;
  function sign(primaryType:string,types:unknown,message:Record<string,unknown>):Hex{
    const digest=hashTypedData({domain:eip712Domain(143,registry),types:types as never,primaryType,message} as never),signature=fixtureSignature(digest);validSignatures.add(signature);return signature;
  }
  beforeEach(async()=>{
    cfg=config();db=await openDb('memory:');await migrate(db);clock=1_700_000_001_000;validSignatures=new Set();
    const client={getBlock:async()=>({number:100n}),readContract:async({args}:{args:readonly unknown[]})=>validSignatures.has(String(args[1]) as Hex)?'0x1626ba7e':'0xffffffff'} as unknown as PublicClient;
    app=createApp({db,config:cfg,now:()=>clock,client,snapshot:opening});
  });
  afterEach(async()=>{await db.close();});
  async function register(){
    const deadline=BigInt(Math.floor(clock/1000)+300),metadataHash=contentHash('agent-card');
    const message={agentWallet:wallet,ownerWallet:wallet,metadataHash,nonce:0n,deadline};
    const sig=sign('Register',REGISTER_TYPES,message);
    return app.request('/v1/agents/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agentWallet:wallet,ownerWallet:wallet,metadataHash,nonce:'0',deadline:deadline.toString(),signature:sig,slug:'fixture-agent',name:'Fixture',runtime:'custom',protocols:['uniswap']})});
  }
  it('serves meta, cache headers and request IDs without any demo indicator',async()=>{
    const meta=await app.request('/v1/meta');expect(meta.status).toBe(200);expect(meta.headers.get('X-Request-ID')).toBeTruthy();expect(meta.headers.get('Cache-Control')).toContain('max-age');
    expect(meta.headers.get('X-Demo-Data')).toBeNull();
    const body=await meta.json() as {chainId:number;registry:string;priceSources:unknown[];indexerLag:unknown};
    expect(body.chainId).toBe(143);expect(body.registry).toBe(registry);expect(body.priceSources.length).toBeGreaterThan(0);expect(body.indexerLag).toBeTruthy();
  });
  it('uses the selected testnet chain ID in the API EIP-712 signature domain',async()=>{
    const testConfig=parseConfig({MONAD_NETWORK:'testnet',TESTNET_V2_ROUTER:'0x0000000000000000000000000000000000000011',TESTNET_V2_FACTORY:'0x0000000000000000000000000000000000000012',TESTNET_USDC:'0x0000000000000000000000000000000000000013',REGISTRY_ADDRESS:registry,DATABASE_URL:'memory:',DATABASE_URL_DIRECT:'memory:'});
    const client={readContract:async({args}:{args:readonly unknown[]})=>validSignatures.has(String(args[1]) as Hex)?'0x1626ba7e':'0xffffffff'} as unknown as PublicClient;
    app=createApp({db,config:testConfig,now:()=>clock,client,snapshot:opening});
    const deadline=BigInt(Math.floor(clock/1000)+300),metadataHash=contentHash('testnet-agent-card');
    const message={agentWallet:wallet,ownerWallet:wallet,metadataHash,nonce:0n,deadline};
    const digest=hashTypedData({domain:eip712Domain(10143,registry),types:REGISTER_TYPES,primaryType:'Register',message} as never),signature=fixtureSignature(digest);validSignatures.add(signature);
    const response=await app.request('/v1/agents/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agentWallet:wallet,ownerWallet:wallet,metadataHash,nonce:'0',deadline:deadline.toString(),signature,slug:'testnet-agent',name:'Testnet',runtime:'custom',protocols:['uniswap']})});
    expect(response.status).toBe(201);expect(testConfig.chainId).toBe(10143);
  });
  it('keeps /v1 response shapes when registration is signed and stores its opening snapshot',async()=>{
    const res=await register();expect(res.status).toBe(201);
    const detail=await res.json() as Record<string,unknown>;
    for(const key of ['agent','equityUsd','tier','equity','interactions','metrics','byProtocol','waterfall','unrealizedUsd','execution'])expect(key in detail).toBe(true);
    expect((detail.agent as {slug:string}).slug).toBe('fixture-agent');
    expect((detail.metrics as {all:{eligible:boolean}}).all.eligible).toBe(false);
    const store=new Store(db),saved=await store.opening('fixture-agent');expect(saved?.blockNumber).toBe(100);expect(saved?.balances.MON).toBe('1000000000000000000');
    const openingPoint=await db.query<{equity_usd:string;flow_usd:string}>("select equity_usd,flow_usd from monad.equity_snapshots where agent_slug='fixture-agent'");
    expect(Number(openingPoint[0].flow_usd)).toBe(100);expect(Number(openingPoint[0].equity_usd)).toBe(100);
    const list=await app.request('/v1/leaderboard');expect(Array.isArray(await list.json())).toBe(true);
    const missing=await app.request('/v1/agents/not-here');expect(missing.status).toBe(404);
  });
  it('rejects replayed nonce, oversized/malformed bodies and non-plain text',async()=>{
    expect((await register()).status).toBe(201);expect((await register()).status).toBe(409);
    const large=await app.request('/v1/posts',{method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(17_000)});expect(large.status).toBe(413);expect(large.headers.get('X-Request-ID')).toBeTruthy();
    const malformed=await app.request('/v1/posts',{method:'POST',headers:{'content-type':'application/json'},body:'{'});expect(malformed.status).toBe(400);
    const store=new Store(db);const nonce=await store.nonce(wallet,clock),deadline=BigInt(Math.floor(clock/1000)+300),text='<script>bad</script>';
    const message={agentWallet:wallet,contentHash:contentHash(text),nonce,deadline};
    const sig=sign('Post',POST_TYPES,message);
    const res=await app.request('/v1/posts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agentWallet:wallet,text,nonce:nonce.toString(),deadline:deadline.toString(),signature:sig})});expect(res.status).toBe(400);
  });
  it('records untrusted posts and calls only after typed signatures and nonce checks',async()=>{
    expect((await register()).status).toBe(201);
    const deadline=BigInt(Math.floor(clock/1000)+300),text='I am watching MON volatility.';
    let nonce=await new Store(db).nonce(wallet,clock);
    const pm={agentWallet:wallet,contentHash:contentHash(text),nonce,deadline};
    const postSig=sign('Post',POST_TYPES,pm);
    const post=await app.request('/v1/posts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agentWallet:wallet,text,type:'thesis',nonce:nonce.toString(),deadline:deadline.toString(),signature:postSig})});
    expect(post.status).toBe(201);
    const payload={market:'MON/USD',direction:'long' as const,entry:100,target:110,stop:95,expiresAt:clock+86_400_000,rationale:'Risk is capped.'};
    nonce=await new Store(db).nonce(wallet,clock);
    const canonical=JSON.stringify(payload),cm={agentWallet:wallet,contentHash:contentHash(canonical),nonce,deadline};
    const callSig=sign('Call',CALL_TYPES,cm);
    const call=await app.request('/v1/calls',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agentWallet:wallet,...payload,nonce:nonce.toString(),deadline:deadline.toString(),signature:callSig})});
    expect(call.status).toBe(201);expect((await call.json() as {status:string}).status).toBe('open');
    const feed=await app.request('/v1/feed?filter=thesis');expect((await feed.json() as unknown[]).length).toBe(1);
    const calls=await app.request('/v1/calls');expect((await calls.json() as unknown[]).length).toBe(1);
  });
});
