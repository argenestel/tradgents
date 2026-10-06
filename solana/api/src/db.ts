import { DatabaseSync } from 'node:sqlite';
import type { Agent, Call, EquityPoint, Interaction, Post } from './types';
export type Stored<T> = { data: T; demo: boolean };
export class Store {
  readonly db: DatabaseSync;
  constructor(path = process.env.DB_PATH ?? './tradgents.sqlite') {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS agents(slug TEXT PRIMARY KEY,wallet TEXT UNIQUE NOT NULL,data TEXT NOT NULL,demo INTEGER NOT NULL CHECK(demo IN(0,1)));
      CREATE TABLE IF NOT EXISTS trades(id TEXT PRIMARY KEY,agent TEXT NOT NULL REFERENCES agents(slug),ts INTEGER NOT NULL,data TEXT NOT NULL,demo INTEGER NOT NULL CHECK(demo IN(0,1)));
      CREATE TABLE IF NOT EXISTS equity(agent TEXT NOT NULL REFERENCES agents(slug),ts INTEGER NOT NULL,data TEXT NOT NULL,flow REAL NOT NULL DEFAULT 0,demo INTEGER NOT NULL CHECK(demo IN(0,1)),PRIMARY KEY(agent,ts));
      CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY,agent TEXT NOT NULL REFERENCES agents(slug),ts INTEGER NOT NULL,data TEXT NOT NULL,demo INTEGER NOT NULL CHECK(demo IN(0,1)),untrusted INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,agent TEXT NOT NULL REFERENCES agents(slug),ts INTEGER NOT NULL,data TEXT NOT NULL,demo INTEGER NOT NULL CHECK(demo IN(0,1)),untrusted INTEGER NOT NULL DEFAULT 1);
      CREATE INDEX IF NOT EXISTS posts_time ON posts(ts DESC,id DESC);
      CREATE INDEX IF NOT EXISTS trades_agent ON trades(agent,ts);
      CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,wallet TEXT NOT NULL,message TEXT NOT NULL,metadata TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS proofs(id TEXT PRIMARY KEY,agent TEXT NOT NULL REFERENCES agents(slug),message TEXT NOT NULL,signature TEXT NOT NULL,ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS nonces(wallet TEXT NOT NULL,nonce TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(wallet,nonce));
      CREATE TABLE IF NOT EXISTS quotas(principal TEXT NOT NULL,kind TEXT NOT NULL,last INTEGER NOT NULL,PRIMARY KEY(principal,kind));
      CREATE TABLE IF NOT EXISTS registry_events(signature TEXT NOT NULL,ix_index INTEGER NOT NULL,event_index INTEGER NOT NULL,slot INTEGER NOT NULL,data TEXT NOT NULL,demo INTEGER NOT NULL DEFAULT 0 CHECK(demo=0),PRIMARY KEY(signature,ix_index,event_index));
      CREATE TABLE IF NOT EXISTS registry_accounts(wallet TEXT PRIMARY KEY,address TEXT NOT NULL,slot INTEGER NOT NULL,data TEXT NOT NULL,demo INTEGER NOT NULL DEFAULT 0 CHECK(demo=0));
      CREATE TABLE IF NOT EXISTS indexer_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS raw_transactions(signature TEXT PRIMARY KEY,slot INTEGER NOT NULL,data TEXT NOT NULL,demo INTEGER NOT NULL DEFAULT 0 CHECK(demo=0));`);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  agents(): Stored<Agent>[] { return this.rows<Agent>('SELECT data,demo FROM agents ORDER BY slug'); }
  agent(slug: string): Stored<Agent> | undefined { return this.rows<Agent>('SELECT data,demo FROM agents WHERE slug=?',slug)[0]; }
  wallet(wallet: string): Stored<Agent> | undefined { return this.rows<Agent>('SELECT data,demo FROM agents WHERE wallet=?',wallet)[0]; }
  rows<T>(sql: string,...args: (string|number)[]): Stored<T>[] {
    return (this.db.prepare(sql).all(...args) as {data:string;demo:number}[]).map(r=>({data:JSON.parse(r.data) as T,demo:!!r.demo}));
  }
  putAgent(a: Agent,demo: boolean) { this.db.prepare('INSERT INTO agents VALUES(?,?,?,?)').run(a.slug,a.wallet,JSON.stringify(a),+demo); }
  putTrade(i: Interaction,demo: boolean) { this.db.prepare('INSERT INTO trades VALUES(?,?,?,?,?)').run(i.id,i.agentSlug,i.ts,JSON.stringify(i),+demo); }
  putEquity(agent: string,p: EquityPoint,demo: boolean,flow=0) { this.db.prepare('INSERT INTO equity VALUES(?,?,?,?,?)').run(agent,p.t,JSON.stringify(p),flow,+demo); }
  putPost(p: Post,demo: boolean) { this.db.prepare('INSERT INTO posts(id,agent,ts,data,demo) VALUES(?,?,?,?,?)').run(p.id,p.agentSlug,p.ts,JSON.stringify(p),+demo); }
  putCall(c: Call,demo: boolean) { this.db.prepare('INSERT INTO calls(id,agent,ts,data,demo) VALUES(?,?,?,?,?)').run(c.id,c.agentSlug,c.createdAt,JSON.stringify(c),+demo); }
  close() { this.db.close(); }
}
