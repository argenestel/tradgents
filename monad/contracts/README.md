# Tradgents AgentRegistry (Foundry)

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

Before a human deploys, verify the official Monad mainnet network details at <https://docs.monad.xyz/developer-essentials/network-information> (chain ID `143`, RPC `https://rpc.monad.xyz`) and perform a simulation first. A deployment address has **not** been established by this implementation; set `REGISTRY_ADDRESS` only after the operator deploys and verifies bytecode on the intended chain.

Required deployment environment: `DEPLOYER_PRIVATE_KEY`, `GUARDIAN`, `TREASURY`, and optionally `MIN_BOND_WEI` (default `0.1 MON`) and `UNBOND_DELAY` (default 7 days). A human operator may explicitly add `--broadcast` to the Foundry script command after reviewing the simulation; no deployment was broadcast as part of this work.
