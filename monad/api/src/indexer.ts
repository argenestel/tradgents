import { decodeEventLog, getAddress, numberToHex, pad, parseAbi, parseAbiItem, toEventSelector, type Address, type Hex, type PublicClient } from 'viem';
import type { Config } from './config.ts';
import { finalizedBlockNumber, readPythPrice } from './chain.ts';
import { readWalletBalances } from './snapshot.ts';
import { replayLedger, type PriceSample, type TxObservation, type TransferDelta } from './ledger.ts';
import { SUPPORTED_SWAP_TARGETS, TOKEN_CATALOG, USDC, WMON } from './protocols.ts';
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
interface TraceFrame {from?:string;to?:string;value?:string;type?:string;error?:string;calls?:TraceFrame[]}

export class Indexer {
  private readonly store:Store;
  private readonly tokenCache=new Map<string,TokenMeta>();
  constructor(private readonly db:Db,private readonly client:PublicClient,private readonly config:Config,private readonly logger?:Logger) {this.store=new Store(db);}

  async backfill(now=Date.now()):Promise<{from:number;to:number;applied:number}> {
    const latest=Number(await finalizedBlockNumber(this.client)),head=await this.store.indexerHead();
    const from=head===0?await this.initialCursor(latest):head+1;
    if(from>latest)return {from,to:latest,applied:0};
    let applied=0;
    for(let n=from;n<=latest;n++)applied+=await this.indexBlock(BigInt(n),now);
    return {from,to:latest,applied};
  }
  private async initialCursor(latest:number):Promise<number> {
    const agents=await this.store.agents();if(!agents.length)return latest+1;
    // Registration snapshots bound the first scan; never import pre-registration history.
    const openings=await Promise.all(agents.map(a=>this.store.opening(a.slug)));
    const first=Math.min(...openings.filter((o):o is NonNullable<typeof o>=>Boolean(o)).map(o=>o.blockNumber));
    return Number.isFinite(first)?Math.max(0,first):latest+1;
  }

  private async agentObservation(agent:Agent,tx:Record<string,unknown>,blockNumber:bigint,blockHash:string,tsMs:number,logs:readonly Record<string,unknown>[]):Promise<TxObservation> {
    const wallet=lower(agent.wallet),from=lower(String(tx.from)),to=tx.to?lower(String(tx.to)):undefined,success=String((tx as {receiptStatus?:string}).receiptStatus??'success')!=='reverted';
    const deltas:TransferDelta[]=[];
    if(success&&from===wallet&&BigInt(String(tx.value??0))>0n)deltas.push({token:'MON',raw:-BigInt(String(tx.value)),decimals:18,symbol:'MON'});
    if(success&&to===wallet&&BigInt(String(tx.value??0))>0n)deltas.push({token:'MON',raw:BigInt(String(tx.value)),decimals:18,symbol:'MON'});
    let wrap:TxObservation['wrap'];
    for(const log of logs){
      if(lower(String(log.address))===lower(WMON)){
        try {
          const event=decodeEventLog({abi:WMON_ABI,data:String(log.data) as Hex,topics:log.topics as never});
          if(event.eventName==='Deposit'&&lower(String(event.args.dst))===wallet)wrap={kind:'deposit',amount:event.args.wad};
          if(event.eventName==='Withdrawal'&&lower(String(event.args.src))===wallet)wrap={kind:'withdrawal',amount:event.args.wad};
        }catch{}
      }
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
      const trace=await (this.client as unknown as {request:(p:{method:string;params:unknown[]})=>Promise<TraceFrame>}).request({method:'debug_traceTransaction',params:[String(tx.hash),{tracer:'callTracer'}]});
      children=trace.calls??[];
      this.collectInternalValue(children,wallet,deltas);
    }catch {
      const knownToken=to===lower(WMON)||to===lower(USDC),needsTrace=Boolean(to&&SUPPORTED_SWAP_TARGETS.has(to))||Boolean(to===lower(WMON)&&wrap?.kind==='withdrawal');
      let contractTarget=false;
      if(to){try{const code=await this.client.getCode({address:getAddress(to),blockNumber});contractTarget=Boolean(code&&code!=='0x');}catch{contractTarget=true;}}
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
  private async walletLogs(blockNumber:bigint,topics:[Hex,Hex|null,Hex|null]):Promise<Record<string,unknown>[]> {
    const request=(this.client as unknown as {request:(p:{method:string;params:unknown[]})=>Promise<Record<string,unknown>[]>}).request;
    return request({method:'eth_getLogs',params:[{fromBlock:numberToHex(blockNumber),toBlock:numberToHex(blockNumber),topics}]});
  }
  private async tokenMeta(address:Address,blockNumber:bigint):Promise<TokenMeta> {
    const a=lower(address),cached=this.tokenCache.get(a);if(cached)return cached;
    if(a===lower(WMON)){const m={token:'WMON',decimals:18,symbol:'WMON',verified:true};this.tokenCache.set(a,m);return m;}
    if(a===lower(USDC)){const m={token:'USDC',decimals:6,symbol:'USDC',verified:true};this.tokenCache.set(a,m);return m;}
    let decimals=18,symbol=`TOKEN-${a.slice(2,8)}`,verified=false;
    try{decimals=Number(await this.client.readContract({address,abi:TOKEN_ABI,functionName:'decimals',blockNumber}));verified=Number.isInteger(decimals)&&decimals>=0&&decimals<=36;}catch{}
    try{symbol=String(await this.client.readContract({address,abi:TOKEN_ABI,functionName:'symbol',blockNumber}));}catch{}
    const m={token:a,decimals,symbol,verified};this.tokenCache.set(a,m);return m;
  }

  private async indexBlock(blockNumber:bigint,now:number):Promise<number> {
    const block=await this.client.getBlock({blockNumber,includeTransactions:true});
    const agents=await this.store.agents();
    const openings=new Map<string,Awaited<ReturnType<Store['opening']>>>();
    for(const agent of agents)openings.set(agent.slug,await this.store.opening(agent.slug));
    const byWallet=new Map(agents.map(a=>[lower(a.wallet),a]));
    const relevantAgents=agents.filter(a=>Number(blockNumber)>(openings.get(a.slug)?.blockNumber??0));
    const wallets=relevantAgents.map(a=>a.wallet);
    const logsByHash=new Map<string,Record<string,unknown>[]>();
    for(const wallet of wallets){
      for(const topics of [[TRANSFER_TOPIC,topicAddress(wallet),null],[TRANSFER_TOPIC,null,topicAddress(wallet)]] as const){
        const logs=await this.walletLogs(blockNumber,topics as unknown as [Hex,Hex|null,Hex|null]);
        for(const log of logs){const hash=lower(String(log.transactionHash));const list=logsByHash.get(hash)??[];list.push(log as unknown as Record<string,unknown>);logsByHash.set(hash,list);}
      }
    }
    const txs=block.transactions as unknown as Record<string,unknown>[];
    const selected=new Map<string,Record<string,unknown>>();
    for(const tx of txs){const hash=lower(String(tx.hash));if(byWallet.has(lower(String(tx.from)))||Boolean(tx.to&&byWallet.has(lower(String(tx.to))))||logsByHash.has(hash))selected.set(hash,tx);}
    const observations:{agent:Agent;observation:TxObservation;tx:Record<string,unknown>;receipt:unknown;logs:Record<string,unknown>[]}[]=[];
    for(const [hash,tx] of selected){
      const receipt=await this.client.getTransactionReceipt({hash:hash as Hex});
      const fullTx={...tx,effectiveGasPrice:receipt.effectiveGasPrice,receiptStatus:receipt.status,receiptGasUsed:receipt.gasUsed};
      for(const agent of relevantAgents){
        const wallet=lower(agent.wallet);
        const logs=(logsByHash.get(hash)??[]).filter(l=>{try{const ev=decodeEventLog({abi:TRANSFER_ABI,data:String(l.data) as Hex,topics:l.topics as never});return lower(String(ev.args.from))===wallet||lower(String(ev.args.to))===wallet;}catch{return false;}});
        const touches=lower(String(tx.from))===wallet||Boolean(tx.to&&lower(String(tx.to))===wallet)||logs.length>0;
        if(!touches)continue;
        // A tx with a tracked ERC-20 transfer may be submitted by an EntryPoint/paymaster; do not pretend its fee payer is the wallet.
        const observation=await this.agentObservation(agent,fullTx,blockNumber,String(block.hash),Number(block.timestamp)*1000,logs);
        if(lower(String(tx.from))!==wallet&&logs.some(l=>{try{return lower(String(decodeEventLog({abi:TRANSFER_ABI,data:String(l.data) as Hex,topics:l.topics as never}).args.from))===wallet;}catch{return false;}}))observation.internalValueUnknown=true;
        observations.push({agent,observation,tx:fullTx,receipt,logs});
      }
    }
    const registryLogs=await this.client.getLogs({address:this.config.registryAddress,fromBlock:blockNumber,toBlock:blockNumber});
    const registryEvents:Array<{log:(typeof registryLogs)[number];decoded:{eventName:string;args:Record<string,unknown>}}>=[];
    for(const log of registryLogs){try{registryEvents.push({log,decoded:decodeEventLog({abi:REGISTRY_EVENTS,data:log.data,topics:log.topics as never}) as unknown as {eventName:string;args:Record<string,unknown>}});}catch{}}
    const indexedRegistrations=new Map<string,{agent:Agent;opening:import('./store.ts').Opening}>();
    for(const {decoded} of registryEvents){
      if(decoded.eventName!=='AgentRegistered')continue;
      const wallet=getAddress(String(decoded.args.agentWallet));
      if(await this.store.agentByWallet(wallet))continue;
      const registrationBlock=await this.client.getBlock({blockNumber});
      const balances=await readWalletBalances(this.client,wallet,blockNumber,this.config.trackedTokens);
      const [mon,usdc]=await Promise.all([readPythPrice(this.client,this.config.monadPriceFeedId,Number(registrationBlock.timestamp)*1000,this.config.priceStaleMs,blockNumber),readPythPrice(this.client,this.config.usdcPriceFeedId,Number(registrationBlock.timestamp)*1000,this.config.priceStaleMs,blockNumber)]);
      const prices:Record<string,number>={MON:mon.usd,WMON:mon.usd,USDC:usdc.usd},opening={blockNumber:Number(blockNumber),blockHash:String(registrationBlock.hash),tsMs:Number(registrationBlock.timestamp)*1000,balances,tokenDecimals:Object.fromEntries(this.config.trackedTokens.map(t=>[t.address.toLowerCase(),t.decimals])),prices,priceQuality:{MON:mon.quality,WMON:mon.quality,USDC:usdc.quality}};
      const slug=`agent-${wallet.slice(2).toLowerCase()}`,agent:Agent={slug,name:slug,bio:'',runtime:'custom',verification:'wallet_signed',strategyLabel:'',wallet:wallet.toLowerCase(),owner:getAddress(String(decoded.args.ownerWallet)).toLowerCase(),accountType:'eoa',protocols:[],startedAt:opening.tsMs,startCapitalUsd:Object.entries(balances).reduce((sum,[token,raw])=>sum+Number(BigInt(raw))/10**(token==='USDC'?6:18)*(prices[token]??0),0),status:'live',bondMon:Number(BigInt(String(decoded.args.bondWei)))/1e18,policy:emptyPolicy(),approvals:[],fingerprint:{avgHoldHours:0,avgLeverage:1,tradesPerDay:0}};
      indexedRegistrations.set(wallet.toLowerCase(),{agent,opening});
    }
    const affected=new Set(observations.map(x=>x.agent.slug)),registryAffected=new Set<string>();
    for(const {decoded} of registryEvents){
      const wallet=String(decoded.args.agentWallet??'').toLowerCase(),indexed=indexedRegistrations.get(wallet);
      const existing=indexed?undefined:await this.store.agentByWallet(wallet);
      if(indexed)registryAffected.add(indexed.agent.slug);else if(existing)registryAffected.add(existing.slug);
    }
    await this.db.tx(async q=>{
      const s=new Store(this.db,q);
      for(const item of observations){
        await s.putRawTransaction({txHash:item.observation.hash,agentSlug:item.agent.slug,blockNumber:Number(blockNumber),blockHash:String(block.hash),tsMs:item.observation.tsMs,transaction:{observation:JSON.parse(JSON.stringify(item.observation,SERIALIZE)),transaction:JSON.parse(JSON.stringify(item.tx,SERIALIZE))},receipt:JSON.parse(JSON.stringify(item.receipt,SERIALIZE)),status:'finalized'});
        for(const log of item.logs){
          await s.putRawLog({chainId:this.config.chainId,txHash:String(log.transactionHash),logIndex:Number(log.logIndex),blockNumber:Number(blockNumber),blockHash:String(block.hash),address:String(log.address),topic0:String((log.topics as string[])[0]),topics:log.topics as string[],data:String(log.data) as Hex,status:'finalized'});
        }
      }
      for(const {log,decoded} of registryEvents){
        if(decoded.eventName==='AgentRegistered'){
          const registration=indexedRegistrations.get(String(decoded.args.agentWallet).toLowerCase());
          if(registration)await s.putIndexedRegistration(registration.agent,registration.opening);
        }
        await s.putRawLog({chainId:this.config.chainId,txHash:log.transactionHash!,logIndex:log.logIndex!,blockNumber:Number(blockNumber),blockHash:String(block.hash),address:log.address,topic0:String(log.topics[0]),topics:log.topics as string[],data:log.data,status:'finalized'});
        await s.applyRegistryEvent(decoded.eventName,decoded.args as Record<string,unknown>,log.transactionHash!);
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
        for(const token of Object.keys(openingBalances))if(/^0x[0-9a-f]{40}$/i.test(token)&&!tokenDecimals.has(token))tokenDecimals.set(token,(await this.tokenMeta(getAddress(token),blockNumber)).decimals);
        const result=replayLedger({agentSlug:slug,wallet:getAddress(agent.wallet),opening:openingBalances,openingTsMs:opening.tsMs,openingLots:lots,tokenDecimals:Object.fromEntries(tokenDecimals),transactions:txs,samples,maxPriceAgeMs:this.config.priceStaleMs});
        const at=Number(block.timestamp)*1000,monPrice=(await s.nearestPrice('MON',at))?.usd??opening.prices.MON??0;
        let integrityOk=true;
        try{
          const actual=await readWalletBalances(this.client,getAddress(agent.wallet),blockNumber,this.config.trackedTokens);
          for(const [token,raw] of Object.entries(actual))if((result.balances.get(token)??0n)!==BigInt(raw))integrityOk=false;
          for(const token of result.balances.keys()){
            if(!/^0x[0-9a-f]{40}$/i.test(token)||token===lower(WMON)||token===lower(USDC)||Object.hasOwn(actual,token))continue;
            const raw=await this.client.readContract({address:getAddress(token),abi:TOKEN_ABI,functionName:'balanceOf',args:[getAddress(agent.wallet)],blockNumber});
            if((result.balances.get(token)??0n)!==raw)integrityOk=false;
          }
        }catch{integrityOk=false;}
        const unpriced=result.unpriced;
        const flowUsd=observations.filter(x=>x.agent.slug===slug&&x.observation.blockNumber===Number(blockNumber)).reduce((sum,x)=>sum+(result.flowsByTx.get(x.observation.hash)??0),0);
        await s.applyReplay(slug,result.entries,result.lots,result.interactions,txs,at,Number(blockNumber),result.equityUsd,monPrice,Object.fromEntries([...result.balances].map(([k,v])=>[k,v.toString()])),unpriced,integrityOk,flowUsd);
      }
      for(const slug of registryAffected)await s.rebuildStats(slug,now);
    });
    return observations.length+registryEvents.length;
  }

  async markAll(now=Date.now()):Promise<void> {
    const block=await this.client.getBlock({blockTag:'finalized'}),blockNumber=Number(block.number),tsMs=Number(block.timestamp)*1000;
    const s=new Store(this.db),samples=await s.storedPriceSamples(),agents=await s.agents();
    for(const agent of agents){
      const opening=await s.opening(agent.slug);if(!opening)continue;
      const observations=await s.rawObservations(agent.slug);
      const result=replayLedger({agentSlug:agent.slug,wallet:getAddress(agent.wallet),opening:Object.fromEntries(Object.entries(opening.balances).map(([k,v])=>[k,BigInt(v)])),openingTsMs:opening.tsMs,tokenDecimals:opening.tokenDecimals,transactions:observations.filter(o=>o.blockNumber>opening.blockNumber),samples,maxPriceAgeMs:this.config.priceStaleMs});
      const balances=new Map(result.balances),decimals=new Map<string,number>(Object.entries(opening.tokenDecimals??{}));
      for(const o of observations)for(const d of o.deltas)decimals.set(d.token,d.decimals);
      let integrityOk=true;
      try{
        const actual=await readWalletBalances(this.client,getAddress(agent.wallet),block.number,this.config.trackedTokens);
        for(const token of ['MON','WMON','USDC']){if((balances.get(token)??0n)!==BigInt(actual[token]??'0'))integrityOk=false;balances.set(token,BigInt(actual[token]??'0'));}
        for(const token of balances.keys()){
          if(!/^0x[0-9a-f]{40}$/i.test(token)||token===lower(WMON)||token===lower(USDC))continue;
          const address=getAddress(token),raw=await this.client.readContract({address,abi:TOKEN_ABI,functionName:'balanceOf',args:[getAddress(agent.wallet)],blockNumber:block.number});
          if((balances.get(token)??0n)!==raw)integrityOk=false;balances.set(token,raw);
        }
      }catch{integrityOk=false;}
      let equityUsd=0;const unpriced:string[]=[];
      for(const [token,raw] of balances){if(raw===0n)continue;const sample=samples.filter(p=>p.token===token).sort((a,b)=>Math.abs(a.tsMs-tsMs)-Math.abs(b.tsMs-tsMs)||a.tsMs-b.tsMs)[0];const dp=decimals.get(token)??(token==='USDC'?TOKEN_CATALOG.USDC.decimals:18);
        if(!sample||Math.abs(sample.tsMs-tsMs)>this.config.priceStaleMs){unpriced.push(token);continue;}if(sample.quality!=='oracle')unpriced.push(token);equityUsd+=Number(raw)/10**dp*sample.usd;
      }
      const monPrice=samples.filter(p=>p.token==='MON').sort((a,b)=>Math.abs(a.tsMs-tsMs)-Math.abs(b.tsMs-tsMs)||a.tsMs-b.tsMs)[0]?.usd??opening.prices.MON??0;
      await s.replaceReplay(agent.slug,result.entries,result.lots,result.interactions,tsMs,blockNumber,equityUsd,monPrice,Object.fromEntries([...balances].map(([k,v])=>[k,v.toString()])),[...new Set(unpriced)].sort(),integrityOk,0);
    }
    await s.setState('last_mark_ms',String(now),now);
  }
  async samplePrices(now=Date.now()):Promise<void> {
    const samples:PriceSample[]=[],finalized=await finalizedBlockNumber(this.client);
    for(const [token,feed] of [['MON',this.config.monadPriceFeedId],['USDC',this.config.usdcPriceFeedId]] as const){
      const sample=await readPythPrice(this.client,feed,now,this.config.priceStaleMs,finalized);samples.push({...sample,token});
    }
    samples.push({...samples[0],token:'WMON'});
    await this.db.tx(async q=>{const s=new Store(this.db,q);for(const p of samples)await s.putPriceSample(p);});
  }
  async run(signal:AbortSignal):Promise<void> {
    let lastPrice=0,lastMark=Number(await this.store.state('last_mark_ms')??0),failures=0,circuitUntil=0;
    while(!signal.aborted){
      const started=Date.now();let retryDelay=0;
      if(started<circuitUntil){retryDelay=circuitUntil-started;}
      else try{
        if(started-lastPrice>60_000){await this.samplePrices(started);lastPrice=started;}
        await this.backfill(started);
        if(started-lastMark>=3_600_000){await this.markAll(started);lastMark=started;}
        failures=0;
      }catch(error){
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
  signal?.addEventListener('abort',()=>controller.abort(signal.reason),{once:true});
  const indexer=new Indexer(db,client,config,logger);
  try{
    const locked=await db.withAdvisoryLock(143,()=>indexer.run(controller.signal),{wait:false,onLost:err=>{lockLost=true;controller.abort(err);}});
    if(locked===undefined)throw new Error('another Monad indexer holds the advisory lock');
  }catch(error){if(signal?.aborted&&!lockLost)return;throw error;}
}
