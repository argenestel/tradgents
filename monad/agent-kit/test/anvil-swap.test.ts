import { afterEach, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { DEFAULT_POLICY, parsePolicy } from '../src/policy.ts';
import { SpendLedger } from '../src/spend-ledger.ts';
import { executeSwap } from '../src/trade.ts';
import { ERC20_ABI, getSignerNetworkProfile } from '../src/venue.ts';

const monadDir = resolve(import.meta.dirname, '../..');
const deployDir = resolve(monadDir, 'deploy');
const fixtureKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const account = privateKeyToAccount(fixtureKey);
let node: ChildProcess | undefined, tmp: string | undefined;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function freePort(): Promise<number> {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
afterEach(async () => {
  if (node && node.exitCode === null) { node.kill('SIGTERM'); await new Promise<void>(resolve => node!.once('exit', () => resolve())); }
  node = undefined; if (tmp) rmSync(tmp, { recursive: true, force: true }); tmp = undefined;
});

it('runs the real profile-pinned signer swap, approval, simulation and budget flow on local Anvil 10143', async () => {
  const build=spawnSync('forge',['build','--root',resolve(monadDir,'contracts')],{cwd:monadDir,encoding:'utf8',timeout:90_000,env:{...process.env,FOUNDRY_PROFILE:'testnet'}});
  if(build.status!==0)throw new Error(`forge build failed: ${build.stderr||build.stdout}`);
  const port = await freePort(), rpc = `http://127.0.0.1:${port}`;
  node = spawn('anvil', ['--chain-id', '10143', '--host', '127.0.0.1', '--port', String(port), '--silent'], { stdio: 'ignore' });
  const chain = defineChain({ id: 10143, name: 'Monad Testnet Fixture', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const client = createPublicClient({ chain, transport: http(rpc) });
  for (let i = 0; i < 100; i++) { try { if (await client.getChainId() === 10143) break; } catch {} await pause(100); }
  expect(await client.getChainId()).toBe(10143);
  tmp = mkdtempSync(resolve(tmpdir(), 'tradgents-signer-anvil-'));
  const keyPath = resolve(tmp, 'fixture.key'), outPath = resolve(tmp, 'testnet.json');
  writeFileSync(keyPath, `${fixtureKey}\n`, { mode: 0o600 }); chmodSync(keyPath, 0o600);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const artifact = JSON.parse(readFileSync(resolve(monadDir,'contracts/out-testnet/TestWMON.sol/TestWMON.json'),'utf8')) as { abi: never; bytecode: { object: string } };
  const wethHash = await wallet.deployContract({ abi: artifact.abi, bytecode: (artifact.bytecode.object.startsWith('0x') ? artifact.bytecode.object : `0x${artifact.bytecode.object}`) as Hex });
  const wethReceipt = await client.waitForTransactionReceipt({ hash: wethHash }); expect(wethReceipt.status).toBe('success');
  const wmon = wethReceipt.contractAddress!;
  const env = { ...process.env, MONAD_NETWORK: 'testnet', MONAD_RPC_URL: rpc, DEPLOYER_KEY_FILE: keyPath, TESTNET_WMON: wmon, TESTNET_DEPLOY_OUT: outPath };
  const deployed = spawnSync(resolve(deployDir, 'node_modules/.bin/tsx'), ['src/deploy.ts', '--wmon-amount', '1', '--usdc-amount', '200'], { cwd: deployDir, env, encoding: 'utf8', timeout: 90_000 });
  if (deployed.status !== 0) throw new Error(`DEX deployment failed: ${deployed.stderr || deployed.stdout}`);
  const addresses = JSON.parse((await import('node:fs')).readFileSync(outPath, 'utf8')) as { usdc: Address; factory: Address; router: Address };
  const profileEnv = { MONAD_NETWORK: 'testnet', TESTNET_V2_ROUTER: addresses.router, TESTNET_V2_FACTORY: addresses.factory, TESTNET_USDC: addresses.usdc, TESTNET_WMON: wmon };
  const policy = parsePolicy({ ...DEFAULT_POLICY, network: 'testnet', chainId: 10143, router: addresses.router, factory: addresses.factory, walletAddress: account.address, ownerAddress: account.address, tokens: [{ symbol: 'WMON', address: wmon, decimals: 18 }, { symbol: 'USDC', address: addresses.usdc, decimals: 6 }], perTradeLimitUsd: 50, perDayLimitUsd: 100, maxSlippageBps: 100, maxGasLimit: '500000', maxGasPriceWei: '100000000000', minPoolLiquidityUsd: 1 }, profileEnv);
  const profile = getSignerNetworkProfile('testnet', profileEnv),ledgerDir = resolve(tmp, 'ledger');
  const { mkdirSync } = await import('node:fs'); mkdirSync(ledgerDir, { mode: 0o700 }); chmodSync(ledgerDir, 0o700);
  const depositHash=await wallet.writeContract({address:wmon,abi:[{type:'function',name:'deposit',stateMutability:'payable',inputs:[],outputs:[]}] as const,functionName:'deposit',value:10n**18n});
  expect((await client.waitForTransactionReceipt({hash:depositHash})).status).toBe('success');
  const ledger = new SpendLedger(ledgerDir, policy),now = Date.now();
  const result = await executeSwap({ type: 'swap', tokenIn: 'WMON', tokenOut: 'USDC', amount: '0.1', maxSlippageBps: 50 }, {
    client, walletClient: wallet, account, policy, ledger, profile, now: () => now, testnetFixedPrices: true, testnetMonPriceUsd: 0.2,
  });
  expect(result.approvalHash).toMatch(/^0x/); expect(result.swapHash).toMatch(/^0x/);
  expect(result.priceQuality).toBe('estimated'); expect(result.priceSource).toBe('testnet-fixed-prices');
  expect(BigInt(result.quotedOutRaw)).toBeGreaterThan(BigInt(result.minOutRaw));
  expect(ledger.read(now).usedUsd).toBeGreaterThan(0);
  expect(await client.readContract({ address: addresses.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })).toBeLessThan(200n * 10n ** 6n);
});
