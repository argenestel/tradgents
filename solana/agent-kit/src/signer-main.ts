#!/usr/bin/env -S node --import tsx
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { solanaChain } from './chain';
import { listen } from './ipc';
import { jupiterApi, priceApi } from './jupiter';
import { DEVNET_GENESIS, loadPolicy, MAINNET_GENESIS, STABLE_MINTS } from './policy';
import { orcaDevnetApi, orcaDevnetPrices } from './orca';
import { Signer } from './signer';
import { SpendLedger } from './spend';
import { encodeBase58, readKeypair } from './keys';

const HELP = `tradgents-signer: holds the agent's key and enforces its limits. Run it as the owner, not as the agent.

  init --dir ~/.tradgents-signer --rpc <RPC url> --api <Tradgents API url> [--keypair file] [--network mainnet-beta|devnet] [--registry <program id>]
        creates the folder, a new keypair (unless --keypair exists), and a policy.json with small default limits
  run  --policy ~/.tradgents-signer/policy.json
        starts the signer on its Unix socket
Env: JUPITER_API_KEY (optional)
`;

const DEVNET_REGISTRY = '73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA'; // the devnet deployment, see solana/DEPLOYMENTS.md
function log(o: object) { console.log(JSON.stringify({ t: new Date().toISOString(), ...o })); }

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({ args: rest, strict: true, options: { dir: { type: 'string' }, rpc: { type: 'string' }, api: { type: 'string' }, keypair: { type: 'string' }, policy: { type: 'string' }, network: { type: 'string' }, registry: { type: 'string' } } });
  if (cmd === 'init') {
    if (!values.dir || !values.rpc || !values.api) throw new Error('init needs --dir, --rpc and --api');
    const dir = values.dir.replace(/^~(?=\/)/, os.homedir());
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const keyfile = values.keypair?.replace(/^~(?=\/)/, os.homedir()) ?? path.join(dir, 'key.json');
    let created = false;
    if (!fs.existsSync(keyfile)) {
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      fs.writeFileSync(keyfile, JSON.stringify([...privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32), ...publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)]), { mode: 0o600, flag: 'wx' });
      created = true;
    }
    const policyFile = path.join(dir, 'policy.json');
    if (fs.existsSync(policyFile)) throw new Error(`${policyFile} already exists; edit it by hand`);
    if (values.network && !['mainnet-beta', 'devnet'].includes(values.network)) throw new Error('--network must be mainnet-beta or devnet');
    fs.writeFileSync(policyFile, JSON.stringify({ network: values.network ?? 'mainnet-beta', rpcUrl: values.rpc, keypairPath: keyfile, stateDir: path.join(dir, 'state'), socketPath: path.join(dir, 'signer.sock'),
      socketMode: '600', apiUrl: values.api, maxTradeUsd: 10, maxDailyUsd: 25, maxSlippageBps: 100,
      ...((values.registry ?? (values.network === 'devnet' ? DEVNET_REGISTRY : undefined)) ? { registryProgram: values.registry ?? DEVNET_REGISTRY } : {}) }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ wallet: encodeBase58(readKeypair(keyfile).subarray(32)), keyCreated: created, policy: policyFile,
      next: 'Fund the wallet with a small amount you can afford to lose, review policy.json, then run: tradgents-signer run --policy ' + policyFile }, null, 2));
    return;
  }
  if (cmd === 'run') {
    if (!values.policy) throw new Error('run needs --policy');
    const policy = loadPolicy(values.policy.replace(/^~(?=\/)/, os.homedir()));
    const secret = readKeypair(policy.keypairPath), chain = await solanaChain(policy.rpcUrl, secret, policy.network);
    const genesis = await chain.genesis(), expected = policy.network === 'devnet' ? DEVNET_GENESIS : MAINNET_GENESIS;
    if (genesis !== expected) throw new Error(`The RPC is not Solana ${policy.network} (genesis ${genesis}); refusing to start`);
    fs.mkdirSync(policy.stateDir, { recursive: true, mode: 0o700 });
    const key = process.env.JUPITER_API_KEY;
    const signer = new Signer({ policy, secret, chain, wallet: chain.wallet, jup: policy.network === 'devnet' ? orcaDevnetApi(policy.rpcUrl, chain.wallet) : jupiterApi(policy.jupiterUrl, key), prices: policy.network === 'devnet' ? orcaDevnetPrices(policy.rpcUrl) : priceApi(policy.priceUrl, STABLE_MINTS, key), spend: new SpendLedger(policy.stateDir) });
    const server = await listen(policy.socketPath, policy.socketMode, async req => {
      const res = await signer.handle(req);
      log({ cmd: req.cmd, ok: res.ok, ...(res.ok ? {} : { error: res.error }) }); // never the request body or any key material
      return res;
    });
    log({ msg: 'signer ready', wallet: chain.wallet, socket: policy.socketPath, maxTradeUsd: policy.maxTradeUsd, maxDailyUsd: policy.maxDailyUsd });
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => server.close(() => { fs.rmSync(policy.socketPath, { force: true }); process.exit(0); }));
    return;
  }
  console.log(HELP);
}
main().catch(e => { console.error(`error: ${(e as Error).message}`); process.exit(1); });
