import { afterEach, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createPublicClient, createWalletClient, defineChain, http, type Abi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createApp } from '../src/app.ts';
import { verifyChainDeployment, verifyUsdcDecimals, verifyWmonMetadata } from '../src/chain.ts';
import { parseConfig } from '../src/config.ts';
import { Indexer } from '../src/indexer.ts';
import { migrate } from '../src/migrate.ts';
import { openDb } from '../src/pg.ts';

const monadDir = resolve(import.meta.dirname, '..');
const contractsDir = resolve(monadDir, '../contracts');
const deployDir = resolve(monadDir, '../deploy');
const fixtureKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const account = privateKeyToAccount(fixtureKey);
let node: ChildProcess | undefined, temp: string | undefined;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function freePort(): Promise<number> {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
async function waitForRpc(client: ReturnType<typeof createPublicClient>): Promise<void> {
  for (let i = 0; i < 100; i++) { try { if (await client.getChainId() === 10143) return; } catch {} await delay(100); }
  throw new Error('Anvil did not start');
}
afterEach(async () => {
  if (node && node.exitCode === null) { node.kill('SIGTERM'); await new Promise<void>(resolve => node!.once('exit', () => resolve())); }
  node = undefined; if (temp) rmSync(temp, { recursive: true, force: true }); temp = undefined;
});

it('runs profile verification, price sampling, finalized worker indexing and API meta on local Anvil 10143', async () => {
  const build = spawnSync('forge', ['build', '--root', contractsDir], { cwd: monadDir, encoding: 'utf8', timeout: 90_000, env: { ...process.env, FOUNDRY_PROFILE: 'testnet' } });
  if (build.status !== 0) throw new Error(`forge build failed: ${build.stderr || build.stdout}`);
  const port = await freePort(), rpc = `http://127.0.0.1:${port}`;
  node = spawn('anvil', ['--chain-id', '10143', '--host', '127.0.0.1', '--port', String(port), '--silent'], { stdio: 'ignore' });
  const chain = defineChain({ id: 10143, name: 'Monad Testnet Fixture', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const client = createPublicClient({ chain, transport: http(rpc) }); await waitForRpc(client);
  temp = mkdtempSync(resolve(tmpdir(), 'tradgents-api-anvil-'));
  const keyPath = resolve(temp, 'fixture.key'), dexPath = resolve(temp, 'testnet.json');
  writeFileSync(keyPath, `${fixtureKey}\n`, { mode: 0o600 }); chmodSync(keyPath, 0o600);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const wmonArtifact = JSON.parse(readFileSync(resolve(contractsDir, 'out-testnet/TestWMON.sol/TestWMON.json'), 'utf8')) as { abi: Abi; bytecode: { object: string } };
  const wmonHash = await wallet.deployContract({ abi: wmonArtifact.abi, bytecode: (wmonArtifact.bytecode.object.startsWith('0x') ? wmonArtifact.bytecode.object : `0x${wmonArtifact.bytecode.object}`) as Hex });
  const wmonReceipt = await client.waitForTransactionReceipt({ hash: wmonHash }); expect(wmonReceipt.status).toBe('success');
  const wmon = wmonReceipt.contractAddress!;
  const deployEnv = { ...process.env, MONAD_NETWORK: 'testnet', MONAD_RPC_URL: rpc, DEPLOYER_KEY_FILE: keyPath, TESTNET_WMON: wmon, TESTNET_DEPLOY_OUT: dexPath };
  const deployed = spawnSync(resolve(deployDir, 'node_modules/.bin/tsx'), ['src/deploy.ts', '--wmon-amount', '1', '--usdc-amount', '200'], { cwd: deployDir, env: deployEnv, encoding: 'utf8', timeout: 90_000 });
  if (deployed.status !== 0) throw new Error(`DEX deployment failed: ${deployed.stderr || deployed.stdout}`);
  const dex = JSON.parse(readFileSync(dexPath, 'utf8')) as { usdc: `0x${string}`; factory: `0x${string}`; router: `0x${string}` };

  const pythArtifact = JSON.parse(readFileSync(resolve(contractsDir, 'out-testnet/TestPyth.sol/TestPyth.json'), 'utf8')) as { abi: Abi; bytecode: { object: string } };
  const pythHash = await wallet.deployContract({ abi: pythArtifact.abi, bytecode: (pythArtifact.bytecode.object.startsWith('0x') ? pythArtifact.bytecode.object : `0x${pythArtifact.bytecode.object}`) as Hex });
  const pythReceipt = await client.waitForTransactionReceipt({ hash: pythHash }); expect(pythReceipt.status).toBe('success');
  const pythCode = await client.getCode({ address: pythReceipt.contractAddress! });
  const pythAddress = '0x2880aB155794e7179c9eE2e38200202908C17B43' as const;
  await client.request({ method: 'anvil_setCode', params: [pythAddress, pythCode] } as never);
  const localPyth=await client.readContract({address:pythAddress,abi:[{type:'function',name:'getPriceUnsafe',stateMutability:'view',inputs:[{name:'id',type:'bytes32'}],outputs:[{type:'tuple',components:[{name:'price',type:'int64'},{name:'conf',type:'uint64'},{name:'expo',type:'int32'},{name:'publishTime',type:'uint256'}]}]}] as const,functionName:'getPriceUnsafe',args:['0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1']});
  expect(localPyth.price).toBe(20_000_000n);

  const registryArtifact = JSON.parse(readFileSync(resolve(contractsDir, 'out-testnet/AgentRegistry.sol/AgentRegistry.json'), 'utf8')) as { abi: Abi; bytecode: { object: string } };
  const registryHash = await wallet.deployContract({ abi: registryArtifact.abi, bytecode: (registryArtifact.bytecode.object.startsWith('0x') ? registryArtifact.bytecode.object : `0x${registryArtifact.bytecode.object}`) as Hex, args: [account.address, account.address, 0n, 86_400n] as never });
  const registryReceipt = await client.waitForTransactionReceipt({ hash: registryHash }); expect(registryReceipt.status).toBe('success');
  const config = parseConfig({ MONAD_NETWORK: 'testnet', MONAD_RPC_URL: rpc, REGISTRY_ADDRESS: registryReceipt.contractAddress!, TESTNET_WMON: wmon, TESTNET_USDC: dex.usdc, TESTNET_V2_FACTORY: dex.factory, TESTNET_V2_ROUTER: dex.router, TESTNET_FIXED_PRICES: 'true', TESTNET_MON_PRICE_USD: '0.20', DATABASE_URL: 'memory:', DATABASE_URL_DIRECT: 'memory:' });
  await verifyChainDeployment(client, config); await verifyUsdcDecimals(client, 6, config.profile); await verifyWmonMetadata(client, config.profile);

  const db = await openDb('memory:');
  try {
    await migrate(db);
    const worker = new Indexer(db, client, config);
    await worker.samplePrices(Date.now());
    const cursor = await worker.backfill(Date.now());
    expect(cursor.applied).toBe(0); expect(cursor.to).toBeGreaterThanOrEqual(cursor.from - 1);
    const response = await createApp({ db, client, config }).request('/v1/meta');
    expect(response.status).toBe(200);
    const meta = await response.json() as { network: string; chainId: number; explorerBaseUrl: string; fixedPriceFallback?: { enabled: boolean; quality: string }; priceSources: { token: string; quality: string; id: string }[] };
    expect(meta.network).toBe('testnet'); expect(meta.chainId).toBe(10143); expect(meta.explorerBaseUrl).toContain('testnet');
    expect(meta.fixedPriceFallback).toMatchObject({ enabled: true, quality: 'estimated' });
    expect(meta.priceSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'MON', quality: 'estimated', id: 'testnet-fixed-prices' }),
      expect.objectContaining({ token: 'USDC', quality: 'estimated', id: 'testnet-fixed-prices' }),
    ]));
  } finally { await db.close(); }
});
