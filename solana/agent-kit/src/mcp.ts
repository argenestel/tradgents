import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import { Client, toolSchemas, type ToolName } from './client';
import { safeError } from './config';

const descriptions: Record<ToolName, string> = {
  status: 'Wallet, balances and remaining signer limits.', quote: 'Preview a swap through signer validation and simulation; sends nothing.',
  swap: 'Execute a swap through signer policy. Moves funds; quote first. Never retry an ambiguous result automatically.',
  post: 'Publish a signed public note.', call: 'Publish a signed market call.', profile: 'Read a public agent profile. Without slug, uses signer wallet.',
};
export const tools = Object.entries(toolSchemas).map(([name, schema]) => ({ name, description: descriptions[name as ToolName],
  inputSchema: z.toJSONSchema(schema, { io: 'input' }), annotations: { readOnlyHint: ['status', 'quote', 'profile'].includes(name), destructiveHint: name === 'swap', openWorldHint: true } }));
const rpcSchema = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number().int()]).optional(), method: z.string(), params: z.unknown().optional() }).strict();
const callSchema = z.object({ name: z.enum(['status', 'quote', 'swap', 'post', 'call', 'profile']), arguments: z.unknown().optional(), _meta: z.record(z.string(), z.unknown()).optional() }).strict();
export function createMcpHandler(client: Pick<Client, 'tool'> = new Client()) {
  let initialized = false;
  return async (raw: unknown): Promise<unknown | undefined> => {
    const parsed = rpcSchema.safeParse(raw);
    if (!parsed.success) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
    const req = parsed.data;
    if (req.id === undefined) return undefined; // Notifications never receive replies.
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id: req.id, result });
    const error = (code: number, message: string) => ({ jsonrpc: '2.0', id: req.id, error: { code, message } });
    if (req.method === 'initialize') {
      const params = z.object({ protocolVersion: z.string(), capabilities: z.object({}).passthrough(), clientInfo: z.object({ name: z.string(), version: z.string() }).passthrough() }).passthrough().safeParse(req.params);
      if (!params.success) return error(-32602, 'Invalid initialization parameters');
      initialized = true;
      const supported = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
      return reply({ protocolVersion: supported.includes(params.data.protocolVersion) ? params.data.protocolVersion : '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'tradgents', version: '1.0.0' } });
    }
    if (req.method === 'ping') return reply({});
    if (!initialized) return error(-32000, 'Initialize the server first');
    if (req.method === 'tools/list') return reply({ tools });
    if (req.method !== 'tools/call') return error(-32601, 'Method not found');
    const parsedCall = callSchema.safeParse(req.params);
    if (!parsedCall.success) return error(-32602, 'Unknown tool or invalid tool call');
    const { name, arguments: args } = parsedCall.data;
    try {
      const result = await client.tool(name, toolSchemas[name].parse(args ?? {}));
      return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
    } catch (e) { return reply({ content: [{ type: 'text', text: safeError(e) }], isError: true }); }
  };
}
/** MCP stdio is newline-delimited JSON-RPC; stdout contains protocol messages only. */
export async function serveMcp(input: Readable = process.stdin, output: Writable = process.stdout, client: Pick<Client, 'tool'> = new Client()) {
  const handle = createMcpHandler(client);
  let buffer = '';
  for await (const chunk of input) {
    buffer += chunk.toString('utf8');
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      let result: unknown;
      if (Buffer.byteLength(line) > 64 * 1024) result = { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } };
      else { try { result = await handle(JSON.parse(line)); } catch { result = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }; } }
      if (result !== undefined) output.write(JSON.stringify(result) + '\n');
    }
    if (Buffer.byteLength(buffer) > 64 * 1024) { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } }) + '\n'); return; }
  }
}
