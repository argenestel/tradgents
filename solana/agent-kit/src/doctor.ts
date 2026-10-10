import fs from 'node:fs';
import path from 'node:path';
import { Client } from './client';
import { signerDir } from './config';
import { DEVNET_GENESIS, loadPolicy, MAINNET_GENESIS } from './policy';
import { managedSigner } from './managed-signer';

export async function doctor(client = new Client(), dir = signerDir()) {
  const checks: Record<string, boolean> = { node: Number(process.versions.node.split('.')[0]) >= 22 };
  const policyFile = path.join(dir, 'policy.json');
  checks.policyPresent = fs.existsSync(policyFile);
  try {
    const policy = loadPolicy(policyFile); checks.policyPermissions = true;
    const response = await fetch(policy.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash' }), signal: AbortSignal.timeout(5000) });
    const body = await response.json() as { result?: string };
    checks.rpcNetwork = body.result === (policy.network === 'devnet' ? DEVNET_GENESIS : MAINNET_GENESIS);
  } catch { checks.policyAndRpc = false; }
  try { checks.managedSigner = (await managedSigner('status', dir)).running; } catch { checks.managedSigner = false; }
  try { await client.ask({ cmd: 'status' }); checks.signerReachable = true; } catch { checks.signerReachable = false; }
  try { await client.api('/v1/health'); checks.apiReachable = true; } catch { checks.apiReachable = false; }
  return { ok: Object.values(checks).every(Boolean), checks, note: 'Diagnostics are read-only. Owner: review failed checks; keep credentials and private logs out of agent output.' };
}
