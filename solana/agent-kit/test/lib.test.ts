import { createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkSwap, encodeBase58, generateKeypairFile, readKeypair, loadEnv, retryReads, signedBody, signMessage } from '../src/lib';
import { metadataHash } from '../src/registry';

const bal = { sol: 1.5, wsol: 0, usdc: 100 };
describe('checkSwap guardrails', () => {
  it('accepts a normal swap', () => { expect(checkSwap({ side: 'SOL', amount: 0.1, slippageBps: 100 }, bal, 0.5)).toBeUndefined(); });
  it.each([[0], [-1], [NaN], [Infinity]])('rejects amount %s', amount => { expect(checkSwap({ side: 'SOL', amount, slippageBps: 100 }, bal, 0.5)).toMatch(/positive/); });
  it('enforces the per-swap cap', () => { expect(checkSwap({ side: 'SOL', amount: 0.6, slippageBps: 100 }, bal, 0.5)).toMatch(/cap/); });
  it('keeps a SOL reserve for fees', () => { expect(checkSwap({ side: 'SOL', amount: 0.5, slippageBps: 100 }, { ...bal, sol: 0.52 }, 1)).toMatch(/at least/); });
  it('limits USDC input to the balance', () => { expect(checkSwap({ side: 'USDC', amount: 101, slippageBps: 100 }, bal, 0.5)).toMatch(/available/); });
  it('bounds slippage', () => { for (const slippageBps of [0, 1001, 1.5]) expect(checkSwap({ side: 'SOL', amount: 0.1, slippageBps }, bal, 0.5)).toMatch(/Slippage/); });
});
describe('config', () => {
  it('requires a keypair path and a positive cap', () => {
    expect(() => loadEnv({})).toThrow(/TRADGENTS_KEYPAIR/);
    expect(() => loadEnv({ TRADGENTS_KEYPAIR: 'k', TRADGENTS_MAX_SOL: '0' })).toThrow(/positive/);
    expect(loadEnv({ TRADGENTS_KEYPAIR: 'k' })).toMatchObject({ rpcUrl: 'https://api.devnet.solana.com', maxSol: 0.5 });
  });
});
describe('signing', () => {
  const secret = new Uint8Array(64); secret.fill(7, 0, 32);
  it('produces signatures the API verifier accepts (ed25519 over the exact message)', () => {
    const { message, signature } = signedBody(secret, '/v1/posts', { agentSlug: 'a', type: 'thesis', text: 'hi' }, 1_700_000_000_000);
    expect(JSON.parse(message)).toMatchObject({ domain: 'tradgents:v1', path: '/v1/posts', timestamp: 1_700_000_000_000 });
    expect(signature).toMatch(/^[A-Za-z0-9+/]{86}==$/);
    // Re-derive the public key from the seed and verify independently of the signing code path.
    const priv = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(secret.subarray(0, 32))]);
    
    const pub = createPublicKey(createPrivateKey({ key: priv, format: 'der', type: 'pkcs8' }));
    expect(verify(null, Buffer.from(message), pub, Buffer.from(signature, 'base64'))).toBe(true);
    expect(signMessage(secret, 'x')).toBe(signMessage(secret, 'x'));
  });
  it('hashes metadata deterministically', () => {
    const m = { slug: 'a', name: 'A', strategyLabel: 's', runtime: 'codex', wallet: 'w' };
    expect(metadataHash(m).equals(metadataHash({ ...m }))).toBe(true); expect(metadataHash(m).equals(metadataHash({ ...m, name: 'B' }))).toBe(false);
  });
});

describe('retryReads', () => {
  it('retries rate limits and gives up on other errors immediately', async () => {
    let n = 0;
    expect(await retryReads(async () => { if (++n < 2) throw new Error('HTTP error (429): Too Many Requests'); return 'ok'; })).toBe('ok'); expect(n).toBe(2);
    let m = 0;
    await expect(retryReads(async () => { m++; throw new Error('invalid account'); })).rejects.toThrow('invalid account'); expect(m).toBe(1);
  });
});

describe('keygen', () => {
  it('writes a valid owner-only keypair file and refuses to overwrite it', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-')), 'k.json');
    const address = generateKeypairFile(file);
    const bytes = readKeypair(file);
    expect(bytes).toHaveLength(64); expect(encodeBase58(bytes.subarray(32))).toBe(address); expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(() => generateKeypairFile(file)).toThrow(/already exists/);
  });
});
