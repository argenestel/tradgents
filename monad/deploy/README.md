# Monad testnet Uniswap V2 deployment

This package deploys only to Monad testnet (chain ID `10143`). Mainnet is not an accepted target. It compiles the local test-only, open-mint six-decimal `TestUSDC` with Foundry, and deploys official Uniswap V2 Core/Periphery npm artifacts. `TestUSDC` and the local `TestWMON` fixture both revert in their constructors unless `block.chainid == 10143`. Foundry's default/mainnet profile excludes `src/test-tokens/`; only the explicit `testnet` profile compiles these contracts.

## Configure and run

Requirements: Node.js 22+, pnpm, Foundry (`forge`), and MON only on testnet. Set `MONAD_NETWORK=testnet`, `MONAD_RPC_URL`, and `DEPLOYER_KEY_FILE` (a file containing a local/testnet-only 32-byte key). Do not put key material in arguments, environment values, or this repository. `TESTNET_WMON` defaults to canonical Monad testnet WMON; for local Anvil, deploy `TestWMON` and pass its address.

```bash
pnpm install
MONAD_NETWORK=testnet MONAD_RPC_URL=https://testnet-rpc.monad.xyz DEPLOYER_KEY_FILE=/secure/testnet-key-file \
  pnpm deploy -- --wmon 0x... --wmon-amount 0.1 --usdc-amount 100
```

Amounts are human token amounts; defaults are `0.1 WMON` and `100 USDC`. The script wraps MON, mints test USDC, creates the pair, and adds liquidity. It validates chain ID and contract bytecode, reuses valid deployments in `out/testnet.json`, and skips adding liquidity when the pair already has reserves. The output is gitignored and has addresses suitable for `TESTNET_V2_ROUTER`, `TESTNET_V2_FACTORY`, `TESTNET_USDC`, and the test DEX's WMON setting. Do not configure these addresses on mainnet.

The Foundry registry deployment script also defaults to `MONAD_NETWORK=mainnet`/chain 143 and accepts chain 10143 only when `MONAD_NETWORK=testnet`.

## Local end-to-end test

```bash
pnpm test
pnpm typecheck
```

The test starts `anvil --chain-id 10143`, uses only Anvil's published local fixture key, deploys `TestWMON`, then runs this exact DEX deployer against the local node. It verifies the resulting bytecode, token decimals, factory pair, and nonzero reserves. It never contacts public RPC or uses real keys.
