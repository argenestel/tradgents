import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assembleDetail, emptyPolicy } from "./metrics.ts";
import { MOCK_NOW, buildDemo } from "./seed.ts";
import type {
  Agent,
  AgentDetail,
  Call,
  EquityPoint,
  Interaction,
  Post,
  ProtocolId,
  RuntimeId,
  AccountType,
  Verification,
} from "./types.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  runtime TEXT NOT NULL,
  verification TEXT NOT NULL,
  strategy_label TEXT NOT NULL DEFAULT '',
  wallet TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  account_type TEXT NOT NULL,
  erc8004_id INTEGER,
  protocols TEXT NOT NULL DEFAULT '[]',
  started_at INTEGER NOT NULL,
  start_capital_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'live',
  bond_mon REAL NOT NULL DEFAULT 0,
  policy TEXT NOT NULL,
  approvals TEXT NOT NULL DEFAULT '[]',
  fingerprint TEXT NOT NULL,
  metadata_hash TEXT,
  registry_status TEXT,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  protocol TEXT NOT NULL,
  kind TEXT NOT NULL,
  legs TEXT NOT NULL,
  notional_usd REAL NOT NULL,
  pnl_usd REAL NOT NULL,
  components TEXT NOT NULL,
  execution TEXT NOT NULL,
  meta TEXT NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS equity_points (
  agent_slug TEXT NOT NULL,
  t INTEGER NOT NULL,
  usd REAL NOT NULL,
  sol REAL NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_slug, t)
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  agent_slug TEXT NOT NULL,
  type TEXT NOT NULL,
  untrusted_text TEXT,
  interaction_id TEXT,
  call_id TEXT,
  reactions TEXT NOT NULL,
  replies INTEGER NOT NULL DEFAULT 0,
  content_trust TEXT NOT NULL DEFAULT 'untrusted',
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  market TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry REAL NOT NULL,
  target REAL NOT NULL,
  stop REAL NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  r_multiple REAL,
  traded INTEGER NOT NULL DEFAULT 0,
  rationale TEXT NOT NULL DEFAULT '',
  content_trust TEXT NOT NULL DEFAULT 'untrusted',
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS raw_logs (
  chain_id INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  block_hash TEXT,
  address TEXT,
  topic0 TEXT,
  topics TEXT,
  data TEXT,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE TABLE IF NOT EXISTS indexer_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_block INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS api_nonces (
  wallet TEXT PRIMARY KEY,
  nonce INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE TABLE IF NOT EXISTS wallet_proofs (
  wallet TEXT NOT NULL,
  signature TEXT NOT NULL,
  message_hash TEXT,
  sig_kind TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_wallet ON agents(wallet);
CREATE INDEX IF NOT EXISTS idx_posts_ts ON posts(ts DESC);
CREATE INDEX IF NOT EXISTS idx_calls_created ON calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ints_agent ON interactions(agent_slug, ts);
`;

function j<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export class Db {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.raw.exec(SCHEMA);
    this.raw.exec("INSERT OR IGNORE INTO indexer_state (id, last_block) VALUES (1, 0)");
  }

  close(): void {
    this.raw.close();
  }

  hasDemo(): boolean {
    const row = this.raw.prepare("SELECT 1 AS x FROM agents WHERE demo = 1 LIMIT 1").get() as { x: number } | undefined;
    return Boolean(row);
  }

  seedDemo(): void {
    const demo = buildDemo();
    this.raw.exec("BEGIN");
    try {
      this.raw.exec("DELETE FROM posts WHERE demo = 1");
      this.raw.exec("DELETE FROM calls WHERE demo = 1");
      this.raw.exec("DELETE FROM interactions WHERE demo = 1");
      this.raw.exec("DELETE FROM equity_points WHERE demo = 1");
      this.raw.exec("DELETE FROM agents WHERE demo = 1");
      for (const d of demo.agents) {
        this.insertAgent(d.agent, true);
        for (const i of d.interactions) this.insertInteraction(i, true);
        for (const e of d.equity) this.insertEquity(d.agent.slug, e, true);
      }
      for (const c of demo.calls) this.insertCall(c, true);
      for (const p of demo.posts) this.insertPost(p, true);
      this.raw.exec("COMMIT");
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }

  insertAgent(a: Agent, demo: boolean): void {
    this.raw.prepare(
      `INSERT INTO agents (
        slug, name, bio, runtime, verification, strategy_label, wallet, owner, account_type,
        erc8004_id, protocols, started_at, start_capital_usd, status, bond_mon, policy, approvals, fingerprint, demo
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(slug) DO UPDATE SET
        name=excluded.name, bio=excluded.bio, runtime=excluded.runtime, verification=excluded.verification,
        strategy_label=excluded.strategy_label, wallet=excluded.wallet, owner=excluded.owner,
        account_type=excluded.account_type, erc8004_id=excluded.erc8004_id, protocols=excluded.protocols,
        started_at=excluded.started_at, start_capital_usd=excluded.start_capital_usd, status=excluded.status,
        bond_mon=excluded.bond_mon, policy=excluded.policy, approvals=excluded.approvals, fingerprint=excluded.fingerprint`,
    ).run(
      a.slug,
      a.name,
      a.bio,
      a.runtime,
      a.verification,
      a.strategyLabel,
      a.wallet.toLowerCase(),
      a.owner.toLowerCase(),
      a.accountType,
      a.erc8004Id ?? null,
      JSON.stringify(a.protocols),
      a.startedAt,
      a.startCapitalUsd,
      a.status,
      a.bondMon,
      JSON.stringify(a.policy),
      JSON.stringify(a.approvals),
      JSON.stringify(a.fingerprint),
      demo ? 1 : 0,
    );
  }

  insertInteraction(i: Interaction, demo: boolean): void {
    this.raw.prepare(
      `INSERT OR REPLACE INTO interactions (
        id, agent_slug, tx_hash, log_index, block_number, ts, protocol, kind, legs, notional_usd, pnl_usd, components, execution, meta, demo
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      i.id,
      i.agentSlug,
      i.txHash,
      i.logIndex,
      i.blockNumber,
      i.ts,
      i.protocol,
      i.kind,
      JSON.stringify(i.legs),
      i.notionalUsd,
      i.pnlUsd,
      JSON.stringify(i.components),
      JSON.stringify(i.execution),
      JSON.stringify(i.meta),
      demo ? 1 : 0,
    );
  }

  insertEquity(slug: string, e: EquityPoint, demo: boolean): void {
    this.raw.prepare(
      "INSERT OR REPLACE INTO equity_points (agent_slug, t, usd, sol, demo) VALUES (?,?,?,?,?)",
    ).run(slug, e.t, e.usd, e.sol, demo ? 1 : 0);
  }

  insertCall(c: Call, demo: boolean): void {
    this.raw.prepare(
      `INSERT OR REPLACE INTO calls (
        id, agent_slug, market, direction, entry, target, stop, created_at, expires_at, status, r_multiple, traded, rationale, demo
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      c.id,
      c.agentSlug,
      c.market,
      c.direction,
      c.entry,
      c.target,
      c.stop,
      c.createdAt,
      c.expiresAt,
      c.status,
      c.rMultiple ?? null,
      c.traded ? 1 : 0,
      c.rationale,
      demo ? 1 : 0,
    );
  }

  insertPost(p: Post, demo: boolean): void {
    this.raw.prepare(
      `INSERT OR REPLACE INTO posts (
        id, ts, agent_slug, type, untrusted_text, interaction_id, call_id, reactions, replies, demo
      ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      p.id,
      p.ts,
      p.agentSlug,
      p.type,
      p.text ?? null,
      p.interactionId ?? null,
      p.callId ?? null,
      JSON.stringify(p.reactions),
      p.replies,
      demo ? 1 : 0,
    );
  }

  agentRow(slug: string): Agent | undefined {
    const row = this.raw.prepare("SELECT * FROM agents WHERE slug = ?").get(slug) as Record<string, unknown> | undefined;
    return row ? this.toAgent(row) : undefined;
  }

  agentByWallet(wallet: string): Agent | undefined {
    const row = this.raw.prepare("SELECT * FROM agents WHERE wallet = ?").get(wallet.toLowerCase()) as
      | Record<string, unknown>
      | undefined;
    return row ? this.toAgent(row) : undefined;
  }

  private toAgent(row: Record<string, unknown>): Agent {
    const agent: Agent = {
      slug: String(row.slug),
      name: String(row.name),
      bio: String(row.bio),
      runtime: row.runtime as RuntimeId,
      verification: row.verification as Verification,
      strategyLabel: String(row.strategy_label),
      wallet: String(row.wallet),
      owner: String(row.owner),
      accountType: row.account_type as AccountType,
      protocols: j<ProtocolId[]>(String(row.protocols), []),
      startedAt: Number(row.started_at),
      startCapitalUsd: Number(row.start_capital_usd),
      status: row.status === "stale" ? "stale" : "live",
      bondMon: Number(row.bond_mon),
      policy: j(String(row.policy), emptyPolicy()),
      approvals: j(String(row.approvals), []),
      fingerprint: j(String(row.fingerprint), { avgHoldHours: 0, avgLeverage: 1, tradesPerDay: 0 }),
    };
    if (row.erc8004_id != null) agent.erc8004Id = Number(row.erc8004_id);
    return agent;
  }

  private toInteraction(row: Record<string, unknown>): Interaction {
    return {
      id: String(row.id),
      agentSlug: String(row.agent_slug),
      txHash: String(row.tx_hash),
      logIndex: Number(row.log_index),
      blockNumber: Number(row.block_number),
      ts: Number(row.ts),
      protocol: row.protocol as ProtocolId,
      kind: row.kind as Interaction["kind"],
      legs: j(String(row.legs), []),
      notionalUsd: Number(row.notional_usd),
      pnlUsd: Number(row.pnl_usd),
      components: j(String(row.components), []),
      execution: j(String(row.execution), { slippageBps: 0, private: false, mevBps: 0 }),
      meta: j(String(row.meta), {}),
    };
  }

  interactionsFor(slug: string): Interaction[] {
    const rows = this.raw.prepare("SELECT * FROM interactions WHERE agent_slug = ? ORDER BY ts ASC").all(slug) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.toInteraction(r));
  }

  equityFor(slug: string): EquityPoint[] {
    const rows = this.raw.prepare("SELECT t, usd, sol FROM equity_points WHERE agent_slug = ? ORDER BY t ASC").all(slug) as {
      t: number;
      usd: number;
      sol: number;
    }[];
    return rows.map((r) => ({ t: Number(r.t), usd: Number(r.usd), sol: Number(r.sol) }));
  }

  detail(slug: string, now: number): AgentDetail | undefined {
    const agent = this.agentRow(slug);
    if (!agent) return undefined;
    const clock = this.raw.prepare("SELECT demo FROM agents WHERE slug = ?").get(slug) as { demo: number };
    return assembleDetail(agent, this.interactionsFor(slug), this.equityFor(slug), clock.demo ? MOCK_NOW : now);
  }

  allDetails(now: number): AgentDetail[] {
    const slugs = this.raw.prepare("SELECT slug FROM agents").all() as { slug: string }[];
    return slugs.map((s) => this.detail(s.slug, now)!).filter(Boolean);
  }

  allAgents(): Agent[] {
    const rows = this.raw.prepare("SELECT * FROM agents").all() as Record<string, unknown>[];
    return rows.map((r) => this.toAgent(r));
  }

  allCalls(agentSlug?: string): Call[] {
    const rows = (
      agentSlug
        ? this.raw.prepare("SELECT * FROM calls WHERE agent_slug = ? ORDER BY created_at DESC").all(agentSlug)
        : this.raw.prepare("SELECT * FROM calls ORDER BY created_at DESC").all()
    ) as Record<string, unknown>[];
    return rows.map((r) => this.toCall(r));
  }

  callById(id: string): Call | undefined {
    const row = this.raw.prepare("SELECT * FROM calls WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.toCall(row) : undefined;
  }

  private toCall(r: Record<string, unknown>): Call {
    const c: Call = {
      id: String(r.id),
      agentSlug: String(r.agent_slug),
      market: String(r.market),
      direction: r.direction === "short" ? "short" : "long",
      entry: Number(r.entry),
      target: Number(r.target),
      stop: Number(r.stop),
      createdAt: Number(r.created_at),
      expiresAt: Number(r.expires_at),
      status: r.status as Call["status"],
      traded: Boolean(r.traded),
      rationale: String(r.rationale ?? ""),
    };
    if (r.r_multiple != null) c.rMultiple = Number(r.r_multiple);
    return c;
  }

  interactionById(id: string): Interaction | undefined {
    const row = this.raw.prepare("SELECT * FROM interactions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.toInteraction(row) : undefined;
  }

  posts(filter: "all" | "calls" | "trades" | "thesis", agentSlug?: string, limit = 40): Post[] {
    let sql = "SELECT * FROM posts";
    const args: (string | number)[] = [];
    const where: string[] = [];
    if (agentSlug) {
      where.push("agent_slug = ?");
      args.push(agentSlug);
    }
    if (filter === "calls") where.push("type = 'call'");
    if (filter === "trades") where.push("type = 'trade'");
    if (filter === "thesis") where.push("type = 'thesis'");
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY ts DESC LIMIT ?";
    args.push(limit);
    const rows = this.raw.prepare(sql).all(...args) as Record<string, unknown>[];
    return rows.map((r) => {
      const p: Post = {
        id: String(r.id),
        ts: Number(r.ts),
        agentSlug: String(r.agent_slug),
        type: r.type as Post["type"],
        reactions: j(String(r.reactions), { useful: 0, sharp: 0, fade: 0 }),
        replies: Number(r.replies),
      };
      if (r.untrusted_text != null) p.text = String(r.untrusted_text);
      if (r.interaction_id) p.interactionId = String(r.interaction_id);
      if (r.call_id) p.callId = String(r.call_id);
      return p;
    });
  }

  getNonce(wallet: string): number {
    const row = this.raw.prepare("SELECT nonce FROM api_nonces WHERE wallet = ?").get(wallet.toLowerCase()) as
      | { nonce: number }
      | undefined;
    return row ? Number(row.nonce) : 0;
  }

  bumpNonce(wallet: string, expected: number): boolean {
    const w = wallet.toLowerCase();
    const current = this.getNonce(w);
    if (current !== expected) return false;
    this.raw.prepare(
      "INSERT INTO api_nonces (wallet, nonce) VALUES (?, ?) ON CONFLICT(wallet) DO UPDATE SET nonce = excluded.nonce",
    ).run(w, expected + 1);
    return true;
  }

  hitRateLimit(key: string, windowMs: number, limit: number, now: number): { ok: boolean; n: number } {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    this.raw.prepare(
      "INSERT INTO rate_limits (key, window_start, n) VALUES (?,?,1) ON CONFLICT(key, window_start) DO UPDATE SET n = n + 1",
    ).run(key, windowStart);
    const row = this.raw.prepare("SELECT n FROM rate_limits WHERE key = ? AND window_start = ?").get(key, windowStart) as {
      n: number;
    };
    return { ok: Number(row.n) <= limit, n: Number(row.n) };
  }

  insertRawLog(row: {
    chainId: number;
    txHash: string;
    logIndex: number;
    blockNumber: number;
    blockHash: string;
    address: string;
    topic0: string;
    topics: string;
    data: string;
  }): boolean {
    const res = this.raw.prepare(
      `INSERT OR IGNORE INTO raw_logs (chain_id, tx_hash, log_index, block_number, block_hash, address, topic0, topics, data)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      row.chainId,
      row.txHash.toLowerCase(),
      row.logIndex,
      row.blockNumber,
      row.blockHash,
      row.address.toLowerCase(),
      row.topic0,
      row.topics,
      row.data,
    );
    return Number(res.changes) > 0;
  }

  indexerHead(): number {
    const row = this.raw.prepare("SELECT last_block FROM indexer_state WHERE id = 1").get() as { last_block: number };
    return Number(row.last_block);
  }

  setIndexerHead(n: number): void {
    this.raw.prepare("UPDATE indexer_state SET last_block = ? WHERE id = 1").run(n);
  }

  applyRegistered(p: {
    wallet: string;
    owner: string;
    metadataHash: string;
    bondWei: bigint;
    now: number;
  }): void {
    const existing = this.agentByWallet(p.wallet);
    const bondMon = Number(p.bondWei) / 1e18;
    if (existing) {
      this.raw.prepare(
        "UPDATE agents SET owner = ?, bond_mon = ?, metadata_hash = ?, verification = CASE WHEN verification = 'declared' THEN 'wallet_signed' ELSE verification END, registry_status = 'Active' WHERE wallet = ?",
      ).run(p.owner.toLowerCase(), bondMon, p.metadataHash, p.wallet.toLowerCase());
      return;
    }
    const slug = `agent-${p.wallet.slice(2, 10).toLowerCase()}`;
    const agent: Agent = {
      slug,
      name: slug,
      bio: "",
      runtime: "custom",
      verification: "wallet_signed",
      strategyLabel: "",
      wallet: p.wallet.toLowerCase(),
      owner: p.owner.toLowerCase(),
      accountType: "eoa",
      protocols: [],
      startedAt: p.now,
      startCapitalUsd: 0,
      status: "live",
      bondMon,
      policy: emptyPolicy(),
      approvals: [],
      fingerprint: { avgHoldHours: 0, avgLeverage: 1, tradesPerDay: 0 },
    };
    this.insertAgent(agent, false);
    this.raw.prepare("UPDATE agents SET metadata_hash = ?, registry_status = 'Active' WHERE slug = ?").run(p.metadataHash, slug);
  }

  applyBondWithdrawn(wallet: string): void {
    this.raw.prepare("UPDATE agents SET bond_mon = 0, registry_status = 'Exited' WHERE wallet = ?").run(wallet.toLowerCase());
  }

  applyPaused(wallet: string): void {
    this.raw.prepare("UPDATE agents SET status = 'stale', registry_status = 'Paused' WHERE wallet = ?").run(wallet.toLowerCase());
  }

  applySlashed(wallet: string): void {
    this.raw.prepare("UPDATE agents SET bond_mon = 0, status = 'stale', registry_status = 'Slashed' WHERE wallet = ?").run(
      wallet.toLowerCase(),
    );
  }

  saveProof(wallet: string, signature: string, messageHash: string, kind: string, now: number): void {
    this.raw.prepare("INSERT INTO wallet_proofs (wallet, signature, message_hash, sig_kind, created_at) VALUES (?,?,?,?,?)")
      .run(wallet.toLowerCase(), signature, messageHash, kind, now);
  }
}
