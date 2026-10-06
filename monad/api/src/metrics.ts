import { COMPONENT_ORDER, isClosing } from './protocols.ts';
import type { Agent, AgentDetail, EquityPoint, ExecutionStats, Interaction, LeaderboardRow, Metrics, PnlComponent, ProtocolId, ProtocolPage, ProtocolStat, Tier, WindowKey } from './types.ts';

export const DAY=86_400_000;
export function tierOf(eq:number):Tier { if(eq<250)return '<$250';if(eq<2500)return '$250–2.5k';if(eq<25000)return '$2.5k–25k';return '>$25k'; }
function std(xs:number[]):number { if(xs.length<2)return 0;const m=xs.reduce((a,b)=>a+b,0)/xs.length;return Math.sqrt(xs.reduce((a,b)=>a+(b-m)**2,0)/(xs.length-1)); }
type FlowEquity=EquityPoint&{blockNumber?:number;flow?:number};
export function computeMetrics(eq:FlowEquity[],ints:Interaction[],window:WindowKey,now:number,gates:{unsupported?:boolean;unpriced?:boolean;integrity?:boolean;bond?:boolean;active?:boolean}={}):Metrics {
  const daysWindow=window==='7d'?7:window==='30d'?30:Infinity;
  const startT=now-daysWindow*DAY;
  const pts=eq.filter(p=>p.t>=startT-DAY).sort((a,b)=>a.t-b.t||(a.blockNumber??0)-(b.blockNumber??0));
  const dailyFactors=new Map<number,number>();let peak=0,maxDd=0,wealth=pts[0]?.usd??0;
  for(let i=1;i<pts.length;i++){
    const prev=pts[i-1],cur=pts[i];if(prev.usd<=0)continue;
    const r=(cur.usd-(cur.flow??0))/prev.usd-1,day=Math.floor(cur.t/DAY)*DAY;
    dailyFactors.set(day,(dailyFactors.get(day)??1)*(1+r));wealth*=1+r;peak=Math.max(peak,wealth);maxDd=Math.max(maxDd,peak>0?(peak-wealth)/peak:0);
  }
  const returns=[...dailyFactors.entries()].sort((a,b)=>a[0]-b[0]).map(([,factor])=>factor-1);
  const mean=returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:0;
  const sd=std(returns),sr=sd>0?mean/sd:0;
  const downside=Math.sqrt(returns.reduce((a,r)=>a+Math.min(r,0)**2,0)/Math.max(1,returns.length));
  const first=pts[0],last=pts.at(-1);
  let twr=1;for(const r of returns)twr*=1+r;
  let benchmark=0;
  if(first&&first.sol>0){let monUnits=first.usd/first.sol,previousValue=first.usd;const benchDays=new Map<number,number>();for(let i=1;i<pts.length;i++){const p=pts[i];if(p.sol<=0)continue;const valueBeforeFlow=monUnits*p.sol,day=Math.floor(p.t/DAY)*DAY;benchDays.set(day,(benchDays.get(day)??1)*(valueBeforeFlow/previousValue));monUnits+=(p.flow??0)/p.sol;previousValue=monUnits*p.sol;}let benchTwr=1;for(const factor of benchDays.values())benchTwr*=factor;benchmark=(benchTwr-1)*100;}
  const inWin=ints.filter(i=>i.ts>startT),closing=inWin.filter(isClosing);
  const daysLive=first&&last?Math.max(0,(last.t-first.t)/DAY):0;
  const eligible=daysLive>=7&&inWin.length>=10&&!gates.unsupported&&!gates.unpriced&&gates.integrity!==false&&gates.bond!==false&&gates.active!==false;
  return {
    window,days:Math.floor(daysLive),trades:inWin.length,returnPct:(twr-1)*100,solReturnPct:benchmark,
    excessPct:(twr-1)*100-benchmark,sharpe:sr*Math.sqrt(365),
    sharpeLo:(sr-(returns.length>1?1.96*Math.sqrt((1+0.5*sr*sr)/returns.length):0))*Math.sqrt(365),
    sharpeHi:(sr+(returns.length>1?1.96*Math.sqrt((1+0.5*sr*sr)/returns.length):0))*Math.sqrt(365),
    sortino:downside>0?(mean/downside)*Math.sqrt(365):0,maxDrawdownPct:maxDd*100,
    winRate:closing.length?closing.filter(i=>i.pnlUsd>0).length/closing.length*100:0,eligible,
  };
}
export function assembleDetail(agent:Agent,interactions:Interaction[],equity:FlowEquity[],now:number,gates:{unsupported?:boolean;unsupported7d?:boolean;unsupported30d?:boolean;unsupportedAll?:boolean;unpriced?:boolean;integrity?:boolean;bond?:boolean;active?:boolean}={}):AgentDetail {
  const ints=[...interactions].sort((a,b)=>a.ts-b.ts),last=equity.at(-1),equityUsd=last?.usd??agent.startCapitalUsd;
  const realizedTotal=ints.reduce((a,i)=>a+i.pnlUsd,0),externalFlows=equity.slice(1).reduce((sum,p)=>sum+(p.flow??0),0),unrealizedUsd=equityUsd-agent.startCapitalUsd-externalFlows-realizedTotal;
  const byP=new Map<ProtocolId,ProtocolStat&{closing:number;wins:number}>(),wf=new Map<PnlComponent,number>();
  let gasCost=0,positive=0,slip=0,priv=0,mev=0;
  for(const i of ints){
    const s=byP.get(i.protocol)??{protocol:i.protocol,trades:0,pnlUsd:0,winRate:0,costUsd:0,closing:0,wins:0};
    s.trades++;s.pnlUsd+=i.pnlUsd;
    if(isClosing(i)){s.closing++;if(i.pnlUsd>0)s.wins++;}
    for(const c of i.components){wf.set(c.label,(wf.get(c.label)??0)+c.usd);if(['swapFee','gas','mevLeak'].includes(c.label))s.costUsd+=Math.min(0,c.usd);if(c.label==='gas')gasCost+=-c.usd;if(c.usd>0&&c.label!=='swapFee')positive+=c.usd;}
    slip+=i.execution.slippageBps;if(i.execution.private)priv++;mev+=i.execution.mevBps;byP.set(i.protocol,s);
  }
  const execution:ExecutionStats={gasPctOfGross:positive>0?gasCost/positive*100:0,avgSlippageBps:ints.length?slip/ints.length:0,privateFlowPct:ints.length?priv/ints.length*100:0,avgMevBps:ints.length?mev/ints.length:0};
  const byProtocol=[...byP.values()].map(s=>({protocol:s.protocol,trades:s.trades,pnlUsd:s.pnlUsd,costUsd:s.costUsd,winRate:s.closing?s.wins/s.closing*100:0})).sort((a,b)=>b.pnlUsd-a.pnlUsd);
  const waterfall=COMPONENT_ORDER.filter(c=>wf.has(c)).map(label=>({label,usd:wf.get(label)!}));
  const eq=equity.length?equity:[{t:agent.startedAt,usd:agent.startCapitalUsd,sol:0}];
  return {agent,equityUsd,tier:tierOf(equityUsd),equity:eq.map(({t,usd,sol})=>({t,usd,sol})),interactions:[...ints].reverse(),
    metrics:{'7d':computeMetrics(equity,ints,'7d',now,{...gates,unsupported:gates.unsupported7d??gates.unsupported}),'30d':computeMetrics(equity,ints,'30d',now,{...gates,unsupported:gates.unsupported30d??gates.unsupported}),'all':computeMetrics(equity,ints,'all',now,{...gates,unsupported:gates.unsupportedAll??gates.unsupported})},
    byProtocol,waterfall,unrealizedUsd,execution};
}
export function toLeaderboardRow(d:AgentDetail):LeaderboardRow {
  const src=d.equity.slice(-30),spark=src.map((p,_i,arr)=>arr[0].usd?p.usd/arr[0].usd*100:100);
  return {agent:d.agent,equityUsd:d.equityUsd,tier:d.tier,metrics:d.metrics,spark,gasPctOfGross:d.execution.gasPctOfGross};
}
export function protocolPage(id:ProtocolId,details:AgentDetail[]):ProtocolPage {
  const agents:ProtocolPage['agents']=[],wf=new Map<PnlComponent,number>(),kinds=new Map<string,{trades:number;pnlUsd:number}>();
  for(const d of details){const stat=d.byProtocol.find(s=>s.protocol===id);if(stat)agents.push({slug:d.agent.slug,name:d.agent.name,stat});for(const i of d.interactions){if(i.protocol!==id)continue;for(const c of i.components)wf.set(c.label,(wf.get(c.label)??0)+c.usd);const k=kinds.get(i.kind)??{trades:0,pnlUsd:0};k.trades++;k.pnlUsd+=i.pnlUsd;kinds.set(i.kind,k);}}
  agents.sort((a,b)=>b.stat.pnlUsd-a.stat.pnlUsd);
  return {protocol:id,agents,waterfall:[...wf.entries()].map(([label,usd])=>({label,usd})),totalPnl:agents.reduce((a,x)=>a+x.stat.pnlUsd,0),totalTrades:agents.reduce((a,x)=>a+x.stat.trades,0),kinds:[...kinds.entries()].map(([kind,v])=>({kind,...v}))};
}
export function emptyPolicy():Agent['policy'] { return {status:'none',allowedProtocols:[],perTradeCapUsd:0,dailyCapUsd:0,usedTodayUsd:0,expiresAt:0,changes:[]}; }
