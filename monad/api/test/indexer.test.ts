import { expect,it } from 'vitest';
import { encodeAbiParameters,encodeEventTopics,parseAbi,type Address,type PublicClient } from 'viem';
import { Indexer,REGISTRY_EVENTS,priceWithLiquidityFloor,runIndexer } from '../src/indexer.ts';
import { parseConfig } from '../src/config.ts';
import { emptyPolicy } from '../src/metrics.ts';
import { migrate } from '../src/migrate.ts';
import { openDb,type Db } from '../src/pg.ts';
import { Store } from '../src/store.ts';
import { USDC,WMON } from '../src/protocols.ts';
import type { Agent } from '../src/types.ts';
const registry='0x0000000000000000000000000000000000000001' as const;
const cfg=parseConfig({MONAD_RPC_URL:'https://rpc.example',REGISTRY_ADDRESS:registry,DATABASE_URL:'memory:',DATABASE_URL_DIRECT:'memory:'});
const agent:Agent={slug:'idx-agent',name:'Indexer',bio:'',runtime:'custom',verification:'wallet_signed',strategyLabel:'',wallet:'0x00000000000000000000000000000000000000aa',owner:'0x00000000000000000000000000000000000000bb',accountType:'eoa',protocols:[],startedAt:1000,startCapitalUsd:0,status:'live',bondMon:0,policy:emptyPolicy(),approvals:[],fingerprint:{avgHoldHours:0,avgLeverage:1,tradesPerDay:0}};
it('keeps pool liquidity with samples and makes sub-floor sources estimated',()=>{
  const sample={token:'ALT',tsMs:1,usd:1,source:'pool',quality:'oracle' as const,liquidityUsd:50};
  expect(priceWithLiquidityFloor(sample,100)).toMatchObject({quality:'estimated',liquidityUsd:50});
  expect(priceWithLiquidityFloor({...sample,liquidityUsd:150},100).quality).toBe('oracle');
});
it('uses the revised unbond, unpause and reason-code event ABI',()=>{
  const topics=encodeEventTopics({abi:REGISTRY_EVENTS,eventName:'AgentUnpaused',args:{agentWallet:agent.wallet as Address,guardian:agent.owner as Address}});
  expect(topics.length).toBe(3);
  expect(REGISTRY_EVENTS.some(e=>e.type==='event'&&e.name==='UnbondRequested')).toBe(true);
  expect(REGISTRY_EVENTS.some(e=>e.type==='event'&&e.name==='AgentUnpaused')).toBe(true);
  expect(REGISTRY_EVENTS.some(e=>e.type==='event'&&e.name==='AgentSlashed'&&e.inputs?.at(-1)?.name==='reasonCode')).toBe(true);
});
it('decodes WMON Deposit/Withdrawal from receipt logs and records the wrap event',async()=>{
  const db=await openDb('memory:');const client={readContract:async()=>0n} as unknown as PublicClient,indexer=new Indexer(db,client,cfg);
  const amount=1_000_000_000_000_000_000n,transferAbi=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']),depositAbi=parseAbi(['event Deposit(address indexed dst,uint256 wad)']);
  const transfer={topics:encodeEventTopics({abi:transferAbi,eventName:'Transfer',args:{from:'0x0000000000000000000000000000000000000000',to:agent.wallet as Address}}),data:encodeAbiParameters([{type:'uint256'}],[amount])};
  const deposit={topics:encodeEventTopics({abi:depositAbi,eventName:'Deposit',args:{dst:agent.wallet as Address}}),data:encodeAbiParameters([{type:'uint256'}],[amount])};
  const tx={hash:`0x${'11'.repeat(32)}`,from:agent.wallet,to:'0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',value:amount,gas:100_000n,effectiveGasPrice:1n,receiptStatus:'success',receiptGasUsed:50_000n};
  const observation=await (indexer as unknown as {agentObservation:(a:Agent,t:Record<string,unknown>,b:bigint,h:string,ts:number,l:Record<string,unknown>[],r:Record<string,unknown>[])=>Promise<import('../src/ledger.ts').TxObservation>}).agentObservation(agent,tx,1n,'0xblock',1000,[{...transfer,address:'0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A'} as unknown as Record<string,unknown>],[{...deposit,address:'0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A'} as unknown as Record<string,unknown>]);
  expect(observation.wrap).toEqual({kind:'deposit',amount});expect(observation.deltas.map(d=>d.token)).toEqual(['MON','WMON']);await db.close();
});
it('stores finalized registry history from its own cursor before any agent exists',async()=>{
  const db=await openDb('memory:');await migrate(db);const wallet='0x00000000000000000000000000000000000000cc' as Address,owner='0x00000000000000000000000000000000000000dd' as Address;
  const topics=encodeEventTopics({abi:REGISTRY_EVENTS,eventName:'AgentRegistered',args:{agentWallet:wallet,ownerWallet:owner}});
  const data=encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'uint256'}],[`0x${'12'.repeat(32)}`,1_000_000_000_000_000_000n,0n]);
  const log={address:registry,blockNumber:1n,blockHash:`0x${'01'.repeat(32)}`,transactionHash:`0x${'02'.repeat(32)}`,logIndex:0n,topics,data};
  const client={
    getBlock:async(args:{blockNumber?:bigint;blockTag?:string})=>({number:args.blockNumber??2n,hash:`0x${String(args.blockNumber??2n)}`,timestamp:1_700_000_000n,transactions:[]}),
    getLogs:async(args:{fromBlock:bigint;toBlock:bigint})=>args.fromBlock<=1n&&args.toBlock>=1n?[log]:[],
    getBalance:async()=>0n,
    readContract:async(args:{functionName:string;args?:readonly unknown[]})=>args.functionName==='getPriceUnsafe'?{price:args.args?.[0]===cfg.monadPriceFeedId?100n:1n,conf:0n,expo:0,publishTime:1_700_000_000n}:0n,
    request:async()=>[],
  } as unknown as PublicClient;
  const indexer=new Indexer(db,client,cfg);await indexer.backfill(1_700_000_000_000);
  const store=new Store(db),indexed=await store.agentByWallet(wallet);
  expect(indexed?.bondMon).toBe(1);expect(await store.state('registry_block')).toBe('2');expect(await store.indexerHead()).toBe(2);
  expect(await db.query('select tx_hash from monad.raw_logs where address=$1',[registry])).toHaveLength(1);await db.close();
});
it('aborts an in-flight index block before it can write or advance its cursor',async()=>{
  const db=await openDb('memory:');await migrate(db);const store=new Store(db);await store.putAgent(agent,0,1000);await store.putOpening(agent.slug,{blockNumber:0,blockHash:'0x0',tsMs:1000,balances:{MON:'0',WMON:'0',USDC:'0'},prices:{MON:1,WMON:1,USDC:1}});
  let started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});
  const client={getBlock:async(args:{blockNumber?:bigint;blockTag?:string})=>args.blockTag?({number:1n}):new Promise(resolve=>started()),getLogs:async()=>[],request:async()=>[]} as unknown as PublicClient;
  const controller=new AbortController(),indexer=new Indexer(db,client,cfg),running=indexer.backfill(2000,controller.signal);
  await entered;controller.abort(new Error('advisory lock lost'));
  await expect(running).rejects.toThrow(/lock lost/);
  expect(await db.query('select tx_hash from monad.raw_transactions where agent_slug=$1',[agent.slug])).toHaveLength(0);
  await db.close();
});
it('rebuilds on-chain drift from raw activity without overwriting replay balances',async()=>{
  const db=await openDb('memory:');await migrate(db);const store=new Store(db),opened={...agent,bondMon:1,startCapitalUsd:100};
  await store.putAgent(opened,1,1000);await store.putOpening(opened.slug,{blockNumber:1,blockHash:'0xopen',tsMs:1000,balances:{MON:'1000000000000000000',WMON:'0',USDC:'0'},prices:{MON:100,WMON:100,USDC:1},priceQuality:{MON:'oracle',WMON:'oracle',USDC:'oracle'}});
  await store.putPriceSample({token:'MON',tsMs:1000,usd:100,source:'fixture',quality:'oracle'});await store.putPriceSample({token:'USDC',tsMs:1000,usd:1,source:'fixture',quality:'oracle'});await store.putPriceSample({token:'WMON',tsMs:1000,usd:100,source:'fixture',quality:'oracle'});
  await store.putRawTransaction({txHash:`0x${'33'.repeat(32)}`,agentSlug:opened.slug,blockNumber:2,blockHash:'0x2',tsMs:1500,transaction:{observation:{hash:`0x${'33'.repeat(32)}`,blockNumber:2,transactionIndex:0,blockHash:'0x2',tsMs:1500,from:'0x00000000000000000000000000000000000000bb',to:opened.wallet,success:true,gasLimit:'0',effectiveGasPrice:'0',value:'0',deltas:[{token:'USDC',raw:'1000000',decimals:6,symbol:'USDC'}],internalValueUnknown:false},transaction:{}},receipt:{},status:'finalized'});
  const logged:unknown[]=[];const client={getBlock:async()=>({number:5n,hash:'0x5',timestamp:2n}),getBalance:async()=>2_000_000_000_000_000_000n,readContract:async(args:{address:string})=>args.address.toLowerCase()===USDC.toLowerCase()?1_000_000n:0n} as unknown as PublicClient;
  const indexer=new Indexer(db,client,cfg,{warn:(...args:unknown[])=>logged.push(args),error:(...args:unknown[])=>logged.push(args)} as never);await indexer.markAll(2000);
  expect(await store.latestBalances(opened.slug)).toEqual({MON:'1000000000000000000',WMON:'0',USDC:'1000000'});
  expect(await store.integrityDrifted(opened.slug)).toBe(true);expect(logged.length).toBeGreaterThan(0);
  expect((await store.detail(opened.slug,2000))?.integrityOk).toBe(false);await db.close();
});
it('propagates lost advisory-lock failure so the worker exits non-zero',async()=>{
  const db={kind:'pglite',query:async()=>[],exec:async()=>undefined,tx:async(fn:unknown)=>undefined,withAdvisoryLock:async(_key:number,fn:()=>Promise<void>,opts?:{onLost?:(e:unknown)=>void})=>{opts?.onLost?.(new Error('session lost'));await fn();return undefined;},close:async()=>undefined} as unknown as Db;
  const client={} as PublicClient;
  await expect(runIndexer(db,client,cfg)).rejects.toThrow(/advisory lock/);
});
it('advances only finalized cursors and keeps registry event writes within each block transaction',async()=>{
  const db=await openDb('memory:');await migrate(db);const store=new Store(db);await store.putAgent(agent,10,1000);await store.putOpening(agent.slug,{blockNumber:10,blockHash:'0x10',tsMs:1000,balances:{MON:'0',WMON:'0',USDC:'0'},prices:{MON:1,WMON:1,USDC:1}});
  const client={
    getBlock:async(args:{blockNumber?:bigint})=>({number:args.blockNumber??11n,hash:`0x${String(args.blockNumber??11n)}`,timestamp:2n,transactions:[]}),
    getLogs:async()=>[],request:async()=>[],
  } as unknown as PublicClient;
  const indexer=new Indexer(db,client,cfg);const result=await indexer.backfill(2000);
  expect(result).toMatchObject({from:10,to:11,applied:0});expect(await store.indexerHead()).toBe(11);
  await db.close();
});
