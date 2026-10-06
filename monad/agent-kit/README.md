# Monad agent kit

`tradgents` is a keyless CLI; `tradgents-signer` is the only process that reads the owner's private-key file. The signer accepts bounded JSON intents over a Unix socket and supports only WMON/USDC exact-input swaps through the pinned Monad Uniswap V2 Router02. It constructs and validates calldata itself, checks the recipient/path/amount/deadline, simulates with `eth_call`, enforces Pyth-backed USD limits, reserves spend durably before sending, and only exact-approves the router. It supports domain-separated Tradgents `Register`, `Post`, and `Call` EIP-712 messages; there is no arbitrary-sign or raw-transaction API.

## Operator setup

1. Create a root-owned, non-group/world-writable JSON policy file with chain ID `143`, the deployed registry address, the agent wallet and explicitly allowed registration owner wallet, canonical WMON (18 decimals) and USDC (6 decimals), pinned router/factory, per-trade/day caps, and gas/slippage limits. The registry address must match a deployment verified by the operator; no address is shipped here.
2. Run the signer as a dedicated OS user. Provision `SIGNER_KEY_FILE` out of band, owned by that user and mode `0600`; never put key material in environment examples, shell commands, or this repo. `SIGNER_DIR` must be signer-owned mode `0700` and stores the spend ledger and `PAUSE` file.
3. For a separate CLI/agent user, place `TRADGENTS_SIGNER_SOCKET` in a root-controlled runtime directory. Configure ACL/group traversal so the signer can create the socket and only the intended agent group can connect; do not make the directory agent-writable. Set `TRADGENTS_SIGNER_SOCKET_MODE=0660`. The default socket mode is `0600` and is only suitable when the client runs as the signer UID. Do not grant the agent user access to the signer directory, policy, or key.
4. Inject `MONAD_RPC_URL`, `MONAD_CHAIN_ID=143`, `REGISTRY_ADDRESS`, `SIGNER_DIR`, `SIGNER_POLICY_FILE`, `SIGNER_KEY_FILE`, and the socket settings through the process manager. The signer checks RPC chain ID and deployed bytecode for the registry, router, factory, and tokens at startup.
5. Install with `pnpm install`, then run `pnpm typecheck` and `pnpm test`. Start `pnpm signer` under the signer account and expose the same socket path to the keyless CLI. Use `pnpm tradgents -- status` or `pnpm tradgents -- swap --in WMON --out USDC --amount 0.2 --max-slippage-bps 50`.

The signer reserves the full notional before simulation or broadcast; failed attempts continue to consume that day's budget. A `PAUSE` file in `SIGNER_DIR` blocks all trade and signing requests. This is an OS-isolation boundary, not an on-chain session-key policy. Use only funds the owner can afford to lose.

## Verification sources

- Network chain ID/RPC: <https://docs.monad.xyz/developer-essentials/network-information>
- Uniswap mainnet router/factory: <https://github.com/monad-crypto/protocols/blob/main/mainnet/uniswap.jsonc>
- WMON: <https://github.com/monad-crypto/protocols/blob/main/mainnet/CANONICAL.jsonc>
- USDC: <https://github.com/monad-crypto/protocols/blob/main/mainnet/aave_v3.jsonc>
- Pyth contract/feed IDs: <https://github.com/monad-crypto/protocols/blob/main/mainnet/pyth.jsonc>
