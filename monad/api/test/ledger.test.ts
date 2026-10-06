import { describe,expect,it } from 'vitest';
import type { Address } from 'viem';
import { classifyActivity,replayLedger,type TxObservation,type PriceSample } from '../src/ledger.ts';
import { UNISWAP_V2_ROUTER,WMON } from '../src/protocols.ts';
const WALLET='0x00000000000000000000000000000000000000aa' as Address;
const P:PriceSample[]=[{token:'MON',tsMs:1_000,usd:100,source:'fixture-oracle',quality:'oracle'},{token:'WMON',tsMs:1_000,usd:100,source:'fixture-oracle',quality:'oracle'},{token:'USDC',tsMs:1_000,usd:1,source:'fixture-oracle',quality:'oracle'}];
function tx(p:Partial<TxObservation>&Pick<TxObservation,'hash'|'from'|'to'|'deltas'>):TxObservation{return {hash:p.hash,blockNumber:p.blockNumber??1,blockHash:p.blockHash??'0x01',tsMs:p.tsMs??1_000,from:p.from,to:p.to,success:p.success??true,gasLimit:p.gasLimit??0n,effectiveGasPrice:p.effectiveGasPrice??0n,value:p.value??0n,deltas:p.deltas,wrap:p.wrap,internalValueUnknown:p.internalValueUnknown,dataSelector:p.dataSelector};}
const initial={MON:10_000_000_000_000_000_000n,WMON:2_000_000_000_000_000_000n,USDC:100_000_000n};

describe('Monad ledger reducer',()=>{
  it('classifies deposits and withdrawals as external flows',()=>{
    const deposit=tx({hash:'0xd1',from:'0x0000000000000000000000000000000000000001' as Address,to:WALLET,deltas:[{token:'USDC',raw:10_000_000n,decimals:6,symbol:'USDC'}]});
    const withdraw=tx({hash:'0xd2',from:WALLET,to:'0x0000000000000000000000000000000000000001' as Address,deltas:[{token:'USDC',raw:-5_000_000n,decimals:6,symbol:'USDC'}]});
    expect(classifyActivity(deposit).kind).toBe('flow');expect(classifyActivity(withdraw).kind).toBe('flow');
    const result=replayLedger({agentSlug:'a',wallet:WALLET,opening:initial,transactions:[deposit,withdraw],samples:P});
    expect(result.balances.get('USDC')).toBe(105_000_000n);expect(result.interactions).toHaveLength(0);
    expect(result.entries.map(e=>e.kind)).toEqual(['flow','flow']);
  });
  it('treats WMON wrapping and unwrapping as neutral inventory moves',()=>{
    const wrap=tx({hash:'0xa1',from:WALLET,to:WMON,value:1_000_000_000_000_000_000n,deltas:[{token:'MON',raw:-1_000_000_000_000_000_000n,decimals:18,symbol:'MON'},{token:'WMON',raw:1_000_000_000_000_000_000n,decimals:18,symbol:'WMON'}],wrap:{kind:'deposit',amount:1_000_000_000_000_000_000n}});
    const unwrap=tx({hash:'0xa2',from:WALLET,to:WMON,deltas:[{token:'WMON',raw:-500_000_000_000_000_000n,decimals:18,symbol:'WMON'},{token:'MON',raw:500_000_000_000_000_000n,decimals:18,symbol:'MON'}],wrap:{kind:'withdrawal',amount:500_000_000_000_000_000n}});
    expect(classifyActivity(wrap).kind).toBe('wrap');expect(classifyActivity(unwrap).kind).toBe('wrap');
    const r=replayLedger({agentSlug:'a',wallet:WALLET,opening:initial,transactions:[wrap,unwrap],samples:P});
    expect(r.entries.every(e=>e.kind==='wrap')).toBe(true);expect(r.interactions).toHaveLength(0);
  });
  it('uses opposite-signed deltas at an allowlisted venue for a swap and charges gas_limit fee',()=>{
    const swap=tx({hash:'0xs1',from:WALLET,to:UNISWAP_V2_ROUTER,deltas:[{token:'WMON',raw:-1_000_000_000_000_000_000n,decimals:18,symbol:'WMON'},{token:'USDC',raw:100_000_000n,decimals:6,symbol:'USDC'}],gasLimit:21000n,effectiveGasPrice:2_000_000_000n});
    expect(classifyActivity(swap)).toMatchObject({kind:'swap',protocol:'uniswap'});
    const r=replayLedger({agentSlug:'a',wallet:WALLET,opening:initial,transactions:[swap],samples:P});
    expect(r.interactions).toHaveLength(1);expect(r.interactions[0].pnlUsd).toBeCloseTo(-0.0042,6);
    expect(r.entries.some(e=>e.kind==='fee'&&e.deltaRaw===-42_000_000_000_000n)).toBe(true);
    expect(r.gasPaidRaw).toBe(42_000_000_000_000n);
  });
  it('preserves remaining FIFO cost basis across partial lot disposals',()=>{
    const first=tx({hash:'0xs1',from:WALLET,to:UNISWAP_V2_ROUTER,deltas:[{token:'WMON',raw:-1_000_000_000_000_000_000n,decimals:18,symbol:'WMON'},{token:'USDC',raw:110_000_000n,decimals:6,symbol:'USDC'}]});
    const second=tx({hash:'0xs2',from:WALLET,to:UNISWAP_V2_ROUTER,deltas:[{token:'WMON',raw:-1_000_000_000_000_000_000n,decimals:18,symbol:'WMON'},{token:'USDC',raw:90_000_000n,decimals:6,symbol:'USDC'}]});
    const r=replayLedger({agentSlug:'a',wallet:WALLET,opening:initial,transactions:[first,second],samples:P});
    expect(r.interactions[0].pnlUsd).toBeCloseTo(10,8);expect(r.interactions[1].pnlUsd).toBeCloseTo(-10,8);
    expect(r.lots.find(l=>l.token==='WMON')).toBeUndefined();
  });
  it('counts failed transaction fees and stores unsupported activity instead of guessing',()=>{
    const failed=tx({hash:'0xf1',from:WALLET,to:UNISWAP_V2_ROUTER,deltas:[],success:false,gasLimit:50000n,effectiveGasPrice:1_000_000_000n});
    const unknown=tx({hash:'0xu1',from:WALLET,to:'0x00000000000000000000000000000000000000ff' as Address,deltas:[{token:'USDC',raw:-1_000_000n,decimals:6,symbol:'USDC'},{token:'0xtoken',raw:1n,decimals:18,symbol:'TOKEN'}]});
    expect(classifyActivity(unknown).kind).toBe('unsupported');
    const r=replayLedger({agentSlug:'a',wallet:WALLET,opening:initial,transactions:[failed,unknown],samples:P});
    expect(r.gasPaidRaw).toBe(50_000_000_000_000n);expect(r.unsupportedCount).toBe(1);expect(r.entries.some(e=>e.kind==='unsupported')).toBe(true);
  });
  it('excludes unpriced token holdings from equity and blocks deterministically on replay',()=>{
    const transactions=[tx({hash:'0xt2',from:WALLET,to:'0x0000000000000000000000000000000000000002' as Address,deltas:[{token:'MYSTERY',raw:7_000_000_000_000_000_000n,decimals:18,symbol:'MYSTERY'}]})];
    const input={agentSlug:'a',wallet:WALLET,opening:{...initial,MYSTERY:2_000_000_000_000_000_000n},transactions,samples:P};
    const first=replayLedger(input),second=replayLedger({...input,transactions:[...transactions].reverse(),samples:[...P].reverse()});
    expect(first.unpriced).toEqual(['MYSTERY']);expect(first.equityUsd).toBeCloseTo(second.equityUsd,10);
    expect([...first.balances.entries()].sort()).toEqual([...second.balances.entries()].sort());expect(first.entries).toEqual(second.entries);
  });
  it('marks untraceable internal value activity unsupported',()=>{
    const x=tx({hash:'0xi',from:WALLET,to:UNISWAP_V2_ROUTER,value:1n,deltas:[],internalValueUnknown:true});
    expect(classifyActivity(x)).toMatchObject({kind:'unsupported'});
  });
});
