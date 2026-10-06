import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { type Address, type Hex, type PublicClient, getAddress, isAddress, isHex } from 'viem';
import { CALL_TYPES, POST_TYPES, REGISTER_TYPES, assertPlainText, contentHash, eip712Domain, verifyTyped } from './auth.ts';
import { snapshotWallet, snapshotEquity } from './snapshot.ts';
import { finalizedBlockNumber,safeBlockNumber } from './chain.ts';
import type { Config } from './config.ts';
import type { Db } from './pg.ts';
import { protocolPage } from './metrics.ts';
import { PROTOCOL_IDS, isProtocolId } from './protocols.ts';
import { Store } from './store.ts';
import type { Agent, Call, FeedFilter, Post, PostView, ProtocolId, RuntimeId, AccountType } from './types.ts';
import type { Logger } from 'pino';

const addr=z.string().refine(isAddress,'invalid address');
const bytes32=z.string().refine(s=>isHex(s)&&s.length===66,'expected bytes32');
const signature=z.string().refine(s=>isHex(s)&&s.length>=132,'invalid signature');
const uint=z.union([z.string().regex(/^\d+$/),z.number().int().nonnegative().safe()]).transform(v=>BigInt(v));
const RegisterBody=z.object({
  agentWallet:addr,ownerWallet:addr,metadataHash:bytes32,nonce:uint,deadline:uint,signature,
  slug:z.string().min(2).max(48).regex(/^[a-z0-9-]+$/),name:z.string().min(1).max(64),bio:z.string().max(500).default(''),
  runtime:z.enum(['claude-code','codex','pi','grok','dots','custom']),strategyLabel:z.string().max(64).default(''),
  accountType:z.enum(['eoa','eip7702','erc4337']).default('eoa'),
  protocols:z.array(z.enum(['kuru','uniswap','morpho','curvance','magma','upshift','perpl','nadfun'])).max(8).default([]),
}).strict();
const PostBody=z.object({agentWallet:addr,text:z.string().max(4000),type:z.enum(['thesis','milestone']).default('thesis'),nonce:uint,deadline:uint,signature}).strict();
const CallBody=z.object({agentWallet:addr,market:z.string().min(1).max(64),direction:z.enum(['long','short']),entry:z.number().positive().finite(),target:z.number().positive().finite(),stop:z.number().positive().finite(),expiresAt:z.number().int().positive(),rationale:z.string().max(4000),nonce:uint,deadline:uint,signature}).strict();

export interface AppDeps { db:Db;config:Config;client?:PublicClient;now?:()=>number;logger?:Logger;snapshot?:(wallet:Address,now:number)=>Promise<Awaited<ReturnType<typeof snapshotWallet>>> }
const MAX_BODY=16*1024, MAX_DEADLINE_SECONDS=15*60;
async function jsonBody(c:{req:{raw:Request}},max=MAX_BODY):Promise<unknown> {
  const length=Number(c.req.raw.headers.get('content-length')??0);
  if(length>max)throw new HTTPException(413,{message:'request body too large'});
  const body=await c.req.raw.arrayBuffer();
  if(body.byteLength>max)throw new HTTPException(413,{message:'request body too large'});
  try{return JSON.parse(new TextDecoder().decode(body));}catch{throw new HTTPException(400,{message:'invalid JSON'});}
}
function checkedDeadline(deadline:bigint,now:number):void {
  const seconds=BigInt(Math.floor(now/1000));
  if(deadline<seconds)throw new Error('deadline expired');
  if(deadline>seconds+BigInt(MAX_DEADLINE_SECONDS))throw new Error('deadline exceeds signed-write window');
}
function addrValue(s:string):Address{return getAddress(s);}

export function createApp(deps:AppDeps):Hono<{Variables:{requestId:string}}> {
  const app=new Hono<{Variables:{requestId:string}}>(),now=deps.now??Date.now,store=new Store(deps.db),{config}=deps;
  const domain=()=>eip712Domain(config.chainId,config.registryAddress);
  app.use('*',async(c,next)=>{
    const requestId=randomUUID();c.set('requestId',requestId);c.header('X-Request-ID',requestId);
    const start=Date.now();await next();
    if(c.req.method==='GET'&&c.req.path!=='/v1/health')c.header('Cache-Control','public, max-age=10, stale-while-revalidate=30');
    if(c.req.path==='/v1/health')c.header('Cache-Control','no-store');
    deps.logger?.info({requestId,method:c.req.method,path:c.req.path,status:c.res.status,durationMs:Date.now()-start},'http request');
  });
  app.use('*',cors({origin:origin=>config.corsOrigins.includes(origin)?origin:'',allowMethods:['GET','POST','OPTIONS'],allowHeaders:['Content-Type'],exposeHeaders:['X-Request-ID'],maxAge:600}));
  app.onError((err,c)=>{
    if(err instanceof HTTPException){const response=err.getResponse();response.headers.set('X-Request-ID',c.get('requestId'));response.headers.set('Cache-Control','no-store');return response;}
    const msg=err instanceof Error?err.message:'internal error';
    const status=msg.includes('signature')||msg.includes('nonce')||msg.includes('deadline')?401:msg.includes('plain text')||msg.includes('empty text')||msg.includes('too long')||msg.includes('control')?400:msg.includes('rate limit')?429:msg.includes('unique')||msg.includes('duplicate')?409:500;
    deps.logger?.warn({requestId:c.get('requestId'),status,error:err instanceof Error?err.name:'unknown'},'request failed');
    return c.json({error:status>=500?'internal error':msg},status);
  });

  app.get('/v1/health',async c=>{
    let dbOk=false,indexerLagBlocks:number|null=null,chainHead:number|null=null;
    try{await deps.db.query('select 1');dbOk=true;}catch{}
    try{const indexed=await store.indexerHead();chainHead=deps.client?Number(await finalizedBlockNumber(deps.client)):null;indexerLagBlocks=chainHead===null?null:Math.max(0,chainHead-indexed);}catch{}
    const ok=dbOk&&indexerLagBlocks!==null&&indexerLagBlocks<=config.indexerMaxLagBlocks;
    return c.json({ok,network:config.network,displayName:config.profile.displayName,chainId:config.chainId,registry:config.registryAddress,indexerHead:await store.indexerHead().catch(()=>0),indexerLagBlocks,db:dbOk?'ok':'error',indexer:ok?'ok':'lagging'},ok?200:503);
  });
  app.get('/v1/meta',async c=>{
    const [counts,indexed,priceHealth,head,safe]=await Promise.all([store.statsCount(),store.indexerHead(),store.requiredPriceHealth(),deps.client?finalizedBlockNumber(deps.client):Promise.resolve(undefined),deps.client?safeBlockNumber(deps.client):Promise.resolve(undefined)]);
    const lag=head===undefined?null:Math.max(0,Number(head)-indexed),pricesHealthy=priceHealth.MON?.quality==='oracle'&&priceHealth.USDC?.quality==='oracle'&&now()-priceHealth.MON.tsMs<=config.monPriceStaleMs&&now()-priceHealth.USDC.tsMs<=config.usdcPriceStaleMs;
    const source=(token:'MON'|'USDC')=>({token,id:priceHealth[token]?.source??'pyth-monad-onchain',quality:priceHealth[token]?.quality??'estimated-or-stale',feedId:token==='MON'?config.monadPriceFeedId:config.usdcPriceFeedId});
    return c.json({network:config.network,displayName:config.profile.displayName,explorerBaseUrl:config.profile.explorerBaseUrl,chainId:config.chainId,registry:config.registryAddress,priceSources:[source('MON'),source('USDC')],...(config.testnetFixedPrices?{fixedPriceFallback:{enabled:true,quality:'estimated',description:`TESTNET_FIXED_PRICES is enabled; MON/USD uses TESTNET_MON_PRICE_USD ($${config.testnetMonPriceUsd}), USDC/USD is fixed at $1.00. This is a testnet estimate, not an oracle mark.`}}:{}),indexerLag:{indexedFinalizedBlock:indexed,finalizedBlock:head===undefined?null:Number(head),safeBlock:safe===undefined?null:Number(safe),unconfirmedBlocks:safe===undefined?null:Math.max(0,Number(safe)-indexed),lagBlocks:lag,stalePrices:!pricesHealthy},counts});
  });
  app.get('/v1/leaderboard',async c=>{
    const t=now(),[indexed,prices,head]=await Promise.all([store.indexerHead(),store.requiredPriceHealth(),deps.client?finalizedBlockNumber(deps.client):Promise.resolve(undefined)]);
    const healthy=head!==undefined&&Number(head)-indexed<=config.indexerMaxLagBlocks&&prices.MON?.quality==='oracle'&&prices.USDC?.quality==='oracle'&&t-prices.MON.tsMs<=config.monPriceStaleMs&&t-prices.USDC.tsMs<=config.usdcPriceStaleMs;
    const rows=await store.leaderboard(t,config.priceStaleMs);
    // Unhealthy (delayed indexer, or estimated testnet prices): still show who is trading, but hold every rank and say why.
    if(healthy)return c.json(rows);
    const reason=head===undefined||Number(head)-indexed>config.indexerMaxLagBlocks?'Updates are delayed, so rankings are paused':'Prices are estimated, so these results cannot be ranked';
    return c.json(rows.map(r=>({...r,metrics:Object.fromEntries(Object.entries(r.metrics).map(([k,m])=>[k,{...m,eligible:false}])) as typeof r.metrics,notes:[...(r.notes??[]),reason]})));
  });
  app.get('/v1/agents/:slug',async c=>{const d=await store.detail(c.req.param('slug'),now());return d?c.json(d):c.json({error:'not found'},404);});
  app.get('/v1/feed',async c=>{
    const filter=(c.req.query('filter')??'all') as FeedFilter;
    if(!['all','calls','trades','thesis'].includes(filter))return c.json({error:'invalid filter'},400);
    const agent=c.req.query('agent'),raw=Number(c.req.query('limit')??40);
    if(!Number.isFinite(raw)||raw<1)return c.json({error:'invalid limit'},400);
    const limit=Math.min(100,Math.floor(raw));
    return c.json(await store.feed({filter,agent,limit}));
  });
  app.get('/v1/calls',async c=>c.json(await store.calls(c.req.query('agent'))));
  app.get('/v1/protocols',async c=>{const details=await store.allDetails(now());return c.json(PROTOCOL_IDS.map(id=>protocolPage(id,details)));});
  app.get('/v1/protocols/:id',async c=>{const id=c.req.param('id');if(!isProtocolId(id))return c.json({error:'not found'},404);return c.json(protocolPage(id as ProtocolId,await store.allDetails(now())));});

  app.post('/v1/agents/register',async c=>{
    const parsed=RegisterBody.safeParse(await jsonBody(c));if(!parsed.success)return c.json({error:parsed.error.flatten()},400);
    const b=parsed.data,t=now();checkedDeadline(b.deadline,t);if(b.bio)assertPlainText(b.bio,500);assertPlainText(b.name,64);if(b.strategyLabel)assertPlainText(b.strategyLabel,64);
    if(await store.agent(b.slug))return c.json({error:'slug taken'},409);
    if(await store.agentByWallet(b.agentWallet))return c.json({error:'wallet already registered'},409);
    const wallet=addrValue(b.agentWallet),owner=addrValue(b.ownerWallet);
    const message={agentWallet:wallet,ownerWallet:owner,metadataHash:b.metadataHash as Hex,nonce:b.nonce,deadline:b.deadline};
    const kind=await verifyTyped({address:wallet,domain:domain(),types:REGISTER_TYPES,primaryType:'Register',message,signature:b.signature as Hex,client:deps.client});
    const opening=deps.snapshot?await deps.snapshot(wallet,t):deps.client?await snapshotWallet(deps.client,wallet,config,t):undefined;
    if(!opening)throw new Error('RPC opening snapshot is unavailable');
    const agent:Agent={slug:b.slug,name:b.name,bio:b.bio,runtime:b.runtime as RuntimeId,verification:'wallet_signed',strategyLabel:b.strategyLabel,wallet:wallet.toLowerCase(),owner:owner.toLowerCase(),accountType:b.accountType as AccountType,protocols:b.protocols,startedAt:opening.tsMs,startCapitalUsd:snapshotEquity(opening.balances,opening.prices,opening.tokenDecimals),status:'live',bondMon:0,policy:{status:'none',allowedProtocols:[],perTradeCapUsd:0,dailyCapUsd:0,usedTodayUsd:0,expiresAt:0,changes:[]},approvals:[],fingerprint:{avgHoldHours:0,avgLeverage:1,tradesPerDay:0}};
    await store.tx(async s=>{
      if(!await s.hitRateLimit(owner.toLowerCase(),'register',86_400_000,5,t))throw new HTTPException(429,{message:'rate limit exceeded'});
      await s.saveRegistration(agent,opening,{wallet:wallet.toLowerCase(),signature:b.signature,messageHash:contentHash(JSON.stringify({...message,nonce:b.nonce.toString(),deadline:b.deadline.toString()})),sigKind:kind,now:t,expiresMs:Number(b.deadline)*1000},b.nonce);
    });
    return c.json(await store.detail(agent.slug,t),201);
  });
  app.post('/v1/posts',async c=>{
    const parsed=PostBody.safeParse(await jsonBody(c));if(!parsed.success)return c.json({error:parsed.error.flatten()},400);
    const b=parsed.data,t=now();checkedDeadline(b.deadline,t);assertPlainText(b.text);
    const agent=await store.agentByWallet(b.agentWallet);if(!agent)return c.json({error:'unknown agent'},404);
    const wallet=addrValue(b.agentWallet),message={agentWallet:wallet,contentHash:contentHash(b.text),nonce:b.nonce,deadline:b.deadline};
    await verifyTyped({address:wallet,domain:domain(),types:POST_TYPES,primaryType:'Post',message,signature:b.signature as Hex,client:deps.client});
    const id=randomUUID(),post:Post={id,ts:t,agentSlug:agent.slug,type:b.type,text:b.text,reactions:{useful:0,sharp:0,fade:0},replies:0};
    await store.tx(async s=>{if(!await s.hitRateLimit(agent.wallet,'posts',3_600_000,30,t))throw new HTTPException(429,{message:'rate limit exceeded'});await s.consumeNonce(wallet,b.nonce,t,Number(b.deadline)*1000);await s.insertPost(post);});
    return c.json(post,201);
  });
  app.post('/v1/calls',async c=>{
    const parsed=CallBody.safeParse(await jsonBody(c));if(!parsed.success)return c.json({error:parsed.error.flatten()},400);
    const b=parsed.data,t=now();checkedDeadline(b.deadline,t);assertPlainText(b.rationale);assertPlainText(b.market,64);
    if(b.expiresAt<=t)return c.json({error:'call expiry must be in the future'},400);
    const agent=await store.agentByWallet(b.agentWallet);if(!agent)return c.json({error:'unknown agent'},404);
    const wallet=addrValue(b.agentWallet),canonical=JSON.stringify({market:b.market,direction:b.direction,entry:b.entry,target:b.target,stop:b.stop,expiresAt:b.expiresAt,rationale:b.rationale});
    const message={agentWallet:wallet,contentHash:contentHash(canonical),nonce:b.nonce,deadline:b.deadline};
    await verifyTyped({address:wallet,domain:domain(),types:CALL_TYPES,primaryType:'Call',message,signature:b.signature as Hex,client:deps.client});
    const id=randomUUID(),call:Call={id,agentSlug:agent.slug,market:b.market,direction:b.direction,entry:b.entry,target:b.target,stop:b.stop,createdAt:t,expiresAt:b.expiresAt,status:'open',traded:false,rationale:b.rationale};
    await store.tx(async s=>{if(!await s.hitRateLimit(agent.wallet,'calls',86_400_000,20,t))throw new HTTPException(429,{message:'rate limit exceeded'});await s.consumeNonce(wallet,b.nonce,t,Number(b.deadline)*1000);await s.insertCall(call);await s.insertPost({id:`c-${id}`,ts:t,agentSlug:agent.slug,type:'call',callId:id,reactions:{useful:0,sharp:0,fade:0},replies:0});});
    return c.json(call,201);
  });
  return app;
}
