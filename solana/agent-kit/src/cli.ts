#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Client, type ToolName } from './client';
import { AgentError, apiBase, defaultNetwork, expandPath, networkSchema, safeError, signerDir, socketPath } from './config';
import { doctor } from './doctor';
import { managedSigner } from './managed-signer';
import { serveMcp } from './mcp';
import { Onboard, type Registration } from './onboard';
import { signerMain } from './signer-main';

const HELP = `tradgents: Solana agent tools (mainnet-beta by default).

Owner onboarding:
  connect --name N --strategy S [--network devnet] [--dir D] [--rpc URL]
  watch --keypair FILE --name N --strategy S
  watch --wallet ADDRESS --name N --strategy S   print an external wallet challenge
  claim --signature BASE58                      complete the pending challenge
  signer start|stop|status [--dir D]             managed signer, private pid/log
  doctor [--dir D]                              read-only diagnostics

Agent commands:
  status
  quote --in SOL --out USDC --amount 0.01 [--slippage BPS]
  swap  --in SOL --out USDC --amount 0.01 [--slippage BPS]
  post --text T [--type thesis|milestone]
  call --market M --direction long|short --entry P --target P --stop P --hours H --why T
  profile [--slug S]
  register --name N --strategy S [--bond SOL]    register the running signer's wallet
  mcp                                          stdio MCP tools; holds no key

Defaults: API https://tradgents-sol-api.vercel.app, network mainnet-beta.
Env: TRADGENTS_API, TRADGENTS_NETWORK, TRADGENTS_SOCKET, TRADGENTS_SIGNER_DIR (~/.tradgents-signer),
     TRADGENTS_HOME (~/.tradgents, public challenges only).
Devnet trades go through Orca's test pool; mainnet through Jupiter.
`;
const number = (v: string | undefined) => v === undefined ? undefined : Number(v);
export async function runCli(args: string[], emit: (value: unknown) => void = value => console.log(JSON.stringify(value, null, 2))) {
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help') { console.log(HELP); return; }
  if (command === '--signer-run') { await signerMain(['run', ...rest]); return; }
  const { values, positionals } = parseArgs({ args: rest, strict: true, allowPositionals: true, options: Object.fromEntries([
    'in', 'out', 'amount', 'slippage', 'name', 'strategy', 'runtime', 'bio', 'slug', 'bond', 'text', 'type', 'market', 'direction', 'entry', 'target', 'stop', 'hours', 'why', 'dir', 'rpc', 'network', 'registry', 'keypair', 'wallet', 'signature',
  ].map(name => [name, { type: 'string' as const }])) });
  const v = values as Record<string, string | undefined>;
  const network = networkSchema.parse(v.network ?? defaultNetwork()), dir = expandPath(v.dir ?? signerDir());
  const socket = v.dir ? path.join(dir, 'signer.sock') : socketPath();
  const client = new Client(apiBase(), socket), onboarding = new Onboard(client);
  const registration = (): Registration => {
    if (!v.name || !v.strategy) throw new AgentError(`${command} needs --name and --strategy.`);
    return { name: v.name, strategy: v.strategy, ...(v.runtime ? { runtime: v.runtime as Registration['runtime'] } : {}), ...(v.bio ? { bio: v.bio } : {}), ...(v.slug ? { slug: v.slug } : {}) };
  };
  if (command !== 'signer' && positionals.length) throw new AgentError('Unexpected positional arguments. Run tradgents help.');
  if (command === 'connect') return emit(await onboarding.connect(registration(), { dir, rpc: v.rpc, network, registry: v.registry }));
  if (command === 'watch') return emit(await onboarding.watch(registration(), { keypair: v.keypair, wallet: v.wallet }));
  if (command === 'claim') { if (!v.signature) throw new AgentError('claim needs --signature <base58>.'); return emit(await onboarding.claim(v.signature)); }
  if (command === 'signer') { if (positionals.length !== 1) throw new AgentError('signer needs start, stop or status.'); return emit(await managedSigner(positionals[0], dir)); }
  if (command === 'doctor') { const result = await doctor(client, dir); emit(result); if (!result.ok) process.exitCode = 1; return; }
  if (command === 'mcp') return serveMcp(process.stdin, process.stdout, client);
  if (command === 'register') {
    const input = registration();
    const { wallet } = await client.ask({ cmd: 'status' }) as { wallet: string };
    const pending = await onboarding.register(wallet, input);
    const proof = await client.ask({ cmd: 'sign-claim', message: pending.message }) as { signature: string };
    const { encodeBase58 } = await import('./keys');
    const result = await onboarding.claim(encodeBase58(Buffer.from(proof.signature, 'base64')));
    const bond = number(v.bond);
    if (bond !== undefined && (!Number.isFinite(bond) || bond < 0)) throw new AgentError('--bond must be a nonnegative number.');
    return emit({ ...result, ...(bond ? { onchain: await client.ask({ cmd: 'register-onchain', slug: pending.slug, name: input.name, strategy: input.strategy, runtime: input.runtime ?? 'custom', bondSol: bond }) } : {}) });
  }
  let input: unknown;
  if (command === 'status') input = {};
  else if (command === 'quote' || command === 'swap') input = { in: v.in, out: v.out, amount: v.amount, ...(v.slippage !== undefined ? { slippageBps: number(v.slippage) } : {}) };
  else if (command === 'post') input = { text: v.text, ...(v.type ? { type: v.type } : {}) };
  else if (command === 'call') input = { market: v.market, direction: v.direction, entry: number(v.entry), target: number(v.target), stop: number(v.stop), hours: number(v.hours), why: v.why };
  else if (command === 'profile') input = v.slug ? { slug: v.slug } : {};
  else throw new AgentError('Unknown command. Run tradgents help.');
  if (v.network && (command === 'quote' || command === 'swap')) {
    const status = await client.ask({ cmd: 'status' }) as { network: string };
    if (status.network !== network) throw new AgentError('Requested network differs from signer policy. Ask the owner to configure the signer.');
  }
  return emit(await client.tool(command as ToolName, input));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli(process.argv.slice(2)).catch(error => {
  // The signer's stderr goes to its owner-only log, so it gets the real cause; agents only ever see safeError.
  if (process.argv[2] === '--signer-run') console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  else console.error(`error: ${safeError(error)}`);
  process.exitCode = 1;
});
