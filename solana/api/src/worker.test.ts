import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { encodeBase58 } from './encoding';
import { migrate } from './migrate';
import { openDb } from './pg';
import { Store } from './store';
import type { Agent } from './types';
import { projectRegistry } from './worker';

const wallet = encodeBase58(Buffer.alloc(32, 9));
const agent: Agent = { slug: 'a', name: 'A', bio: 'b', runtime: 'codex', verification: 'declared', strategyLabel: 's', wallet, protocols: [], startedAt: 0, startCapitalUsd: 0, status: 'stale', bondSol: 0, fingerprint: { avgHoldHours: 0, avgLeverage: 0, tradesPerDay: 0 } };
const fresh = async () => { const db = await openDb('memory:'); await migrate(db); return new Store(db); };
const event = (s: Store, slot: number, name: string, fields: Record<string, string | boolean>) => s.putRegistryEvent(createHash('sha256').update(`${slot}${name}`).digest('hex'), 0, 0, slot, { name, fields });

it('promotes a declared agent to wallet_signed with its bond once the registry shows it', async () => {
  const s = await fresh(); await s.putAgent(agent);
  expect(await projectRegistry(s)).toBe(0);
  await event(s, 1, 'AgentRegistered', { agent_wallet: wallet, bond: '100000000' });
  expect(await projectRegistry(s)).toBe(1);
  expect(await s.agent('a')).toMatchObject({ verification: 'wallet_signed', bondSol: 0.1 });
  expect(await projectRegistry(s)).toBe(0); // idempotent
  await event(s, 2, 'BondWithdrawn', { agent_wallet: wallet, bond: '100000000' });
  await projectRegistry(s);
  expect(await s.agent('a')).toMatchObject({ verification: 'wallet_signed', bondSol: 0 });
  await s.db.close();
});
it('ignores registry events for wallets that have no profile', async () => {
  const s = await fresh();
  await event(s, 1, 'AgentRegistered', { agent_wallet: wallet, bond: '1' });
  expect(await projectRegistry(s)).toBe(0); await s.db.close();
});
