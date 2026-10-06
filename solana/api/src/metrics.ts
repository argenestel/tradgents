import { DAY } from './format';
import { COMPONENT_ORDER, isClosing } from './protocols';
import type { Agent, AgentDetail, EquityPoint, Interaction, Metrics, PnlComponent, ProtocolId, ProtocolStat, Tier, WindowKey } from './types';
export type Valuation = EquityPoint & { flow?: number };
export const tierOf = (eq: number): Tier => eq < 250 ? '<$250' : eq < 2500 ? '$250–2.5k' : eq < 25000 ? '$2.5k–25k' : '>$25k';
function std(xs: number[]) { const mean=xs.reduce((s,x)=>s+x,0)/Math.max(1,xs.length); return xs.length<2?0:Math.sqrt(xs.reduce((s,x)=>s+(x-mean)**2,0)/(xs.length-1)); }
/** Each snapshot is post-flow; flow belongs to its end boundary. Intraday flows require pre/post valuations. */
export function computeMetrics(eq: Valuation[], ints: Interaction[], window: WindowKey, now: number): Metrics {
  const start = now - (window==='7d'?7:window==='30d'?30:Infinity)*DAY;
  const pts = eq.filter(p=>p.t>=start-1 && p.t<=now);
  const daily = new Map<number,number>();
  let wealth=1, peak=1, maxDD=0, valid=true;
  for(let i=1;i<pts.length;i++) {
    const before=pts[i-1].usd, after=pts[i].usd-(pts[i].flow??0);
    if(before<=0 || after<=0) { valid=false; continue; }
    const factor=after/before;
    wealth*=factor; peak=Math.max(peak,wealth); maxDD=Math.max(maxDD,1-wealth/peak);
    const day=Math.floor((pts[i].t-1)/DAY); daily.set(day,(daily.get(day)??1)*factor);
  }
  const rets=[...daily.values()].map(x=>x-1), n=rets.length;
  const mean=rets.reduce((s,x)=>s+x,0)/Math.max(1,n), sd=std(rets), srd=sd>0?mean/sd:0;
  const downside=Math.sqrt(rets.reduce((s,x)=>s+Math.min(x,0)**2,0)/Math.max(1,n));
  const se=n>1 && sd>0?Math.sqrt((1+0.5*srd*srd)/n):0, annual=Math.sqrt(365);
  const trades=ints.filter(i=>i.ts>start && i.ts<=now), closing=trades.filter(isClosing);
  const first=pts[0], last=pts.at(-1), solReturnPct=first&&last&&first.sol>0?(last.sol/first.sol-1)*100:0;
  const returnPct=valid?(wealth-1)*100:0;
  return {window,days:n,trades:trades.length,returnPct,solReturnPct,excessPct:returnPct-solReturnPct,sharpe:valid?srd*annual:0,sharpeLo:valid?(srd-1.96*se)*annual:0,sharpeHi:valid?(srd+1.96*se)*annual:0,sortino:valid&&downside>0?mean/downside*annual:0,maxDrawdownPct:maxDD*100,winRate:closing.length?closing.filter(i=>i.pnlUsd>0).length/closing.length*100:0,eligible:valid&&n>=7&&trades.length>=10};
}
export function detail(agent: Agent, equity: Valuation[], interactions: Interaction[], now: number): AgentDetail {
  const byP=new Map<ProtocolId,ProtocolStat & {closing:number;wins:number}>(), wf=new Map<PnlComponent,number>();
  for(const i of interactions) {
    const s=byP.get(i.protocol)??{protocol:i.protocol,trades:0,pnlUsd:0,costUsd:0,winRate:0,closing:0,wins:0};
    s.trades++;s.pnlUsd+=i.pnlUsd;
    if(isClosing(i)){s.closing++;if(i.pnlUsd>0)s.wins++;}
    for(const c of i.components){wf.set(c.label,(wf.get(c.label)??0)+c.usd);if(['swapFee','priorityFee','tip'].includes(c.label))s.costUsd+=c.usd;}
    byP.set(i.protocol,s);
  }
  const equityUsd=equity.at(-1)?.usd??0;
  return {agent,equityUsd,tier:tierOf(equityUsd),equity:equity.map(({t,usd,sol})=>({t,usd,sol})),interactions:[...interactions].sort((a,b)=>b.ts-a.ts),metrics:{'7d':computeMetrics(equity,interactions,'7d',now),'30d':computeMetrics(equity,interactions,'30d',now),all:computeMetrics(equity,interactions,'all',now)},byProtocol:[...byP.values()].map(({closing,wins,...s})=>({...s,winRate:closing?wins/closing*100:0})).sort((a,b)=>b.pnlUsd-a.pnlUsd),waterfall:COMPONENT_ORDER.filter(c=>wf.has(c)).map(label=>({label,usd:wf.get(label)!})),unrealizedUsd:equity.length?equityUsd-agent.startCapitalUsd-interactions.reduce((s,i)=>s+i.pnlUsd,0):0};
}
