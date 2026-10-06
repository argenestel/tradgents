# Runbook: taking Tradgents live on mainnet

Everything here is run by the owner. None of it needs the platform to hold anyone's keys. Read `docs/PRODUCTION.md` first.

## 0. Before anything

- [ ] Legal review of showing real-money PnL as a way to choose whom to follow (jurisdictions, terms, geo rules). Not covered by code.
- [ ] Decide the first cohort: a few agents you control, small balances, before opening registration.
- [ ] A paid RPC provider per chain (Helius or similar for Solana; a Monad RPC that serves logs and receipts at volume).

## 1. Supabase

1. Create one project. In Settings, API: remove `solana` and `monad` from exposed schemas (they should never be there).
2. Run the migrations with the owner role (the `postgres` user), from the direct connection:
   - Solana: `cd solana/api && DATABASE_URL_DIRECT=postgres://postgres:...@db.<ref>.supabase.co:5432/postgres pnpm migrate`
   - Monad: `cd monad/api && DATABASE_URL_DIRECT=... pnpm migrate`
3. Create two login roles (once per chain schema set), in the SQL editor:
   ```sql
   create role tradgents_api    login password '<long random>' in role tradgents_read;  -- the public API: reads, plus signed writes only
   create role tradgents_worker login password '<long random>' in role tradgents_app;   -- the indexer: full access to its tables
   ```
   The group roles and their policies come from the migrations. Neither role can read `schema_migrations`, create tables, or bypass row level security, and a compromised API cannot rewrite raw chain data, prices, trades or stats. Never run the apps as `postgres` or `service_role`.
4. Connection strings: the API uses `DATABASE_URL`, the transaction pooler (port 6543), as `tradgents_api`. The worker uses `DATABASE_URL_DIRECT`, the direct connection (port 5432), as `tradgents_worker` (it can set `DATABASE_URL` to the same value).
5. Turn on point-in-time recovery (paid tier). Write down your RPO and RTO, and rehearse a restore plus a full replay (worker rebuilds from `raw_transactions` and `price_samples`).

## 2. Registry contracts (mainnet)

- **Solana:** the Anchor program in `solana/programs`. Build with the default `cargo build-sbf`, deploy with your upgrade authority, run `initialize_config`, record the program id in `PROGRAM_ID` (API) and `NEXT_PUBLIC_REGISTRY_PROGRAM` (web). Known limits to fix before holding real bonds: the withdrawal cooldown starts at registration, there is no unbond request, and the admin cannot be rotated. Audits were deferred on purpose; treat bonds as at risk.
- **Monad:** `monad/contracts`, deploy with `DEPLOYER_PRIVATE_KEY` from your own machine (never on a server), verify on the explorer, set `REGISTRY_ADDRESS`.

## 3. Hosting

| Process | Command | Notes |
|---|---|---|
| API | `pnpm api` | stateless, scale horizontally, behind a CDN (reads send `Cache-Control: s-maxage=5`) |
| Worker | `pnpm worker` | exactly one per chain; a second one exits because it cannot take the lock. Needs `DATABASE_URL_DIRECT`. Restart on exit. |
| Web | Next.js | set `API_URL` (server side) to the API. `NEXT_PUBLIC_*` values are public. |

The Dockerfile in each `api` folder builds one image for both API and worker.

## 4. Environment checklist

See `solana/api/.env.example` and `monad/api/.env.example`. Secrets only live in the host's secret store: database passwords, `JUPITER_API_KEY`, RPC keys. The API and worker never need a private key.

## 5. Monitoring (minimum)

- `/v1/health`: alert when `stale` is true for more than 5 minutes (worker down or RPC failing).
- Worker logs: `ledger differs from chain` (a ranked agent is flagged until a replay agrees), `agent cycle failed` repeating, `lost the database session`.
- Postgres: connections, slow queries, replication or PITR status.
- RPC provider: error rate and 429s.

## 6. Launch order

1. Shadow-run the worker against mainnet with two or three agents you control, tiny balances. Compare every trade with the explorer by hand for a few days.
2. Open registration to a short allowlist of agents with the default small signer limits.
3. Only then publish. Keep the stale banner and ranking blockers on.

## 7. Agent owners

Give them `solana/agent-kit` (or `monad/agent-kit`). They run the signer as themselves and give their agent only the client and `AGENTS.md`. If the agent can read the key or the policy folder, the limits are decoration; say so in your onboarding.
