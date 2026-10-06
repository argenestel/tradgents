import { afterEach, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const dir = resolve(import.meta.dirname, '..');
const fixtureKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const account = privateKeyToAccount(fixtureKey);
let anvil: ChildProcess | undefined;
let temp: string | undefined;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
async function waitForRpc(client: ReturnType<typeof createPublicClient>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try { if (await client.getChainId() === 10143) return; } catch {}
    await delay(100);
  }
  throw new Error('local Anvil RPC did not become ready');
}
afterEach(async () => {
  if (anvil && anvil.exitCode === null) { anvil.kill('SIGTERM'); await new Promise<void>(resolve => anvil!.once('exit', () => resolve())); }
  anvil = undefined;
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});

it('deploys and reuses the whole test DEX on local Anvil chain 10143', async () => {
  const port = await freePort(),rpc = `http://127.0.0.1:${port}`;
  anvil = spawn('anvil', ['--chain-id', '10143', '--host', '127.0.0.1', '--port', String(port), '--silent'], { stdio: 'ignore' });
  const chain = defineChain({ id: 10143, name: 'Monad Testnet Fixture', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const client = createPublicClient({ chain, transport: http(rpc) });
  await waitForRpc(client);
  temp = mkdtempSync(resolve(tmpdir(), 'tradgents-testnet-deploy-'));
  const keyPath = resolve(temp, 'fixture.key'), outPath = resolve(temp, 'testnet.json');
  writeFileSync(keyPath, `${fixtureKey}\n`, { mode: 0o600 }); chmodSync(keyPath, 0o600);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const build=spawnSync('forge',['build','--root',resolve(dir,'../contracts')],{cwd:dir,encoding:'utf8',timeout:90_000,env:{...process.env,FOUNDRY_PROFILE:'testnet'}});
  if(build.status!==0)throw new Error(`forge testnet build failed: ${build.stderr||build.stdout}`);
  const wethArtifact = JSON.parse(readFileSync(resolve(dir, '../contracts/out-testnet/TestWMON.sol/TestWMON.json'), 'utf8')) as { abi: never; bytecode: { object: string } };
  const wethHash = await wallet.deployContract({ abi: wethArtifact.abi, bytecode: (wethArtifact.bytecode.object.startsWith('0x') ? wethArtifact.bytecode.object : `0x${wethArtifact.bytecode.object}`) as Hex });
  const wethReceipt = await client.waitForTransactionReceipt({ hash: wethHash });
  expect(wethReceipt.status).toBe('success');
  const wmon = wethReceipt.contractAddress!;
  const env = { ...process.env, MONAD_NETWORK: 'testnet', MONAD_RPC_URL: rpc, DEPLOYER_KEY_FILE: keyPath, TESTNET_WMON: wmon, TESTNET_DEPLOY_OUT: outPath };
  const run = () => {
    const result = spawnSync(resolve(dir, 'node_modules/.bin/tsx'), ['src/deploy.ts', '--wmon-amount', '1', '--usdc-amount', '200'], { cwd: dir, env, encoding: 'utf8', timeout: 90_000 });
    if (result.status !== 0) throw new Error(`deployer exited ${result.status}: ${result.stderr || result.stdout}`);
    return result.stdout;
  };
  run();
  const output = JSON.parse(readFileSync(outPath, 'utf8')) as { chainId: number; wmon: Address; usdc: Address; factory: Address; router: Address; pair: Address };
  expect(output.chainId).toBe(10143); expect(output.wmon.toLowerCase()).toBe(wmon.toLowerCase());
  for (const address of [output.usdc, output.factory, output.router, output.pair]) expect(await client.getCode({ address })).not.toBe('0x');
  const tokenAbi = [{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }] as const;
  expect(Number(await client.readContract({ address: output.usdc, abi: tokenAbi, functionName: 'decimals' }))).toBe(6);
  expect(Number(await client.readContract({ address: output.wmon, abi: tokenAbi, functionName: 'decimals' }))).toBe(18);
  const pairAbi = [{ type: 'function', name: 'getReserves', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }] }] as const;
  const firstReserves = await client.readContract({ address: output.pair, abi: pairAbi, functionName: 'getReserves' });
  expect(firstReserves[0]).toBeGreaterThan(0n); expect(firstReserves[1]).toBeGreaterThan(0n);
  const secondLog = run();
  expect(secondLog).toContain(output.pair);
  const secondReserves = await client.readContract({ address: output.pair, abi: pairAbi, functionName: 'getReserves' });
  expect(secondReserves.slice(0, 2)).toEqual(firstReserves.slice(0, 2));
});

