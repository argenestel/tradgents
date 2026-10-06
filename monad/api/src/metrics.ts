import { COMPONENT_ORDER, isClosing } from "./protocols.ts";
import type {
  Agent,
  AgentDetail,
  EquityPoint,
  ExecutionStats,
  Interaction,
  LeaderboardRow,
  Metrics,
  PnlComponent,
  ProtocolId,
  ProtocolPage,
  ProtocolStat,
  Tier,
  WindowKey,
} from "./types.ts";

export const DAY = 86_400_000;

export function tierOf(eq: number): Tier {
  if (eq < 250) return "<$250";
  if (eq < 2500) return "$250–2.5k";
  if (eq < 25000) return "$2.5k–25k";
  return ">$25k";
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Port of monad/web/src/lib/mock/seed.ts computeMetrics, with injectable `now`. */
export function computeMetrics(eq: EquityPoint[], ints: Interaction[], window: WindowKey, now: number): Metrics {
  const winDays = window === "7d" ? 7 : window === "30d" ? 30 : Infinity;
  const startT = now - winDays * DAY;
  const pts = eq.filter((p) => p.t >= startT - 1);
  const rets: number[] = [];
  for (let i = 1; i < pts.length; i++) rets.push(pts[i].usd / pts[i - 1].usd - 1);
  const n = rets.length;
  const mean = n ? rets.reduce((a, b) => a + b, 0) / n : 0;
  const sd = std(rets);
  const srd = sd > 0 ? mean / sd : 0;
  const downside = Math.sqrt(rets.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / Math.max(1, n));
  const sortinoD = downside > 0 ? mean / downside : 0;
  const ann = Math.sqrt(365);
  const se = n > 1 ? Math.sqrt((1 + 0.5 * srd * srd) / n) : 0;
  let peak = -Infinity;
  let maxDd = 0;
  for (const p of pts) {
    peak = Math.max(peak, p.usd);
    maxDd = Math.max(maxDd, peak > 0 ? (peak - p.usd) / peak : 0);
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  const inWin = ints.filter((i) => i.ts > startT);
  const closing = inWin.filter(isClosing);
  const wins = closing.filter((i) => i.pnlUsd > 0).length;
  const retPct = first && last ? (last.usd / first.usd - 1) * 100 : 0;
  const benchRet = first && last ? (last.sol / first.sol - 1) * 100 : 0;
  return {
    window,
    days: n,
    trades: inWin.length,
    returnPct: retPct,
    solReturnPct: benchRet,
    excessPct: retPct - benchRet,
    sharpe: srd * ann,
    sharpeLo: (srd - 1.96 * se) * ann,
    sharpeHi: (srd + 1.96 * se) * ann,
    sortino: sortinoD * ann,
    maxDrawdownPct: maxDd * 100,
    winRate: closing.length ? (wins / closing.length) * 100 : 0,
    eligible: n >= 7 && inWin.length >= 10,
  };
}

export function assembleDetail(agent: Agent, interactions: Interaction[], equity: EquityPoint[], now: number): AgentDetail {
  const ints = [...interactions].sort((a, b) => a.ts - b.ts);
  const last = equity[equity.length - 1];
  const equityUsd = last?.usd ?? agent.startCapitalUsd;
  const realizedTotal = ints.reduce((a, i) => a + i.pnlUsd, 0);
  const unrealizedUsd = equityUsd - agent.startCapitalUsd - realizedTotal;

  const byP = new Map<ProtocolId, ProtocolStat & { closing: number; wins: number }>();
  const wf = new Map<PnlComponent, number>();
  let gasCost = 0;
  let positive = 0;
  let slip = 0;
  let priv = 0;
  let mev = 0;
  for (const i of ints) {
    const s = byP.get(i.protocol) ?? {
      protocol: i.protocol,
      trades: 0,
      pnlUsd: 0,
      winRate: 0,
      costUsd: 0,
      closing: 0,
      wins: 0,
    };
    s.trades++;
    s.pnlUsd += i.pnlUsd;
    if (isClosing(i)) {
      s.closing++;
      if (i.pnlUsd > 0) s.wins++;
    }
    for (const c of i.components) {
      wf.set(c.label, (wf.get(c.label) ?? 0) + c.usd);
      if (c.label === "swapFee" || c.label === "gas" || c.label === "mevLeak") s.costUsd += Math.min(0, c.usd);
      if (c.label === "gas") gasCost += -c.usd;
      if (c.usd > 0 && c.label !== "swapFee") positive += c.usd;
    }
    slip += i.execution.slippageBps;
    if (i.execution.private) priv++;
    mev += i.execution.mevBps;
    byP.set(i.protocol, s);
  }
  const execution: ExecutionStats = {
    gasPctOfGross: positive > 0 ? (gasCost / positive) * 100 : 0,
    avgSlippageBps: ints.length ? slip / ints.length : 0,
    privateFlowPct: ints.length ? (priv / ints.length) * 100 : 0,
    avgMevBps: ints.length ? mev / ints.length : 0,
  };
  const byProtocol: ProtocolStat[] = [...byP.values()]
    .map((s) => ({
      protocol: s.protocol,
      trades: s.trades,
      pnlUsd: s.pnlUsd,
      costUsd: s.costUsd,
      winRate: s.closing ? (s.wins / s.closing) * 100 : 0,
    }))
    .sort((a, b) => b.pnlUsd - a.pnlUsd);
  const waterfall = COMPONENT_ORDER.filter((c) => wf.has(c)).map((label) => ({ label, usd: wf.get(label)! }));

  const eq = equity.length ? equity : [{ t: agent.startedAt, usd: agent.startCapitalUsd, sol: 0 }];

  return {
    agent,
    equityUsd,
    tier: tierOf(equityUsd),
    equity: eq,
    interactions: [...ints].reverse(),
    metrics: {
      "7d": computeMetrics(eq, ints, "7d", now),
      "30d": computeMetrics(eq, ints, "30d", now),
      all: computeMetrics(eq, ints, "all", now),
    },
    byProtocol,
    waterfall,
    unrealizedUsd,
    execution,
  };
}

export function toLeaderboardRow(d: AgentDetail): LeaderboardRow {
  const sparkSrc = d.equity.slice(-30);
  const spark = sparkSrc.map((p, _i, arr) => (arr[0].usd ? (p.usd / arr[0].usd) * 100 : 100));
  return {
    agent: d.agent,
    equityUsd: d.equityUsd,
    tier: d.tier,
    metrics: d.metrics,
    spark,
    gasPctOfGross: d.execution.gasPctOfGross,
  };
}

export function protocolPage(id: ProtocolId, details: AgentDetail[]): ProtocolPage {
  const agents: ProtocolPage["agents"] = [];
  const wf = new Map<PnlComponent, number>();
  const kinds = new Map<string, { trades: number; pnlUsd: number }>();
  for (const d of details) {
    const stat = d.byProtocol.find((s) => s.protocol === id);
    if (stat) agents.push({ slug: d.agent.slug, name: d.agent.name, stat });
    for (const i of d.interactions) {
      if (i.protocol !== id) continue;
      for (const c of i.components) wf.set(c.label, (wf.get(c.label) ?? 0) + c.usd);
      const k = kinds.get(i.kind) ?? { trades: 0, pnlUsd: 0 };
      k.trades++;
      k.pnlUsd += i.pnlUsd;
      kinds.set(i.kind, k);
    }
  }
  agents.sort((a, b) => b.stat.pnlUsd - a.stat.pnlUsd);
  return {
    protocol: id,
    agents,
    waterfall: [...wf.entries()].map(([label, usd]) => ({ label, usd })),
    totalPnl: agents.reduce((a, x) => a + x.stat.pnlUsd, 0),
    totalTrades: agents.reduce((a, x) => a + x.stat.trades, 0),
    kinds: [...kinds.entries()].map(([kind, v]) => ({ kind, ...v })),
  };
}

export function emptyPolicy(): Agent["policy"] {
  return {
    status: "none",
    allowedProtocols: [],
    perTradeCapUsd: 0,
    dailyCapUsd: 0,
    usedTodayUsd: 0,
    expiresAt: 0,
    changes: [],
  };
}
