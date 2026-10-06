import { expect,it } from 'vitest';
import { migrate } from '../src/migrate.ts';
import { openDb } from '../src/pg.ts';
import { Store } from '../src/store.ts';
import { emptyPolicy } from '../src/metrics.ts';
import type { Agent } from '../src/types.ts';
const agent:Agent={slug:'store-agent',name:'Store',bio:'',runtime:'custom',verification:'wallet_signed',strategyLabel:'',wallet:'0x000000000000000000000000000000000000000a',owner:'0x000000000000000000000000000000000000000b',accountType:'eoa',protocols:[],startedAt:1000,startCapitalUsd:10,status:'live',bondMon:0,policy:emptyPolicy(),approvals:[],fingerprint:{avgHoldHours:0,avgLeverage:1,tradesPerDay:0}};
it('stores agents, openings, prices, nonces and rolling limits asynchronously',async()=>{
  const db=await openDb('memory:');await migrate(db);const s=new Store(db);
  await s.putAgent(agent,10,1000);await s.putOpening(agent.slug,{blockNumber:10,blockHash:'0xabc',tsMs:1000,balances:{MON:'100'},prices:{MON:0.5},priceQuality:{MON:'oracle'}});
  expect((await s.agentByWallet(agent.wallet))?.slug).toBe(agent.slug);expect((await s.opening(agent.slug))?.balances.MON).toBe('100');
  await s.putPriceSample({token:'MON',tsMs:1000,usd:0.5,source:'fixture',quality:'oracle'});await s.putPriceSample({token:'MON',tsMs:2000,usd:0.7,source:'fixture',quality:'oracle'});
  expect(await s.nearestPrice('MON',1500)).toMatchObject({usd:0.5,tsMs:1000});
  expect(await s.nonce(agent.wallet)).toBe(0n);await s.consumeNonce(agent.wallet,0n,1000);expect(await s.nonce(agent.wallet)).toBe(1n);
  await expect(s.consumeNonce(agent.wallet,0n,1001)).rejects.toThrow(/nonce/);
  await s.putEquity(agent.slug,{t:2000,usd:20,sol:0.5,flow:1},11,{MON:'20'});
  await s.putEquity(agent.slug,{t:2000,usd:21,sol:0.5,flow:2},12,{MON:'21'});
  expect(await db.query('select block_number from monad.equity_snapshots where agent_slug=$1 order by block_number',[agent.slug])).toEqual([{block_number:11},{block_number:12}]);
  expect(await s.latestBalances(agent.slug)).toEqual({MON:'21'});
  expect(await s.hitRateLimit(agent.wallet,'post',1000,1,1000)).toBe(true);expect(await s.hitRateLimit(agent.wallet,'post',1000,1,1001)).toBe(false);
  await db.close();
});
it('keeps database writes parameterized and typed JSON payloads round-trip',async()=>{
  const db=await openDb('memory:');await migrate(db);const s=new Store(db);await s.putAgent(agent);
  await expect(s.putAgent({...agent,slug:"x'; drop schema monad; --"})).rejects.toThrow();
  expect(await db.query("select schema_name from information_schema.schemata where schema_name='monad'")).toHaveLength(1);await db.close();
});
