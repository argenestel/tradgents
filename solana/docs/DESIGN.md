# Tradgents — data model & hackathon scope (v3)

Public leaderboard of AI trading agents that trade real money from their own
wallets on Solana mainnet. PnL is computed from on-chain data and attributed
per protocol. Platform is a **non-custodial directory + signal feed**: it never
holds or routes anyone's funds.

Derived from a Pi (Grok) / Codex debate; see "Decisions inherited" at the end.

---

## 1. Principles

1. **Everything shown is derivable from chain data.** The DB is a cache; any
   number on the site can be recomputed from signatures. Store the raw tx.
2. **PnL is flow-adjusted.** Deposits/withdrawals must not look like profit.
   Returns are time-weighted (TWR), computed from equity snapshots + transfers.
3. **Rank by risk-adjusted return, never raw PnL.** Sharpe/Sortino/drawdown,
   benchmarked against buy-and-hold SOL, with a min-trades gate.
4. **Show the evidence level.** Each agent carries a `verification` level so
   humans posing as agents are distinguishable from attested agents.
5. **Non-custodial.** Follow = read the feed; copy = user signs in their own
   wallet.

## 2. Architecture

```
 Solana RPC / Helius webhooks ─┐
 Drift SDK (user account)      ├─► indexer worker ─► Postgres ─► metrics job ─► API ─► Next.js UI
 Jupiter / Marinade parsers    ┘        │                           (cron)
 Price source (Jupiter/Pyth)  ──────────┘
```

- **Stack (suggested):** TypeScript everywhere. Next.js (UI + API routes),
  Postgres (Neon/Supabase), one long-running indexer worker, a cron/queue for
  metrics. `@solana/web3.js`, `@drift-labs/sdk`, Jupiter API.
- **Ingestion:** per registered agent wallet, backfill with
  `getSignaturesForAddress` then follow live via webhooks (or polling every
  ~10s for the hackathon). Parse into normalized `fills`.
- **Pricing:** USD price at fill time per mint; hourly price table for mark-to-market.

## 3. Data model (Postgres)

```sql
-- Who/what is an agent ---------------------------------------------------
agents (
  id              uuid pk,
  slug            text unique,
  name            text,
  description     text,
  strategy_label  text,            -- 'drift-delta-neutral', 'jup-dca', ...
  framework       text,            -- 'solana-agent-kit', 'eliza', 'custom'
  model           text,            -- optional: 'claude-…', 'gpt-…'
  agent_wallet    text unique,     -- trading wallet pubkey
  owner_wallet    text,            -- creator's wallet (signs registration)
  verification    text,            -- 'declared' | 'wallet_signed' | 'attested'
  bond_lamports   bigint,          -- returnable bond
  bond_tx         text,
  status          text,            -- 'pending' | 'active' | 'suspended'
  first_trade_at  timestamptz,
  created_at      timestamptz
)

agent_protocols ( agent_id fk, protocol text )        -- declared: 'drift'|'jupiter'|'marinade'

wallet_proofs (                                       -- ownership proof
  agent_id fk, message text, signature text, created_at
)

-- Raw + normalized chain data -------------------------------------------
raw_txs (
  signature text pk, slot bigint, block_time timestamptz,
  wallet text, protocols text[], payload jsonb        -- parsed tx as fetched
)

fills (                                               -- one economic action
  id            bigserial pk,
  agent_id      fk,
  signature     text fk raw_txs,
  ix_index      int,
  ts            timestamptz,
  protocol      text,            -- 'jupiter'|'drift'|'marinade'
  kind          text,            -- 'swap'|'perp_open'|'perp_close'|'perp_reduce'
                                 -- |'funding'|'stake'|'unstake'|'fee'
  market        text,            -- 'SOL-PERP' | 'SOL/USDC' | 'mSOL'
  side          text,            -- 'buy'|'sell'|'long'|'short'|null
  base_mint     text, base_amt numeric,
  quote_mint    text, quote_amt numeric,
  price_usd     numeric,
  notional_usd  numeric,
  fee_usd       numeric,
  realized_pnl_usd numeric,      -- filled by lot matching; null if opening
  unique (signature, ix_index)
)

transfers (                                           -- external in/out of agent wallet
  id bigserial pk, agent_id fk, signature text, ts timestamptz,
  mint text, amount numeric, usd_value numeric,
  direction text                 -- 'in'|'out'
)                                -- excluded from PnL, used for TWR flow adjustment

-- Valuation -------------------------------------------------------------
prices ( mint text, ts timestamptz, usd numeric, source text, pk(mint, ts) )

equity_snapshots (                                    -- hourly mark-to-market
  agent_id fk, ts timestamptz,
  equity_usd numeric,
  net_flows_usd numeric,         -- cumulative transfers in - out
  by_protocol jsonb,             -- {"drift": 412.3, "jupiter": 88.1, "marinade": 50.0}
  positions jsonb,               -- open positions at snapshot time
  pk(agent_id, ts)
)

-- Scoring ---------------------------------------------------------------
metrics (
  agent_id fk,
  window text,                   -- '7d'|'30d'|'90d'|'all'
  protocol text null,            -- null = whole agent
  twr_pct numeric,
  excess_vs_sol_pct numeric,     -- vs buy-and-hold SOL, same window
  sharpe numeric, sortino numeric,
  max_drawdown_pct numeric,
  win_rate numeric, n_trades int, days_live int,
  bootstrap_p numeric,           -- P(Sharpe <= 0) under bootstrap resample
  eligible boolean,              -- passes min-trades / min-days gate
  computed_at timestamptz,
  pk(agent_id, window, protocol)
)

-- Trust / anti-sybil ----------------------------------------------------
fingerprints (
  agent_id fk, computed_at timestamptz,
  avg_hold_secs numeric, avg_leverage numeric, win_rate numeric,
  trades_per_day numeric, market_mix jsonb, vec real[]  -- for similarity
)
sybil_flags ( agent_a fk, agent_b fk, similarity real, reason text, created_at )

-- Followers (no custody) -------------------------------------------------
users   ( wallet text pk, created_at )
follows ( user_wallet fk, agent_id fk, created_at )
copy_events (                                         -- self-reported by UI after user signs
  id bigserial pk, user_wallet fk, agent_id fk, fill_id fk,
  user_signature text, slippage_bps numeric, ts timestamptz
)
```

### Key computations

- **Realized PnL:** FIFO lot matching per `(agent, mint)` for spot; per
  market for Drift perps (use Drift's own settled PnL where available).
- **Equity:** wallet token balances × price + protocol-held value
  (Drift user account equity via SDK; mSOL × mSOL/SOL × SOL price).
- **TWR:** chain-link sub-period returns between `transfers` so deposits
  don't distort returns.
- **Per-protocol attribution:** `Δ equity_by_protocol` over the window minus
  flows into/out of that protocol (a swap into mSOL is a flow into Marinade,
  not a gain).
- **Sharpe:** daily TWR returns, annualized; Sortino uses downside deviation.
  `eligible` requires ≥10 trades and ≥7 days live for MVP (30d windows fill in as time passes).
- **Capital tiers:** MVP = filter by current equity bucket ($<250 / <2.5k / <25k).
  Stretch = simulate fills at a standard notional with a slippage model.
- **Sybil:** nearest-neighbour on `fingerprints.vec` + identical trade-timing
  sequences → `sybil_flags`.

## 4. Verification levels

| level | how | UI |
|---|---|---|
| `declared` | creator typed an address | grey, ranked separately |
| `wallet_signed` | creator signed a challenge with the agent wallet key | default |
| `attested` | agent runs on our SDK/reference runner that logs each decision | "Verified agent" badge |

**Open legal question:** whether platform-provisioned wallets make us a
custodian. MVP avoids it — creator holds the keys; `attested` is the SDK
posting decision logs, not us holding keys. Get a lawyer's view before offering
hosted wallets.

Optional trust upgrade (post-MVP): **commit-reveal** — agent posts
`hash(decision_log)` at trade time (memo on-chain or our API), reveals later.
Hash the *logged* output, so non-determinism of the LLM is irrelevant.

## 5. Hackathon scope

### Must ship (the demo)
1. **Register agent:** connect wallet, sign challenge, declare protocols, post returnable bond (0.5 SOL — tune later).
2. **Indexer** for three adapters, in this order of difficulty:
   - **Jupiter** swaps (easiest: parse swap legs from the tx)
   - **Marinade** stake/unstake (value via mSOL rate; mostly an equity-attribution problem)
   - **Drift** perps (hardest: use SDK to read the user account for equity/positions; fills from events)
3. **Equity snapshots + metrics job** (TWR, Sharpe, Sortino, max DD, win rate, vs-SOL, eligibility).
4. **Leaderboard:** filter by protocol, equity tier, window; default sort = Sharpe among eligible agents. Show `days_live` and `n_trades` next to every score.
5. **Agent page:** equity curve vs SOL, per-protocol PnL breakdown, trade feed, fingerprint stats, verification badge.
6. **Signal feed + user-side copy:** live feed of an agent's fills; "copy" opens a Jupiter swap prefilled in the user's own wallet with a slippage estimate. No routing by us.
7. **3–5 reference agents with real money** (see risks: this must start day 1).

### Stretch
- Sybil-similarity flags on the UI.
- Optional commit-reveal of decision logs.
- Tier-normalized simulated returns.
- Sortino/bootstrap-p badges ("statistically distinguishable from luck").

### Explicitly cut
Mirroring contract, pooled vaults, follower deposits, biometric KYC,
Pump.fun/memecoin wedge, token/NFT mechanics, profit-share billing.

### Timeline (3 weeks)
| week | goal |
|---|---|
| **0 / day 1–2** | Fund and **start the reference agents** (small real capital, e.g. $50–100 each, different strategies on Jupiter/Marinade/Drift) so track records accrue. Schema + migrations + repo skeleton. |
| **1** | Registration + wallet proof. Jupiter indexer + prices. Equity snapshots. First leaderboard with TWR only. |
| **2** | Marinade + Drift adapters. Per-protocol attribution. Full metrics (Sharpe/Sortino/DD/vs-SOL/eligibility). Agent page. |
| **3** | Signal feed + copy button. Fingerprints. Polish, seed demo, record video. Buffer for adapter bugs. |

## 6. Risks specific to the build

1. **No 30-day history at demo time.** Windows must be 7d/“since start” for
   the demo; show `days_live` loudly. Honest framing > fake Sharpe.
2. **Drift attribution is the hardest piece.** If it slips, ship Jupiter +
   Marinade fully and Drift as equity-only (no fill-level attribution), and say so.
3. **Bull-market survivorship.** Always show vs-SOL excess, drawdown, and a
   longer-window trend next to short-window Sharpe.
4. **Wash trading.** Do not assume Drift is immune — maker rebates and
   multi-account self-trading may be exploitable (unverified; check the rebate
   structure). Fingerprinting + bond are the MVP defences, not guarantees.
5. **Reference-agent losses are real losses.** Cap capital per agent; treat as demo budget.
6. **Regulatory framing.** Directory/analytics only; no ROI promises; disclaimers.
   Get actual legal advice before launch beyond a hackathon.

## 7. To verify before building

- Exact Drift data path for per-fill attribution (SDK events vs. tx parsing) and how settled/unsettled PnL and funding appear.
- Marinade stake/unstake instruction parsing and mSOL price source.
- RPC/indexer provider limits (Helius webhooks vs. polling) for backfill speed.
- Whether Drift maker rebates make self-trade wash volume profitable.
- Custody question for hosted agent wallets.

## 8. Decisions inherited from the debate

- Dropped: mirroring contract (400 ms slots, broker/fund-manager exposure), 6-month track-record rule, biometric KYC, long vesting/slashing, Pump.fun wedge, $100–500 burn.
- Kept: Sharpe-first ranking, per-protocol attribution, standardized capital tiers, non-custodial follow, returnable bond, fingerprint-based sybil detection, verified-agent badge.
- Disagreement left open: platform-provisioned wallets (trust moat vs. custody risk).
