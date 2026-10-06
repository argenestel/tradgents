import { expect,it } from 'vitest';
import { encodeEventTopics,type Address,type PublicClient } from 'viem';
import { Indexer,REGISTRY_EVENTS } from '../src/indexer.ts';
import { parseConfig } from '../src/config.ts';
import { emptyPolicy } from '../src/metrics.ts';
import { migrate } from '../src/migrate.ts';
import { openDb } from '../src/pg.ts';
import { Store } from '../src/store.ts';
import type { Agent } from '../src/types.ts';
const registry='0x0000000000000000000000000000000000000001' as const;
const cfg=parseConfig({MONAD_RPC_URL:'https://rpc.example',REGISTRY_ADDRESS:registry,DATABASE_URL:'memory:',DATABASE_URL_DIRECT:'memory:'});
const agent:Agent={slug:'idx-agent',name:'Indexer',bio:'',runtime:'custom',verification:'wallet_signed',strategyLabel:'',wallet:'0x00000000000000000000000000000000000000aa',owner:'0x00000000000000000000000000000000000000bb',accountType:'eoa',protocols:[],startedAt:1000,startCapitalUsd:0,status:'live',bondMon:0,policy:emptyPolicy(),approvals:[],fingerprint:{avgHoldHours:0,avgLeverage:1,tradesPerDay:0}};
it('uses the revised unbond, unpause and reason-code event ABI',()=>{
  const topics=encodeEventTopics({abi:REGISTRY_EVENTS,eventName:'AgentUnpaused',args:{agentWallet:agent.wallet as Address,guardian:agent.owner as Address}});
  expect(topics.length).toBe(3);
  expect(REGISTRY_EVENTS.some(e=>e.type==='event'&&e.name==='UnbondRequested')).toBe(true);
  expect(REGISTRY_EVENTS.some(e=>e.type==='event'&&e.name==='AgentUnpaused')).toBe(true);
  expect(REGISTRY_EVENTS.some(e=>e.type==='event'&&e.name==='AgentSlashed'&&e.inputs?.at(-1)?.name==='reasonCode')).toBe(true);
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
