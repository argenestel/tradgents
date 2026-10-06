import { decodeEventLog, getAddress, numberToHex, pad, parseAbi, parseAbiItem, toEventSelector, type Address, type Hex, type PublicClient } from 'viem';
import type { Config } from './config.ts';
import { finalizedBlockNumber, readConfiguredPrice } from './chain.ts';
import { readWalletBalances, snapshotEquity } from './snapshot.ts';
import { replayLedger, type PriceSample, type TxObservation, type TransferDelta } from './ledger.ts';
import { TOKEN_CATALOG, swapTargetsForProfile } from './protocols.ts';
import { Store } from './store.ts';
import type { Db } from './pg.ts';
import type { Agent } from './types.ts';
import { emptyPolicy } from './metrics.ts';
import type { Logger } from 'pino';

export const REGISTRY_EVENTS=parseAbi([
  'event AgentRegistered(address indexed agentWallet,address indexed ownerWallet,bytes32 metadataHash,uint256 bondWei,uint256 nonce)',
  'event UnbondRequested(address indexed agentWallet,uint64 availableAt)',
  'event BondWithdrawn(address indexed agentWallet,address indexed ownerWallet,uint256 amount)',
  'event AgentPaused(address indexed agentWallet,address indexed guardian,bytes32 reason)',
  'event AgentUnpaused(address indexed agentWallet,address indexed guardian)',
  'event AgentSlashed(address indexed agentWallet,address indexed treasury,uint256 amount,bytes32 reasonCode)',
]);
const TRANSFER_ABI=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const WMON_ABI=parseAbi(['event Deposit(address indexed dst,uint256 wad)','event Withdrawal(address indexed src,uint256 wad)']);
const TOKEN_ABI=parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);
const TRANSFER_TOPIC=toEventSelector(parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)'));
const SERIALIZE=(_key:string,v:unknown)=>typeof v==='bigint'?v.toString():v;
const delay=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  if(signal.aborted)return reject(signal.reason);
  const onAbort=()=>{clearTimeout(timer);reject(signal.reason??new Error('aborted'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},ms);
  signal.addEventListener('abort',onAbort,{once:true});
});
const topicAddress=(a:string)=>pad(getAddress(a),{size:32}).toLowerCase() as Hex;
const lower=(s:string)=>s.toLowerCase();

interface TokenMeta {token:string;decimals:number;symbol:string;verified:boolean}
export function priceWithLiquidityFloor<T extends PriceSample>(sample:T,floorUsd:number):T {
  return sample.liquidityUsd!==undefined&&sample.liquidityUsd<floorUsd?{...sample,quality:'estimated'}:sample;
}
interface TraceFrame {from?:string;to?:string;value?:string;type?:string;error?:string;calls?:TraceFrame[]}

export class Indexer {
  private readonly store:Store;
  private readonly tokenCache=new Map<string,TokenMeta>();
  constructor(private readonly db:Db,private readonly client:PublicClient,private readonly config:Config,private readonly logger?:Logger) {this.store=new Store(db);}

  private check(signal?:AbortSignal):void {if(signal?.aborted)throw signal.reason??new Error('indexer lock lost');}
  private async wait<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T> {
    this.check(signal);if(!signal)return promise;
    return new Promise<T>((resolve,reject)=>{
      const abort=()=>{cleanup();reject(signal.reason??new Error('indexer lock lost'));};
      const cleanup=()=>signal.removeEventListener('abort',abort);
      signal.addEventListener('abort',abort,{once:true});
      promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    });
  }
  async backfill(now=Date.now(),signal?:AbortSignal):Promise<{from:number;to:number;applied:number}> {
    this.check(signal);
    const latest=Number(await this.wait(finalizedBlockNumber(this.client),signal));
    await this.scanRegistry(BigInt(latest),now,signal);
    const agents=await this.store.agents(),head=await this.store.indexerHead();
    if(!agents.length){this.check(signal);await this.store.setState('finalized_block',String(latest),now);return {from:latest+1,to:latest,applied:0};}
    const initialized=await this.store.state('agent_index_started');
    const from=initialized?head+1:await this.initialCursor(latest);
    if(from>latest){await this.store.setState('agent_index_started','1',now);return {from,to:latest,applied:0};}
    let applied=0;
    for(let n=from;n<=latest;n++){this.check(signal);applied+=await this.indexBlock(BigInt(n),now,signal);}
    this.check(signal);await this.store.setState('agent_index_started','1',now);
    return {from,to:latest,applied};
  }
  private async initialCursor(latest:number):Promise<number> {
    const agents=await this.store.agents();if(!agents.length)return latest+1;
    // Transaction ingestion is bounded by opening snapshots. Registry history has its own cursor.
    const openings=await Promise.all(agents.map(a=>this.store.opening(a.slug)));
    const first=Math.min(...openings.filter((o):o is NonNullable<typeof o>=>Boolean(o)).map(o=>o.blockNumber));
    return Number.isFinite(first)?Math.max(0,first):latest+1;
  }

  private async agentObservation(agent:Agent,tx:Record<string,unknown>,blockNumber:bigint,blockHash:string,tsMs:number,logs:readonly Record<string,unknown>[],receiptLogs:readonly Record<string,unknown>[],signal?:AbortSignal):Promise<TxObservation> {
    const wallet=lower(agent.wallet),from=lower(String(tx.from)),to=tx.to?lower(String(tx.to)):undefined,success=String((tx as {receiptStatus?:string}).receiptStatus??'success')!=='reverted';
    const deltas:TransferDelta[]=[];
    if(success&&from===wallet&&BigInt(String(tx.value??0))>0n)deltas.push({token:'MON',raw:-BigInt(String(tx.value)),decimals:18,symbol:'MON'});
    if(success&&to===wallet&&BigInt(String(tx.value??0))>0n)deltas.push({token:'MON',raw:BigInt(String(tx.value)),decimals:18,symbol:'MON'});
    let wrap:TxObservation['wrap'];
    for(const log of receiptLogs){
      if(lower(String(log.address))===lower(this.config.profile.wmon)){
        try {
          const event=decodeEventLog({abi:WMON_ABI,data:String(log.data) as Hex,topics:log.topics as never});
          if(event.eventName==='Deposit'&&lower(String(event.args.dst))===wallet)wrap={kind:'deposit',amount:event.args.wad};
          if(event.eventName==='Withdrawal'&&lower(String(event.args.src))===wallet)wrap={kind:'withdrawal',amount:event.args.wad};
        }catch{}
      }
    }
    for(const log of logs){
      try {
        const event=decodeEventLog({abi:TRANSFER_ABI,data:String(log.data) as Hex,topics:log.topics as never});
        const src=lower(String(event.args.from)),dst=lower(String(event.args.to));if(src!==wallet&&dst!==wallet)continue;
        const meta=await this.tokenMeta(String(log.address) as Address,blockNumber);
        const raw=BigInt(event.args.value);
        if(src===wallet)deltas.push({token:meta.token,raw:-raw,decimals:meta.decimals,symbol:meta.symbol});
        if(dst===wallet)deltas.push({token:meta.token,raw,decimals:meta.decimals,symbol:meta.symbol});
      }catch{}
    }
    let internalValueUnknown=false;
    // Trace support is optional. A native-value contract call without an attributable trace is explicitly unsupported.
    let children:TraceFrame[]|undefined;
    try {
      const trace=await this.wait((this.client as unknown as {request:(p:{method:string;params:unknown[]},o?:{signal?:AbortSignal})=>Promise<TraceFrame>}).request({method:'debug_traceTransaction',params:[String(tx.hash),{tracer:'callTracer'}]},{signal}),signal);
      children=trace.calls??[];
      this.collectInternalValue(children,wallet,deltas);
    }catch {
      const knownToken=to===lower(this.config.profile.wmon)||to===lower(this.config.profile.usdc.address),needsTrace=Boolean(to&&swapTargetsForProfile(this.config.profile).has(to))||Boolean(to===lower(this.config.profile.wmon)&&wrap?.kind==='withdrawal');
      let contractTarget=false;
      if(to){try{const code=await this.wait(this.client.getCode({address:getAddress(to),blockNumber}),signal);contractTarget=Boolean(code&&code!=='0x');}catch{if(signal?.aborted)throw signal.reason;contractTarget=true;}}
      if(success&&(needsTrace||contractTarget&&!knownToken||BigInt(String(tx.value??0))>0n&&contractTarget))internalValueUnknown=true;
    }
    const gasLimit=BigInt(String(tx.gas??0)),effective=(tx as {effectiveGasPrice?:bigint;gasPrice?:bigint}).effectiveGasPrice??(tx as {gasPrice?:bigint}).gasPrice;
    if(from===wallet&&tx.gas===undefined)throw new Error('transaction is missing gas limit');
    if(from===wallet&&effective===undefined)throw new Error('receipt is missing effective gas price');
    const receiptGasUsed=(tx as {receiptGasUsed?:bigint}).receiptGasUsed;
    if(receiptGasUsed!==undefined&&receiptGasUsed>gasLimit)throw new Error('receipt gas used exceeds transaction gas limit');
    return {
      hash:String(tx.hash),blockNumber:Number(blockNumber),transactionIndex:Number(tx.transactionIndex??0),blockHash,tsMs,from:getAddress(String(tx.from)),to:tx.to?getAddress(String(tx.to)):null,
      success,gasLimit,effectiveGasPrice:effective??0n,
      value:BigInt(String(tx.value??0)),deltas, ...(wrap?{wrap}:{}),internalValueUnknown,
      dataSelector:String(tx.input??'0x').slice(0,10).toLowerCase(),
    };
  }
  private collectInternalValue(frames:TraceFrame[],wallet:string,deltas:TransferDelta[]):void {
    for(const f of frames){if(f.error){continue;}const value=BigInt(f.value??'0x0');if(value>0n&&f.from&&f.to){
      if(lower(f.from)===wallet)deltas.push({token:'MON',raw:-value,decimals:18,symbol:'MON'});
      if(lower(f.to)===wallet)deltas.push({token:'MON',raw:value,decimals:18,symbol:'MON'});
    }if(f.calls)this.collectInternalValue(f.calls,wallet,deltas);}
  }
  private async walletLogs(blockNumber:bigint,topics:[Hex,Hex|null,Hex|null],signal?:AbortSignal):Promise<Record<string,unknown>[]> {
    const request=(this.client as unknown as {request:(p:{method:string;params:unknown[]},o?:{signal?:AbortSignal})=>Promise<Record<string,unknown>[]>}).request;
    return this.wait(request({method:'eth_getLogs',params:[{fromBlock:numberToHex(blockNumber),toBlock:numberToHex(blockNumber),topics}]},{signal}),signal);
  }
  private async tokenMeta(address:Address,blockNumber:bigint,signal?:AbortSignal):Promise<TokenMeta> {
    const a=lower(address),cached=this.tokenCache.get(a);if(cached)return cached;
    if(a===lower(this.config.profile.wmon)){const m={token:'WMON',decimals:18,symbol:'WMON',verified:true};this.tokenCache.set(a,m);return m;}
    if(a===lower(this.config.profile.usdc.address)){const m={token:'USDC',decimals:this.config.profile.usdc.decimals,symbol:'USDC',verified:true};this.tokenCache.set(a,m);return m;}
    let decimals=18,symbol=`TOKEN-${a.slice(2,8)}`,verified=false;
    try{decimals=Number(await this.wait(this.client.readContract({address,abi:TOKEN_ABI,functionName:'decimals',blockNumber}),signal));verified=Number.isInteger(decimals)&&decimals>=0&&decimals<=36;}catch{if(signal?.aborted)throw signal.reason;}
    try{symbol=String(await this.wait(this.client.readContract({address,abi:TOKEN_ABI,functionName:'symbol',blockNumber}),signal));}catch{if(signal?.aborted)throw signal.reason;}
    const m={token:a,decimals,symbol,verified};this.tokenCache.set(a,m);return m;
  }
  private async registrationFor(decoded:{args:Record<string,unknown>},blockNumber:bigint,signal?:AbortSignal):Promise<{agent:Agent;opening:import('./store.ts').Opening}> {
    const wallet=getAddress(String(decoded.args.agentWallet));
    const block=await this.wait(this.client.getBlock({blockNumber}),signal);
    const balances=await this.wait(readWalletBalances(this.client,wallet,blockNumber,this.config.trackedTokens,this.config.profile),signal);
    const [mon,usdc]=await Promise.all([
      this.wait(readConfiguredPrice(this.client,this.config,'MON',Number(block.timestamp)*1000,blockNumber),signal),
      this.wait(readConfiguredPrice(this.client,this.config,'USDC',Number(block.timestamp)*1000,blockNumber),signal),
    ]);
    const tokenDecimals=Object.fromEntries(this.config.trackedTokens.map(t=>[t.address.toLowerCase(),t.decimals]));
    const prices:Record<string,number>={MON:mon.usd,WMON:mon.usd,USDC:usdc.usd};
    const opening={blockNumber:Number(blockNumber),blockHash:String(block.hash),tsMs:Number(block.timestamp)*1000,balances,tokenDecimals,prices,priceQuality:{MON:mon.quality,WMON:mon.quality,USDC:usdc.quality}};
    const slug=`agent-${wallet.slice(2).toLowerCase()}`;
    const agent:Agent={slug,name:slug,bio:'',runtime:'custom',verification:'wallet_signed',strategyLabel:'',wallet:wallet.toLowerCase(),owner:getAddress(String(decoded.args.ownerWallet)).toLowerCase(),accountType:'eoa',protocols:[],startedAt:opening.tsMs,startCapitalUsd:snapshotEquity(balances,prices,tokenDecimals),status:'live',bondMon:Number(BigInt(String(decoded.args.bondWei)))/1e18,policy:emptyPolicy(),approvals:[],fingerprint:{avgHoldHours:0,avgLeverage:1,tradesPerDay:0}};
    return {agent,opening};
  }
  private async scanRegistry(latest:bigint,now:number,signal?:AbortSignal):Promise<void> {
    let from=Number(await this.store.state('registry_block')??-1)+1;
    const latestNumber=Number(latest);if(from>latestNumber)return;
    while(from<=latestNumber){
      this.check(signal);const to=Math.min(latestNumber,from+1999);
      const logs=await this.wait(this.client.getLogs({address:this.config.registryAddress,fromBlock:BigInt(from),toBlock:BigInt(to)}),signal);
      const events:Array<{log:typeof logs[number];decoded:{eventName:string;args:Record<string,unknown>}}> = [];
      for(const log of logs){try{events.push({log,decoded:decodeEventLog({abi:REGISTRY_EVENTS,data:log.data,topics:log.topics as never}) as unknown as {eventName:string;args:Record<string,unknown>}});}catch{}}
      events.sort((a,b)=>Number(a.log.blockNumber)-Number(b.log.blockNumber)||Number(a.log.logIndex)-Number(b.log.logIndex));
      const known=new Set((await this.store.agents()).map(a=>a.wallet.toLowerCase()));
      const registrations=new Map<string,{agent:Agent;opening:import('./store.ts').Opening}>();
      for(const {log,decoded} of events){
        this.check(signal);if(decoded.eventName!=='AgentRegistered')continue;
        const wallet=getAddress(String(decoded.args.agentWallet)),key=wallet.toLowerCase();if(known.has(key))continue;
        const registration=await this.registrationFor(decoded,log.blockNumber!,signal);registrations.set(key,registration);known.add(key);
      }
      await this.db.tx(async q=>{
        const s=new Store(this.db,q),affected=new Set<string>();this.check(signal);
        for(const {log,decoded} of events){
          this.check(signal);const wallet=String(decoded.args.agentWallet??'').toLowerCase(),registration=registrations.get(wallet);
          if(registration)await s.putIndexedRegistration(registration.agent,registration.opening);
          await s.putRawLog({chainId:this.config.chainId,txHash:String(log.transactionHash),logIndex:Number(log.logIndex),blockNumber:Number(log.blockNumber),blockHash:String(log.blockHash),address:String(log.address),topic0:String(log.topics[0]),topics:log.topics.map(String),data:String(log.data) as Hex,status:'finalized'});
          await s.applyRegistryEvent(decoded.eventName,decoded.args, String(log.transactionHash));
          if(registration)affected.add(registration.agent.slug);else {const existing=await s.agentByWallet(wallet);if(existing)affected.add(existing.slug);}
        }
        await s.setState('registry_block',String(to),now);
        for(const slug of affected){this.check(signal);await s.rebuildStats(slug,now);}
        this.check(signal);
      });
      from=to+1;
    }
  }

  private async compareBalances(agent:Agent,replayed:Map<string,bigint>,blockNumber:bigint,signal?:AbortSignal):Promise<{ok:boolean;differences:Record<string,{replayed:string;chain:string}>}> {
    try{
      const actual=await this.wait(readWalletBalances(this.client,getAddress(agent.wallet),blockNumber,this.config.trackedTokens,this.config.profile),signal);
      const chain=new Map<string,bigint>(Object.entries(actual).map(([token,raw])=>[token,BigInt(raw)]));
      for(const token of replayed.keys()){
        if(!/^0x[0-9a-f]{40}$/i.test(token)||chain.has(token))continue;
        const raw=await this.wait(this.client.readContract({address:getAddress(token),abi:TOKEN_ABI,functionName:'balanceOf',args:[getAddress(agent.wallet)],blockNumber}),signal);
        chain.set(token,raw);
      }
      const differences:Record<string,{replayed:string;chain:string}>={};
      for(const token of new Set([...replayed.keys(),...chain.keys()])){
        const replayRaw=replayed.get(token)??0n,chainRaw=chain.get(token)??0n;
        if(replayRaw!==chainRaw)differences[token]={replayed:replayRaw.toString(),chain:chainRaw.toString()};
      }
      return {ok:Object.keys(differences).length===0,differences};
    }catch(error){if(signal?.aborted)throw signal.reason;return {ok:false,differences:{__rpc:{replayed:'unavailable',chain:error instanceof Error?error.name:'error'}}};}
  }

  private async indexBlock(blockNumber:bigint,now:number,signal?:AbortSignal):Promise<number> {
    this.check(signal);
    const block=await this.wait(this.client.getBlock({blockNumber,includeTransactions:true}),signal);
    const agents=await this.store.agents();
    const openings=new Map<string,Awaited<ReturnType<Store['opening']>>>();
    for(const agent of agents)openings.set(agent.slug,await this.store.opening(agent.slug));
    const byWallet=new Map(agents.map(a=>[lower(a.wallet),a]));
    const relevantAgents=agents.filter(a=>Number(blockNumber)>(openings.get(a.slug)?.blockNumber??0));
    const wallets=relevantAgents.map(a=>a.wallet);
    const logsByHash=new Map<string,Record<string,unknown>[]>();
    for(const wallet of wallets){
      for(const topics of [[TRANSFER_TOPIC,topicAddress(wallet),null],[TRANSFER_TOPIC,null,topicAddress(wallet)]] as const){
        const logs=await this.walletLogs(blockNumber,topics as unknown as [Hex,Hex|null,Hex|null],signal);
        for(const log of logs){const hash=lower(String(log.transactionHash));const list=logsByHash.get(hash)??[];list.push(log as unknown as Record<string,unknown>);logsByHash.set(hash,list);}
      }
    }
    const txs=block.transactions as unknown as Record<string,unknown>[];
    const selected=new Map<string,Record<string,unknown>>();
    for(const tx of txs){const hash=lower(String(tx.hash));if(byWallet.has(lower(String(tx.from)))||Boolean(tx.to&&byWallet.has(lower(String(tx.to))))||logsByHash.has(hash))selected.set(hash,tx);}
    const observations:{agent:Agent;observation:TxObservation;tx:Record<string,unknown>;receipt:unknown;logs:Record<string,unknown>[];receiptLogs:readonly Record<string,unknown>[]}[]=[];
    for(const [hash,tx] of selected){
      const receipt=await this.wait(this.client.getTransactionReceipt({hash:hash as Hex}),signal);
      const fullTx={...tx,effectiveGasPrice:receipt.effectiveGasPrice,receiptStatus:receipt.status,receiptGasUsed:receipt.gasUsed};
      for(const agent of relevantAgents){
        const wallet=lower(agent.wallet);
        const logs=(logsByHash.get(hash)??[]).filter(l=>{try{const ev=decodeEventLog({abi:TRANSFER_ABI,data:String(l.data) as Hex,topics:l.topics as never});return lower(String(ev.args.from))===wallet||lower(String(ev.args.to))===wallet;}catch{return false;}});
        const touches=lower(String(tx.from))===wallet||Boolean(tx.to&&lower(String(tx.to))===wallet)||logs.length>0;
        if(!touches)continue;
        // A tx with a tracked ERC-20 transfer may be submitted by an EntryPoint/paymaster; do not pretend its fee payer is the wallet.
        const receiptLogs=((receipt as {logs?:readonly Record<string,unknown>[]}).logs??[]);
        const observation=await this.agentObservation(agent,fullTx,blockNumber,String(block.hash),Number(block.timestamp)*1000,logs,receiptLogs,signal);
        if(lower(String(tx.from))!==wallet&&logs.some(l=>{try{return lower(String(decodeEventLog({abi:TRANSFER_ABI,data:String(l.data) as Hex,topics:l.topics as never}).args.from))===wallet;}catch{return false;}}))observation.internalValueUnknown=true;
        observations.push({agent,observation,tx:fullTx,receipt,logs,receiptLogs});
      }
    }
    const affected=new Set(observations.map(x=>x.agent.slug));
    await this.db.tx(async q=>{
      const s=new Store(this.db,q);this.check(signal);
      for(const item of observations){
        this.check(signal);
        await s.putRawTransaction({txHash:item.observation.hash,agentSlug:item.agent.slug,blockNumber:Number(blockNumber),blockHash:String(block.hash),tsMs:item.observation.tsMs,transaction:{observation:JSON.parse(JSON.stringify(item.observation,SERIALIZE)),transaction:JSON.parse(JSON.stringify(item.tx,SERIALIZE))},receipt:JSON.parse(JSON.stringify(item.receipt,SERIALIZE)),status:'finalized'});
        const rawLogs=new Map<number,Record<string,unknown>>();
        for(const log of item.logs)rawLogs.set(Number(log.logIndex),log);
        for(const log of item.receiptLogs)if(lower(String(log.address))===lower(this.config.profile.wmon))rawLogs.set(Number(log.logIndex),log);
        for(const log of rawLogs.values()){
          this.check(signal);
          await s.putRawLog({chainId:this.config.chainId,txHash:String(log.transactionHash),logIndex:Number(log.logIndex),blockNumber:Number(blockNumber),blockHash:String(block.hash),address:String(log.address),topic0:String((log.topics as string[])[0]),topics:(log.topics as string[]),data:String(log.data) as Hex,status:'finalized'});
        }
      }
      await s.setState('finalized_block',String(blockNumber),now);
      const samples=await s.storedPriceSamples();
      for(const slug of affected){
        const agent=await s.agent(slug);if(!agent)continue;
        const opening=await s.opening(slug);if(!opening)continue;
        const txs=observations.filter(x=>x.agent.slug===slug).map(x=>x.observation);
        const current=await s.latestBalances(slug),openingBalances=Object.fromEntries(Object.entries(current).map(([k,v])=>[k,BigInt(v)])),lots=await s.lots(slug);
        const tokenDecimals=new Map<string,number>(Object.entries(opening.tokenDecimals??{}));
        for(const o of txs)for(const d of o.deltas)tokenDecimals.set(d.token,d.decimals);
        for(const token of Object.keys(openingBalances))if(/^0x[0-9a-f]{40}$/i.test(token)&&!tokenDecimals.has(token))tokenDecimals.set(token,(await this.tokenMeta(getAddress(token),blockNumber,signal)).decimals);
        const maxPriceAgeMs={MON:this.config.monPriceStaleMs,WMON:this.config.monPriceStaleMs,USDC:this.config.usdcPriceStaleMs};
        let result=replayLedger({agentSlug:slug,wallet:getAddress(agent.wallet),opening:openingBalances,openingTsMs:opening.tsMs,openingLots:lots,tokenDecimals:Object.fromEntries(tokenDecimals),transactions:txs,samples,maxPriceAgeMs,profile:this.config.profile});
        const at=Number(block.timestamp)*1000,monPrice=(await s.nearestPrice('MON',at))?.usd??opening.prices.MON??0;
        let comparison=await this.compareBalances(agent,result.balances,blockNumber,signal);
        const rebuild=!comparison.ok||await s.integrityDrifted(slug);
        let allTransactions=txs;
        if(rebuild){
          if(!comparison.ok)this.logger?.warn({agentSlug:slug,differences:comparison.differences},'ledger balance drift detected; rebuilding from raw transactions');
          allTransactions=(await s.rawObservations(slug)).filter(o=>o.blockNumber>opening.blockNumber);
          const openingBalances=Object.fromEntries(Object.entries(opening.balances).map(([k,v])=>[k,BigInt(v)]));
          result=replayLedger({agentSlug:slug,wallet:getAddress(agent.wallet),opening:openingBalances,openingTsMs:opening.tsMs,tokenDecimals:Object.fromEntries(tokenDecimals),transactions:allTransactions,samples,maxPriceAgeMs,profile:this.config.profile});
          comparison=await this.compareBalances(agent,result.balances,blockNumber,signal);
          if(!comparison.ok)this.logger?.error({agentSlug:slug,differences:comparison.differences},'rebuilt ledger still differs from chain');
        }
        const integrityOk=comparison.ok;
        const flowUsd=txs.reduce((sum,o)=>sum+(result.flowsByTx.get(o.hash)??0),0);
        const balances=Object.fromEntries([...result.balances].map(([k,v])=>[k,v.toString()]));
        if(rebuild)await s.replaceReplay(slug,result.entries,result.lots,result.interactions,at,Number(blockNumber),result.equityUsd,monPrice,balances,result.unpriced,integrityOk,flowUsd,comparison.differences,signal);
        else await s.applyReplay(slug,result.entries,result.lots,result.interactions,txs,at,Number(blockNumber),result.equityUsd,monPrice,balances,result.unpriced,integrityOk,flowUsd,comparison.differences,signal);
      }
      this.check(signal);
    });
    return observations.length;
  }

  async markAll(now=Date.now(),signal?:AbortSignal):Promise<void> {
    this.check(signal);
    const block=await this.wait(this.client.getBlock({blockTag:'finalized'}),signal),blockNumber=Number(block.number),tsMs=Number(block.timestamp)*1000;
    const s=new Store(this.db),samples=await s.storedPriceSamples(),agents=await s.agents();
    const maxPriceAgeMs={MON:this.config.monPriceStaleMs,WMON:this.config.monPriceStaleMs,USDC:this.config.usdcPriceStaleMs};
    for(const agent of agents){
      this.check(signal);const opening=await s.opening(agent.slug);if(!opening)continue;
      const observations=await s.rawObservations(agent.slug);
      const result=replayLedger({agentSlug:agent.slug,wallet:getAddress(agent.wallet),opening:Object.fromEntries(Object.entries(opening.balances).map(([k,v])=>[k,BigInt(v)])),openingTsMs:opening.tsMs,tokenDecimals:opening.tokenDecimals,transactions:observations.filter(o=>o.blockNumber>opening.blockNumber),samples,maxPriceAgeMs,profile:this.config.profile});
      const decimals=new Map<string,number>(Object.entries(opening.tokenDecimals??{}));
      for(const o of observations)for(const d of o.deltas)decimals.set(d.token,d.decimals);
      const comparison=await this.compareBalances(agent,result.balances,block.number,signal),integrityOk=comparison.ok;
      if(!integrityOk)this.logger?.error({agentSlug:agent.slug,differences:comparison.differences},'full ledger rebuild still differs from chain');
      let equityUsd=0;const unpriced:string[]=[];
      for(const [token,raw] of result.balances){
        if(raw===0n)continue;
        const sample=samples.filter(p=>p.token===token).sort((a,b)=>Math.abs(a.tsMs-tsMs)-Math.abs(b.tsMs-tsMs)||a.tsMs-b.tsMs)[0];
        const dp=decimals.get(token)??(token==='USDC'?TOKEN_CATALOG.USDC.decimals:18),age=token==='USDC'?this.config.usdcPriceStaleMs:this.config.monPriceStaleMs;
        if(!sample||Math.abs(sample.tsMs-tsMs)>age){unpriced.push(token);continue;}
        if(sample.quality!=='oracle')unpriced.push(token);
        equityUsd+=Number(raw.toString())/10**dp*sample.usd;
      }
      const monPrice=samples.filter(p=>p.token==='MON').sort((a,b)=>Math.abs(a.tsMs-tsMs)-Math.abs(b.tsMs-tsMs)||a.tsMs-b.tsMs)[0]?.usd??opening.prices.MON??0;
      const balances=Object.fromEntries([...result.balances].map(([k,v])=>[k,v.toString()]));
      await s.replaceReplay(agent.slug,result.entries,result.lots,result.interactions,tsMs,blockNumber,equityUsd,monPrice,balances,[...new Set(unpriced)].sort(),integrityOk,0,comparison.differences,signal);
    }
    this.check(signal);await s.setState('last_mark_ms',String(now),now);
  }
  async samplePrices(now=Date.now(),signal?:AbortSignal):Promise<void> {
    this.check(signal);const samples:PriceSample[]=[],finalized=await this.wait(finalizedBlockNumber(this.client),signal);
    for(const token of ['MON','USDC'] as const){
      const sample=await this.wait(readConfiguredPrice(this.client,this.config,token,now,finalized),signal);
      samples.push(priceWithLiquidityFloor({...sample,token},this.config.minLiquidityUsd));
    }
    samples.push({...samples[0],token:'WMON'});
    await this.db.tx(async q=>{const s=new Store(this.db,q);for(const p of samples){this.check(signal);await s.putPriceSample(p);}this.check(signal);});
  }
  async run(signal:AbortSignal):Promise<void> {
    let lastPrice=0,lastMark=Number(await this.store.state('last_mark_ms')??0),failures=0,circuitUntil=0;
    while(!signal.aborted){
      const started=Date.now();let retryDelay=0;
      if(started<circuitUntil){retryDelay=circuitUntil-started;}
      else try{
        if(started-lastPrice>60_000){await this.samplePrices(started,signal);lastPrice=started;}
        await this.backfill(started,signal);
        if(started-lastMark>=3_600_000){await this.markAll(started,signal);lastMark=started;}
        failures=0;
      }catch(error){
        if(signal.aborted)throw signal.reason??error;
        failures++;retryDelay=Math.min(30_000,Math.max(this.config.indexerPollMs,500)*2**Math.min(failures-1,6));
        if(failures>=5){circuitUntil=Date.now()+retryDelay;this.logger?.warn({circuitOpenMs:retryDelay},'RPC/database circuit breaker opened');failures=0;}
        this.logger?.error({error:error instanceof Error?error.name:'unknown'},'indexer tick failed');
      }
      await delay(Math.max(300,this.config.indexerPollMs-(Date.now()-started),retryDelay),signal);
    }
  }
}

export async function runIndexer(db:Db,client:PublicClient,config:Config,logger?:Logger,signal?:AbortSignal):Promise<void> {
  const controller=new AbortController();let lockLost=false;
  if(signal?.aborted)controller.abort(signal.reason);else signal?.addEventListener('abort',()=>controller.abort(signal.reason),{once:true});
  const indexer=new Indexer(db,client,config,logger);
  try{
    const locked=await db.withAdvisoryLock(config.chainId,()=>indexer.run(controller.signal),{wait:false,onLost:err=>{lockLost=true;controller.abort(err);}});
    if(locked===undefined)throw new Error('another Monad indexer holds the advisory lock');
  }catch(error){if(signal?.aborted&&!lockLost)return;throw error;}
}
