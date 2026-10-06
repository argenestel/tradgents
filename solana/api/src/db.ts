import { DatabaseSync } from 'node:sqlite';
import type { Agent, Call, EquityPoint, Interaction, Post } from './types';

export class Store {
  readonly db: DatabaseSync;
  constructor(path = process.env.DB_PATH ?? './tradgents.sqlite') {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS agents(slug TEXT PRIMARY KEY,wallet TEXT UNIQUE NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trades(id TEXT PRIMARY KEY,agent TEXT NOT NULL REFERENCES agents(slug),ts INTEGER NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS equity(agent TEXT NOT NULL REFERENCES agents(slug),ts INTEGER NOT NULL,data TEXT NOT NULL,flow REAL NOT NULL DEFAULT 0,src TEXT NOT NULL DEFAULT 'tx' CHECK(src IN('tx','mark')),PRIMARY KEY(agent,ts));
      CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY,agent TEXT NOT NULL REFERENCES agents(slug),ts INTEGER NOT NULL,data TEXT NOT NULL,untrusted INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,agent TEXT NOT NULL REFERENCES agents(slug),ts INTEGER NOT NULL,data TEXT NOT NULL,untrusted INTEGER NOT NULL DEFAULT 1);
      CREATE INDEX IF NOT EXISTS posts_time ON posts(ts DESC,id DESC);
      CREATE INDEX IF NOT EXISTS trades_agent ON trades(agent,ts);
      CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,wallet TEXT NOT NULL,message TEXT NOT NULL,metadata TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS nonces(wallet TEXT NOT NULL,nonce TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(wallet,nonce));
      CREATE TABLE IF NOT EXISTS quotas(principal TEXT NOT NULL,kind TEXT NOT NULL,last INTEGER NOT NULL,PRIMARY KEY(principal,kind));
      CREATE TABLE IF NOT EXISTS registry_events(signature TEXT NOT NULL,ix_index INTEGER NOT NULL,event_index INTEGER NOT NULL,slot INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(signature,ix_index,event_index));
      CREATE TABLE IF NOT EXISTS indexer_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS raw_transactions(signature TEXT PRIMARY KEY,wallet TEXT NOT NULL,slot INTEGER NOT NULL,block_time INTEGER NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS raw_wallet ON raw_transactions(wallet,slot);`);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  rows<T>(sql: string, ...args: (string | number)[]): T[] {
    return (this.db.prepare(sql).all(...args) as { data: string }[]).map(r => JSON.parse(r.data) as T);
  }
  agents(): Agent[] { return this.rows<Agent>('SELECT data FROM agents ORDER BY slug'); }
  agent(slug: string): Agent | undefined { return this.rows<Agent>('SELECT data FROM agents WHERE slug=?', slug)[0]; }
  wallet(wallet: string): Agent | undefined { return this.rows<Agent>('SELECT data FROM agents WHERE wallet=?', wallet)[0]; }
  state(key: string): string | undefined { return (this.db.prepare('SELECT value FROM indexer_state WHERE key=?').get(key) as { value: string } | undefined)?.value; }
  setState(key: string, value: string) { this.db.prepare('INSERT INTO indexer_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
  putAgent(a: Agent) { this.db.prepare('INSERT INTO agents VALUES(?,?,?)').run(a.slug, a.wallet, JSON.stringify(a)); }
  updateAgent(a: Agent) { this.db.prepare('UPDATE agents SET data=? WHERE slug=?').run(JSON.stringify(a), a.slug); }
  putTrade(i: Interaction) { this.db.prepare('INSERT OR REPLACE INTO trades VALUES(?,?,?,?)').run(i.id, i.agentSlug, i.ts, JSON.stringify(i)); }
  putEquity(agent: string, p: EquityPoint, flow = 0, src: 'tx' | 'mark' = 'tx') { this.db.prepare('INSERT OR REPLACE INTO equity VALUES(?,?,?,?,?)').run(agent, p.t, JSON.stringify(p), flow, src); }
  putPost(p: Post) { this.db.prepare('INSERT OR REPLACE INTO posts(id,agent,ts,data) VALUES(?,?,?,?)').run(p.id, p.agentSlug, p.ts, JSON.stringify(p)); }
  putCall(c: Call) { this.db.prepare('INSERT INTO calls(id,agent,ts,data) VALUES(?,?,?,?)').run(c.id, c.agentSlug, c.createdAt, JSON.stringify(c)); }
  close() { this.db.close(); }
}
