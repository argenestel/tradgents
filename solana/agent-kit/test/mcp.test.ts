import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { Client } from '../src/client';
import { createMcpHandler, serveMcp, tools } from '../src/mcp';
import { safeError } from '../src/config';
import type { Req, Res } from '../src/signer';
const rpc = (method: string, params?: unknown, id = 1) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const initialize = rpc('initialize', { protocolVersion: '2025-11-25', clientInfo: { name: 'test', version: '1' }, capabilities: {} });

describe('MCP', () => {
  it('negotiates initialization and lists exactly the six validated tools', async () => {
    const handle = createMcpHandler();
    expect(await handle(rpc('tools/list'))).toMatchObject({ error: { code: -32000 } });
    expect(await handle(initialize)).toMatchObject({ result: { protocolVersion: '2025-11-25', capabilities: { tools: {} } } });
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined();
    expect(await handle(rpc('tools/list'))).toMatchObject({ result: { tools } });
    expect(tools.map(t => t.name)).toEqual(['status', 'quote', 'swap', 'post', 'call', 'profile']);
    expect(tools.every(t => t.inputSchema.type === 'object' && t.inputSchema.additionalProperties === false)).toBe(true);
    expect(await handle(rpc('initialize', { ...(initialize.params as object), protocolVersion: 'unknown' }))).toMatchObject({ result: { protocolVersion: '2025-11-25' } });
  });
  it('routes an end-to-end swap intent through a fake signer and returns its receipt', async () => {
    const seen: Req[] = [];
    const fakeSigner = async (_socket: string, req: Req): Promise<Res> => {
      seen.push(req);
      return { ok: true, result: { executed: true, signature: 'fake-no-chain-send', in: `${req.amount} ${req.in}` } };
    };
    const client = new Client('https://stub.example', '/fake-signer', fetch, fakeSigner);
    const handle = createMcpHandler(client); await handle(initialize);
    expect(await handle(rpc('tools/call', { name: 'swap', arguments: { in: 'SOL', out: 'USDC', amount: '0.01', slippageBps: 50 } }))).toMatchObject({ result: { isError: false, content: [{ type: 'text', text: expect.stringContaining('fake-no-chain-send') }] } });
    expect(seen).toEqual([{ cmd: 'swap', in: 'SOL', out: 'USDC', amount: '0.01', slippageBps: 50 }]);
  });
  it.each([
    { name: 'status', arguments: { keypair: '/must-not-read' } },
    { name: 'swap', arguments: { in: 'SOL', out: 'USDC', amount: '-1' } },
    { name: 'swap', arguments: { in: 'SOL', out: 'USDC', amount: '0' } },
    { name: 'quote', arguments: { in: 'SOL', out: 'USDC', amount: '1', slippageBps: 999 } },
    { name: 'post', arguments: { text: '<script>' } },
    { name: 'call', arguments: { direction: 'sideways', entry: 1, target: 2, stop: 0, hours: 1, why: 'test' } },
    { name: 'profile', arguments: { slug: '../secret' } },
  ])('validates inputs before calling the signer: %j', async params => {
    const tool = vi.fn(); const handle = createMcpHandler({ tool }); await handle(initialize);
    expect(await handle(rpc('tools/call', params))).toMatchObject({ result: { isError: true, content: [{ text: 'Invalid input. Check the command or tool schema.' }] } });
    expect(tool).not.toHaveBeenCalled();
  });
  it('returns agent-safe errors without raw API, RPC, path or debug output', async () => {
    const handle = createMcpHandler({ tool: async () => { throw new Error('secret-key rpc://credential /private/path'); } }); await handle(initialize);
    const result = await handle(rpc('tools/call', { name: 'status' }));
    expect(JSON.stringify(result)).not.toMatch(/secret-key|credential|private\/path/);
    expect(result).toMatchObject({ result: { isError: true } });
    const client = new Client('https://stub.example', '/private/path', fetch, async () => ({ ok: false, error: 'secret-key debug stack' }));
    await expect(client.tool('status', {})).rejects.toThrow('Signer refused');
    expect(safeError(new Error('private'))).not.toContain('private');
  });
  it('publishes signed posts/calls through the API, and reads profiles without holding a key', async () => {
    const sent: Req[] = [], bodies: unknown[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url).endsWith('/leaderboard')) return Response.json([{ agent: { wallet: 'public-wallet', slug: 'agent' } }]);
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return Response.json({ accepted: true }, { status: init?.body ? 201 : 200 });
    };
    const client = new Client('https://stub.example', '/fake', fetcher, async (_socket, req) => {
      sent.push(req); return { ok: true, result: req.cmd === 'status' ? { wallet: 'public-wallet' } : { message: 'signed-domain-message', signature: 'public-proof' } };
    });
    await client.tool('post', { text: 'A note' });
    await client.tool('call', { direction: 'long', entry: 150, target: 160, stop: 145, hours: 24, why: 'Reason' });
    expect(sent.filter(r => r.cmd.startsWith('sign-'))).toEqual([
      { cmd: 'sign-post', payload: { agentSlug: 'agent', type: 'thesis', text: 'A note' } },
      { cmd: 'sign-call', payload: { agentSlug: 'agent', market: 'SOL/USDC', direction: 'long', entry: 150, target: 160, stop: 145, expiresAt: expect.any(Number), rationale: 'Reason' } },
    ]);
    expect(bodies).toHaveLength(2);
    await expect(client.tool('profile', { slug: 'other-agent' })).resolves.toEqual({ accepted: true });
  });
  it('uses the profile saved at onboarding, so a new agent can post before it has leaderboard stats', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'tradgents-home-'));
    writeFileSync(path.join(home, 'profile.json'), JSON.stringify({ slug: 'fresh-agent', wallet: 'public-wallet', api: 'https://stub.example' }));
    vi.stubEnv('TRADGENTS_HOME', home);
    try {
      const urls: string[] = [], sent: Req[] = [];
      const client = new Client('https://stub.example', '/fake', async (url) => { urls.push(String(url)); return Response.json({ accepted: true }, { status: 201 }); },
        async (_socket, req) => { sent.push(req); return { ok: true, result: req.cmd === 'status' ? { wallet: 'public-wallet' } : { message: 'm', signature: 's' } }; });
      await client.tool('post', { text: 'First note' });
      expect(urls.some(u => u.endsWith('/leaderboard'))).toBe(false);
      expect(sent.find(r => r.cmd === 'sign-post')).toMatchObject({ payload: { agentSlug: 'fresh-agent' } });
    } finally { vi.unstubAllEnvs(); }
  });
  it('stdio serves fragmented newline JSON, replies to parse errors and never responds to notifications', async () => {
    const input = new PassThrough(), output = new PassThrough(), chunks: string[] = [];
    output.on('data', chunk => chunks.push(chunk.toString()));
    const serving = serveMcp(input, output, { tool: async () => ({ wallet: 'public' }) });
    const serialized = JSON.stringify(initialize);
    input.write(serialized.slice(0, 13)); input.write(serialized.slice(13) + '\n');
    input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    input.write('{broken\n'); input.write(JSON.stringify(rpc('tools/list', undefined, 2)) + '\n'); input.end();
    await serving;
    const replies = chunks.join('').trim().split('\n').map(line => JSON.parse(line));
    expect(replies).toHaveLength(3);
    expect(replies[1]).toMatchObject({ error: { code: -32700 } });
    expect(replies[2].result.tools).toHaveLength(6);
  });
  it('bounds request size and rejects unknown methods/tools', async () => {
    const handle = createMcpHandler(); await handle(initialize);
    expect(await handle(rpc('unknown'))).toMatchObject({ error: { code: -32601 } });
    expect(await handle(rpc('tools/call', { name: 'read-key' }))).toMatchObject({ error: { code: -32602 } });
    const input = new PassThrough(), output = new PassThrough(), chunks: string[] = [];
    output.on('data', chunk => chunks.push(chunk.toString()));
    const serving = serveMcp(input, output); input.end('x'.repeat(65 * 1024)); await serving;
    expect(JSON.parse(chunks.join(''))).toMatchObject({ error: { message: 'Request too large' } });
  });
});
