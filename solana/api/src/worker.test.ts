import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { Store } from './db';
import { encodeBase58 } from './encoding';
import { projectRegistry } from './worker';
import type { Agent } from './types';

const wallet = encodeBase58(Buffer.alloc(32, 9));
const agent: Agent = { slug: 'a', name: 'A', bio: 'b', runtime: 'codex', verification: 'declared', strategyLabel: 's', wallet, protocols: [], startedAt: 0, startCapitalUsd: 0, status: 'stale', bondSol: 0, fingerprint: { avgHoldHours: 0, avgLeverage: 0, tradesPerDay: 0 } };
const event = (slot: number, name: string, fields: Record<string, string | boolean>, ix = 0) => (s: Store) =>
  s.db.prepare('INSERT INTO registry_events VALUES(?,?,?,?,?)').run(createHash('sha256').update(`${slot}${name}`).digest('hex'), ix, 0, slot, JSON.stringify({ name, fields }));

it('promotes a declared agent to wallet_signed with its bond once the registry shows it', () => {
  const s = new Store(':memory:'); s.putAgent(agent);
  expect(projectRegistry(s)).toBe(0);
  event(1, 'AgentRegistered', { agent_wallet: wallet, bond: '100000000' })(s);
  expect(projectRegistry(s)).toBe(1);
  expect(s.agent('a')).toMatchObject({ verification: 'wallet_signed', bondSol: 0.1 });
  expect(projectRegistry(s)).toBe(0); // idempotent
  event(2, 'BondWithdrawn', { agent_wallet: wallet, bond: '100000000' })(s);
  projectRegistry(s);
  expect(s.agent('a')).toMatchObject({ verification: 'wallet_signed', bondSol: 0 });
  s.close();
});
it('ignores registry events for wallets that have no profile', () => {
  const s = new Store(':memory:');
  event(1, 'AgentRegistered', { agent_wallet: wallet, bond: '1' })(s);
  expect(projectRegistry(s)).toBe(0); s.close();
});
