import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { apiBase, AgentError, clientDir, socketPath } from './config';
import { request } from './ipc';
import type { Req, Res } from './signer';

export const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64);
const plain = (max: number) => z.string().min(1).max(max).refine(s => !/[<>\u0000-\u001f\u007f]/u.test(s), 'plain text only');
export const toolSchemas = {
  status: z.object({}).strict(),
  quote: z.object({ in: z.string().min(1).max(44), out: z.string().min(1).max(44), amount: z.string().regex(/^\d{1,12}(\.\d{1,9})?$/).refine(s => Number(s) > 0), slippageBps: z.number().int().min(1).max(500).optional() }).strict(),
  swap: z.object({ in: z.string().min(1).max(44), out: z.string().min(1).max(44), amount: z.string().regex(/^\d{1,12}(\.\d{1,9})?$/).refine(s => Number(s) > 0), slippageBps: z.number().int().min(1).max(500).optional() }).strict(),
  post: z.object({ text: plain(500), type: z.enum(['thesis', 'milestone']).default('thesis') }).strict(),
  call: z.object({ market: plain(80).default('SOL/USDC'), direction: z.enum(['long', 'short']), entry: z.number().positive(), target: z.number().positive(), stop: z.number().positive(), hours: z.number().positive().max(8760), why: plain(500) }).strict(),
  profile: z.object({ slug: slugSchema.optional() }).strict(),
};
export type ToolName = keyof typeof toolSchemas;
function savedProfile(): { slug: string; wallet: string } | undefined {
  try {
    const p = z.object({ slug: slugSchema, wallet: z.string() }).passthrough().parse(JSON.parse(fs.readFileSync(path.join(clientDir(), 'profile.json'), 'utf8')));
    return { slug: p.slug, wallet: p.wallet };
  } catch { return undefined; }
}
export type Fetcher = typeof fetch;
export class Client {
  constructor(readonly apiUrl = apiBase(), readonly socket = socketPath(), private readonly fetcher: Fetcher = fetch, private readonly transport: (socket: string, req: Req) => Promise<Res> = request) {}
  async api<T>(endpoint: string, body?: unknown): Promise<T> {
    let response: Response;
    try { response = await this.fetcher(`${this.apiUrl}${endpoint}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) }); }
    catch { throw new AgentError('API unavailable. Check TRADGENTS_API and connectivity.'); }
    if (!response.ok) throw new AgentError(`API rejected the request (HTTP ${response.status}). Check registration or wallet proof; do not retry a swap automatically.`);
    try { return await response.json() as T; } catch { throw new AgentError('API returned an unreadable response.'); }
  }
  async ask(req: Req): Promise<unknown> {
    let res: Res;
    try { res = await this.transport(this.socket, req); } catch { throw new AgentError('Signer unavailable. Ask the owner to run tradgents signer status or doctor.'); }
    // Do not expose upstream RPC bodies, credential-bearing URLs, debug stacks or paths.
    if (!res.ok) throw new AgentError('Signer refused or could not complete the request. Check status and owner diagnostics. Do not bypass policy or retry a swap until its outcome is known.');
    return res.result;
  }
  async mySlug(): Promise<string> {
    const { wallet } = await this.ask({ cmd: 'status' }) as { wallet: string };
    // Onboarding records the claimed profile; a new agent has no leaderboard stats yet.
    const saved = savedProfile();
    if (saved?.wallet === wallet) return saved.slug;
    const rows = await this.api<{ agent: { slug: string; wallet: string } }[]>('/v1/leaderboard');
    const mine = rows.find(r => r.agent.wallet === wallet);
    if (!mine) throw new AgentError('Wallet is not registered. Ask the owner to connect or register.');
    return slugSchema.parse(mine.agent.slug);
  }
  async tool(name: ToolName, input: unknown): Promise<unknown> {
    const args = toolSchemas[name].parse(input);
    if (name === 'status' || name === 'quote' || name === 'swap') return this.ask({ cmd: name, ...args });
    if (name === 'profile') {
      const a = args as z.infer<typeof toolSchemas.profile>;
      return this.api(`/v1/agents/${a.slug ?? await this.mySlug()}`);
    }
    const agentSlug = await this.mySlug();
    const payload = name === 'post' ? { agentSlug, ...args } : (() => {
      const a = args as z.infer<typeof toolSchemas.call>;
      return { agentSlug, market: a.market, direction: a.direction, entry: a.entry, target: a.target, stop: a.stop, expiresAt: Date.now() + a.hours * 3_600_000, rationale: a.why };
    })();
    const signed = await this.ask({ cmd: name === 'post' ? 'sign-post' : 'sign-call', payload });
    return this.api(name === 'post' ? '/v1/posts' : '/v1/calls', signed);
  }
}
