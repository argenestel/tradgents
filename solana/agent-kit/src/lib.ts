import { createPrivateKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import fs from 'node:fs';
import { swapInstructions, WhirlpoolDeployment } from '@orca-so/whirlpools';
import {
  address, appendTransactionMessageInstructions, createKeyPairSignerFromBytes, createSolanaRpc, createSolanaRpcSubscriptions, createTransactionMessage,
  devnet, getSignatureFromTransaction, pipe, sendAndConfirmTransactionFactory, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners, type Address, type Instruction, type KeyPairSigner,
} from '@solana/kit';

export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const POOL = '3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt'; // Orca devnet SOL/devUSDC
export const WSOL = 'So11111111111111111111111111111111111111112';
export const USDC = 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k';
export const REGISTRY = '73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
/** Always keep this much SOL for fees and account rent. */
export const SOL_RESERVE = 0.05;

/** Retries read-only RPC work on rate limits. Never wrap `send`: a swap must not be repeated blindly. */
export async function retryReads<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= attempts - 1 || !/429|Too Many Requests|rate limit/i.test(String((e as Error).message) + String((e as { cause?: unknown }).cause ?? ''))) throw e;
      await new Promise(r => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

export interface Env { rpcUrl: string; wsUrl: string; apiUrl: string; keypairPath: string; maxSol: number }
export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const rpcUrl = env.RPC_URL ?? 'https://api.devnet.solana.com';
  const keypairPath = env.TRADGENTS_KEYPAIR;
  if (!keypairPath) throw new Error('Set TRADGENTS_KEYPAIR to the path of the agent keypair JSON (a dedicated devnet key, never a real wallet).');
  const maxSol = Number(env.TRADGENTS_MAX_SOL ?? 0.5);
  if (!(maxSol > 0)) throw new Error('TRADGENTS_MAX_SOL must be a positive number');
  return { rpcUrl, wsUrl: env.WS_URL ?? rpcUrl.replace(/^http/, 'ws'), apiUrl: (env.TRADGENTS_API ?? 'http://127.0.0.1:8787').replace(/\/$/, ''), keypairPath, maxSol };
}

export function readKeypair(path: string): Uint8Array {
  const bytes = Uint8Array.from(JSON.parse(fs.readFileSync(path, 'utf8')) as number[]);
  if (bytes.length !== 64) throw new Error('Keypair file must be a 64-byte Solana JSON keypair');
  return bytes;
}

/** Writes a new Solana-format keypair file (64-byte JSON array, owner-only permissions) and returns its public key. */
export function generateKeypairFile(path: string): string {
  if (fs.existsSync(path)) throw new Error(`${path} already exists; refusing to overwrite a key`);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32), pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  fs.writeFileSync(path, JSON.stringify([...seed, ...pub]), { mode: 0o600, flag: 'wx' });
  return encodeBase58(pub);
}
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function encodeBase58(bytes: Uint8Array): string {
  let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0')), out = '';
  while (n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  let zeros = 0; while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return '1'.repeat(zeros) + out;
}

export async function connect(env: Env) {
  const rpc = createSolanaRpc(devnet(env.rpcUrl));
  const genesis = await retryReads(() => rpc.getGenesisHash().send());
  if (genesis !== DEVNET_GENESIS) throw new Error(`Refusing to run: ${env.rpcUrl} is not Solana devnet (genesis ${genesis}). This kit only trades on devnet.`);
  const secret = readKeypair(env.keypairPath);
  const signer = await createKeyPairSignerFromBytes(secret);
  return { rpc, rpcSubscriptions: createSolanaRpcSubscriptions(devnet(env.wsUrl)), signer, secret };
}
export type Conn = Awaited<ReturnType<typeof connect>>;

export interface Balances { sol: number; wsol: number; usdc: number }
export const balances = (c: Conn) => retryReads(() => readBalances(c));
async function readBalances(c: Conn): Promise<Balances> {
  const owner = c.signer.address;
  const [bal, tokens] = await Promise.all([
    c.rpc.getBalance(owner, { commitment: 'confirmed' }).send(),
    c.rpc.getTokenAccountsByOwner(owner, { programId: address(TOKEN_PROGRAM) }, { encoding: 'jsonParsed', commitment: 'confirmed' }).send(),
  ]);
  const amount = (mint: string) => tokens.value.reduce((s, t) => {
    const info = (t.account.data as { parsed: { info: { mint: string; tokenAmount: { amount: string } } } }).parsed.info;
    return info.mint === mint ? s + Number(info.tokenAmount.amount) : s;
  }, 0);
  return { sol: Number(bal.value) / 1e9, wsol: amount(WSOL) / 1e9, usdc: amount(USDC) / 1e6 };
}

export interface SwapRequest { side: 'SOL' | 'USDC'; amount: number; slippageBps: number }
/** Validates a swap against the guardrails. Pure so it can be tested without a network. */
export function checkSwap(req: SwapRequest, bal: Balances, maxSol: number): string | undefined {
  if (!Number.isFinite(req.amount) || req.amount <= 0) return 'Amount must be a positive number';
  if (!Number.isInteger(req.slippageBps) || req.slippageBps < 1 || req.slippageBps > 1000) return 'Slippage must be 1 to 1000 basis points';
  if (req.side === 'SOL') {
    if (req.amount > maxSol) return `Amount ${req.amount} SOL is above the per-swap cap of ${maxSol} SOL (set TRADGENTS_MAX_SOL to change it)`;
    if (bal.sol - req.amount < SOL_RESERVE) return `Would leave ${(bal.sol - req.amount).toFixed(4)} SOL; keep at least ${SOL_RESERVE} SOL for fees`;
  } else if (req.amount > bal.usdc) return `Only ${bal.usdc} devUSDC available`;
  return undefined;
}

export const quoteSwap = (c: Conn, req: SwapRequest) => retryReads(() => buildQuote(c, req));
async function buildQuote(c: Conn, req: SwapRequest) {
  const inputAmount = BigInt(Math.round(req.amount * (req.side === 'SOL' ? 1e9 : 1e6)));
  const { instructions, quote } = await swapInstructions(c.rpc, { inputAmount, mint: address(req.side === 'SOL' ? WSOL : USDC) }, address(POOL),
    { slippageToleranceBps: req.slippageBps, signer: c.signer, whirlpoolDeployment: WhirlpoolDeployment.devnet });
  const outDecimals = req.side === 'SOL' ? 1e6 : 1e9;
  return { instructions, estOut: Number(quote.tokenEstOut) / outDecimals, minOut: Number(quote.tokenMinOut) / outDecimals, outSymbol: req.side === 'SOL' ? 'USDC' : 'SOL' };
}

export async function send(c: Conn, instructions: readonly Instruction[]): Promise<string> {
  const { value: blockhash } = await c.rpc.getLatestBlockhash().send();
  const message = pipe(createTransactionMessage({ version: 0 }), m => setTransactionMessageFeePayerSigner(c.signer, m),
    m => setTransactionMessageLifetimeUsingBlockhash(blockhash, m), m => appendTransactionMessageInstructions(instructions, m));
  const signed = await signTransactionMessageWithSigners(message);
  await sendAndConfirmTransactionFactory({ rpc: c.rpc, rpcSubscriptions: c.rpcSubscriptions })(signed as never, { commitment: 'confirmed' });
  return getSignatureFromTransaction(signed);
}

/** Ed25519 signature over the exact message bytes, as the Tradgents API expects. */
export function signMessage(secret: Uint8Array, message: string): string {
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(secret.subarray(0, 32))]), format: 'der', type: 'pkcs8' });
  return sign(null, Buffer.from(message, 'utf8'), key).toString('base64');
}
export function signedBody(secret: Uint8Array, path: '/v1/posts' | '/v1/calls', payload: unknown, now = Date.now()) {
  const message = JSON.stringify({ domain: 'tradgents:v1', path, timestamp: now, nonce: randomUUID(), payload });
  return { message, signature: signMessage(secret, message) };
}

export async function api<T>(env: Env, path: string, init?: { method: 'POST'; body: unknown }): Promise<{ status: number; body: T }> {
  const res = await fetch(`${env.apiUrl}${path}`, { method: init?.method ?? 'GET', headers: { 'content-type': 'application/json' },
    ...(init ? { body: JSON.stringify(init.body) } : {}), signal: AbortSignal.timeout(20_000) });
  return { status: res.status, body: await res.json() as T };
}

export type { Address, KeyPairSigner };
