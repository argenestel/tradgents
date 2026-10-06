# Tradgents AgentRegistry (Foundry)

Non-custodial MON bond escrow + EIP-712 / ERC-1271 registration. The contract
never holds trading keys and has **no automated slashing**. An admin may slash
to `treasury` only after an off-chain dispute.

## Layout

- `src/AgentRegistry.sol` — registry
- `test/AgentRegistry.t.sol` — unit tests (forge)
- `script/Deploy.s.sol` — deploy; private key from `DEPLOYER_PRIVATE_KEY` only

## Local tests

```bash
forge test -vv
```

Installed Foundry is 1.5.1; the `network = "monad"` / `--network monad` switch is Foundry ≥1.8 (docs.monad.xyz). Tests still run on the local EVM.

## Rehearse on a local Anvil node (do this, not a public broadcast)

Anvil well-known account 0 is fine **only** on a local node:

```bash
anvil --network monad --port 8545
```

In another shell, from this directory:

```bash
export DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export GUARDIAN=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
export TREASURY=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
export MIN_BOND_WEI=100000000000000000
export UNBOND_DELAY=604800

cast chain-id --rpc-url http://127.0.0.1:8545

forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key "$DEPLOYER_PRIVATE_KEY"
```

Do **not** reuse that well-known key on any public network.

## Monad testnet — exact commands (human deploys)

Verified against [Network Information - Testnet](https://docs.monad.xyz/developer-essentials/testnet) (fetched at build time):

| Field | Value |
|---|---|
| Network name | Monad Testnet |
| Chain ID | `10143` |
| Native token | MON |
| Public RPC | `https://testnet-rpc.monad.xyz` (QuickNode, 50 rps) |
| Alt RPC | `https://rpc-testnet.monadinfra.com` |
| Explorer | https://testnet.monadvision.com |
| Explorer | https://testnet.monadscan.com |
| Faucet | https://faucet.monad.xyz |
| App hub | https://testnet.monad.xyz |

Fund the deployer from the faucet first. **Never** put a key in a file, in this
repo, or on the command line history if you can avoid it. The script reads
`DEPLOYER_PRIVATE_KEY` from the environment only.

```bash
# 1. Confirm you are talking to Monad testnet
cast chain-id --rpc-url https://testnet-rpc.monad.xyz
# expect: 10143

# 2. Export a funded deployer key (do not commit, do not write to disk)
export DEPLOYER_PRIVATE_KEY         # 0x-prefixed hex
export GUARDIAN                     # pause role
export TREASURY                     # slash proceeds
export MIN_BOND_WEI=100000000000000000   # 0.1 MON; tune to ~USD 50–100 later
export UNBOND_DELAY=604800               # 7 days

# 3. Simulate, then broadcast (human only — do not run from automation)
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://testnet-rpc.monad.xyz \
  --chain 10143 \
  --private-key "$DEPLOYER_PRIVATE_KEY"

# When the simulation looks right:
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://testnet-rpc.monad.xyz \
  --chain 10143 \
  --broadcast \
  --private-key "$DEPLOYER_PRIVATE_KEY"
```

Contract verification (Sourcify / Monadscan API) is **not wired here**. I did
not find a documented `forge verify-contract` explorer API key flow on
docs.monad.xyz at build time. Verify manually on MonadVision / Monadscan if needed.

EIP-712 domain after deploy: `{ name: "Tradgents", version: "1", chainId: 10143, verifyingContract: <deployed> }`.
