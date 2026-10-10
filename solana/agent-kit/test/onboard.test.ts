import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../src/client';
import { runCli } from '../src/cli';
import { DEFAULT_API } from '../src/config';
import { encodeBase58 } from '../src/keys';
import { Onboard } from '../src/onboard';
import { loadPolicy, USDC, USDT, WSOL } from '../src/policy';

const dirs: string[] = [];
const temporary = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradgents-onboard-')); dirs.push(dir); return dir; };
function wallet() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  return { privateKey, publicKey, address: encodeBase58(pub), bytes: [...privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32), ...pub] };
}
function stubApi(publicKey?: ReturnType<typeof createPublicKey>) {
  const challenge = { id: '11111111-1111-4111-8111-111111111111', expiresAt: Date.now() + 300_000 };
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let registered: Record<string, unknown>;
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/register')) { registered = body; return Response.json({ agent: body, challenge }, { status: 201 }); }
    if (String(url).endsWith('/claim')) {
      const key = publicKey ?? createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), decodeWallet(String(registered.wallet))]), type: 'spki', format: 'der' });
      const message = `tradgents:register:${challenge.id}:${challenge.expiresAt}`;
      if (body.message !== message || !verify(null, Buffer.from(message), key, Buffer.from(String(body.signature), 'base64'))) return Response.json({ error: 'Invalid proof' }, { status: 401 });
      return Response.json({ ...registered, verification: 'wallet_signed' });
    }
    return Response.json({ error: 'Unknown route' }, { status: 404 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
import { decodeBase58 as decodeWallet } from '../src/keys';
const registration = { name: 'Test Agent', strategy: 'Tiny swaps', runtime: 'custom' as const };
beforeEach(() => { vi.stubEnv('TRADGENTS_HOME', temporary()); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('onboarding with a stub API', () => {
  it('connect creates a private wallet and default policy, proves control and prints only the public funding address', async () => {
    const api = stubApi(); vi.stubGlobal('fetch', api.fetcher);
    const dir = path.join(temporary(), 'signer');
    const emitted: unknown[] = [];
    await runCli(['connect', '--dir', dir, '--name', registration.name, '--strategy', registration.strategy], result => emitted.push(result));
    const policy = loadPolicy(path.join(dir, 'policy.json'));
    expect(policy).toMatchObject({ network: 'mainnet-beta', apiUrl: DEFAULT_API, maxTradeUsd: 10, maxDailyUsd: 25, maxTradesPerDay: 20, allowedMints: { [WSOL]: 'SOL', [USDC]: 'USDC', [USDT]: 'USDT' } });
    expect(fs.statSync(policy.keypairPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(emitted[0]).toMatchObject({ fundingAddress: expect.any(String), verification: 'wallet_signed', keyCreated: true });
    expect(api.calls).toHaveLength(2);
    expect(api.calls[0].url).toBe(`${DEFAULT_API}/v1/agents/register`);
    expect(JSON.stringify(emitted)).not.toContain(fs.readFileSync(policy.keypairPath, 'utf8'));
    await expect(runCli(['connect', '--dir', dir, '--name', 'Test', '--strategy', 'Test'])).rejects.toThrow('Policy already exists');
  });
  it('watch reads the existing key once, signs only the challenge and does not copy it', async () => {
    const key = wallet(), directory = temporary(), file = path.join(directory, 'external.json');
    fs.writeFileSync(file, JSON.stringify(key.bytes), { mode: 0o600 });
    const api = stubApi(key.publicKey); vi.stubGlobal('fetch', api.fetcher);
    const read = vi.spyOn(fs, 'readFileSync');
    const emitted: unknown[] = [];
    await runCli(['watch', '--keypair', file, '--name', 'Watch', '--strategy', 'External'], result => emitted.push(result));
    expect(read.mock.calls.filter(([name]) => name === file)).toHaveLength(1); read.mockRestore();
    expect(emitted[0]).toMatchObject({ wallet: key.address, verification: 'wallet_signed' });
    expect(api.calls[0].body).not.toHaveProperty('keypair');
    expect(fs.readdirSync(process.env.TRADGENTS_HOME!)).toEqual(['profile.json']);
    expect(fs.readFileSync(file, 'utf8')).toBe(JSON.stringify(key.bytes));
  });
  it('external watch prints a public challenge; claim converts base58 to the API base64 proof', async () => {
    const key = wallet(), api = stubApi(key.publicKey); vi.stubGlobal('fetch', api.fetcher);
    const output: { message?: string }[] = [];
    await runCli(['watch', '--wallet', key.address, '--name', 'External', '--strategy', 'Other venue'], result => output.push(result as { message: string }));
    const proof = sign(null, Buffer.from(output[0].message!), key.privateKey);
    const result: unknown[] = [];
    await runCli(['claim', '--signature', encodeBase58(proof)], value => result.push(value));
    expect(api.calls[1].body.signature).toBe(proof.toString('base64'));
    expect(result[0]).toMatchObject({ wallet: key.address, verification: 'wallet_signed' });
    await expect(runCli(['claim', '--signature', encodeBase58(proof)])).rejects.toThrow('No pending challenge');
  });
  it('rejects malformed signatures, ambiguous watch inputs and expired or cross-API challenges', async () => {
    const key = wallet(), api = stubApi(key.publicKey), home = temporary();
    const onboarding = new Onboard(new Client('https://stub.example', '', api.fetcher), home);
    await expect(onboarding.watch(registration, {})).rejects.toThrow('exactly one');
    await onboarding.watch(registration, { wallet: key.address });
    await expect(onboarding.claim('111')).rejects.toThrow('64-byte');
    const pendingFile = path.join(home, 'claim.json'), pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    const proof = encodeBase58(sign(null, Buffer.from(pending.message), key.privateKey));
    await expect(new Onboard(new Client('https://other.example', '', api.fetcher), home).claim(proof)).rejects.toThrow('differs');
    fs.writeFileSync(pendingFile, JSON.stringify({ ...pending, expiresAt: Date.now() - 1 }));
    await expect(onboarding.claim(proof)).rejects.toThrow('expired');
  });
  it('API failures return safe errors and preserve owner wallet for recovery', async () => {
    const dir = path.join(temporary(), 'signer');
    const client = new Client('https://stub.example', '', async () => Response.json({ error: 'secret-internal-path' }, { status: 503 }));
    await expect(new Onboard(client, temporary()).connect(registration, { dir })).rejects.toThrow('HTTP 503');
    expect(fs.existsSync(path.join(dir, 'key.json'))).toBe(true);
  });
  it('rejects invalid network before writing files and creates explicit devnet policies', async () => {
    const dir = path.join(temporary(), 'signer'), api = stubApi();
    const onboarding = new Onboard(new Client('https://stub.example', '', api.fetcher), temporary());
    await expect(onboarding.connect(registration, { dir, network: 'invalid' })).rejects.toThrow();
    expect(fs.existsSync(dir)).toBe(false);
    await onboarding.connect(registration, { dir, network: 'devnet' });
    expect(loadPolicy(path.join(dir, 'policy.json'))).toMatchObject({ network: 'devnet', maxTradesPerDay: 20, rpcUrl: 'https://api.devnet.solana.com' });
  });
});
