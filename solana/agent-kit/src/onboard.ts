import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Client, slugSchema } from './client';
import { AgentError, clientDir, defaultNetwork, expandPath, networkSchema, signerDir } from './config';
import { decodeBase58, encodeBase58, readKeypair, signClaim } from './keys';
import { loadPolicy } from './policy';
import { signerMain } from './signer-main';

const registrationSchema = z.object({
  name: z.string().min(1).max(80), strategy: z.string().min(1).max(120),
  slug: slugSchema.optional(), bio: z.string().max(500).optional(),
  runtime: z.enum(['codex', 'claude-code', 'pi', 'grok', 'dots', 'custom']).default('custom'),
});
const pendingSchema = z.object({ slug: slugSchema, wallet: z.string(), api: z.string().url(), message: z.string().regex(/^tradgents:register:[0-9a-f-]{36}:\d{13}$/), expiresAt: z.number().int() });
type Pending = z.infer<typeof pendingSchema>;
export type Registration = z.input<typeof registrationSchema>;
export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
export class Onboard {
  constructor(private readonly client = new Client(), private readonly home = clientDir()) {}
  private pendingFile() { return path.join(this.home, 'claim.json'); }
  private save(file: string, value: unknown) {
    fs.mkdirSync(this.home, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
  }
  async register(wallet: string, raw: Registration): Promise<Pending> {
    if (decodeBase58(wallet).length !== 32) throw new AgentError('Wallet must be a base58 Solana public address.');
    const input = registrationSchema.parse(raw), slug = slugSchema.parse(input.slug ?? slugify(input.name));
    const result = await this.client.api<{ challenge: { id: string; expiresAt: number } }>('/v1/agents/register', { slug, wallet, name: input.name, bio: input.bio ?? input.strategy, runtime: input.runtime, strategyLabel: input.strategy, protocols: [], startCapitalUsd: 0 });
    const pending = pendingSchema.parse({ slug, wallet, api: this.client.apiUrl, message: `tradgents:register:${result.challenge.id}:${result.challenge.expiresAt}`, expiresAt: result.challenge.expiresAt });
    this.save(this.pendingFile(), pending); // Public challenge only; never a key or a signature.
    return pending;
  }
  private async submit(pending: Pending, signature: string) {
    if (pending.expiresAt <= Date.now()) throw new AgentError('Registration challenge expired. Ask the API owner for a fresh challenge; do not sign an old message.');
    if (pending.api !== this.client.apiUrl) throw new AgentError('Challenge API differs from TRADGENTS_API. Use the API that issued the challenge.');
    const result = await this.client.api(`/v1/agents/${pending.slug}/claim`, { message: pending.message, signature });
    this.save(path.join(this.home, 'profile.json'), { slug: pending.slug, wallet: pending.wallet, api: pending.api });
    fs.rmSync(this.pendingFile(), { force: true });
    return { slug: pending.slug, wallet: pending.wallet, verification: 'wallet_signed', profile: result };
  }
  async watch(raw: Registration, options: { keypair?: string; wallet?: string }) {
    if (!!options.keypair === !!options.wallet) throw new AgentError('watch needs exactly one of --keypair or --wallet.');
    if (options.wallet) return { ...await this.register(options.wallet, raw), next: 'Sign message exactly as UTF-8 with your external wallet, then run tradgents claim --signature <base58>.' };
    const bytes = readKeypair(expandPath(options.keypair!)); // One read, no copy or persistence.
    try {
      const pending = await this.register(encodeBase58(bytes.subarray(32)), raw);
      return await this.submit(pending, signClaim(bytes, pending.message));
    } finally { bytes.fill(0); }
  }
  async claim(signature: string) {
    if (!fs.existsSync(this.pendingFile())) throw new AgentError('No pending challenge. Run watch --wallet <address> first.');
    const pending = pendingSchema.parse(JSON.parse(fs.readFileSync(this.pendingFile(), 'utf8')));
    const bytes = decodeBase58(signature);
    if (bytes.length !== 64) throw new AgentError('Signature must be a base58-encoded 64-byte Ed25519 signature.');
    return this.submit(pending, Buffer.from(bytes).toString('base64'));
  }
  async connect(raw: Registration, options: { dir?: string; rpc?: string; network?: string; registry?: string } = {}) {
    // Validate before creating owner files; init refuses to overwrite any policy.
    registrationSchema.parse(raw);
    const network = networkSchema.parse(options.network ?? defaultNetwork()), dir = expandPath(options.dir ?? signerDir());
    const initialized = await signerMain(['init', '--dir', dir, '--network', network, '--api', this.client.apiUrl, ...(options.rpc ? ['--rpc', options.rpc] : []), ...(options.registry ? ['--registry', options.registry] : [])]);
    const policy = loadPolicy(path.join(dir, 'policy.json'));
    const registration = await this.watch(raw, { keypair: policy.keypairPath });
    return { ...registration, network, policy: path.join(dir, 'policy.json'), keyCreated: initialized?.keyCreated, fundingAddress: registration.wallet,
      next: 'Owner: review the policy and OS separation, fund this address only when ready, then run tradgents signer start.' };
  }
}
