import type { Address } from 'viem';
import { SUPPORTED_SWAP_TARGETS, TOKEN_CATALOG, WMON } from './protocols.ts';
import type { Interaction, ProtocolId } from './types.ts';

export type TokenId='MON'|'WMON'|'USDC'|string;
export interface TransferDelta { token:TokenId; raw:bigint; decimals:number; symbol:string }
export interface TxObservation {
  hash:string; blockNumber:number; transactionIndex?:number; blockHash:string; tsMs:number; from:Address; to?:Address|null;
  success:boolean; gasLimit:bigint; effectiveGasPrice:bigint; value:bigint;
  deltas:TransferDelta[]; wrap?:{kind:'deposit'|'withdrawal';amount:bigint}; internalValueUnknown?:boolean; dataSelector?:string;
}
export interface PriceSample { token:TokenId;tsMs:number;usd:number;source:string;quality:'oracle'|'estimated';liquidityUsd?:number }
export interface LedgerEntry { token:TokenId;deltaRaw:bigint;kind:'flow'|'swap'|'fee'|'unsupported'|'wrap';txHash:string }
export interface FifoLot { token:TokenId;qtyRaw:bigint;costUsd:number;costUsdMicros?:bigint;tsMs:number;sourceTx:string }
export interface ReplayResult {
  balances:Map<TokenId,bigint>; entries:LedgerEntry[]; lots:FifoLot[]; interactions:Interaction[];
  equityUsd:number;unpriced:string[];unsupportedCount:number;gasPaidRaw:bigint;flowsByTx:Map<string,number>;
}

export function nearestPrice(samples:PriceSample[],token:TokenId,tsMs:number):PriceSample|undefined {
  return samples.filter(s=>s.token===token).sort((a,b)=>Math.abs(a.tsMs-tsMs)-Math.abs(b.tsMs-tsMs)||a.tsMs-b.tsMs)[0];
}
const human=(raw:bigint,decimals:number)=>Number(raw.toString())/10**decimals;
const USD_SCALE=1_000_000n;
const usdMicrosForRaw=(raw:bigint,decimals:number,price:number):bigint=>raw*BigInt(Math.round(price*Number(USD_SCALE)))/(10n**BigInt(decimals));
const usdForRaw=(raw:bigint,decimals:number,price:number):number=>Number(usdMicrosForRaw(raw,decimals,price))/Number(USD_SCALE);
const micros=(usd:number)=>BigInt(Math.round(usd*Number(USD_SCALE)));
export function usdMicrosFromDecimal(value:string):bigint {
  const [whole,fraction='']=value.split('.'),negative=whole.startsWith('-'),digits=negative?whole.slice(1):whole;
  let amount=BigInt(digits||'0')*USD_SCALE+BigInt((fraction+'000000').slice(0,6));
  if((fraction[6]??'0')>='5')amount++;
  return negative?-amount:amount;
}
export function usdDecimalFromMicros(amount:bigint):string {
  const sign=amount<0n?'-':'',absolute=amount<0n?-amount:amount;
  return `${sign}${absolute/USD_SCALE}.${String(absolute%USD_SCALE).padStart(6,'0')}`;
}
const dollars=(amount:bigint)=>Number(amount)/Number(USD_SCALE);
interface WorkingLot extends Omit<FifoLot,'costUsd'> { costUsdMicros:bigint }
const tokenMeta=(token:TokenId,decimals?:number)=>{
  const known=TOKEN_CATALOG[token as keyof typeof TOKEN_CATALOG];
  return {decimals:decimals??known?.decimals??18,symbol:known?token:token};
};
const priceAt=(samples:PriceSample[],token:TokenId,ts:number,maxAgeMs?:number)=>{const sample=nearestPrice(samples,token,ts);return sample&&(maxAgeMs===undefined||Math.abs(sample.tsMs-ts)<=maxAgeMs)?sample.usd:undefined;};
const oraclePriceAt=(samples:PriceSample[],token:TokenId,ts:number,maxAgeMs?:number)=>{const sample=nearestPrice(samples,token,ts);return sample?.quality==='oracle'&&(maxAgeMs===undefined||Math.abs(sample.tsMs-ts)<=maxAgeMs)?sample.usd:undefined;};
function isKnownTokenAddress(address:string):boolean {
  return address.toLowerCase()===WMON.toLowerCase()||address.toLowerCase()===TOKEN_CATALOG.USDC.address.toLowerCase();
}

export type ActivityKind='wrap'|'swap'|'flow'|'neutral'|'unsupported';
export function classifyActivity(tx:TxObservation):{kind:ActivityKind;protocol?:ProtocolId;reason?:string} {
  if(tx.internalValueUnknown)return {kind:'unsupported',reason:'internal value transfer cannot be attributed without traces'};
  const to=tx.to?.toLowerCase();
  const core=tx.deltas.filter(d=>d.raw!==0n);
  const targetProtocol=to?SUPPORTED_SWAP_TARGETS.get(to):undefined;
  const isWrapTarget=to===WMON.toLowerCase()||tx.wrap!==undefined;
  const onlyNativeWrapTokens=core.every(d=>d.token==='WMON'||d.token==='MON')&&core.length<=2;
  const hasOppositeWrapDeltas=core.some(d=>d.token==='MON'&&d.raw<0n)&&core.some(d=>d.token==='WMON'&&d.raw>0n)||core.some(d=>d.token==='WMON'&&d.raw<0n)&&core.some(d=>d.token==='MON'&&d.raw>0n);
  if(isWrapTarget&&onlyNativeWrapTokens&&(tx.wrap!==undefined||core.length===0||hasOppositeWrapDeltas)) return {kind:'wrap'};
  if(targetProtocol) {
    const hasIn=core.some(d=>d.raw<0n),hasOut=core.some(d=>d.raw>0n);
    if(hasIn&&hasOut)return {kind:'swap',protocol:targetProtocol};
    if(core.length===0&& !tx.success)return {kind:'neutral',protocol:targetProtocol};
    if(core.length===1||core.every(d=>d.raw>0n)||core.every(d=>d.raw<0n))return {kind:'flow',protocol:targetProtocol};
  }
  if(core.length===0) {
    if(tx.to&&isKnownTokenAddress(tx.to)&&tx.dataSelector==='0x095ea7b3')return {kind:'neutral'};
    if(tx.to&&to===WMON.toLowerCase())return {kind:'wrap'};
    if(!tx.success&&targetProtocol)return {kind:'neutral',protocol:targetProtocol};
    if(tx.dataSelector&&tx.dataSelector!=='0x'&&!(tx.to&&isKnownTokenAddress(tx.to)))return {kind:'unsupported',reason:'unrecognized contract call with no attributable balance changes'};
    return {kind:'neutral'};
  }
  if(core.length>0) {
    const allOneDirection=core.every(d=>d.raw>0n)||core.every(d=>d.raw<0n);
    if(allOneDirection)return {kind:'flow'};
  }
  return {kind:'unsupported',reason:'activity does not match a pinned swap, wrap, or one-directional flow'};
}

function consumeFifo(lots:WorkingLot[],token:TokenId,qty:bigint):{cost:number;costMicros:bigint;unmatched:bigint} {
  let left=qty,costMicros=0n;
  for(const lot of lots){if(lot.token!==token||left===0n)continue;const originalQty=lot.qtyRaw,used=originalQty<left?originalQty:left;if(originalQty>0n){const usedCost=lot.costUsdMicros*used/originalQty;costMicros+=usedCost;lot.costUsdMicros-=usedCost;}lot.qtyRaw-=used;left-=used;}
  return {cost:dollars(costMicros),costMicros,unmatched:left};
}

/** Deterministic fixture/replay reducer. Raw quantities remain bigint; USD conversion occurs only at the mark edge. */
export function replayLedger(args:{agentSlug:string;wallet:Address;opening:Record<TokenId,bigint>;openingTsMs?:number;openingLots?:FifoLot[];tokenDecimals?:Record<string,number>;transactions:TxObservation[];samples:PriceSample[];maxPriceAgeMs?:number|Record<string,number>}):ReplayResult {
  const decimalsOf=(token:TokenId,fallback?:number)=>args.tokenDecimals?.[token]??fallback??tokenMeta(token).decimals;
  const maxAge=(token:TokenId)=>typeof args.maxPriceAgeMs==='number'?args.maxPriceAgeMs:args.maxPriceAgeMs?.[token];
  const balances=new Map<TokenId,bigint>(Object.entries(args.opening).map(([k,v])=>[k,BigInt(v)]));
  const entries:LedgerEntry[]=[],lots:WorkingLot[]=args.openingLots?.length?args.openingLots.map(({costUsd,costUsdMicros,...l})=>({...l,costUsdMicros:costUsdMicros??micros(costUsd)})):[],interactions:Interaction[]=[],flowsByTx=new Map<string,number>();let unsupportedCount=0,gasPaidRaw=0n;
  const txs=[...args.transactions].sort((a,b)=>a.blockNumber-b.blockNumber||(a.transactionIndex??0)-(b.transactionIndex??0)||a.tsMs-b.tsMs||a.hash.localeCompare(b.hash));
  const openingTs=args.openingTsMs??txs[0]?.tsMs??args.samples.reduce((m,s)=>Math.min(m,s.tsMs),Number.MAX_SAFE_INTEGER);
  if(!args.openingLots?.length)for(const [token,raw] of balances){
    const price=Number.isFinite(openingTs)?oraclePriceAt(args.samples,token,openingTs,maxAge(token)):undefined;
    if(raw>0n&&price!==undefined){lots.push({token,qtyRaw:raw,costUsdMicros:usdMicrosForRaw(raw,decimalsOf(token),price),tsMs:openingTs,sourceTx:'opening'});}
  }
  for(const tx of txs){

    const classified=classifyActivity(tx),tokenDeltas=new Map<TokenId,{raw:bigint;decimals:number;symbol:string}>();
    for(const d of tx.deltas){const old=tokenDeltas.get(d.token);tokenDeltas.set(d.token,{...d,raw:(old?.raw??0n)+d.raw});}
    const agentIsSender=tx.from.toLowerCase()===args.wallet.toLowerCase();
    const feeRaw=agentIsSender?tx.gasLimit*tx.effectiveGasPrice:0n;
    const wrap=classified.kind==='wrap';
    let activityUnsupported=classified.kind==='unsupported';
    if(feeRaw>0n){balances.set('MON',(balances.get('MON')??0n)-feeRaw);gasPaidRaw+=feeRaw;entries.push({token:'MON',deltaRaw:-feeRaw,kind:'fee',txHash:tx.hash});if(consumeFifo(lots,'MON',feeRaw).unmatched>0n)activityUnsupported=true;}
    if(classified.kind==='flow'){
      let flowUsd=0;
      for(const [token,d] of tokenDeltas){
        const sample=nearestPrice(args.samples,token,tx.tsMs),tokenMaxAge=maxAge(token),usable=sample?.quality==='oracle'&&(tokenMaxAge===undefined||Math.abs(sample.tsMs-tx.tsMs)<=tokenMaxAge);
        if(!usable)activityUnsupported=true;else flowUsd+=usdForRaw(d.raw,d.decimals,sample.usd);
        if(d.raw>0n)lots.push({token,qtyRaw:d.raw,costUsdMicros:usable&&sample?usdMicrosForRaw(d.raw,decimalsOf(token,d.decimals),sample.usd):0n,tsMs:tx.tsMs,sourceTx:tx.hash});
        else if(d.raw<0n&&consumeFifo(lots,token,-d.raw).unmatched>0n)activityUnsupported=true;
      }
      flowsByTx.set(tx.hash,flowUsd);
    }
    if(classified.kind==='wrap'){
      const inputs=[...tokenDeltas].filter(([,d])=>d.raw<0n),outputs=[...tokenDeltas].filter(([,d])=>d.raw>0n);
      if(inputs.length||outputs.length){
        let transferredCostMicros=0n,consumed=0n,produced=0n;
        for(const [token,d] of inputs){const used=consumeFifo(lots,token,-d.raw);transferredCostMicros+=used.costMicros;consumed+=-d.raw;if(used.unmatched>0n)activityUnsupported=true;}
        for(const [,d] of outputs)produced+=d.raw;
        if(inputs.length!==1||outputs.length!==1||consumed!==produced)activityUnsupported=true;
        for(const [token,d] of outputs)lots.push({token,qtyRaw:d.raw,costUsdMicros:produced>0n?transferredCostMicros*d.raw/produced:0n,tsMs:tx.tsMs,sourceTx:tx.hash});
      }
    }
    for(const [token,d] of tokenDeltas){
      if(d.raw===0n)continue;
      balances.set(token,(balances.get(token)??0n)+d.raw);
      const kind=activityUnsupported?'unsupported':wrap?'wrap':classified.kind==='swap'?'swap':classified.kind==='flow'?'flow':'flow';
      entries.push({token,deltaRaw:d.raw,kind,txHash:tx.hash});
    }
    if(classified.kind==='swap'&&classified.protocol){
      const negatives=[...tokenDeltas].filter(([,d])=>d.raw<0n),positives=[...tokenDeltas].filter(([,d])=>d.raw>0n);
      let outUsd=0,inUsd=0,inputQty=0,realized=0,markPriceUsd:number|undefined;const legs:Interaction['legs']=[];
      for(const [token,d] of negatives){const qty=-d.raw,p=oraclePriceAt(args.samples,token,tx.tsMs,maxAge(token));const decimals=decimalsOf(token,d.decimals),qtyHuman=human(qty,decimals),usd=p===undefined?0:usdForRaw(qty,decimals,p);if(p===undefined)activityUnsupported=true;inUsd+=usd;inputQty+=qtyHuman;markPriceUsd??=p;const {cost,unmatched}=consumeFifo(lots,token,qty);realized-=cost;if(unmatched>0n){activityUnsupported=true;if(p!==undefined)realized-=usdForRaw(unmatched,decimals,p);}legs.push({symbol:d.symbol,delta:-qtyHuman,usd:-usd});}
      for(const [token,d] of positives){const qty=d.raw,p=oraclePriceAt(args.samples,token,tx.tsMs,maxAge(token)),decimals=decimalsOf(token,d.decimals);const usd=p===undefined?0:usdForRaw(qty,decimals,p);if(p===undefined)activityUnsupported=true;outUsd+=usd;lots.push({token,qtyRaw:qty,costUsdMicros:p===undefined?0n:usdMicrosForRaw(qty,decimals,p),tsMs:tx.tsMs,sourceTx:tx.hash});legs.push({symbol:d.symbol,delta:human(qty,decimals),usd});}
      const executionPriceUsd=inputQty>0&&outUsd>0?outUsd/inputQty:undefined;
      const monPrice=oraclePriceAt(args.samples,'MON',tx.tsMs,maxAge('MON'));if(feeRaw>0n&&monPrice===undefined)activityUnsupported=true;const feeUsd=feeRaw&&monPrice!==undefined?human(feeRaw,18)*monPrice:0;
      const pnl=realized+outUsd-feeUsd;
      const notional=Math.min(inUsd,outUsd);
      interactions.push({id:`${tx.hash}:0`,agentSlug:args.agentSlug,txHash:tx.hash,logIndex:0,blockNumber:tx.blockNumber,ts:tx.tsMs,protocol:classified.protocol,kind:'swap',legs,notionalUsd:notional,pnlUsd:pnl,components:[{label:'price',usd:realized+outUsd},...(feeUsd? [{label:'gas' as const,usd:-feeUsd}]:[])],execution:{slippageBps:0,private:false,mevBps:0},meta:{executionPriceUsd,...(executionPriceUsd===undefined?{}:{pair:`usd/${negatives[0]?.[0]??'token'}`}),markPriceUsd} as Interaction['meta']});
    }
    if(activityUnsupported){
      unsupportedCount++;
      if(!entries.some(e=>e.txHash===tx.hash&&e.kind==='unsupported'))entries.push({token:'UNKNOWN',deltaRaw:0n,kind:'unsupported',txHash:tx.hash});
    }
    // A transaction without economic transfer still remains in raw_transactions and contributes its failed/successful fee.
  }
  const at=txs.at(-1)?.tsMs??0,unpriced:string[]=[];let equityUsd=0;
  for(const [token,raw] of balances){if(raw===0n)continue;const sample=nearestPrice(args.samples,token,at),tokenMaxAge=maxAge(token);if(!sample||(tokenMaxAge!==undefined&&Math.abs(sample.tsMs-at)>tokenMaxAge)){unpriced.push(token);continue;}if(sample.quality!=='oracle')unpriced.push(token);equityUsd+=human(raw,decimalsOf(token))*sample.usd;}
  return {balances,entries,lots:lots.filter(l=>l.qtyRaw>0n).map(l=>({...l,costUsd:dollars(l.costUsdMicros),costUsdMicros:l.costUsdMicros})),interactions,equityUsd,unpriced:unpriced.sort(),unsupportedCount,gasPaidRaw,flowsByTx};
}
