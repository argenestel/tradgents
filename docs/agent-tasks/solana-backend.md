You are the backend engineer for "Tradgents" on SOLANA. BUILD (not just design) the backend in
/home/arg/projects/hack/tradgents/solana/programs/ (Anchor) and /home/arg/projects/hack/tradgents/solana/api/ (TypeScript service).
Read first: solana/docs/BACKEND.md, solana/docs/PROTOCOLS.md, solana/docs/DESIGN.md, and the frontend contract files
solana/web/src/lib/types.ts, solana/web/src/lib/api.ts, solana/web/src/lib/mock/seed.ts (demo-data generator: reuse its logic for demo seeding).
Do NOT modify solana/web or anything outside solana/programs and solana/api (you may read everything).

Installed toolchain: anchor-cli 0.32.1, solana-cli 3.1.8, cargo/rustc 1.95, node 22, pnpm. If `anchor build` needs to download platform tools and the
network blocks it, say so and fall back to what can be verified (cargo check / cargo test, litesvm), stating clearly what was and wasn't verified.

PART 1 - solana/programs/agent-registry (Anchor):
- register_agent(agent_wallet, metadata_hash, ...) with a returnable SOL bond held in a PDA vault; the agent_wallet must co-sign (proves control of the
  agent key); withdraw_bond after a cooldown unless paused/slashed; pause_agent / unpause_agent / slash_agent callable only by an admin/guardian stored in a
  config PDA (NO automated slashing; slashed bond goes to a treasury in config); update_config by admin. Emit events for the indexer.
  Checked math, PDA bumps, rent-exempt handling, account constraints (has_one, seeds), clear errors. No unsafe code.
- Tests (anchor test with solana-test-validator, or litesvm/bankrun): happy path, missing agent co-signature, bond below minimum, withdraw before/after
  cooldown, paused/slashed cannot withdraw, non-admin cannot pause/slash, double-register rejected. Report pass counts.
- scripts + README with EXACT devnet deploy commands. The HUMAN deploys with their OWN funded devnet keypair (path from env ANCHOR_WALLET).
  You must NOT generate or fund a wallet on devnet, NOT run `solana airdrop` against devnet, and NOT broadcast any transaction to a public cluster.
  Rehearse the full deploy on a local solana-test-validator and show the output. Print the program id in a form usable as NEXT_PUBLIC_REGISTRY_PROGRAM.

PART 2 - solana/api (Node 22 + TypeScript; node:sqlite if available else better-sqlite3; Hono or Fastify; zod; vitest):
Implement these JSON endpoints returning shapes EXACTLY matching the TS types in solana/web/src/lib/types.ts:
  GET /v1/leaderboard -> LeaderboardRow[]
  GET /v1/agents/:slug -> AgentDetail (404 if unknown)
  GET /v1/feed?filter=all|calls|trades|thesis&agent=&limit= -> PostView[]
  GET /v1/calls?agent= -> Call[]
  GET /v1/protocols -> ProtocolPage[]  and  GET /v1/protocols/:id -> ProtocolPage
  GET /v1/health
  POST /v1/agents/register (verifies an ed25519 signature over a server-issued challenge; stores agent with verification='wallet_signed')
  POST /v1/posts and POST /v1/calls (authenticated by an ed25519 signature from a registered agent wallet; rate limited; length limited; plain-text only;
  agent-authored text is UNTRUSTED)
- Indexer: reads registry-program events/accounts via RPC at 'finalized' commitment into SQLite idempotently (unique signature + ix index), safe on
  restart/backfill; integration test against the local test validator if feasible.
- Metrics COMPUTED from stored trade/equity rows (port the logic from seed.ts): TWR, Sharpe/Sortino/maxDD, 95% Sharpe range, eligibility gates
  (>=7 days and >=10 trades), per-protocol attribution, waterfall. `pnpm seed:demo` fills the DB with the simulated demo agents, every demo row marked
  demo=true; the API sets header X-Demo-Data: true when serving demo rows and never presents them as real. Real registered agents have no trades until
  protocol adapters exist (do not fake them).
- Config via env (.env.example): RPC_URL, PROGRAM_ID, DB_PATH, PORT, CORS origins. No secrets in the repo. README with run instructions.
  `pnpm test` and `pnpm typecheck` must pass.

SAFETY: no public-network broadcasts, no generating/using keys other than throwaway local test keypairs, no git commands, no global installs, nothing
outside your two directories. If you hit a permission denial, missing credits or a tool limit, STOP and report exactly that.

Final reply (<=250 words): what was built, test results with pass counts, the exact commands the human must run to deploy to Solana devnet, what is NOT
done, and what you could not verify.
