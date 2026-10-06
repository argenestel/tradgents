#!/usr/bin/env node
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseUnits, createPublicClient, createWalletClient, defineChain, http, isAddress, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const here = dirname(fileURLToPath(import.meta.url));
const deployDir = resolve(here, '..');
const require = createRequire(import.meta.url);
const WMON_CANONICAL = '0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541' as Address;
const TOKEN_ABI = [
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;
const WRAP_ABI = [{ type: 'function', name: 'deposit', stateMutability: 'payable', inputs: [], outputs: [] }] as const;
const FACTORY_ABI = [
  { type: 'function', name: 'getPair', stateMutability: 'view', inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'createPair', stateMutability: 'nonpayable', inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }], outputs: [{ type: 'address' }] },
] as const;
const PAIR_ABI = [{ type: 'function', name: 'getReserves', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }] }] as const;
const ROUTER_ABI = [{
  type: 'function', name: 'addLiquidity', stateMutability: 'nonpayable',
  inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }, { name: 'amountADesired', type: 'uint256' }, { name: 'amountBDesired', type: 'uint256' }, { name: 'amountAMin', type: 'uint256' }, { name: 'amountBMin', type: 'uint256' }, { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' }],
  outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
}] as const;
const ERC20_DECIMALS_ABI = [{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }] as const;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;

type Artifact = { abi: Abi; bytecode: string | { object: string } };
type DeploymentOutput = {
  network: 'testnet'; chainId: 10143; wmon: Address; usdc?: Address; factory?: Address; router?: Address; pair?: Address;
  wmonAmount: string; usdcAmount: string; deployer: Address;
};
function argsMap(args: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--') || out.has(key)) throw new Error('usage: pnpm deploy -- [--wmon ADDRESS] [--wmon-amount 0.1] [--usdc-amount 100]');
    out.set(key, value);
  }
  for (const key of out.keys()) if (!['--wmon', '--wmon-amount', '--usdc-amount'].includes(key)) throw new Error(`unsupported option ${key}`);
  return out;
}
function artifactBytecode(artifact: Artifact): Hex {
  const value = typeof artifact.bytecode === 'string' ? artifact.bytecode : artifact.bytecode.object;
  if (!value || value === '0x') throw new Error('contract artifact has no deployable bytecode');
  return (value.startsWith('0x') ? value : `0x${value}`) as Hex;
}
function persist(path: string, output: DeploymentOutput): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}
function loadOutput(path: string, wmon: Address, deployer: Address, wmonAmount: string, usdcAmount: string): DeploymentOutput {
  if (!existsSync(path)) return { network: 'testnet', chainId: 10143, wmon, wmonAmount, usdcAmount, deployer };
  const old = JSON.parse(readFileSync(path, 'utf8')) as DeploymentOutput;
  if (old.network !== 'testnet' || old.chainId !== 10143) throw new Error('existing output file is not a Monad testnet deployment');
  if (old.wmon.toLowerCase() !== wmon.toLowerCase()) throw new Error('existing output WMON differs; use a separate TESTNET_DEPLOY_OUT or remove the stale testnet output');
  return { ...old, wmon, wmonAmount, usdcAmount, deployer };
}
async function deployedCode(client: ReturnType<typeof createPublicClient>, address: Address | undefined): Promise<boolean> {
  if (!address || !isAddress(address)) return false;
  const code = await client.getCode({ address });
  return Boolean(code && code !== '0x');
}

async function main(): Promise<void> {
  const env = process.env;
  if ((env.MONAD_NETWORK ?? 'mainnet') !== 'testnet') throw new Error('refusing test DEX deployment unless MONAD_NETWORK=testnet');
  const rpcUrl = env.MONAD_RPC_URL;
  if (!rpcUrl) throw new Error('MONAD_RPC_URL is required');
  const keyFile = env.DEPLOYER_KEY_FILE;
  if (!keyFile) throw new Error('DEPLOYER_KEY_FILE is required');
  const parsed = argsMap(process.argv.slice(2));
  const wmon = (parsed.get('--wmon') ?? env.TESTNET_WMON ?? WMON_CANONICAL) as Address;
  if (!isAddress(wmon)) throw new Error('WMON address must be a valid EVM address');
  const wmonAmount = parsed.get('--wmon-amount') ?? '0.1';
  const usdcAmount = parsed.get('--usdc-amount') ?? '100';
  const wmonRaw = parseUnits(wmonAmount, 18), usdcRaw = parseUnits(usdcAmount, 6);
  if (wmonRaw <= 0n || usdcRaw <= 0n) throw new Error('liquidity amounts must be positive');
  const key = readFileSync(resolve(keyFile), 'utf8').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('DEPLOYER_KEY_FILE must contain a 32-byte 0x-prefixed local testnet deployer key');
  const account = privateKeyToAccount(key as Hex);
  const chain = defineChain({ id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } }, blockExplorers: { default: { name: 'Monad Testnet Explorer', url: 'https://testnet.monadexplorer.com' } } });
  const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 30_000, retryCount: 2 }) });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 30_000, retryCount: 2 }) });
  const chainId = await client.getChainId();
  if (chainId !== 10143) throw new Error(`RPC chain ID ${chainId} is not Monad testnet 10143`);
  if (!(await deployedCode(client, wmon))) throw new Error(`WMON ${wmon} has no bytecode; deploy/provide a WETH9-compatible testnet token first`);
  const outPath = resolve(env.TESTNET_DEPLOY_OUT ?? resolve(deployDir, 'out/testnet.json'));
  const output = loadOutput(outPath, wmon, account.address, wmonAmount, usdcAmount);
  const save = () => persist(outPath, output);

  const forge = spawnSync('forge', ['build', '--root', resolve(deployDir, '../contracts')], { cwd: deployDir, encoding: 'utf8', env: { ...process.env, FOUNDRY_PROFILE: 'testnet' } });
  if (forge.status !== 0) throw new Error(`forge build failed for test-only contracts: ${(forge.stderr || forge.stdout || 'forge exited non-zero').trim()}`);
  const testUsdcArtifact = JSON.parse(readFileSync(resolve(deployDir, '../contracts/out-testnet/TestUSDC.sol/TestUSDC.json'), 'utf8')) as Artifact;
  const coreFactory = require('@uniswap/v2-core/build/UniswapV2Factory.json') as Artifact;
  const router02 = require('@uniswap/v2-periphery/build/UniswapV2Router02.json') as Artifact;
  const deploy = async (label: string, artifact: Artifact, constructorArgs: readonly unknown[] = []): Promise<Address> => {
    const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifactBytecode(artifact), args: constructorArgs as never });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`${label} deployment failed`);
    console.log(`${label}: ${receipt.contractAddress}`);
    return receipt.contractAddress;
  };
  if (!(await deployedCode(client, output.usdc))) { output.usdc = await deploy('TESTNET_USDC', testUsdcArtifact); save(); }
  if (!(await deployedCode(client, output.factory))) { output.factory = await deploy('TESTNET_V2_FACTORY', coreFactory, [account.address]); save(); }
  if (!(await deployedCode(client, output.router))) { output.router = await deploy('TESTNET_V2_ROUTER', router02, [output.factory!, wmon]); save(); }
  const usdc = output.usdc!, factory = output.factory!, router = output.router!;
  const wmonDecimals = Number(await client.readContract({ address: wmon, abi: ERC20_DECIMALS_ABI, functionName: 'decimals' }));
  const usdcDecimals = Number(await client.readContract({ address: usdc, abi: ERC20_DECIMALS_ABI, functionName: 'decimals' }));
  if (wmonDecimals !== 18 || usdcDecimals !== 6) throw new Error(`test DEX token decimals must be WMON=18 and USDC=6 (got ${wmonDecimals}/${usdcDecimals})`);

  const [wrappedBalance, stableBalance] = await Promise.all([
    client.readContract({ address: wmon, abi: TOKEN_ABI, functionName: 'balanceOf', args: [account.address] }),
    client.readContract({ address: usdc, abi: TOKEN_ABI, functionName: 'balanceOf', args: [account.address] }),
  ]);
  if (wrappedBalance < wmonRaw) {
    const hash = await wallet.writeContract({ address: wmon, abi: WRAP_ABI, functionName: 'deposit', value: wmonRaw - wrappedBalance });
    const receipt = await client.waitForTransactionReceipt({ hash }); if (receipt.status !== 'success') throw new Error('wrapping MON failed');
  }
  if (stableBalance < usdcRaw) {
    const hash = await wallet.writeContract({ address: usdc, abi: TOKEN_ABI, functionName: 'mint', args: [account.address, usdcRaw - stableBalance] });
    const receipt = await client.waitForTransactionReceipt({ hash }); if (receipt.status !== 'success') throw new Error('minting test USDC failed');
  }

  let pair = await client.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'getPair', args: [wmon, usdc] });
  if (pair.toLowerCase() === ZERO.toLowerCase()) {
    const hash = await wallet.writeContract({ address: factory, abi: FACTORY_ABI, functionName: 'createPair', args: [wmon, usdc] });
    const receipt = await client.waitForTransactionReceipt({ hash }); if (receipt.status !== 'success') throw new Error('creating the WMON/USDC pair failed');
    pair = await client.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'getPair', args: [wmon, usdc] });
  }
  if (pair.toLowerCase() === ZERO.toLowerCase() || !(await deployedCode(client, pair))) throw new Error('Uniswap factory did not create a WMON/USDC pair');
  output.pair = pair; save();
  const reserves = await client.readContract({ address: pair, abi: PAIR_ABI, functionName: 'getReserves' });
  if (reserves[0] === 0n || reserves[1] === 0n) {
    for (const token of [wmon, usdc]) {
      const amount = token.toLowerCase() === wmon.toLowerCase() ? wmonRaw : usdcRaw;
      const allowance = await client.readContract({ address: token, abi: TOKEN_ABI, functionName: 'allowance', args: [account.address, router] });
      if (allowance < amount) {
        const approve = await wallet.writeContract({ address: token, abi: TOKEN_ABI, functionName: 'approve', args: [router, amount] });
        const receipt = await client.waitForTransactionReceipt({ hash: approve }); if (receipt.status !== 'success') throw new Error('token approval failed');
      }
    }
    const hash = await wallet.writeContract({ address: router, abi: ROUTER_ABI, functionName: 'addLiquidity', args: [wmon, usdc, wmonRaw, usdcRaw, 0n, 0n, account.address, BigInt(Math.floor(Date.now() / 1000) + 1200)] });
    const receipt = await client.waitForTransactionReceipt({ hash }); if (receipt.status !== 'success') throw new Error('adding WMON/USDC liquidity failed');
  }
  output.wmonAmount = wmonAmount; output.usdcAmount = usdcAmount; save();
  console.log(JSON.stringify({ ...output, rpcUrl }, null, 2));
}

main().catch(error => {
  console.error(`testnet deploy failed: ${error instanceof Error ? error.message : 'deployment error'}`);
  process.exitCode = 1;
});
