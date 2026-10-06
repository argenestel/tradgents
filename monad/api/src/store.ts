import { formatUnits } from 'viem';
import type { Db, Sql } from './pg.ts';
import { assembleDetail, toLeaderboardRow } from './metrics.ts';
import type { Agent, AgentDetail, Call, EquityPoint, Interaction, LeaderboardRow, Metrics, Post, PostView, ProtocolId, ProtocolPage } from './types.ts';
import { usdDecimalFromMicros,usdMicrosFromDecimal,type FifoLot,type PriceSample,type TxObservation } from './ledger.ts';

type Q = Pick<Sql,'query'>;
const num = (v: unknown) => Number(v);
const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) as T : v as T);
function openingFlowUsd(o:Opening):number {
  let total=0;
  for(const [token,raw] of Object.entries(o.balances)){
    const price=o.prices[token];if(price===undefined)continue;
    const decimals=o.tokenDecimals?.[token]??(token==='USDC'?6:18);
    total+=Number(formatUnits(BigInt(raw),decimals))*price;
  }
  return total;
}
export interface Opening { blockNumber:number; blockHash:string; tsMs:number; balances:Record<string,string>; tokenDecimals?:Record<string,number>; prices:Record<string,number>; priceQuality?:Record<string,'oracle'|'estimated'> }
export type Valuation = EquityPoint & { blockNumber?:number; flow?:number; unpriced?:string[]; integrityOk?:boolean };
export interface StatsRow { equityUsd:number; tier:LeaderboardRow['tier']; metrics:Record<'7d'|'30d'|'all',Metrics>; spark:number[]; unsupportedCount:number; unpriced:string[]; eligible:boolean }

/** The application's complete asynchronous, parameterized database surface. */
export class Store {
  constructor(readonly db:Db, private readonly sql:Q = db) {}
  tx<T>(fn:(s:Store)=>Promise<T>):Promise<T> { return this.sql===this.db ? this.db.tx(q=>fn(new Store(this.db,q))) : fn(this); }
  private get q():Q { return this.sql; }

  async agents():Promise<Agent[]> { return (await this.q.query<{data:Agent}>('select data from monad.agents order by slug')).map(r=>r.data); }
  async agent(slug:string):Promise<Agent|undefined> { return (await this.q.query<{data:Agent}>('select data from monad.agents where slug=$1',[slug]))[0]?.data; }
  async agentByWallet(wallet:string):Promise<Agent|undefined> { return (await this.q.query<{data:Agent}>('select data from monad.agents where lower(wallet)=lower($1)',[wallet]))[0]?.data; }
  async putAgent(a:Agent, registeredBlock=0, now=a.startedAt):Promise<void> {
    await this.q.query('insert into monad.agents(slug,wallet,owner,data,registered_block,created_ms) values($1,$2,$3,$4::text::jsonb,$5,$6)',[a.slug,a.wallet.toLowerCase(),a.owner.toLowerCase(),JSON.stringify(a),registeredBlock,now]);
  }
  async opening(slug:string):Promise<Opening|undefined> {
    const r=(await this.q.query<{block_number:string;block_hash:string;ts_ms:string;balances:unknown;token_decimals:unknown;prices:unknown;price_quality:unknown}>('select block_number,block_hash,ts_ms,balances,token_decimals,prices,price_quality from monad.openings where agent_slug=$1',[slug]))[0];
    return r&&{blockNumber:num(r.block_number),blockHash:r.block_hash,tsMs:num(r.ts_ms),balances:json(r.balances),tokenDecimals:json(r.token_decimals),prices:json(r.prices),priceQuality:json(r.price_quality)};
  }
  async putOpening(slug:string,o:Opening):Promise<void> {
    await this.q.query('insert into monad.openings(agent_slug,block_number,block_hash,ts_ms,balances,token_decimals,prices,price_quality) values($1,$2,$3,$4,$5::text::jsonb,$6::text::jsonb,$7::text::jsonb,$8::text::jsonb) on conflict(agent_slug) do nothing',[slug,o.blockNumber,o.blockHash,o.tsMs,JSON.stringify(o.balances),JSON.stringify(o.tokenDecimals??{}),JSON.stringify(o.prices),JSON.stringify(o.priceQuality??{})]);
  }
  async putIndexedRegistration(a:Agent,o:Opening):Promise<void> {
    const flowUsd=openingFlowUsd(o),registered={...a,startCapitalUsd:flowUsd};
    await this.putAgent(registered,o.blockNumber,o.tsMs);await this.putOpening(a.slug,o);
    for(const [token,usd] of Object.entries(o.prices))await this.putPriceSample({token,tsMs:o.tsMs,usd,source:'pyth-monad-onchain',quality:o.priceQuality?.[token]??'estimated'});
    await this.q.query('insert into monad.equity_snapshots(agent_slug,ts_ms,block_number,equity_usd,mon_price,flow_usd,balances,unpriced,integrity_ok) values($1,$2,$3,$4,$5,$4,$6::text::jsonb,$7,false)',[registered.slug,o.tsMs,o.blockNumber,flowUsd,o.prices.MON??0,JSON.stringify(o.balances),Object.keys(o.balances).filter(t=>o.prices[t]===undefined||o.priceQuality?.[t]!=='oracle')]);
  }

  async state(key:string):Promise<string|undefined> { return (await this.q.query<{value:string}>('select value from monad.indexer_state where key=$1',[key]))[0]?.value; }
  async setState(key:string,value:string,now=Date.now()):Promise<void> { await this.q.query('insert into monad.indexer_state(key,value,updated_ms) values($1,$2,$3) on conflict(key) do update set value=excluded.value,updated_ms=excluded.updated_ms',[key,value,now]); }
  async indexerHead(tag:'finalized'|'safe'='finalized'):Promise<number> { return Number((await this.state(`${tag}_block`))??0); }

  async saveRegistration(a:Agent,o:Opening,proof:{wallet:string;signature:string;messageHash:string;sigKind:string;now:number;expiresMs:number},nonce:bigint):Promise<void> {
    const flowUsd=openingFlowUsd(o),registered={...a,startCapitalUsd:flowUsd};
    await this.tx(async s=>{
      await s.q.query('delete from monad.used_nonces where lower(wallet)=lower($1) and expires_ms<$2',[proof.wallet,proof.now]);
      const inserted=await s.q.query('insert into monad.used_nonces(wallet,nonce,expires_ms,created_ms) values(lower($1),$2,$3,$4) on conflict(wallet,nonce) do nothing returning nonce',[proof.wallet,nonce.toString(),proof.expiresMs,proof.now]);
      if(!inserted.length)throw new Error('invalid nonce');
      await s.q.query('insert into monad.agents(slug,wallet,owner,data,registered_block,created_ms) values($1,$2,$3,$4::text::jsonb,$5,$6)',[registered.slug,registered.wallet.toLowerCase(),registered.owner.toLowerCase(),JSON.stringify(registered),o.blockNumber,registered.startedAt]);
      await s.q.query('insert into monad.openings(agent_slug,block_number,block_hash,ts_ms,balances,token_decimals,prices,price_quality) values($1,$2,$3,$4,$5::text::jsonb,$6::text::jsonb,$7::text::jsonb,$8::text::jsonb)',[a.slug,o.blockNumber,o.blockHash,o.tsMs,JSON.stringify(o.balances),JSON.stringify(o.tokenDecimals??{}),JSON.stringify(o.prices),JSON.stringify(o.priceQuality??{})]);
      await s.q.query('insert into monad.wallet_proofs(wallet,signature,message_hash,sig_kind,created_ms) values(lower($1),$2,$3,$4,$5)',[proof.wallet,proof.signature,proof.messageHash,proof.sigKind,proof.now]);
      for(const [token,usd] of Object.entries(o.prices)) await s.putPriceSample({token,tsMs:o.tsMs,usd,source:'pyth-monad-onchain',quality:o.priceQuality?.[token]??'estimated'});
      await s.q.query('insert into monad.equity_snapshots(agent_slug,ts_ms,block_number,equity_usd,mon_price,flow_usd,balances,unpriced,integrity_ok) values($1,$2,$3,$4,$5,$4,$6::text::jsonb,$7,false)',[registered.slug,o.tsMs,o.blockNumber,flowUsd,o.prices.MON??0,JSON.stringify(o.balances),Object.keys(o.balances).filter(t=>o.prices[t]===undefined||o.priceQuality?.[t]!=='oracle')]);
    });
  }
  async consumeNonce(wallet:string,nonce:bigint,now:number,expiresMs=now+15*60_000):Promise<void> {
    await this.q.query('delete from monad.used_nonces where lower(wallet)=lower($1) and expires_ms<$2',[wallet,now]);
    const rows=await this.q.query('insert into monad.used_nonces(wallet,nonce,expires_ms,created_ms) values(lower($1),$2,$3,$4) on conflict(wallet,nonce) do nothing returning nonce',[wallet,nonce.toString(),expiresMs,now]);
    if(rows.length===0)throw new Error('invalid nonce');
  }
  async nonce(wallet:string,now=Date.now()):Promise<bigint> {
    const used=new Set((await this.q.query<{nonce:string}>('select nonce from monad.used_nonces where lower(wallet)=lower($1) and expires_ms>= $2',[wallet,now])).map(r=>r.nonce));
    let next=0n;while(used.has(next.toString()))next++;return next;
  }
  async hitRateLimit(principal:string,kind:string,windowMs:number,limit:number,now:number):Promise<boolean> {
    const start=Math.floor(now/windowMs)*windowMs;
    const r=await this.q.query<{count:number}>(`insert into monad.rate_limits(principal,kind,window_start_ms,count) values($1,$2,$3,1)
      on conflict(principal,kind,window_start_ms) do update set count=monad.rate_limits.count+1 returning count`,[principal,kind,start]);
    return r[0].count<=limit;
  }

  async applyRegistryEvent(name:string,args:Record<string,unknown>,txHash:string):Promise<void> {
    const wallet=String(args.agentWallet??args.agentWallet??'').toLowerCase();
    if(name==='AgentRegistered'){
      const bond=Number(BigInt(String(args.bondWei??0)))/1e18;
      await this.q.query(`update monad.agents set data=jsonb_set(jsonb_set(data,'{bondMon}',to_jsonb($2::numeric),true),'{status}','"live"'::jsonb,true) where lower(wallet)=$1`,[wallet,bond]);
    } else if(name==='BondWithdrawn'){
      await this.q.query(`update monad.agents set data=jsonb_set(jsonb_set(data,'{bondMon}','0'::jsonb,true),'{status}','"stale"'::jsonb,true) where lower(wallet)=$1`,[wallet]);
    } else if(name==='AgentPaused'){
      await this.q.query(`update monad.agents set data=jsonb_set(data,'{status}','"stale"'::jsonb,true) where lower(wallet)=$1`,[wallet]);
    } else if(name==='AgentUnpaused'){
      await this.q.query(`update monad.agents set data=jsonb_set(data,'{status}','"live"'::jsonb,true) where lower(wallet)=$1`,[wallet]);
    } else if(name==='AgentSlashed'){
      await this.q.query(`update monad.agents set data=jsonb_set(jsonb_set(data,'{bondMon}','0'::jsonb,true),'{status}','"stale"'::jsonb,true) where lower(wallet)=$1`,[wallet]);
    } else if(name==='UnbondRequested'){
      await this.q.query('insert into monad.unbond_events(agent_wallet,available_at,tx_hash) values($1,$2,$3) on conflict do nothing',[wallet,String(args.availableAt??0),txHash]);
    }
  }

  async putPriceSample(p:{token:string;tsMs:number;usd:string|number;source:string;quality:'oracle'|'estimated';liquidityUsd?:number}):Promise<void> {
    await this.q.query(`insert into monad.price_samples(token,ts_ms,usd,source,quality,liquidity_usd) values($1,$2,$3,$4,$5,$6) on conflict(token,ts_ms) do update set usd=excluded.usd,source=excluded.source,quality=excluded.quality,liquidity_usd=excluded.liquidity_usd`,[p.token,p.tsMs,p.usd,p.source,p.quality,p.liquidityUsd??null]);
  }
  async nearestPrice(token:string,tsMs:number):Promise<{usd:number;tsMs:number;source:string;quality:'oracle'|'estimated';liquidityUsd?:number}|undefined> {
    const r=(await this.q.query<{usd:string;ts_ms:string;source:string;quality:'oracle'|'estimated';liquidity_usd:string|null}>(`select usd,ts_ms,source,quality,liquidity_usd from monad.price_samples where token=$1 order by abs(ts_ms-$2) asc,ts_ms asc limit 1`,[token,tsMs]))[0];
    return r&&{usd:num(r.usd),tsMs:num(r.ts_ms),source:r.source,quality:r.quality,...(r.liquidity_usd===null?{}:{liquidityUsd:num(r.liquidity_usd)})};
  }
  async latestPriceTs():Promise<number|undefined> { const x=(await this.q.query<{ts:string|null}>('select max(ts_ms) ts from monad.price_samples'))[0]?.ts;return x==null?undefined:num(x); }
  async requiredPriceHealth():Promise<Record<string,{tsMs:number;quality:'oracle'|'estimated';source:string}>> {
    const rows=await this.q.query<{token:string;ts_ms:string;quality:'oracle'|'estimated';source:string}>(`select p.token,p.ts_ms,p.quality,p.source from monad.price_samples p join (select token,max(ts_ms) ts from monad.price_samples where token in ('MON','USDC') group by token) latest on p.token=latest.token and p.ts_ms=latest.ts`);
    return Object.fromEntries(rows.map(r=>[r.token,{tsMs:num(r.ts_ms),quality:r.quality,source:r.source}]));
  }

  async putRawTransaction(r:{txHash:string;agentSlug:string;blockNumber:number;blockHash:string;tsMs:number;transaction:unknown;receipt:unknown;status:'finalized'|'safe'}):Promise<boolean> {
    const rows=await this.q.query('insert into monad.raw_transactions(tx_hash,agent_slug,block_number,block_hash,ts_ms,transaction,receipt,status) values(lower($1),$2,$3,$4,$5,$6::text::jsonb,$7::text::jsonb,$8) on conflict(agent_slug,tx_hash) do nothing returning tx_hash',[r.txHash,r.agentSlug,r.blockNumber,r.blockHash,r.tsMs,JSON.stringify(r.transaction),JSON.stringify(r.receipt),r.status]);
    return rows.length>0;
  }
  async putRawLog(r:{chainId:number;txHash:string;logIndex:number;blockNumber:number;blockHash:string;address:string;topic0:string;topics:string[];data:`0x${string}`;status:'finalized'|'safe'}):Promise<void> {
    await this.q.query('insert into monad.raw_logs(chain_id,tx_hash,log_index,block_number,block_hash,address,topic0,topics,data,status) values($1,lower($2),$3,$4,$5,lower($6),lower($7),$8,decode(substr($9,3),\'hex\'),$10) on conflict do nothing',[r.chainId,r.txHash,r.logIndex,r.blockNumber,r.blockHash,r.address,r.topic0,r.topics,r.data,r.status]);
  }
  async rawObservations(agentSlug:string):Promise<TxObservation[]> {
    const rows=await this.q.query<{transaction:unknown}>('select transaction from monad.raw_transactions where agent_slug=$1 order by block_number,tx_hash',[agentSlug]);
    return rows.map(row=>{
      const wrapped=json<{observation:Record<string,unknown>}>(row.transaction),o=wrapped.observation;
      return {...o,gasLimit:BigInt(String(o.gasLimit)),effectiveGasPrice:BigInt(String(o.effectiveGasPrice)),value:BigInt(String(o.value)),deltas:(o.deltas as Record<string,unknown>[]).map(d=>({...d,raw:BigInt(String(d.raw))})),...(o.wrap?{wrap:{...(o.wrap as Record<string,unknown>),amount:BigInt(String((o.wrap as Record<string,unknown>).amount))}}:{})} as unknown as TxObservation;
    });
  }
  async storedPriceSamples():Promise<PriceSample[]> {
    return (await this.q.query<{token:string;ts_ms:string;usd:string;source:string;quality:'oracle'|'estimated';liquidity_usd:string|null}>('select token,ts_ms,usd,source,quality,liquidity_usd from monad.price_samples order by ts_ms,token')).map(r=>({token:r.token,tsMs:num(r.ts_ms),usd:num(r.usd),source:r.source,quality:r.quality,...(r.liquidity_usd?{liquidityUsd:num(r.liquidity_usd)}:{})}));
  }
  async latestBalances(agentSlug:string):Promise<Record<string,string>> {
    const r=(await this.q.query<{balances:unknown}>('select balances from monad.equity_snapshots where agent_slug=$1 order by block_number desc limit 1',[agentSlug]))[0];
    if(r)return json(r.balances);
    return (await this.opening(agentSlug))?.balances??{};
  }
  async lots(agentSlug:string):Promise<FifoLot[]> {
    const rows=await this.q.query<{token:string;qty_raw:string;cost_usd:string;acquired_ms:string;source_tx:string}>('select token,qty_raw,cost_usd,acquired_ms,source_tx from monad.lots where agent_slug=$1 order by acquired_ms,id',[agentSlug]);
    return rows.map(r=>({token:r.token,qtyRaw:BigInt(r.qty_raw),costUsd:num(r.cost_usd),costUsdMicros:usdMicrosFromDecimal(r.cost_usd),tsMs:num(r.acquired_ms),sourceTx:r.source_tx}));
  }
  async applyReplay(agentSlug:string,entries:{token:string;deltaRaw:bigint;kind:string;txHash:string}[],lots:FifoLot[],interactions:Interaction[],transactions:TxObservation[],at:number,blockNumber:number,equityUsd:number,monPrice:number,balances:unknown,unpriced:string[],integrityOk:boolean,flowUsd=0,differences:Record<string,{replayed:string;chain:string}>={},signal?:AbortSignal):Promise<void> {
    const check=()=>{if(signal?.aborted)throw signal.reason??new Error('indexer lock lost');};
    await this.tx(async s=>{
      check();const byHash=new Map(transactions.map(o=>[o.hash,o]));
      for(const e of entries){check();const tx=byHash.get(e.txHash);if(!tx)continue;await s.insertLedger({agentSlug,txHash:e.txHash,blockNumber:tx.blockNumber,tsMs:tx.tsMs,token:e.token,deltaRaw:e.deltaRaw,kind:e.kind as 'flow'|'swap'|'fee'|'unsupported'|'wrap'});}
      check();await s.q.query('delete from monad.lots where agent_slug=$1',[agentSlug]);
      for(const lot of lots){check();await s.q.query('insert into monad.lots(agent_slug,token,acquired_ms,qty_raw,cost_usd,source_tx) values($1,$2,$3,$4,$5,$6)',[agentSlug,lot.token,lot.tsMs,lot.qtyRaw.toString(),usdDecimalFromMicros(lot.costUsdMicros??BigInt(Math.round(lot.costUsd*1_000_000))),lot.sourceTx]);}
      for(const interaction of interactions){check();await s.putInteraction(interaction);}
      check();await s.setIntegrityDrift(agentSlug,!integrityOk,differences,at);
      await s.putEquity(agentSlug,{t:at,usd:equityUsd,sol:monPrice,flow:flowUsd,unpriced,integrityOk},blockNumber,balances,integrityOk);check();
    });
  }
  async replaceReplay(agentSlug:string,entries:{token:string;deltaRaw:bigint;kind:string;txHash:string}[],lots:FifoLot[],interactions:Interaction[],at:number,blockNumber:number,equityUsd:number,monPrice:number,balances:unknown,unpriced:string[],integrityOk:boolean,flowUsd=0,differences:Record<string,{replayed:string;chain:string}>={},signal?:AbortSignal):Promise<void> {
    const check=()=>{if(signal?.aborted)throw signal.reason??new Error('indexer lock lost');};
    await this.tx(async s=>{
      check();await s.q.query('delete from monad.ledger_entries where agent_slug=$1',[agentSlug]);
      check();await s.q.query('delete from monad.interactions where agent_slug=$1',[agentSlug]);
      await s.q.query('delete from monad.lots where agent_slug=$1',[agentSlug]);
      const observations=await s.rawObservations(agentSlug),byHash=new Map(observations.map(o=>[o.hash,o]));
      for(const e of entries){check();const tx=byHash.get(e.txHash);if(!tx)continue;await s.insertLedger({agentSlug,txHash:e.txHash,blockNumber:tx.blockNumber,tsMs:tx.tsMs,token:e.token,deltaRaw:e.deltaRaw,kind:e.kind as 'flow'|'swap'|'fee'|'unsupported'|'wrap'});}
      for(const lot of lots){check();await s.q.query('insert into monad.lots(agent_slug,token,acquired_ms,qty_raw,cost_usd,source_tx) values($1,$2,$3,$4,$5,$6)',[agentSlug,lot.token,lot.tsMs,lot.qtyRaw.toString(),usdDecimalFromMicros(lot.costUsdMicros??BigInt(Math.round(lot.costUsd*1_000_000))),lot.sourceTx]);}
      for(const i of interactions){check();await s.putInteraction(i);}
      check();await s.setIntegrityDrift(agentSlug,!integrityOk,differences,at);
      await s.putEquity(agentSlug,{t:at,usd:equityUsd,sol:monPrice,flow:flowUsd,unpriced,integrityOk},blockNumber,balances,integrityOk);
      check();await s.rebuildStats(agentSlug,at);check();
    });
  }

  async insertLedger(r:{agentSlug:string;txHash?:string;blockNumber:number;tsMs:number;token:string;deltaRaw:bigint;kind:'opening'|'flow'|'swap'|'fee'|'unsupported'|'wrap';data?:unknown}):Promise<void> {
    await this.q.query(`insert into monad.ledger_entries(agent_slug,tx_hash,block_number,ts_ms,token,delta_raw,kind,data) values($1,lower($2),$3,$4,$5,$6,$7,$8::text::jsonb)
      on conflict(agent_slug,tx_hash,token,kind) do update set block_number=excluded.block_number,ts_ms=excluded.ts_ms,delta_raw=excluded.delta_raw,data=excluded.data`,[r.agentSlug,r.txHash??null,r.blockNumber,r.tsMs,r.token,r.deltaRaw.toString(),r.kind,JSON.stringify(r.data??{})]);
  }
  async putInteraction(i:Interaction):Promise<void> { await this.q.query('insert into monad.interactions(id,agent_slug,tx_hash,block_number,ts_ms,protocol,kind,data) values($1,$2,lower($3),$4,$5,$6,$7,$8::text::jsonb) on conflict(agent_slug,tx_hash) do nothing',[i.id,i.agentSlug,i.txHash,i.blockNumber,i.ts,i.protocol,i.kind,JSON.stringify(i)]); }
  async putEquity(agentSlug:string,p:Valuation,blockNumber:number,balances:unknown,integrityOk=true):Promise<void> {
    await this.q.query(`insert into monad.equity_snapshots(agent_slug,ts_ms,block_number,equity_usd,mon_price,flow_usd,balances,unpriced,integrity_ok)
      values($1,$2,$3,$4,$5,$6,$7::text::jsonb,$8,$9) on conflict(agent_slug,block_number) do update set ts_ms=excluded.ts_ms,equity_usd=excluded.equity_usd,mon_price=excluded.mon_price,flow_usd=excluded.flow_usd,balances=excluded.balances,unpriced=excluded.unpriced,integrity_ok=excluded.integrity_ok`,[agentSlug,p.t,blockNumber,p.usd,p.sol,p.flow??0,JSON.stringify(balances),p.unpriced??[],integrityOk]);
  }
  async integrityDrifted(agent:string):Promise<boolean> {return (await this.q.query<{drifted:boolean}>('select drifted from monad.agent_integrity where agent_slug=$1',[agent]))[0]?.drifted??false;}
  async setIntegrityDrift(agent:string,drifted:boolean,differences:Record<string,{replayed:string;chain:string}>,now=Date.now()):Promise<void> {
    await this.q.query(`insert into monad.agent_integrity(agent_slug,drifted,differences,updated_ms) values($1,$2,$3::text::jsonb,$4)
      on conflict(agent_slug) do update set drifted=excluded.drifted,differences=excluded.differences,updated_ms=excluded.updated_ms`,[agent,drifted,JSON.stringify(differences),now]);
  }
  async unsupportedCount(agent:string,sinceMs=0):Promise<number> { return Number((await this.q.query<{n:string}>('select count(distinct tx_hash) n from monad.ledger_entries where agent_slug=$1 and kind=\'unsupported\' and ts_ms >= $2',[agent,sinceMs]))[0]?.n??0); }
  async unpriced(agent:string):Promise<string[]> { return (await this.q.query<{unpriced:string[]}>('select unpriced from monad.agent_stats where agent_slug=$1',[agent]))[0]?.unpriced??[]; }

  private async detailRows(slug:string):Promise<{agent:Agent;interactions:Interaction[];equity:Valuation[]}|undefined> {
    const agent=await this.agent(slug); if(!agent)return undefined;
    const ints=await this.q.query<{data:Interaction}>('select data from monad.interactions where agent_slug=$1 order by ts_ms,block_number,id',[slug]);
    const rows=await this.q.query<{ts_ms:string;block_number:string;equity_usd:string;mon_price:string;flow_usd:string;unpriced:string[];integrity_ok:boolean}>('select ts_ms,block_number,equity_usd,mon_price,flow_usd,unpriced,integrity_ok from monad.equity_snapshots where agent_slug=$1 order by ts_ms,block_number',[slug]);
    return {agent,interactions:ints.map(r=>r.data),equity:rows.map(r=>({t:num(r.ts_ms),blockNumber:num(r.block_number),usd:num(r.equity_usd),sol:num(r.mon_price),flow:num(r.flow_usd),unpriced:r.unpriced,integrityOk:r.integrity_ok}))};
  }
  async detail(slug:string,now:number):Promise<(AgentDetail&{unsupportedTransactions:number;unpricedTokens:string[]})|undefined> {
    const r=await this.detailRows(slug);if(!r)return undefined;
    const unpriced=r.equity.at(-1)?.unpriced??[];
    const unsupportedTransactions=await this.unsupportedCount(slug);
    const [unsupported7d,unsupported30d]=await Promise.all([this.unsupportedCount(slug,now-7*86_400_000),this.unsupportedCount(slug,now-30*86_400_000)]);
    const integrityOk=r.equity.at(-1)?.integrityOk===true&&!await this.integrityDrifted(slug);
    const d=assembleDetail(r.agent,r.interactions,r.equity,now,{unsupported7d:unsupported7d>0,unsupported30d:unsupported30d>0,unsupportedAll:unsupportedTransactions>0,unpriced:unpriced.length>0,integrity:integrityOk,bond:r.agent.bondMon>0,active:r.agent.status==='live'});
    return {...d,unsupportedTransactions,unpricedTokens:unpriced,integrityOk};
  }
  async allDetails(now:number):Promise<AgentDetail[]> { const agents=await this.agents();const out:AgentDetail[]=[];for(const a of agents){const d=await this.detail(a.slug,now);if(d)out.push(d);}return out; }
  async rebuildStats(agentSlug:string,now:number):Promise<StatsRow|undefined> {
    const d=await this.detail(agentSlug,now); if(!d)return undefined;
    const row=toLeaderboardRow(d);
    const unsupported=d.unsupportedTransactions;
    const unpriced=d.unpricedTokens;
    const metrics={...row.metrics};
    const integrityOk=await this.integrityDrifted(agentSlug)===false&&d.integrityOk===true;
    const eligible=metrics.all.eligible&&unpriced.length===0&&d.agent.status==='live'&&d.agent.bondMon>0&&integrityOk;
    for(const k of ['7d','30d','all'] as const) metrics[k]={...metrics[k],eligible:metrics[k].eligible&&unpriced.length===0&&d.agent.status==='live'&&d.agent.bondMon>0};
    const result={equityUsd:row.equityUsd,tier:row.tier,metrics,spark:row.spark,unsupportedCount:unsupported,unpriced,eligible};
    await this.q.query(`insert into monad.agent_stats(agent_slug,updated_ms,equity_usd,tier,metrics,spark,unsupported_count,unpriced,eligible)
      values($1,$2,$3,$4,$5::text::jsonb,$6::text::jsonb,$7,$8,$9) on conflict(agent_slug) do update set updated_ms=excluded.updated_ms,equity_usd=excluded.equity_usd,tier=excluded.tier,metrics=excluded.metrics,spark=excluded.spark,unsupported_count=excluded.unsupported_count,unpriced=excluded.unpriced,eligible=excluded.eligible`,[agentSlug,now,result.equityUsd,result.tier,JSON.stringify(metrics),JSON.stringify(result.spark),unsupported,unpriced,eligible]);
    return result;
  }
  async leaderboard(now:number,staleAfterMs=3_600_000):Promise<LeaderboardRow[]> {
    const rows=await this.q.query<{data:Agent;equity_usd:string;tier:LeaderboardRow['tier'];metrics:LeaderboardRow['metrics'];spark:number[];eligible:boolean}>('select a.data,s.equity_usd,s.tier,s.metrics,s.spark,s.eligible from monad.agent_stats s join monad.agents a on a.slug=s.agent_slug where s.eligible and s.updated_ms >= $1 order by (s.metrics->\'30d\'->>\'sharpe\')::numeric desc',[now-staleAfterMs]);
    return rows.map(r=>({agent:r.data,equityUsd:num(r.equity_usd),tier:r.tier,metrics:r.metrics,spark:r.spark}));
  }
  async statsCount():Promise<{agents:number;trades:number}> { const r=(await this.q.query<{agents:string;trades:string}>('select (select count(*) from monad.agents) agents,(select count(*) from monad.interactions) trades'))[0];return {agents:num(r.agents),trades:num(r.trades)}; }

  async insertPost(p:Post):Promise<void> { await this.q.query('insert into monad.posts(id,agent_slug,ts_ms,type,data) values($1,$2,$3,$4,$5::text::jsonb)',[p.id,p.agentSlug,p.ts, p.type,JSON.stringify(p)]); }
  async insertCall(c:Call):Promise<void> { await this.q.query('insert into monad.calls(id,agent_slug,ts_ms,expires_ms,data) values($1,$2,$3,$4,$5::text::jsonb)',[c.id,c.agentSlug,c.createdAt,c.expiresAt,JSON.stringify(c)]); }
  async callById(id:string):Promise<Call|undefined> { return (await this.q.query<{data:Call}>('select data from monad.calls where id=$1',[id]))[0]?.data; }
  async calls(agent?:string):Promise<Call[]> { return (await this.q.query<{data:Call}>(`select data from monad.calls ${agent?'where agent_slug=$1':''} order by ts_ms desc,id desc`,agent?[agent]:[])).map(r=>r.data); }
  async feed(o:{filter:'all'|'calls'|'trades'|'thesis';agent?:string;limit:number}):Promise<PostView[]> {
    const conditions:string[]=[];const args:unknown[]=[];
    if(o.agent){args.push(o.agent);conditions.push(`p.agent_slug=$${args.length}`);}
    if(o.filter!=='all'){args.push(o.filter==='calls'?'call':o.filter==='trades'?'trade':'thesis');conditions.push(`p.type=$${args.length}`);}
    args.push(o.limit);
    const rows=await this.q.query<{data:Post;agent:Agent}>(`select p.data,a.data agent from monad.posts p join monad.agents a on a.slug=p.agent_slug ${conditions.length?'where '+conditions.join(' and '):''} order by p.ts_ms desc,p.id desc limit $${args.length}`,args);
    const result:PostView[]=[];
    for(const r of rows){const view:PostView={...r.data,agent:r.agent};if(r.data.interactionId){const i=(await this.q.query<{data:Interaction}>('select data from monad.interactions where id=$1',[r.data.interactionId]))[0]?.data;if(i)view.interaction=i;}if(r.data.callId){const c=await this.callById(r.data.callId);if(c)view.call=c;}result.push(view);}
    return result;
  }
}
