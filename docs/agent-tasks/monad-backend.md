You are the backend engineer for "Tradgents" on MONAD. BUILD (not just design) the backend in
/home/arg/projects/hack/tradgents/monad/contracts/ (Foundry) and /home/arg/projects/hack/tradgents/monad/api/ (TypeScript service).
Read first: monad/docs/BACKEND.md (sections 3, 4, 10), monad/docs/PROTOCOLS.md, and monad/web/src/lib/types.ts, monad/web/src/lib/api.ts,
monad/web/src/lib/mock/seed.ts. Do NOT modify monad/web or anything outside monad/contracts and monad/api.

PART 1 - monad/contracts (Foundry; forge/anvil/cast 1.5.1 installed):
- AgentRegistry.sol: register(agentWallet, ownerWallet, metadataHash, nonce, deadline, signature) payable with a native MON bond; EIP-712 domain
  {name:"Tradgents", version:"1", chainId, verifyingContract}; Register(address agentWallet,address ownerWallet,bytes32 metadataHash,uint256 nonce,uint256 deadline).
  Signature check via OpenZeppelin SignatureChecker (EOA + ERC-1271). Per-agent nonce, deadline check, owner-settable minimum bond, withdraw after
  cooldown unless paused/slashed, guardian can pause (NO automated slashing; admin slash after dispute -> treasury). Events: AgentRegistered, BondWithdrawn,
  AgentPaused, AgentSlashed. Reentrancy-safe, checks-effects-interactions, no unbounded loops.
- Foundry tests: happy path, bad signature, expired deadline, replay, ERC-1271 signer, bond below minimum, withdraw before/after cooldown,
  paused/slashed cannot withdraw, reentrancy attempt, access control. Use `forge install --no-git` for OpenZeppelin.
- script/Deploy.s.sol + README with EXACT Monad TESTNET deploy commands (verify chain id, RPC URL, explorer, faucet from docs.monad.xyz; say if you
  cannot). Key ONLY from env DEPLOYER_PRIVATE_KEY; never hard-code or write keys to disk. Rehearse on a local anvil node. DO NOT broadcast to any public
  network - the human deploys with their own funded key.

PART 2 - monad/api (Node 22 + TypeScript; node:sqlite or better-sqlite3; Hono or Fastify; zod; vitest):
Endpoints returning shapes EXACTLY matching monad/web/src/lib/types.ts: GET /v1/leaderboard, /v1/agents/:slug, /v1/feed?filter=all|calls|trades|thesis,
/v1/calls, /v1/protocols, /v1/protocols/:id, /v1/health; POST /v1/agents/register (EIP-712 + ERC-1271 via viem), POST /v1/posts, POST /v1/calls
(signature-authenticated, rate limited, plain text only, agent text is UNTRUSTED). Indexer reads AgentRegistry events idempotently (unique tx hash + log
index), handles restarts/backfill; integration test against anvil. Metrics COMPUTED from stored rows (port seed.ts logic); `pnpm seed:demo` marks every row
demo=true and the API sets X-Demo-Data. Real agents have no trades until protocol adapters exist. Config via .env.example (RPC_URL, REGISTRY_ADDRESS,
CHAIN_ID, DB_PATH, PORT, CORS). `pnpm test` and `pnpm typecheck` must pass.

SAFETY: no public-network broadcasts, no keys other than anvil's well-known dev keys in tests, no git commands, no global installs, nothing outside your
two directories. If blocked (permissions, credits, tools), STOP and say exactly what.

Final reply (<=250 words): what was built, test pass counts, the exact commands to deploy to Monad testnet, what is NOT done, unverified facts.
