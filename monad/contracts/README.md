# Tradgents AgentRegistry (Foundry)

`MONAD_NETWORK=mainnet` is the deployment default. The registry script accepts chain ID 10143 only when explicitly run with `MONAD_NETWORK=testnet`; mainnet still requires chain 143. The open-mint TestUSDC and TestWMON fixtures under `src/test-tokens/` are testnet-only, are excluded from Foundry's default/mainnet profile, and their constructors revert unless chain ID is 10143. Use `FOUNDRY_PROFILE=testnet forge build` only for local/testnet work.

Non-custodial MON bond escrow with EIP-712 / ERC-1271 registration. The registry does not hold agent trading keys. Slashing is an explicit admin action, limited to the owner's requested unbond cooldown and requiring a nonzero reason code.

## Contract semantics

- Registration records the agent wallet, owner, metadata hash, bond, and nonce. Registration does **not** start the withdrawal cooldown.
- The owner calls `requestUnbond(agentWallet)` to start the configured cooldown.
- The owner may call `withdraw(agentWallet)` after cooldown expiry if the agent is not paused or slashed.
- The owner may slash only during the requested cooldown; `AgentSlashed` includes the reason code.
- Ownership transfer is two-step (`transferOwnership`, then `acceptOwnership`). Guardian pause/unpause and bond lifecycle events are indexed by `mon/api`.

## Local tests

```bash
forge test -vv
```

Tests use a keyless ERC-1271 fixture and execute only in Foundry's local EVM. They do not send network transactions or load a private key.

## Deployment

`script/Deploy.s.sol` reads `DEPLOYER_PRIVATE_KEY` from the environment, starts Foundry broadcasting, and prints the deployer and deployed registry address. Keep the key in the operator's secret manager/environment; never put it in this repository, a command-line flag, or API/worker environment.

Before a human deploys, verify the selected profile and perform a simulation first. Mainnet is chain ID `143` at `https://rpc.monad.xyz`; testnet is chain ID `10143` at `https://testnet-rpc.monad.xyz`. Set `MONAD_NETWORK=testnet` explicitly for the latter. Never use mainnet credentials for testnet work. A deployment address has **not** been established by this implementation; set `REGISTRY_ADDRESS` only after the operator deploys and verifies bytecode on the intended chain.

Required deployment environment: `DEPLOYER_PRIVATE_KEY`, `GUARDIAN`, `TREASURY`, and optionally `MIN_BOND_WEI` (default `0.1 MON`) and `UNBOND_DELAY` (default 7 days). A human operator may explicitly add `--broadcast` to the Foundry script command after reviewing the simulation; no deployment was broadcast as part of this work.
