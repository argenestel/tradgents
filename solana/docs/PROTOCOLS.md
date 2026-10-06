# Tradgents Solana Protocol and Interaction Catalog

Status: proposed adapter reference, 6 October 2026. This file extends [BACKEND.md](BACKEND.md); it does not assert that catalog adapters or connector actions are implemented. [high]

## Scope, confidence, and connector conventions

The catalog covers economic interaction families and major named Solana protocols, including historical positions that agents may still hold. It cannot enumerate every permissionless program, future deployment, pool, or issuer. Unknown programs remain evidence-backed unsupported activity; the residual interaction entries below prevent unexplained losses from disappearing. [high]

- **[high]**: established accounting rule, explicit backend requirement, or directly supported primary-source identity/interface. It is not an audit or guarantee of current availability. [high]
- **[med]**: documented product or reasonable adapter design whose deployed version, historical state, precision, or execution semantics need validation. [med]
- **[low]**: discovery candidate, legacy recovery uncertainty, missing authoritative deployment, or unverified market support. “Verify” means do not enable preparation until checked. [low]
- Each field's tag applies to its claims; an entry's final confidence is the weakest material implementation assumption, not an average. Priority and action names are Tradgents proposals, tagged for confidence in the recommendation. [high]
- **must-have** means required indexing/accounting for the supported launch cohort; **should-have** means the next practical coverage extension; **nice-to-have** means specialized, legacy, or valuation-heavy support. Unsupported exposure blocks fully covered rankings regardless of priority; see BACKEND.md §§4–6. [high]
- All action names below are **proposed shared registry names**, not upstream API endpoints or available MCP tools. `POST /v1/actions/:name/prepare` returns unsigned instructions; MCP may expose the same names or reversible host-compatible aliases. Only `jupiter.swap` preparation is in BACKEND.md's MVP. Cataloging a protocol does not authorize custody, automatic copy trading, or a hosted signer. See BACKEND.md §§1–2, 8, 10. [high]
- Common preparation inputs: `cluster`, `wallet`, exact `amount_atomic` strings, mint/market/pool/position identifiers, debit ceiling, minimum receive or limit price, expiry and policy limits. Return signer, all invoked programs including CPIs, fee payer, mints, maximum debit, minimum receive, quote timestamp, fee estimates, blockhash expiry and simulation requirements. Never derive a program allowlist solely from a caller's label. [high]
- `[TX]` = finalized transaction/instruction and inner-CPI parsing; `[LOG]` = program-scoped binary event decoding; `[STATE]` = captured on-chain account state; `[API]` = supplementary protocol/issuer data; `[RPC]` = chain primitives, balances, rewards and history. APIs help discovery and valuation; an API quote or reported fill never substitutes for finalized execution. [high]
- Listed IDs are source-verified addresses, not independently inspected mainnet binaries. Before deployment pin cluster, source commit, IDL hash, executable account owner, ProgramData/upgrade authority where applicable, schema version and activation slot. “verify”/“unknown [low]” is intentional; a token mint, pool, PDA, market, or tip recipient is not a program ID. [high]

## Shared indexing and accounting contract

### Evidence and ownership [high]

Follow BACKEND.md §4: resolve legacy/v0 static and lookup-table keys; parse outer and inner instructions and binary events; reconcile pre/post SOL and token balances; discover beneficially owned token accounts, open-orders accounts, stake accounts, vault receipts, obligations, user subaccounts, escrows and claims. Keeper-driven activity may omit the authority wallet from the transaction. Persist ownership validity intervals and watch position accounts as well as the wallet. [high]

Canonical order is `(slot, block_tx_index, instruction_path, event_index)`; event identity includes `(agent_id, signature, ix_index, event_index)`. Preserve raw RPC payload, invocation stack, parser version, IDL hash, accounts, atomic quantities, decimals, price/state provenance and finality. Missing logs require instruction/state fallback, not a guessed fill. Failed transactions book actual charged fees only; attempted actions revert. See BACKEND.md §§4, 9. [high]

### Formula reference [high]

These are proposed normalized accounting definitions, not claims that each protocol exposes these fields directly. Prices `P_i(t)` are historical USD/unit observations at aligned slot/time; quantities are decimal-scaled from exact atomic integers. `F` is positive capital into a bucket, negative out; it includes matched internal flows for protocol buckets and only external flows for the whole portfolio. [high]

| Code | Value, profit, or cost computation | Confidence |
|---|---|---|
| A: portfolio/bucket | `E = assets + recoverable claims − liabilities`; `PnL = E1 − E0 − ΣF`. All bucket PnLs reconcile to portfolio dollar PnL after internal flows cancel. Borrowing is asset plus debt, not funding or income. | [high] |
| S: spot | Inventory `V = qP`; FIFO realized PnL `= net disposal proceeds − matched basis`; unrealized `= remaining marked value − remaining basis`. Immediate execution mark difference `= q_out P_out − q_in P_in − C_separate`; it is not the full investment's realized PnL. | [high] |
| C: costs | `C_chain = meta.fee / 10^9 × P_SOL`; this already contains actual base/priority transaction fees. Add separately evidenced tips, protocol charges and Token-2022 transfer fees only when not already included in net fill deltas/NAV. Recoverable rent stays an asset. | [high] |
| L: fungible LP | `V = owned_shares / effective_total_shares × net_redeemable_reserve_NAV + separately_owed_claims`. Correct reserves for debt, protocol-owned fees and other non-LP claims. Use protocol share accounting, not a universal raw mint supply denominator. | [high] |
| CL: concentrated LP | With normalized sqrt price `s`, bounds `a<b` and correctly scaled liquidity `L`, token0 `x=L(1/a−1/b), y=0` below range; `x=L(1/s−1/b), y=L(s−a)` in range; `x=0,y=L(b−a)` above range. `V=xP0+yP1+owed_fees+rewards`. Protocol SDK handles fixed-point rounding/decimals. | [high] |
| B: bin LP | `V = Σ_bins(user_share_fraction × withdrawable_token0_bin × P0 + user_share_fraction × withdrawable_token1_bin × P1) + owed_fees/rewards`. Reconstruct per-bin shares and pending claims from deployed layout. | [high] |
| IL: LP comparison | Flow-adjusted hold baseline `H=a0 P0+b0 P1`; divergence loss `= fee-excluded LP value − H`. For a full-range, equal-value constant-product pool only, relative IL `=2√r/(1+r)−1` for relative price ratio change `r`. Do not apply this to CLMM/DLMM. | [high] |
| D: lending | `E=Σ supply_units×deposit_conversion×P − Σ debt_units×borrow_conversion×P + separate_rewards`. Index/share conversion is protocol-specific. Interest equals flow-adjusted quantity growth; then distinguish price remeasurement. Bad debt/haircuts reduce the claim. | [high] |
| P: linear perp | Signed base `q`, entry `p_e`, mark `p`: `UPnL=q(p−p_e)` in quote units. Net trading PnL `= realized + Δunrealized + signed_funding + rebates − trading/borrow/liquidation_costs`; convert quote currency at its USD mark. Use contract multipliers, settled funding signs and payout caps where applicable. | [high] |
| ST: staking receipt | `V=n×redeemable_SOL_per_receipt×P_SOL`, alongside an executable market mark. For fixed `n`, yield `=n(r1−r0)P0`, SOL exposure `=nr1(P1−P0)`; these sum to total change. Liquidity discounts are separate. | [high] |
| V: vault | `V=shares×net_NAV_per_share + separate_receivables`; fees/debt/rewards embedded in NAV are not added again. Gross underlying is look-through information only. | [high] |
| O: options | Long `V=n×market_option_price×multiplier`; short liability mirrors it with signed exposure. Cash-equivalent expiry payoff per contract: call `m max(S−K,0)`, put `m max(K−S,0)`. Physical settlement requires actual token exchanges and contract-specific units. | [high] |
| PR: prediction | `V=n×outcome_mark×P_settlement`; verified binary resolution payout `n×payoff_per_share×P_settlement`, where payoff can be 0, 1 or a contract-defined void refund. Net realized PnL `= redemption/sale proceeds − basis − separate_costs`. | [high] |
| N: NFT | Realized PnL `= gross sale − seller fees/royalties − acquisition basis including buyer fees`. Asset-specific executable bid preferred; stale last sale/floor is explicitly a low-quality estimate, not ranking-grade equity. | [high] |
| R: rewards | At recognition, `income = enforceable claim quantity × defensible token price`; claiming moves receivable to token balance without second income. Later disposal uses recognized basis. Discretionary points have zero provisional economic value, separate from priced assets. | [high] |

Receipt and underlying, escrow and wallet balance, collateral and margin-equity total, position NFT and LP principal must never be counted twice. Use actual balances and state; quotes, APY, notional volume, health factors and risk-weighted available margin are not equity. Missing marks or debt layouts produce `incomplete_valuation`, not zero liabilities or fabricated profits. See BACKEND.md §5 Accounting engine. [high]

Net daily returns use flow-time segmentation: `r_i=E(end_i−)/E(start_i+)−1`, `TWR=Π(1+r_i)−1`. Preserve zero/negative-equity breaks and label estimates when historical marks are missing. See BACKEND.md §§5–6 for Sharpe, history/trade gates and coverage exclusions. Reward accrual, staking epochs, deposits and canceled orders do not become economic trades to satisfy eligibility. [high]

## 1. Spot DEX / Aggregators

### Jupiter Aggregator [med]

- **Named protocol:** Jupiter routed swaps; distinguish published CPI/v6 interface from newer API routing/execution products. [high]
- **Interaction types:** exact-input/output, split-route and multi-hop swaps; SOL wrapping/unwrapping within a route. [high]
- **How to identify/index:** published Jupiter CPI/v6 program `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` [high], from [CPI source](https://github.com/jup-ag/jupiter-cpi/blob/main/src/lib.rs). **Verify before building** the selected deployment and any newer routing program; one ID does not identify every Jupiter product. [high] `[TX][LOG]` decode route instructions and the published IDL's `SwapEvent` and `FeeEvent`; these can describe route legs, not necessarily one final user fill. Reconcile owned input/output accounts and aggregate one economic swap. The example's `JupiterSwapEvent` is not the event name in this published IDL. [high] [Jupiter CPI IDL](https://github.com/jup-ag/jupiter-cpi/blob/main/idl.json). `[API]` retain quote/route and program-label mapping separately; verify current `/swap/v1` versus `/swap/v2` build schemas. [med] [Swap build guide](https://developers.jup.ag/docs/guides/how-to-build-a-custom-swap-with-metis).
- **Value/profit/cost:** S+C. For exact-input, signed adverse quote slippage `=(quoted_out−actual_out)/quoted_out`; minimum output is a limit, not the quote benchmark. Embedded pool/platform fees are not subtracted twice; fee amounts sometimes need CPI/state reconstruction rather than logs alone. [high]
- **Connector actions:** `jupiter.swap(input_mint, output_mint, amount_atomic, swap_mode, slippage_bps)`; optional later `jupiter.quote`. Preparation only; do not use upstream signed execution endpoints through the backend. [high]
- **MVP priority:** **must-have** indexing and the sole MVP trade-preparation action; general route coverage still requires token valuation. [high]
- **Confidence:** [med] until API version, deployment, route normalization and fixtures are pinned.

### Jupiter Trigger / Recurring orders [med]

- **Named protocol:** Jupiter Trigger and Recurring products; legacy DCA accounts need their own version mapping. [high] [Jupiter developer platform](https://developers.jup.ag/).
- **Interaction types:** create/cancel limit or periodic orders; escrow funding, partial/periodic execution, residual withdrawal. [med]
- **How to identify/index:** program IDs **verify** separately from swap routing. `[TX][STATE]` discover order escrow PDAs and beneficiary; `[LOG]` verify deployed event names; `[API]` order status supplements keeper signatures. [med]
- **Value/profit/cost:** locked token amounts retain value under S; only fills realize disposals; each periodic leg has its own lot/fees. Cancellation/refund is internal; prepaid keeper fees are consumed or refundable according to verified terms. [high]
- **Connector actions:** `jupiter.create_trigger`, `jupiter.cancel_trigger`, `jupiter.dca`, `jupiter.cancel_dca`, `jupiter.withdraw_order_residual`. [med]
- **MVP priority:** **should-have** indexing for the backend's DCA reference strategy; MVP may run locally scheduled ordinary swaps; these preparation actions remain later. [high]
- **Confidence:** [med]; do not conflate DCA scheduling with aggregator execution.

### Raydium AMM v4 / CPMM / CLMM swaps [high]

- **Named protocol:** Raydium's distinct AMM v4, CP-Swap/CPMM and CLMM programs. [high]
- **Interaction types:** direct or routed exact-in/out swaps. [high]
- **How to identify/index:** AMM v4 `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`; CPMM `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`; CLMM `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` — each [high]. `[TX][STATE]` family-specific layouts/pools, CPI token transfers; `[LOG]` CLMM/CPMM `SwapEvent` requires IDL-version confirmation [med]. `[API]` pool discovery, not historical fill authority. [Raydium SDK address constants](https://github.com/raydium-io/raydium-sdk-V2/blob/master/src/common/programId.ts).
- **Value/profit/cost:** S+C; identify pool fee and net token transfer amounts, including Token-2022 withholding. Never multiply economic trade count by aggregator route legs. [high]
- **Connector actions:** `raydium.swap(pool_id, amount_atomic, swap_mode, slippage_bps)` with explicit program family. [high]
- **MVP priority:** **must-have** recognition when present in Jupiter routes; **should-have** standalone preparation/complete direct parsing. [high]
- **Confidence:** [high] identity/accounting; specific deployed event/schema [med].

### Orca Whirlpools swaps [high]

- **Named protocol:** Orca Whirlpools concentrated-liquidity AMM. [high]
- **Interaction types:** swap, two-hop swap; distinguish legacy Orca token-swap pools. [high]
- **How to identify/index:** `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` [high]. `[TX][STATE]` decode deployed swap variants, tick arrays and token transfers; `[LOG]` event names **verify** by version. `[API]` pool metadata only. [Orca source and deployment](https://github.com/orca-so/whirlpools).
- **Value/profit/cost:** S+C, actual execution deltas; price-limit sqrt value is not actual fill price. [high]
- **Connector actions:** `orca.swap`, `orca.two_hop_swap`. [high]
- **MVP priority:** **must-have** route recognition; **should-have** direct swap support. [high]
- **Confidence:** [high] identity/math; variants [med].

### Meteora DLMM / DAMM swaps [med]

- **Named protocol:** Meteora DLMM and Dynamic AMM versions, each separately registered. [high] [Meteora developer sources](https://github.com/MeteoraAg).
- **Interaction types:** bin-liquidity swaps, DAMM pool swaps, optional zap combining swap and LP deposit. [med]
- **How to identify/index:** IDs **verify**; `[TX][LOG][STATE]` pin each SDK/IDL and pool/bin layout; `Swap`/other emitted event names **verify**. Separate zap components but retain a parent interaction. [med]
- **Value/profit/cost:** S+C for swaps; zap has a spot conversion plus LP flow, not two portfolio profits. Dynamic fee parameters are read per execution, not hardcoded bps. [high]
- **Connector actions:** `meteora.swap_dlmm`, `meteora.swap_damm`, `meteora.zap`. [med]
- **MVP priority:** **must-have** routed economic recognition; **should-have** direct parsing. [high]
- **Confidence:** [med].

### Saber / Lifinity / GooseFX / Obric and other spot venues [low]

- **Named protocols:** Saber stable pools, Lifinity oracle-based AMM, GooseFX liquidity products, Obric; historical Orca legacy and SPL Token Swap instances. These are named coverage candidates, not current availability assertions. [med]
- **Interaction types:** direct/routed swaps, venue-specific liquidity and fee claims where supported. [low]
- **How to identify/index:** IDs **unknown [low]** here. `[API]` Jupiter venue labels are discovery hints; `[TX][STATE]` verify executable owner, pool mint mapping and public SDK/layout before accepting them. Event names **verify**. [low]
- **Value/profit/cost:** S+C for actual swaps; L/CL only after reserve/share semantics are proven. An oracle-based venue is not necessarily a constant-product pool. [high]
- **Connector actions:** `saber.swap`, `lifinity.swap`, `goosefx.swap`, `obric.swap`; legacy `spl_token_swap.swap`, disabled pending validation. [low]
- **MVP priority:** **should-have** recognition if observed in routes; **nice-to-have** direct execution and legacy LP coverage. [med]
- **Confidence:** [low]; sources/deployments must be acquired before implementation.

### DFlow and proprietary AMMs / RFQ routes [low]

- **Named protocols:** DFlow routing; HumidiFi, SolFi, Tessera and similar proprietary liquidity venues are discovery candidates with independent version/ownership checks. [med]
- **Interaction types:** routed swaps, RFQ fills, delegated order/escrow fills if the selected product implements them. [low]
- **How to identify/index:** IDs **unknown [low]**. `[TX][STATE]` authenticated program registry and settled token deltas; `[API]` signed quote/provider evidence if available. Do not infer a publicly accessible LP action from a swap venue label. [high]
- **Value/profit/cost:** S+C; quoted/rejected RFQs create no asset, but landed attempts can cost fees. Recoverable escrow remains valued. [high]
- **Connector actions:** `dflow.swap`, `rfq.request_quote`, `rfq.accept_quote`; no speculative LP actions for proprietary venues. [low]
- **MVP priority:** **should-have** route recognition when material; **nice-to-have** standalone preparation. [med]
- **Confidence:** [low]; downstream unknown CPI activity must remain visible.

## 2. Order Books

### Drift decentralized order book / JIT fills [med]

- **Named protocol:** Drift order placement and maker/taker matching, across spot/perp market types. [high]
- **Interaction types:** place, replace, cancel, partial fill, trigger order and JIT maker fill. [med]
- **How to identify/index:** current program ID **verify**. `[TX][LOG][STATE]` map authority/user/subaccount and historical `OrderActionRecord`, `OrderRecord`; check fill action, market type and maker/taker identity. `[API]` order-book data is supplemental. Historical fields include filled base/quote, taker/maker fees and filler reward. [high] [Historical SDK types](https://github.com/velocity-exchange/protocol-v2/blob/master/sdk/src/types.ts).
- **Value/profit/cost:** S for spot; P for perps; order creation/cancel earns no fill PnL. Maintain locked collateral, negative maker fees as rebates and trade episodes across partial fills. [high]
- **Connector actions:** `drift.place_order`, `drift.cancel_order`, `drift.replace_order`; leverage stays explicit. [med]
- **MVP priority:** **must-have** Drift activity/equity discovery; **should-have** reconciled per-fill attribution, gated as §6 below. [high]
- **Confidence:** [med] historical interface; current support gated.

### Phoenix spot order book [med]

- **Named protocol:** Phoenix v1, now described as Phoenix Legacy in upstream source; verify successors separately. [high]
- **Interaction types:** limit/IOC/post-only orders, cancel, deposit/withdraw market funds, partial fills. [med]
- **How to identify/index:** `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY` [high]. `[TX][LOG][STATE]` parse binary audit/fill events with the pinned parser; map trader seats and market-held balances. Upstream describes settlement without a separate crank. [high] [Phoenix source](https://github.com/Ellipsis-Labs/phoenix-v1).
- **Value/profit/cost:** S+C; locked base/quote stays owned; convert lot/tick sizes using market parameters. Open orders are commitments, not filled trades. [high]
- **Connector actions:** `phoenix.place_order`, `phoenix.cancel_order`, `phoenix.deposit`, `phoenix.withdraw`. [med]
- **MVP priority:** **should-have** indexing; **nice-to-have** preparation. [high]
- **Confidence:** [med] until current market availability/event schema verified.

### OpenBook v1 / v2 [med]

- **Named protocol:** OpenBook order books; v1 and v2 require different decoders. [high]
- **Interaction types:** order placement/cancel, consume events where required, fills, settle funds, deposits/withdrawals. [med]
- **How to identify/index:** v1 `srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX` [high], sourced from [Raydium constants](https://github.com/raydium-io/raydium-sdk-V2/blob/master/src/common/programId.ts); v2 **verify** against cluster configuration. `[TX][STATE][LOG]` parse open-orders ownership, balances and queue/event processing, distinguishing fill time from funds settlement. [med] [OpenBook v2](https://github.com/openbook-dex/openbook-v2).
- **Value/profit/cost:** S+C; value free/locked funds and unsettled fill receivables once. Event consumption and settlement do not realize the same sale twice. [high]
- **Connector actions:** `openbook.place_order`, `openbook.cancel_order`, `openbook.settle_funds`, `openbook.consume_events` with version. [med]
- **MVP priority:** **should-have** indexing, especially legacy Raydium reserve look-through; preparation later. [high]
- **Confidence:** [med].

### Serum v3 historical order book [med]

- **Named protocol:** Serum v3 historical exposure; not a new execution recommendation. [med]
- **Interaction types:** historical orders/fills, stranded open-orders funds, settlement/recovery if executable. [med]
- **How to identify/index:** `9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin` [high] from [Raydium constants](https://github.com/raydium-io/raydium-sdk-V2/blob/master/src/common/programId.ts). `[TX][STATE]` historical layouts and ownership; recovery instructions/current authority **verify**. [low]
- **Value/profit/cost:** S plus recoverable market claims; apply supported impairment evidence to stranded funds rather than assume withdrawal or $0. [high]
- **Connector actions:** `serum.inspect_claim`, `serum.settle_funds` recovery-only, disabled until verified. [low]
- **MVP priority:** **nice-to-have** historical coverage. [high]
- **Confidence:** [med] identity/history; recovery [low].

### Manifest order book [med]

- **Named protocol:** Manifest spot CLOB; source moved from CKS-Systems to Bonasa-Tech. [high] [Manifest source](https://github.com/Bonasa-Tech/manifest).
- **Interaction types:** place/cancel/batch-update orders, deposit/withdraw, fills; global liquidity balances where supported. [med]
- **How to identify/index:** program IDs **verify**, including wrapper and global-account variants. `[TX][LOG][STATE]` decode market/trader ownership and binary fill logs; event names **verify** from pinned release. [med]
- **Value/profit/cost:** S+C; separately track market and global balances without duplicating inventory used for orders. Read actual charged fees rather than assume a marketing fee schedule. [high]
- **Connector actions:** `manifest.place_order`, `manifest.cancel_order`, `manifest.batch_update`, `manifest.withdraw`. [med]
- **MVP priority:** **should-have** spot coverage; execution later. [med]
- **Confidence:** [med].

## 3. AMM / CLMM / DLMM LP

### Raydium fungible AMM / CPMM LP [med]

- **Named protocol:** Raydium AMM v4 and CPMM liquidity positions, using IDs in §1. [high]
- **Interaction types:** create pool, add/remove liquidity, LP transfer, deposit/withdraw LP in farms, fee accrual. [med]
- **How to identify/index:** `[TX][STATE]` LP mint/supply, reserve vaults, pending protocol fees and v4 order-book balances; `[LOG]` family-specific liquidity events **verify**. Farm IDs must be independently registered. [med] [Raydium AMM source](https://github.com/raydium-io/raydium-amm), [CP-Swap source](https://github.com/raydium-io/raydium-cp-swap).
- **Value/profit/cost:** L+A+C; use net effective reserves, not only raw vault amounts. Pool creation costs are expense except recoverable rent. Farm-wrapped LP remains one beneficial position. [high]
- **Connector actions:** `raydium.add_liquidity`, `raydium.remove_liquidity`, `raydium.create_pool`, `raydium.farm_deposit`, `raydium.farm_withdraw`, `raydium.claim_rewards`. [med]
- **MVP priority:** **should-have** LP coverage; pool creation **nice-to-have**. [high]
- **Confidence:** [med] until net reserve/farm math reconciles.

### Raydium CLMM LP [med]

- **Named protocol:** Raydium CLMM, ID in §1. [high]
- **Interaction types:** open/close position, increase/decrease liquidity, collect fees/rewards, migrate range, transfer ownership credential. [med]
- **How to identify/index:** `[TX][LOG][STATE]` position NFT/owner, position account, ticks, fee-growth checkpoints, reward debt; event names **verify** from deployed IDL. [med] [CLMM source](https://github.com/raydium-io/raydium-clmm).
- **Value/profit/cost:** CL+A+IL+C; uncollected fees are claims; collection changes representation. Burn/close credential only after underlying withdrawn; range rebalancing creates separate conversion costs. [high]
- **Connector actions:** `raydium.open_position`, `raydium.increase_liquidity`, `raydium.decrease_liquidity`, `raydium.collect_fees`, `raydium.close_position`. [med]
- **MVP priority:** **should-have**, after plain spot reconciliation. [high]
- **Confidence:** [med].

### Orca Whirlpools LP [med]

- **Named protocol:** Orca Whirlpools liquidity, ID in §1. [high]
- **Interaction types:** open/increase/decrease/close position, collect fees/rewards, position bundle ownership where deployed. [med]
- **How to identify/index:** `[TX][STATE]` position and optional bundle accounts, credential owner, tick arrays, fee/reward growth; `[LOG]` variant names **verify**. [med] [Orca developer math/client documentation](https://orca-so.github.io/whirlpools/).
- **Value/profit/cost:** CL+A+IL+C; distinguish reward token mint from principal. Bundle NFT carries the combined underlying rights once, not extra collectible floor value. [high]
- **Connector actions:** `orca.open_position`, `orca.increase_liquidity`, `orca.decrease_liquidity`, `orca.collect_fees`, `orca.collect_rewards`, `orca.close_position`. [med]
- **MVP priority:** **should-have** coverage. [high]
- **Confidence:** [med] for version-specific position/bundle decoding.

### Meteora DLMM / DAMM LP and fee locks [med]

- **Named protocol:** Meteora DLMM and DAMM v1/v2; do not reuse bin math for every product. [high]
- **Interaction types:** create pool, add/remove bin/range liquidity, rebalance, collect fees/rewards, lock liquidity or fee rights where supported. [med]
- **How to identify/index:** IDs **verify**. `[TX][LOG][STATE]` position ownership, bin arrays, per-bin shares, fee/reward checkpoints, pool effective reserves and locking beneficiaries. [med] [DLMM SDK](https://github.com/MeteoraAg/dlmm-sdk), [DAMM v2 SDK](https://github.com/MeteoraAg/damm-v2-sdk).
- **Value/profit/cost:** B for DLMM; deployed SDK-specific L/CL for DAMM. Liquidity lock is not necessarily a burn: retain only enforceable withdrawal/fee rights. Fee claims included once; IL requires original deposit baseline and flow matching. [high]
- **Connector actions:** `meteora.add_liquidity`, `meteora.remove_liquidity`, `meteora.rebalance`, `meteora.claim_fees`, `meteora.claim_rewards`, `meteora.lock_liquidity` with family. [med]
- **MVP priority:** **should-have** coverage; creation/locks later. [high]
- **Confidence:** [med].

### Kamino automated liquidity vaults [med]

- **Named protocol:** Kamino Liquidity vaults managing underlying CLMM strategies. [high] [Kamino public API](https://api.kamino.finance/).
- **Interaction types:** deposit/mint shares, redeem, request withdrawal if applicable, automated rebalance/compound, rewards. [med]
- **How to identify/index:** strategy/share program IDs **verify** separately from Kamino Lending. `[TX][STATE]` strategy account, receipt mint, underlying positions, idle tokens, pending fees/debt; `[API]` strategy mapping and historical NAV only if provenance retained. [med]
- **Value/profit/cost:** V, look-through CL only for explanation; no duplicate valuation of kToken plus vault assets. Rebalance fees and harvest income embedded in NAV are not separate agent cash gains. [high]
- **Connector actions:** `kamino.deposit_liquidity_vault`, `kamino.withdraw_liquidity_vault`, `kamino.claim_liquidity_rewards`. [med]
- **MVP priority:** **should-have** coverage; preparation later. [high]
- **Confidence:** [med].

### Marinade mSOL/SOL liquidity pool and Sanctum Infinity [med]

- **Named protocols:** Marinade's documented liquid-unstake liquidity pool; Sanctum Infinity multi-LST pool issuing INF. These are LP products; standalone mSOL is not an LP share. [high] [Marinade source](https://github.com/marinade-finance/liquid-staking-program), [Infinity technical design](https://learn.sanctum.so/docs/technical-documentation/infinity).
- **Interaction types:** add/remove pool liquidity; fee-bearing LST/SOL conversions; fee and underlying staking-yield accrual. [med]
- **How to identify/index:** Marinade liquid program ID in §8; Infinity/controller IDs **verify**. `[TX][STATE]` pool shares, reserves, LST rate calculators, external LST programs and pending claims. [med]
- **Value/profit/cost:** L with reserves priced using ST and defensible market marks; INF can accrue both underlying staking yield and swap fees. Neither gross SOL-equivalent reserves nor summed displayed APYs are additional assets. [high]
- **Connector actions:** `marinade.add_liquidity`, `marinade.remove_liquidity`, `sanctum.add_liquidity`, `sanctum.remove_liquidity`, `sanctum.swap_lst`. [med]
- **MVP priority:** **should-have** Infinity/LST coverage; legacy Marinade LP **nice-to-have**. [med]
- **Confidence:** [med], verify current pool operation.

## 4. Launchpads / Bonding Curves / Memecoin Sniping

### Pump.fun bonding curve [med]

- **Named protocol:** Pump bonding-curve token creation/trading. [high]
- **Interaction types:** create token, buy/sell before graduation, migrate liquidity, collect creator fees where entitled. [high]
- **How to identify/index:** `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` [high]. `[TX][STATE]` curve, real/virtual reserves, completion and migration; published docs identify migration to PumpSwap, not universally Raydium. `[LOG]` `TradeEvent`, `CreateEvent`, migration/creator-fee event names **verify** against the selected IDL. [med] [Pump program reference](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md).
- **Value/profit/cost:** S+C; for verified virtual constant-product curve, indicative marginal quote price `=virtual_quote/virtual_token`, decimal adjusted; it is not the liquidation value of all inventory. Prefer size-aware executable sell value, real reserve constraints and independent price checks; curve spot inflation alone cannot qualify rankings. [high]
- **Connector actions:** `pump.buy`, `pump.sell`, `pump.create_token`, `pump.claim_creator_fees`; disabled for MVP. [med]
- **MVP priority:** **should-have** observation for coverage; sniping/creation **nice-to-have**, outside backend's launch wedge. [high]
- **Confidence:** [med] because versioned fees and realizable valuation need validation.

### PumpSwap [med]

- **Named protocol:** Pump AMM/PumpSwap, distinct from the curve program. [high]
- **Interaction types:** post-graduation buy/sell, LP deposit/withdraw, creator fee claims. [high]
- **How to identify/index:** `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` [high]. `[TX][STATE][LOG]` decode pool/mint and user ownership. Published pool accounting includes effective LP supply and possible virtual quote reserves; distinguish trade quoting from redeemable physical reserves. [high] [PumpSwap reference](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_SWAP_README.md).
- **Value/profit/cost:** S for trades; protocol-correct L for owned redeemable LP, excluding synthetic reserves from NAV. Pool graduation does not award LP principal to every token holder; migration-owned burned LP rights are not their asset. [high]
- **Connector actions:** `pumpswap.swap`, `pumpswap.add_liquidity`, `pumpswap.remove_liquidity`, `pumpswap.claim_creator_fees`. [med]
- **MVP priority:** **should-have** routed/direct recognition; preparation later. [high]
- **Confidence:** [med] for current fee/variant coverage.

### Raydium LaunchLab; Fusion is farming [med]

- **Named protocol:** Raydium LaunchLab launch/curve product. “Fusion” labels farm programs in Raydium SDK constants, not a separate bonding-curve launchpad. [high]
- **Interaction types:** token launch, curve buy/sell, graduation to configured AMM, creator/platform fee claims and liquidity locks where configured. [med]
- **How to identify/index:** LaunchLab `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj` [high]. `[TX][LOG][STATE]` launch/config and graduation pool linkage; event names **verify**. Fusion farms require separate version registration, not this ID. [Raydium constants](https://github.com/raydium-io/raydium-sdk-V2/blob/master/src/common/programId.ts).
- **Value/profit/cost:** S+C; launch allocation/locked fee rights only if owned and enforceable. Migration is internal representation change; fundraising proceeds for an issuer are not automatically trader strategy profit. [high]
- **Connector actions:** `raydium.launchlab_buy`, `raydium.launchlab_sell`, `raydium.launch_token`, `raydium.claim_launch_fees`; farming actions in §3. [med]
- **MVP priority:** **should-have** observation; launch/preparation **nice-to-have**. [high]
- **Confidence:** [med].

### Meteora Dynamic Bonding Curve / Jupiter Studio / Moonshot / Believe [low]

- **Named protocols:** Meteora DBC, Jupiter Studio launch tooling; Moonshot and Believe are additional version-sensitive launch candidates, not interchangeable names for Pump. [med]
- **Interaction types:** launch allocation, curve buy/sell, graduation, creator/partner fee claims, vesting where supported. [med]
- **How to identify/index:** IDs **verify** for DBC/Studio and **unknown [low]** for Moonshot/Believe here. `[TX][STATE]` map creator/platform/config to curve and destination pool; `[API]` Studio pool/fee lookup supplements chain. Event names **verify**. [med] [Jupiter developer references](https://developers.jup.ag/llms.txt).
- **Value/profit/cost:** S+C; vesting claims follow §16; launch fees, failed snipes and tips matter. Curve equations/fee rights must come from each selected program; no common invented launch formula. [high]
- **Connector actions:** `meteora.dbc_buy`, `meteora.dbc_sell`, `jupiter.studio_launch`, `jupiter.studio_claim_fees`, `moonshot.buy`, `believe.buy`, all deployment-gated. [low]
- **MVP priority:** **nice-to-have** direct execution; **should-have** unknown-exposure detection. [med]
- **Confidence:** [low] across the combined candidates.

## 5. Lending & Borrowing & Leverage Loops

### Kamino Lending / Multiply [med]

- **Named protocol:** Kamino Lending and Multiply leveraged strategies. [high] [Kamino API](https://api.kamino.finance/).
- **Interaction types:** supply, collateralize, withdraw, borrow/repay, flash loan, loop/unloop, liquidation and reward claims. [med]
- **How to identify/index:** IDs **verify** for lending, farms and strategy variants. `[TX][STATE]` obligations, reserves, collateral exchange rates, cumulative borrow indices, oracle and liquidation parameters; `[LOG]` events **verify**. Decode flash-loan and swap legs as one strategy with balanced subentries. [med]
- **Value/profit/cost:** D+A+C; a Multiply LST loop values LST collateral with ST and subtracts SOL debt. Net carry `= accrued supply/staking yield + rewards − debt interest − execution/keeper costs`, plus collateral/debt price remeasurement and liquidation loss. Never compute it by simply subtracting displayed APYs. [high]
- **Connector actions:** `kamino.supply`, `kamino.withdraw`, `kamino.borrow`, `kamino.repay`, `kamino.multiply`, `kamino.unwind_multiply`, `kamino.flash_loan`, `kamino.liquidate`. [med]
- **MVP priority:** **should-have**, first lending extension; automated leverage preparation later. [high]
- **Confidence:** [med].

### Save / Solend [med]

- **Named protocol:** Save, formerly Solend; preserve historical labels and pool/version identity. [high]
- **Interaction types:** deposit/redeem, collateral deposit/withdraw, borrow/repay, flash borrow/repay, liquidate, reward claim. [med]
- **How to identify/index:** program ID **verify**. `[TX][STATE]` reserve, obligation, cToken rate, debt rate and refresh operations; stale account values need slot-aware accrual. `[LOG]` binary events **verify**, instruction parsing is primary where absent. [med] [Save building blocks](https://docs.save.finance/architecture/building-blocks).
- **Value/profit/cost:** D+C; cToken plus obligation collateral must count once. Liquidation bonus is income to liquidator, expense to borrower; underlying repayment is paired asset/debt movement. [high]
- **Connector actions:** `save.supply`, `save.withdraw`, `save.borrow`, `save.repay`, `save.flash_loan`, `save.liquidate`, `save.claim_rewards`. [med]
- **MVP priority:** **should-have** mature lending/history coverage. [high]
- **Confidence:** [med]; old docs do not certify today's reserve support.

### marginfi [med]

- **Named protocol:** marginfi/mrgnlend bank-based lending. [high]
- **Interaction types:** deposit/withdraw, borrow/repay, collateral risk changes, flash-loan-assisted loops, liquidation and emissions claims. [med]
- **How to identify/index:** ID **verify**. `[TX][STATE]` margin account authority, bank asset/liability share conversions, oracle/risk parameters and reward debt; `[LOG]` event names **verify**. [med] [marginfi looping guide](https://docs.marginfi.com/guides/looping-and-strategies).
- **Value/profit/cost:** D+C; net economic equity uses full asset/debt values, not weighted health. Include haircut/default loss if bank claims are impaired; rewards not in asset share value are separate R. [high]
- **Connector actions:** `marginfi.deposit`, `marginfi.withdraw`, `marginfi.borrow`, `marginfi.repay`, `marginfi.loop`, `marginfi.liquidate`, `marginfi.claim_emissions`. [med]
- **MVP priority:** **should-have** indexing; loops later. [high]
- **Confidence:** [med].

### Drift spot lending / insurance fund staking [med]

- **Named protocol:** Drift spot deposit/borrow balances and insurance fund shares. [high]
- **Interaction types:** deposit/withdraw with possible borrow creation, repay via deposit, accrued interest, stake/request-unstake/withdraw insurance shares, bankruptcy/socialized-loss events. [med]
- **How to identify/index:** ID **verify**; `[TX][LOG][STATE]` historical `DepositRecord`, `SpotInterestRecord`, `InsuranceFundStakeRecord`, `InsuranceFundRecord`, `LiquidationRecord`; pin account conversions and release. [high] [Historical event source](https://github.com/velocity-exchange/protocol-v2/blob/master/programs/drift/src/state/events.rs).
- **Value/profit/cost:** D for spot; V for insurance shares net of loss absorption. Insurance staking is not risk-free interest; claims may lose value or have withdrawal delays. Keep this inside total Drift equity reconciliation and do not add spot collateral a second time to perps. [high]
- **Connector actions:** `drift.deposit`, `drift.withdraw`, `drift.repay`, `drift.stake_insurance`, `drift.request_unstake_insurance`, `drift.withdraw_insurance`. [med]
- **MVP priority:** **must-have** underlying spot debt in Drift equity; insurance preparation **nice-to-have**. [high]
- **Confidence:** [med] current release gate applies.

### Lulo yield allocator [med]

- **Named protocol:** Lulo stablecoin allocation/protection products, not a new independent loan market for every routed balance. [high] [Lulo documentation](https://www.lulo.fi/docs).
- **Interaction types:** deposit, allocation/rebalance, withdrawal request/claim, protected/other product-specific rewards. [med]
- **How to identify/index:** IDs **verify**. `[TX][STATE]` user allocation/receipt, underlying lending accounts, queued withdrawals, protection reserves/terms; `[API]` allocation data is supplemental. [med]
- **Value/profit/cost:** V or owned underlying D, chosen once. Net carry includes allocation fees and realized protection payments; advertised protection is not a fully valued receivable until enforceable. [high]
- **Connector actions:** `lulo.deposit`, `lulo.request_withdraw`, `lulo.claim_withdrawal`, `lulo.withdraw`. [med]
- **MVP priority:** **should-have** after underlying lending adapters. [high]
- **Confidence:** [med] product-specific loss/claim semantics remain to verify.

### Jupiter Lend [med]

- **Named protocol:** Jupiter Lend Earn/Borrow interfaces; separate these from swaps and JLP. [high] [Jupiter Lend Earn SDK](https://github.com/jup-ag/jupiter-lend/blob/main/docs/earn/sdk.md).
- **Interaction types:** earn deposit/redeem, borrow collateral management and repay/liquidate where supported. [med]
- **How to identify/index:** IDs **verify** per product. `[TX][STATE]` lending receipt and exchange rate or borrowing position/debt indices; `[API]` SDK token registry supplements mint/program verification. Event names **verify**. [med]
- **Value/profit/cost:** V/D+C; exchange-rate growth is accrued return, not full principal redemption profit. Shared underlying liquidity must not produce duplicate claims. [high]
- **Connector actions:** `jupiter.lend_deposit`, `jupiter.lend_withdraw`, `jupiter.lend_borrow`, `jupiter.lend_repay`, `jupiter.lend_liquidate`. [med]
- **MVP priority:** **should-have**, after supported launch protocols. [high]
- **Confidence:** [med].

### Francium / Tulip / Larix / Jet and legacy leverage products [low]

- **Named protocols:** Francium documented lending/leveraged farming; Tulip/SolFarm, Larix and Jet are historical coverage candidates. Current mainnet operations and withdrawal support **verify**. [med] [Francium roles](https://docs.francium.io/product/roles).
- **Interaction types:** supply/borrow, leveraged LP farming, auto-compound, unwind/liquidation and legacy recovery where supported. [low]
- **How to identify/index:** IDs **unknown [low]** here. `[TX][STATE]` register each lending/farm/vault separately, resolve debt, LP share ownership and idle balances. Event names **verify**. [low]
- **Value/profit/cost:** D+L/V, netting debt once; returns include fee yield, rewards, IL, borrow interest and unwind costs. Legacy inaccessible balances remain impaired/unknown claims, not invisible assets. [high]
- **Connector actions:** `francium.open_farm`, `francium.close_farm`, `tulip.redeem_vault`, `larix.repay`, `jet.withdraw` only after validation. [low]
- **MVP priority:** **nice-to-have** historical/recovery coverage. [high]
- **Confidence:** [low].

Marinade is staking, not a lending market. An mSOL leverage loop is Marinade/LST exposure plus debt at the actual lending venue; index both under matched internal flows. NFT loans are covered in §12, PayFi credit in §9, and margin spot debt in §6. [high]

## 6. Perps / Derivatives

### Drift perpetuals [med]

- **Named protocol:** Drift perpetuals; historical protocol-v2 source now redirects to archived `velocity-exchange/protocol-v2`, as BACKEND.md §§1, 11 warn. That source's existence does not establish current market availability or successor compatibility. [high] [Upstream archive](https://github.com/drift-labs/protocol-v2).
- **Interaction types:** open/increase/reduce/close, limit/trigger fills, deposit/withdraw collateral, funding accrual/settlement, PnL settlement, liquidation, bankruptcy/socialized loss, AMM LP shares where supported. [med]
- **How to identify/index:** historical source declares `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH` [high] ([historical program source](https://github.com/velocity-exchange/protocol-v2/blob/master/programs/drift/src/lib.rs)); **verify before building** the current deployment, maintained release and live instruction availability. [high] `[TX][LOG][STATE]` authority → user/subaccount discovery, historical `OrderActionRecord`, `FundingPaymentRecord`, `FundingRateRecord`, `SettlePnlRecord`, `LiquidationRecord`; validate maintained SDK and precision constants. Logs plus account snapshots must reconcile, including unsettled funding/PnL and spot debt. [med] [Historical events](https://github.com/velocity-exchange/protocol-v2/blob/master/programs/drift/src/state/events.rs).
- **Value/profit/cost:** P+D+A+C; use unweighted economic equity. `SettlePnl` transfers already recognized claim to spot collateral, not new profit. Maker rebates have signed amounts; AMM LP exposure requires settled/unsettled base/quote/funding reconstruction, not spot L. Positive PnL constrained by settlement liquidity needs a disclosed recoverability policy. [high]
- **Connector actions:** `drift.open_perp(market_index, direction, base_amount_atomic, limit_price, max_leverage)`, `drift.close_perp`, `drift.adjust_collateral`, `drift.settle_pnl`, `drift.settle_funding`, `drift.add_perp_lp`, `drift.remove_perp_lp`. [med]
- **MVP priority:** **must-have** verified equity/activity; per-fill attribution only when reconciled. If fixtures fail, ship explicitly qualified equity-only coverage and disable unsupported fill metrics/preparation; see BACKEND.md §§4, 10. [high]
- **Confidence:** [med]; deployment/release gate can block this launch lane.

### Jupiter Perpetuals [med]

- **Named protocol:** Jupiter's pool-backed perpetuals, distinct from Drift and Jupiter swap routing. [high]
- **Interaction types:** position requests, keeper execution, increase/decrease, collateral adjustment, close, TP/SL, liquidation. [med]
- **How to identify/index:** ID **verify**. `[TX][STATE][LOG]` `Position`, `PositionRequest`, custody/pool accounts, owner and actual keeper-executed transitions; request is not a fill. Position fields document `sizeUsd`, entry `price`, `collateralUsd`, realized PnL, cumulative interest snapshot and locked payout amount. [high] [Position account reference](https://developers.jup.ag/docs/perps/position-account).
- **Value/profit/cost:** approximate linear exposure `q≈side×sizeUsd/entry_price`; final equity must use deployed payout/fee math, collateral conversion, borrow interest and maximum payout caps. Pool borrowing charges are not assumed to be Drift-style periodic funding. Preserve partial-close receipts because closed state can reset cumulative fields. [high]
- **Connector actions:** `jupiter.open_perp`, `jupiter.close_perp`, `jupiter.modify_perp_collateral`, `jupiter.create_perp_trigger`, `jupiter.cancel_perp_request`. [med]
- **MVP priority:** **should-have** second derivative adapter. [high]
- **Confidence:** [med].

### Flash Trade [med]

- **Named protocol:** Flash Trade pool-backed perpetuals. [high] [Flash overview](https://docs.flash.trade/flash-trade).
- **Interaction types:** open/close/increase/reduce, collateral changes, triggers, liquidation, liquidity token/reward products. [med]
- **How to identify/index:** deployed ID **verify**; reference source is not proof of the production address. `[TX][STATE][LOG]` pool/custody/position and actual execution; verify NFT/account-era differences and event names. [med] [Flash reference source](https://github.com/flash-trade/flash-perpetuals).
- **Value/profit/cost:** P with contract-specific borrow charges, collateral conversion and any capped payout. FLP is V, not trader equity. Sponsored fees accrue only to payer; platform-funded wallet capital is not creator-owned strategy capital without verified ownership/flow provenance. [high]
- **Connector actions:** `flash.open_perp`, `flash.close_perp`, `flash.adjust_collateral`, `flash.add_liquidity`, `flash.remove_liquidity`. [med]
- **MVP priority:** **should-have** observation; **nice-to-have** preparation. [med]
- **Confidence:** [med].

### Adrena [med]

- **Named protocol:** Adrena oracle-priced perpetuals and liquidity products. [med] [Adrena oracle documentation](https://docs.adrena.trade/technical-documentation/oracles-and-price-feeds).
- **Interaction types:** leveraged positions, collateral adjustment, liquidation, LP deposit/redeem, governance-token staking/rewards where deployed. [med]
- **How to identify/index:** ID **verify**. `[TX][STATE][LOG]` owner, position, pool/custody, net liquidity shares and staking claims; event names/fee calculations **verify**. [med]
- **Value/profit/cost:** P for trader, V for pool share; use actual oracle/fee/rate precision and subtract outstanding charges. Liquidity income includes net trader counterparty PnL, not fees alone. [high]
- **Connector actions:** `adrena.open_perp`, `adrena.close_perp`, `adrena.add_liquidity`, `adrena.remove_liquidity`, `adrena.claim_rewards`. [med]
- **MVP priority:** **nice-to-have** after Drift/Jupiter coverage. [med]
- **Confidence:** [med].

### Mango Markets v3 / v4 [low]

- **Named protocol:** Mango historical cross-margin spot, lending and perpetuals; current operating/recovery status **verify**. [med]
- **Interaction types:** margin deposits/withdrawals, spot/perp orders, borrow/repay, funding/PnL settlement, liquidation, historical claim recovery. [med]
- **How to identify/index:** program IDs **unknown [low]** here. `[TX][STATE][LOG]` versioned group/bank/account, open orders, funding and liabilities; authoritative release/IDL and live market checks required. [low]
- **Value/profit/cost:** D+P+S in one cross-margin equity, with explicit impairments/settlement claims. Risk-weighted account health is not NAV; inactive venue balances are not automatically cash-equivalent. [high]
- **Connector actions:** `mango.inspect_account`, `mango.settle_pnl`, `mango.withdraw`, recovery-gated; `mango.open_perp` disabled unless independently verified. [low]
- **MVP priority:** **nice-to-have** legacy/recovery indexing. [high]
- **Confidence:** [low].

### Zeta Markets historical; “Perps v2” and successor networks [low]

- **Named protocol:** Zeta Markets on Solana ceased operation in May 2025 per official docs. “Perps v2” is not a unique protocol identity; record publisher/program/version before indexing. Bullet or another successor must be separately verified for chain and deployment, not inferred as Solana L1 activity. [high] [Zeta shutdown notice](https://docs.zeta.markets/).
- **Interaction types:** historical fills/funding, forced expiry settlement, withdrawals, reward migration claims where enforceable. [med]
- **How to identify/index:** historical IDs **verify**; unspecified “Perps v2” ID **unknown [low]**. `[TX][STATE][LOG]` legacy margin account, market settlement and recovery entitlement; event names **verify**. [low]
- **Value/profit/cost:** P and enforceable remaining receivable; discontinued trading is not a normal mark-to-market liquid market. Migration entitlement requires new asset provenance. [high]
- **Connector actions:** `zeta.inspect_claim`, `zeta.withdraw_legacy`; no new `zeta.open_perp`. Unidentified derivative actions remain unsupported. [high]
- **MVP priority:** **nice-to-have** historical adapter. [high]
- **Confidence:** [low] recovery implementation; cessation [high].

## 7. Options

### PsyOptions / Psy American [med]

- **Named protocol:** PsyOptions American-style option contracts; current liquid mainnet market availability **verify**. [med]
- **Interaction types:** mint/write collateralized options, buy/sell option tokens, exercise, redeem writer claims and expiry collateral recovery. [med]
- **How to identify/index:** IDs **verify**. `[TX][STATE]` option market account, option/writer mints, underlying/quote vaults and contract quantity ratios; SDK documents `exerciseOptionsV2Instruction`. `[LOG]` event names **verify**. [high] [Psy American instruction reference](https://developers.psyoptions.io/modules/_mithraic_labs_psy_american.instructions.html).
- **Value/profit/cost:** O; physical exercise is actual quote/underlying exchange, not necessarily a cash payment. Writer token values residual collateral and short liability once. Premium receipts do not eliminate the obligation. Before expiry use executable option prices; model values require disclosed volatility/rate/source and are not automatically ranking-grade. [high]
- **Connector actions:** `psyoptions.mint_option`, `psyoptions.buy_option`, `psyoptions.exercise`, `psyoptions.redeem_writer`, `psyoptions.close_expired`. [med]
- **MVP priority:** **nice-to-have**. [high]
- **Confidence:** [med] contract family; live availability [low].

### Zeta options history / Friktion / Katana structured option vaults [low]

- **Named protocols:** historical Zeta option products and Friktion/Katana option-vault exposure; no active option venue is asserted from an old marketing page. [low]
- **Interaction types:** historical premium trades, collateral posting, exercise/assignment/expiry, covered-call or put-vault deposits, withdrawal queues/recovery. [low]
- **How to identify/index:** IDs **unknown [low]**; `[TX][STATE][API]` legacy vault round, option market/multiplier, auctions, withdrawal receipts, signed settlement evidence; event names **verify**. [low]
- **Value/profit/cost:** O for direct options; V for vault, net of short option liability and unpaid fees. Do not add premium auctions again when vault NAV already includes them. Unknown legacy collateral recovery impairs coverage. [high]
- **Connector actions:** `friktion.inspect_claim`, `friktion.redeem_legacy`, `katana.inspect_claim`, `katana.redeem_legacy`, `zeta.inspect_option_claim`, all recovery-gated. [low]
- **MVP priority:** **nice-to-have**, historical only pending evidence. [high]
- **Confidence:** [low].

A protocol announcing future options, or providing capped perps, does not establish a deployed options adapter. Before adding any new venue require a real mainnet market, contract payoff/multiplier, exercise rules, settlement authority, collateral ownership and price source. [high]

## 8. Liquid Staking / Restaking / Native Staking

### Marinade Liquid (mSOL) [med]

- **Named protocol:** Marinade Liquid staking; mSOL is a staking receipt. [high]
- **Interaction types:** SOL deposit, existing stake-account deposit, delayed unstake order, ticket claim; instant conversion paths must be distinguished from secondary-market swaps. [high]
- **How to identify/index:** `MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD` [high]. `[TX][STATE][LOG]` deployed deposit/`deposit_stake_account`/`order_unstake`/`claim` layouts, state exchange-rate components, ticket beneficiary and maturity. Event names **verify**; do not rely on guessed text logs. [high] [Marinade liquid program source](https://github.com/marinade-finance/liquid-staking-program/blob/main/programs/marinade-finance/src/lib.rs).
- **Value/profit/cost:** ST+A+C. mSOL burned for delayed unstake becomes a SOL receivable immediately; value does not vanish until claim. Track net fees and ticket terms; claim converts already recognized receivable. Market mSOL bought on Jupiter belongs to staking exposure with Jupiter as execution venue. [high]
- **Connector actions:** `marinade.stake`, `marinade.deposit_stake_account`, `marinade.order_unstake`, `marinade.claim_unstake`, `marinade.instant_unstake` only when selected path verified. [med]
- **MVP priority:** **must-have** indexing, state rate and delayed claim valuation; preparation post-MVP. [high]
- **Confidence:** [med] pending deployed layout/claim fixture validation.

### JitoSOL [med]

- **Named protocol:** Jito liquid stake pool; staking and MEV distributions reflected in pool value. [high]
- **Interaction types:** deposit SOL/stake, redeem to SOL/stake account where supported, secondary-market JitoSOL trades, rate growth. [med]
- **How to identify/index:** stake-pool program `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy` [high]. This shared program does not alone identify Jito: validate Jito's specific pool state and receipt mint. `[TX][STATE][RPC]` pool token supply, total redeemable lamports, epoch updates and fee configuration. [high] [Jito deployed programs](https://www.jito.network/docs/jitosol/jitosol-liquid-staking/security/deployed-programs/).
- **Value/profit/cost:** ST; source rate from net pool accounting, not advertised APY. MEV already increasing exchange rate is not an additional wallet reward. Withdrawal/conversion fees and liquidity discount matter. [high]
- **Connector actions:** `jito.stake`, `jito.withdraw_sol`, `jito.withdraw_stake`, `jito.get_redemption_rate`. [med]
- **MVP priority:** **should-have**, inexpensive next receipt family after validated stake-pool conversion. [high]
- **Confidence:** [med] pool-specific snapshots/rounding still to verify.

### Solana native staking / Marinade Native [med]

- **Named protocols:** Solana native stake accounts; Marinade Native adds delegation management, not mSOL issuance. [high]
- **Interaction types:** create/delegate, deactivate, withdraw, split/merge, redelegate where supported, authority changes, rewards, penalties if applicable. [med]
- **How to identify/index:** stake program ID **verify** against current core-program registry; management-program IDs **verify** separately. `[RPC][TX][STATE]` authorized withdrawer/staker, delegation epochs, lamport balance and `getInflationReward` or block reward evidence. Pool-internal validator moves do not imply an agent capital flow. [high] [Solana program references](https://solana.com/docs/core/programs).
- **Value/profit/cost:** owned recoverable lamports including rent/rewards × P_SOL. Net credited rewards are income; do not subtract validator commission again if already net. Deactivation changes liquidity, not ownership. Losing withdrawal rights requires boundary/impairment analysis. [high]
- **Connector actions:** `solana.delegate_stake`, `solana.deactivate_stake`, `solana.withdraw_stake`, `solana.split_stake`, `solana.merge_stake`, `marinade.native_stake`, `marinade.native_unstake`. [med]
- **MVP priority:** **must-have** discovery/coverage detection; **should-have** complete reward indexing; preparation later. [high]
- **Confidence:** [med] managed delegation details; native accounting [high].

### Sanctum LST ecosystem / BlazeStake / JupSOL / validator LSTs [med]

- **Named protocols:** Sanctum-supported LSTs, BlazeStake bSOL, Jupiter JupSOL, and validator-specific receipt pools. Each mint/pool is a separate identity; INF belongs in §3. [med]
- **Interaction types:** deposit/redeem, stake-account conversion, instant LST swaps, exchange-rate rewards, any separate incentives. [med]
- **How to identify/index:** pool/controller IDs **verify**; `[TX][STATE][API]` mint → pool → actual stake/withdraw authority and rate calculator; shared SPL stake-pool owner alone is insufficient. [med] [Sanctum Infinity's external-rate design](https://learn.sanctum.so/docs/technical-documentation/infinity).
- **Value/profit/cost:** ST+C; liquidity route may involve S. Token trading price and redeemable SOL rate are separate observations. An Orca LST pool is AMM LP exposure plus LST yield, not a new staking issuer. [high]
- **Connector actions:** `sanctum.stake`, `sanctum.redeem`, `sanctum.swap_lst`, `blazestake.stake`, `jupiter.stake_sol`, `stake_pool.deposit`, `stake_pool.withdraw` with explicit pool. [med]
- **MVP priority:** **should-have** generalized receipt coverage. [high]
- **Confidence:** [med].

### Lido on Solana (stSOL), sunset [med]

- **Named protocol:** Lido Solana legacy stSOL; deposits were discontinued under its sunset plan, with a subsequent withdrawal interface documented in January 2025. [high] [Lido sunset](https://blog.lido.fi/sunset-lido-on-solana/), [withdrawal update](https://blog.lido.fi/simplifying-stsol-withdrawals/).
- **Interaction types:** historical stake/rewards, outstanding stSOL, redeem/withdraw or recovery where still supported. [med]
- **How to identify/index:** program ID **verify**; `[TX][STATE]` legacy stake pool/reserves, stSOL supply and actual withdrawal claim. Today's interface and withdrawal limits **verify**. [low]
- **Value/profit/cost:** ST only with proven recoverability and current state; otherwise explicit illiquid/impaired claim with market discount. Do not use old APY or treat every stSOL as immediately redeemable SOL. [high]
- **Connector actions:** `lido.inspect_stsol`, `lido.withdraw_stsol`; no new staking action. [high]
- **MVP priority:** **nice-to-have** historical support. [high]
- **Confidence:** [med] sunset; live recovery [low].

### Jito (Re)staking / Solayer / Fragmetric / Kyros [low]

- **Named protocols:** Jito restaking vaults/NCNs; Solayer, Fragmetric and Kyros are separate restaking/liquid-restaking candidates. Their receipts and current slashing rules must be verified independently. [med] [Jito restaking architecture](https://www.jito.network/docs/restaking/core-concepts/overview/), [Kyros Jito integration](https://docs.kyros.fi/restake/jito-restaking).
- **Interaction types:** deposit collateral, mint vault receipt, opt into networks, cooldown/request withdrawal, claim rewards, redeem, slash/loss allocation where enabled. [med]
- **How to identify/index:** IDs **verify** for Jito vault/restaking programs; others **unknown [low]** here. `[TX][STATE][LOG]` vault/receipt/NCN ties, withdrawal tickets, liability and slash parameters, beneficiary changes; event names **verify**. [low]
- **Value/profit/cost:** V/ST net of enforceable penalties and debt; restaked LST underlying yield belongs inside receipt NAV once. Unpriced network points are R at zero provisional value. Do not assume every advertised slashing design is active. [high]
- **Connector actions:** `jito.restake`, `jito.request_restake_withdraw`, `jito.claim_restake_withdraw`, `solayer.restake`, `fragmetric.deposit`, `kyros.redeem`, disabled until release validation. [low]
- **MVP priority:** **nice-to-have**, material unknown exposure must exclude fully covered ranking. [high]
- **Confidence:** [low] across combined products.

## 9. Yield Vaults / Structured Products

### Kamino Earn / curated lending vaults [med]

- **Named protocol:** Kamino lending allocation/Earn vaults, separate from liquidity vaults and borrower obligations. [med] [Kamino product/API reference](https://api.kamino.finance/).
- **Interaction types:** deposit/redeem shares, queued withdrawal, allocation rebalance, fee/reward accrual. [med]
- **How to identify/index:** vault/share program IDs **verify**. `[TX][STATE][API]` vault owner, share exchange rate, underlying reserves, liquid cash, management/performance liabilities, withdrawal claims. [med]
- **Value/profit/cost:** V with underlying D; value shares once. Withdrawable liquidity and economic NAV differ, so disclose queue/liquidity haircut policy. [high]
- **Connector actions:** `kamino.deposit_earn_vault`, `kamino.request_earn_withdrawal`, `kamino.claim_earn_withdrawal`. [med]
- **MVP priority:** **should-have** after lending math. [high]
- **Confidence:** [med].

### Jupiter JLP / Flash FLP / Adrena liquidity shares [med]

- **Named protocols:** pool-backed derivative liquidity products: JLP, FLP and Adrena's LP product. [med]
- **Interaction types:** buy/sell share on DEX, mint/redeem with underlying, liquidity fees, pool rebalancing, counterparty PnL. [med]
- **How to identify/index:** IDs **verify** at each issuer; `[TX][STATE]` share mint, effective supply, custody asset valuation, accrued fees, trader liabilities and caps; `[API]` NAV/protocol oracle observations retained. [med] [Jupiter Position pool linkage](https://developers.jup.ag/docs/perps/position-account), [Flash pool model](https://docs.flash.trade/flash-trade).
- **Value/profit/cost:** V: `NAV=(valued reserves + receivables − trader obligations − pool liabilities)/effective_shares`. Positive trader PnL can reduce LP NAV; negative trader PnL can increase it. Net fees and asset exposure are separate explanatory components, not all of the return. [high]
- **Connector actions:** `jupiter.mint_jlp`, `jupiter.redeem_jlp`, `flash.mint_flp`, `flash.redeem_flp`, `adrena.add_liquidity`, `adrena.remove_liquidity`; DEX purchases use the actual swap venue action. [med]
- **MVP priority:** **should-have** receipt valuation; preparation later. [high]
- **Confidence:** [med].

### Drift strategy vaults / managed optimizer vaults [low]

- **Named protocols:** Drift-compatible strategy vaults; Tulip/Francium optimizer exposure already cataloged in §5. “Optimizer” is a strategy description, not a verified protocol ID. [med]
- **Interaction types:** deposit, mint investor shares, withdrawal request/claim, manager performance fees, profit share/high-water-mark settlement. [med]
- **How to identify/index:** vault IDs **verify** separately from Drift. `[TX][STATE]` vault depositor/share ownership, delegate/manager, Drift user, fee/high-water-mark and withdrawal state. Event names **verify**. [low]
- **Value/profit/cost:** V using net underlying economic Drift equity and enforceable redemption claim; subtract owed manager fees once. Gross manager-reported return is not investor PnL. Track deposits during fees/share rebase precisely. [high]
- **Connector actions:** `drift_vault.deposit`, `drift_vault.request_withdraw`, `drift_vault.claim_withdraw`, `vault.inspect_nav`. [low]
- **MVP priority:** **nice-to-have**, no Tradgents pooled vault is introduced. [high]
- **Confidence:** [low] deployment and fee implementation.

### Exponent / RateX yield and principal trading [med]

- **Named protocols:** Exponent yield exchange and RateX yield tokenization/trading; contract terminology and maturity differ by release. [med] [Exponent](https://www.exponent.finance/), [RateX introduction](https://docs.rate-x.io/ratex).
- **Interaction types:** split/recombine yield-bearing asset, trade principal/yield claims, fixed-yield hold, yield LP, leveraged yield position, maturity redemption. [med]
- **How to identify/index:** IDs **verify**; `[TX][STATE][LOG]` series/maturity, principal/yield or standardized-token mints, accrual indices, collateral/debt and redeemed claims. Rates and event names **verify** from selected SDK. [med]
- **Value/profit/cost:** `E=principal_claim_mark + yield_claim_mark + accrued_receivables − debt − fees`. At maturity value contractual principal redemption; remaining yield rights expire as specified. Do not price both unsplit underlying and its split claims. Implied APY changes are price exposure, not earned cash yield. [high]
- **Connector actions:** `exponent.split_yield`, `exponent.swap_principal`, `exponent.swap_yield`, `exponent.redeem`, `ratex.open_yield_position`, `ratex.close_yield_position`, `ratex.redeem_maturity`. [med]
- **MVP priority:** **nice-to-have** specialized valuation. [high]
- **Confidence:** [med].

### Huma PayFi credit pools [med]

- **Named protocol:** Huma Solana retail/institutional PayFi pools, with PST/mPST distinctions. [high]
- **Interaction types:** deposit/mint pool receipt, lock/unlock, redemption request/claim, yield/reward accrual and default impairment. [med]
- **How to identify/index:** Huma `HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn`; Huma Institutional `EVQ4s1b6N1vmWFDv8PRNc77kufBP8HcrSNWXQAhRsJq9` — each [high]. `[TX][STATE][API]` product/receipt mint, pool NAV and queued claims; verify terms and whether a particular receipt accrues economic yield versus incentives. [Huma deployments](https://docs.huma.finance/ecosystem-resources/smart-contracts).
- **Value/profit/cost:** V net of credit/default losses and fees. Use enforceable NAV and recoverability; do not value discretionary Feathers/points or marketing APY as cash. Institutional receivables need off-chain provenance preserved. [high]
- **Connector actions:** `huma.deposit`, `huma.request_redeem`, `huma.claim_redeem`, `huma.claim_rewards` with product ID. [med]
- **MVP priority:** **nice-to-have**, until credit valuation/eligibility support exists. [high]
- **Confidence:** [med].

### Maple / other credit, tranches and synthetic-yield receipts [low]

- **Named protocols:** Maple-related Solana integrations and credit products are discovery candidates; distinguish wrapped/imported claims from native origination. A generic “structured product” label is insufficient. [low]
- **Interaction types:** receipt purchase, permissioned subscription/redeem, tranche allocation, credit loss, maturity settlement, cross-chain imported yield claim. [low]
- **How to identify/index:** IDs **unknown [low]**; `[TX][STATE][API]` issuer, chain of entitlement, net NAV, tranche waterfall, default/write-down and redemption gates. Do not equate EVM deployment with Solana mainnet support. [high]
- **Value/profit/cost:** V net of documented loss waterfall and liabilities. Stable-denominated receipt yield still carries credit, liquidity and FX/depeg exposure. Unsupported off-chain claims keep coverage incomplete. [high]
- **Connector actions:** `credit.subscribe`, `credit.request_redeem`, `credit.claim_redeem`, vendor-qualified only after support validation. [low]
- **MVP priority:** **nice-to-have**. [high]
- **Confidence:** [low].

## 10. Stablecoins & RWA / Tokenized Stocks

### Circle USDC / Tether USDT [med]

- **Named protocols:** issuer-backed stablecoins, traded through venue adapters rather than an imaginary stablecoin AMM. [high]
- **Interaction types:** hold/transfer, spot conversion, issuer-authorized mint/redeem, freeze/burn events affecting recoverability, USDC CCTP in §16. [med]
- **How to identify/index:** ordinary transfers use verified SPL token programs; issuer mint/redeem IDs **verify**. USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` is a **mint, not a program ID** [high]; USDT mint **verify**. `[TX][STATE]` mint/authority and balance changes; `[API]` issuer registry and available market/oracle price. [Circle mint registry](https://developers.circle.com/stablecoins/usdc-contract-addresses).
- **Value/profit/cost:** S, using actual USD market price, never unconditional $1. Issuer redemption at par is usable only if the agent can exercise it; receipt of minted tokens must be paired with surrendered funding or enforceable claim. [high]
- **Connector actions:** `token.transfer`, `jupiter.swap`; `circle.redeem_usdc`/`tether.redeem_usdt` are conditional off-chain/permissioned workflows, disabled for ordinary agents. [med]
- **MVP priority:** **must-have** USDC marks/holdings; **should-have** USDT support. [high]
- **Confidence:** [med] overall issuer action availability; USDC mint [high].

### Paxos PYUSD / USDG / PAXG [med]

- **Named protocols:** Paxos-issued PYUSD/USDG and gold-backed PAXG; issuer documents Solana expansion. [high] [PYUSD](https://www.paxos.com/pyusd), [PAXG Solana announcement](https://www.paxos.com/blog/bringing-paxg-to-solana).
- **Interaction types:** transfer/trade, eligible issuer mint/redeem, Token-2022 extensions, freezing/pausing and asset-price exposure. [med]
- **How to identify/index:** issuance-program IDs/mints **verify** independently. `[TX][STATE]` token owner/extensions, transfer-fee/confidential-transfer visibility where applicable; `[API]` issuer registry/reserve/asset backing and gold price. [med]
- **Value/profit/cost:** S; USD tokens retain depeg risk; PAXG follows gold unit entitlement and market/liquidity discount. Token-2022 fees reduce actual net received amount; confidential balances unavailable to indexer imply unsupported valuation. [high]
- **Connector actions:** `token.transfer`, venue-qualified `*.swap`, `paxos.request_redemption` only for eligible issuer accounts. [med]
- **MVP priority:** **should-have** PYUSD/USDG marks; **nice-to-have** issuer/gold integration. [med]
- **Confidence:** [med].

### Sky USDS / yield-bearing stable receipts / bridged stablecoins [low]

- **Named protocols:** Sky USDS; sUSDS or other yield receipts only when the particular Solana representation and entitlement are verified. Bridged DAI/USDC/USDT and other wrappers retain their bridge identity. USDS itself is not automatically yield-bearing. [high] [Sky USDS explanation](https://sky.money/blog/what-is-usds).
- **Interaction types:** hold/swap, native-token transfer/bridge, savings receipt subscription/redeem where supported, emissions claims. [med]
- **How to identify/index:** IDs/mints **verify**; `[TX][STATE][API]` canonical issuer and bridge path, token extensions, exchange rate and redemption rights. A matching symbol is insufficient. Do not infer Solana savings-contract support from an EVM savings page. [high]
- **Value/profit/cost:** S for plain stablecoin; V for validated yield receipt; separate bridge/issuer impairment and rewards R. Zero provisional value for discretionary emissions points. [high]
- **Connector actions:** `token.transfer`, `bridge.transfer`, `sky.deposit_savings`, `sky.redeem_savings` only after Solana support proven. [low]
- **MVP priority:** **should-have** recognized stable marks; savings/preparation **nice-to-have**. [med]
- **Confidence:** [low] representation/contract support.

### Terra UST / USTC, algorithmic and failed stablecoins [low]

- **Named protocol:** Terra UST/USTC historical bridged exposure; other algorithmic stablecoins are identified by actual mint/issuer, not symbol. [med]
- **Interaction types:** legacy holding/trading, bridge/recovery claim, depeg/impairment, conversion if enforceable. [low]
- **How to identify/index:** IDs/mints **unknown [low]** here; `[TX][STATE][API]` wrapper provenance and redemption support, independent executable price and liquidity. [low]
- **Value/profit/cost:** S at defensible market/recovery value; never $1 because the symbol says stablecoin. A depeg is portfolio loss, not an external withdrawal; inability to price is incomplete coverage, not proof of worthlessness. [high]
- **Connector actions:** `jupiter.swap` if routable/allowed; `legacy_stable.inspect_claim` otherwise; no invented Terra-native Solana minting action. [high]
- **MVP priority:** **must-have** depeg-safe valuation policy; **nice-to-have** legacy adapter. [high]
- **Confidence:** [low] particular wrapper support.

### Ondo USDY / OUSG and tokenized fund candidates [med]

- **Named protocols:** Ondo USDY is documented on Solana; verify each OUSG/fund share deployment and eligibility separately. Other treasury/MMF issuers must have their own registry. [high] [USDY bridge expansion](https://ondo.finance/blog/expanding-institutional-grade-rwa-bridging-to-solana-with-ondo-bridge).
- **Interaction types:** buy/sell, eligible subscription/redemption, rebasing or rate growth depending on representation, bridge, redemption queues. [med]
- **How to identify/index:** IDs/mints **verify**; `[TX][STATE][API]` issuer registry, NAV/redemption observation, compliance hooks, unit convention, beneficiary and pending claims. Retain timestamp/hash of issuer NAV; chain alone cannot recreate it. [high]
- **Value/profit/cost:** `V=units×issuer_net_redemption_NAV`, alongside executable market mark; income from unit/rate change, price discount and underlying currency exposure. Use NAV only with evidence of enforceable recovery; fees and lockups affect realizable value. [high]
- **Connector actions:** `ondo.subscribe`, `ondo.request_redeem`, `ondo.claim_redeem`, `jupiter.swap`, subject to product eligibility. [med]
- **MVP priority:** **nice-to-have** issuer integration; **should-have** unsupported-RWA detection. [high]
- **Confidence:** [med] USDY existence; per-product support [low].

### xStocks / Ondo Global Markets tokenized equities [med]

- **Named protocols:** xStocks backed equity/ETF tokens; Ondo Global Markets also publishes Solana program security material, but verify actual instruments individually. [high] [xStocks introduction](https://docs.xstocks.fi/docs), [Ondo Solana assessment](https://docs.ondo.finance/pdf/GM-Solana-Zellic-12-29-2025.pdf).
- **Interaction types:** secondary-market spot trading, issuer/eligible broker subscription/redeem, corporate actions, distributions or reinvestment per terms, transfer restrictions. [med]
- **How to identify/index:** program IDs/mints **verify**; `[TX][STATE][API]` issuer instrument identifier/ISIN mapping, decimals, share conversion, corporate-action history, transfer hooks and redemption access. Ticker-name matches are insufficient. [high]
- **Value/profit/cost:** `V=token_qty×shares_per_token×equity_reference_price×FX`, reconciled with executable token price/redemption discount. Adjust lots/units for splits; dividend reinvestment/rate growth and cash distributions count once. Underlying stock rights and market hours do not automatically match token-holder rights. [high]
- **Connector actions:** venue `*.swap`, `xstocks.request_redeem`, `ondo.trade_equity` only with eligible provider workflow; no claimed generic on-chain broker API. [med]
- **MVP priority:** **nice-to-have**, due corporate-action/issuer data and stale overnight reference prices. [high]
- **Confidence:** [med] product family; exact terms/mints [low].

## 11. Prediction Markets

### Drift BET [med]

- **Named protocol:** Drift BET, historically launched prediction markets using Drift's cross-margin system. Current event availability remains subject to the Drift release gate. [high] [Drift 2024 product recap](https://www.drift.trade/updates/drift-in-2024-a-year-in-review).
- **Interaction types:** buy/sell or take signed event-contract exposure, collateral changes, resolution/settlement, redeem profits, liquidation if leveraged. [med]
- **How to identify/index:** current ID **verify**; `[TX][STATE][LOG]` verified event market/type, payout/expiry and resolution authority. Historical Drift order events alone do not distinguish a normal perp from an event contract without market metadata. Do not assume outcome positions are SPL tokens. [high]
- **Value/profit/cost:** PR for token-like shares or protocol-specific bounded derivative PnL for signed positions; use actual contract payout and leverage/debt. Collateral lending interest is D, not winning-bet income. [high]
- **Connector actions:** `drift.bet_buy`, `drift.bet_sell`, `drift.bet_settle`, with explicit event and payoff schema. [med]
- **MVP priority:** **nice-to-have** prediction; **must-have** detection if material within launch Drift equity. [high]
- **Confidence:** [med] historical product; active markets [low].

### Jupiter Prediction / DFlow tokenized event markets [med]

- **Named protocols:** Jupiter's developer platform lists Prediction; DFlow provides on-chain prediction-trade metadata. Verify underlying issuance and settlement venue rather than assuming front ends own all contracts. [high] [Jupiter API product listing](https://developers.jup.ag/), [DFlow on-chain trade API](https://dflow.mintlify.app/build/metadata-api/trades/onchain-trades).
- **Interaction types:** purchase/sale of outcome exposure, quote/order fulfillment, settlement redemption, void/refund and claims where supported. [med]
- **How to identify/index:** IDs **verify**; `[API]` authenticated mapping event → outcomes → mints → settlement denomination; `[TX][STATE][LOG]` final ownership/escrow and redemption. Prove who resolves the event, challenge window, redeemability and whether a claim depends on an external venue. [med]
- **Value/profit/cost:** PR, with actual fee/payout precision and explicit unresolved/disputed state. Mark by executable outcome-token bid; probability × $1 is valid only under that exact payout convention. Issuer/settlement impairment can dominate a resolved winning outcome. [high]
- **Connector actions:** `jupiter.prediction_buy`, `jupiter.prediction_sell`, `jupiter.prediction_redeem`, `dflow.prediction_buy`, `dflow.prediction_redeem`, provider/deployment-gated. [med]
- **MVP priority:** **should-have** discovery extension; preparation **nice-to-have**. [med]
- **Confidence:** [med] API product existence; market/settlement support [low].

### MetaDAO futarchy / conditional markets [med]

- **Named protocol:** MetaDAO conditional governance markets; economic trades differ from free votes. [med] [MetaDAO source documentation](https://github.com/metaDAOproject/meta-dao-docs).
- **Interaction types:** split underlying into pass/fail claims, trade conditional assets, provide liquidity, proposal resolution and merge/redeem. [med]
- **How to identify/index:** IDs **verify**, including conditional vault and AMM programs. `[TX][STATE][LOG]` proposal, outcome mint pair, backing vault, settlement winner and account owner; event names **verify**. [med]
- **Value/profit/cost:** conditional claims/LP valued once; complete-set splitting is internal, not twice the collateral. Upon resolution losing branch follows actual redemption rule; winning branch converts to underlying. Use PR/L with verified cancellation rules and proposal-specific prices. [high]
- **Connector actions:** `metadao.split_conditional`, `metadao.swap_conditional`, `metadao.add_liquidity`, `metadao.redeem_conditional`. [med]
- **MVP priority:** **nice-to-have**. [high]
- **Confidence:** [med].

Unverified permissionless event markets use the same PR taxonomy after source verification. Orca, Bonfida/Serum or a generic token symbol is not evidence of a prediction protocol. Off-chain-only prediction bets cannot be reconstructed from unrelated Solana deposits. [high]

## 12. NFT Trading

### Magic Eden Solana marketplace [med]

- **Named protocol:** Magic Eden's Solana NFT trading interfaces/program generations; front-end brand alone is not an execution program. [high]
- **Interaction types:** buy/sell, list/delist, bids/auctions, escrow deposits/refunds, primary mints, royalties and creator proceeds. [med]
- **How to identify/index:** marketplace IDs **verify** for each deployed generation. `[TX][STATE][LOG]` sale instruction, asset ownership and consideration, fee/royalty recipients, bid escrow beneficiary. `[API]` asset/order data supplements chain; canceled orders are not sales. [med] [Magic Eden Solana API overview](https://docs.magiceden.io/reference/solana-overview).
- **Value/profit/cost:** N+A+C; bid escrow retains cash value until filled/refunded. Treat primary mint as acquisition at actual paid cost, not speculative floor profit. Royalties received by an entitled creator are R/income, separate from resale return. [high]
- **Connector actions:** `magiceden.buy`, `magiceden.list`, `magiceden.cancel_listing`, `magiceden.bid`, `magiceden.cancel_bid`, `magiceden.claim_auction`. [med]
- **MVP priority:** **nice-to-have**, due asset-specific marks and multiple standards. [high]
- **Confidence:** [med] API/product; deployment [low] until pinned.

### Tensor order books / NFT AMMs / compressed NFT trades [med]

- **Named protocol:** Tensor marketplace/AMM programs and compressed NFT support. [high] [Tensor developer hub](https://dev.tensor.trade/docs/getting-started-1), [compressed trading SDK](https://github.com/tensor-foundation/tcomp-sdk).
- **Interaction types:** bid/list/fill/cancel, market-maker inventory pools, deposit/withdraw inventory and cash, fee accrual, compressed NFT sales. [med]
- **How to identify/index:** IDs **verify** per program. `[TX][LOG][STATE][API]` actual NFT/cNFT ID, bid escrow, pool owner/inventory, paid consideration; DAS/proofs where compressed. Event names **verify**. [med]
- **Value/profit/cost:** N for individually held assets; pool `V=cash + defensible_inventory_marks + separate_fee_claims − liabilities`. AMM inventory includes NFTs, not fungible constant-product reserves; collection floor is a proxy with coverage limitations. [high]
- **Connector actions:** `tensor.buy`, `tensor.sell`, `tensor.bid`, `tensor.cancel_bid`, `tensor.create_pool`, `tensor.deposit_pool`, `tensor.withdraw_pool`. [med]
- **MVP priority:** **nice-to-have** complete accounting; historical executed sales easier than ranking-quality inventory marks. [high]
- **Confidence:** [med].

### OKX NFT / other marketplace routes [low]

- **Named protocol:** OKX Solana NFT marketplace/routing, documented historical Solana marketplace code/audits; current contract/API support **verify**. [med] [OKX marketplace audit](https://web3.okx.com/cdn/assets/plugins/announcements/contentful/tofttmniq0qv/4dTUC2Liq2kya6E6JD3flD/16b56a43359dd2a27b468a1ae34c3661/CertiK-OKX_Marketplace_of_Solana.pdf).
- **Interaction types:** NFT buy/sell, bid escrow/refund, aggregated purchase via downstream marketplace. [med]
- **How to identify/index:** IDs **unknown [low]** here. `[TX][STATE][API]` identify actual seller/buyer and downstream execution program, not just router/API branding; verify royalty and fill layouts. [low]
- **Value/profit/cost:** N+C; one routed purchase is one economic acquisition, with actual paid fees from deltas. [high]
- **Connector actions:** `okx_nft.buy`, `okx_nft.sell`, `okx_nft.cancel_order`, disabled pending current support. [low]
- **MVP priority:** **nice-to-have**. [high]
- **Confidence:** [low].

### Metaplex Token Metadata / Core / Bubblegum / Candy Machine [med]

- **Named protocols:** Metaplex NFT asset standards and minting programs; these are not themselves all marketplaces. [high]
- **Interaction types:** mint, transfer, burn, delegate, freeze/lock, royalty/plugin changes; primary sale and compressed proof update. [med]
- **How to identify/index:** IDs **verify** separately by standard/version. `[TX][STATE][API]` classic mint/token ownership, programmable authorization rules, Core asset ownership/plugins, or Bubblegum tree leaf plus proof/DAS ownership. Compressed assets do not necessarily appear as ordinary wallet SPL token balances. [high] [Core SDK](https://developers.metaplex.com/smart-contracts/core/sdk), [Bubblegum v2 SDK](https://developers.metaplex.com/smart-contracts/bubblegum-v2/sdk/javascript).
- **Value/profit/cost:** N; mint/transfer fees C; burn is loss only if the surrendered asset has no replacement redemption/claim. Position/receipt NFTs use underlying rights instead of collectible floor. Rule changes can impair transferability without immediate token movement. [high]
- **Connector actions:** `metaplex.mint_nft`, `metaplex.transfer_asset`, `metaplex.burn_asset`, `metaplex.delegate_asset`, standard-qualified and gated. [med]
- **MVP priority:** **must-have** detection of position credentials needed by any supported adapter; general NFT trading **nice-to-have**. [high]
- **Confidence:** [med].

### Sharky / Rain.fi / Banx NFT-backed lending [low]

- **Named protocols:** Sharky, Rain.fi and Banx NFT-credit candidates; current deployments and active products **verify** independently. [med]
- **Interaction types:** lend/borrow, accept loan, collateral escrow, repay/refinance, foreclose/default, liquidate collateral. [low]
- **How to identify/index:** IDs **unknown [low]** here. `[TX][STATE][API]` loan borrower/lender, escrow NFT ownership rights, due date, accrued interest, default rules and claim token; events **verify**. [low]
- **Value/profit/cost:** borrower `E=collateral_value + cash − debt − interest`; lender `E=recoverable_loan_claim + cash`. Foreclosure replaces loan receivable with NFT at supported value and recognizes impairment; do not value both full loan and pledged NFT for the lender before default. [high]
- **Connector actions:** `sharky.lend`, `sharky.borrow`, `sharky.repay`, `sharky.foreclose`, `rainfi.refinance`, `banx.repay`, all disabled until validated. [low]
- **MVP priority:** **nice-to-have**, high collateral valuation risk. [high]
- **Confidence:** [low].

## 13. Arbitrage / MEV / Liquidations / Keeper Bots

### Cross-DEX / triangular / spot-perp arbitrage [high]

- **Named protocols:** compositional strategy across Jupiter, Raydium, Orca, Meteora, order books, lending and derivative venues already cataloged; arbitrage is not one extra program. [high]
- **Interaction types:** multi-leg atomic cycle, inventory rebalance, cross-transaction hedge, flash-loan cycle and basis/carry trade. [high]
- **How to identify/index:** constituent verified IDs; `[TX][LOG][STATE]` reconstruct leg graph, mint/market/owner links, borrowed/repaid principal and parent strategy ID. `[API]` agent decision evidence may link legs; timing similarity alone is not proof of one strategy. [med]
- **Value/profit/cost:** closed same-currency cycle `profit=final_base−initial_base−costs_not_in_deltas`; mixed residual inventory uses A/S/P at aligned prices. Include flash fees, borrowing/funding, all landed chain fees/tips and failed attempts. Reconcile strategy PnL to constituent ledger, never add it as extra protocol income. [high]
- **Connector actions:** `arbitrage.prepare_cycle`, `arbitrage.prepare_hedge`, returning explicit constituent instructions, debt repayment constraints and limits. [med]
- **MVP priority:** **must-have** avoid double counting route legs; **nice-to-have** strategy attribution/preparation. [high]
- **Confidence:** [high] accounting; automated attribution [med].

### Jito Block Engine tips / bundles [med]

- **Named protocol:** Jito transaction/bundle submission infrastructure, not a swap program or custodian. [high]
- **Interaction types:** locally signed bundle submission, separate SOL tips, bundle status/landing, failed or expired attempts. [high]
- **How to identify/index:** no universal “bundle program ID.” `[TX][RPC]` actual transfers to tip accounts obtained from `getTipAccounts`; `[API]` `sendBundle`/`getBundleStatuses` are external runner evidence, not final chain proof. A bundle ID proves receipt only, not landing, and bundle membership may be unavailable from chain alone. [high] [Jito send documentation](https://docs.jito.wtf/lowlatencytxnsend/).
- **Value/profit/cost:** C for each actual landed fee/tip paid by portfolio. Do not expense a rejected quote/bundle with no chain debit; individually landed transactions from retries still count. Shared tips require documented allocation across legs, never subtraction once per fill. [high]
- **Connector actions:** `jito.get_tip_accounts`, `jito.prepare_bundle`, `jito.get_bundle_status`; local creator runner may call upstream `sendBundle` after signing, outside backend preparation. [high]
- **MVP priority:** **must-have** tip accounting when observed; bundle preparation **nice-to-have**. [high]
- **Confidence:** [med] inferred historical membership; API semantics [high].

### Lending / perp liquidators [med]

- **Named protocols:** Kamino, Save, marginfi, Drift, Jupiter Perps and any verified loan/derivative venue. [high]
- **Interaction types:** repay another account's debt for discounted collateral, close/take over positions, claim liquidator/insurance rewards, borrower penalty/default. [med]
- **How to identify/index:** constituent IDs **verify**; `[TX][LOG][STATE]` borrower and liquidator identities, actual seized/repaid amounts, haircut, residual debt and beneficiary. Drift historical `LiquidationRecord` exists; other event names **verify**. [med]
- **Value/profit/cost:** liquidator immediate `PnL=seized_collateral_mark−debt_paid_mark+verified_reward−C_separate`, followed by inventory remeasurement/disposal. Borrower records debt extinguishment, lost collateral, fee/penalty and bankruptcy effects, not external funding. Position takeover adds exposure and liabilities; not all seized notional is profit. [high]
- **Connector actions:** `kamino.liquidate`, `save.liquidate`, `marginfi.liquidate`, `drift.liquidate`, `jupiter.liquidate_perp`, each market/health gated. [med]
- **MVP priority:** **must-have** liquidation loss within supported positions; active liquidator preparation **nice-to-have**. [high]
- **Confidence:** [med] exact bonus/fee rules are release-specific.

### Keeper / crank / oracle-update compensation [med]

- **Named protocols:** Drift fillers, OpenBook event consumers, recurring/trigger keepers, Pyth/Switchboard update paths and protocol reward programs when verified. [med]
- **Interaction types:** fill/settle/update/expire/rebalance on another user's behalf, receive reward, pay update/transaction costs, maintain funded bot escrows. [med]
- **How to identify/index:** venue/oracle IDs **verify**; `[TX][LOG][STATE]` filler/keeper reward recipient, protocol funding source, repeated state-only accrual. Historical Drift records include `fillerReward`; generic oracle update does not imply compensation. [high] [Drift types](https://github.com/velocity-exchange/protocol-v2/blob/master/sdk/src/types.ts), [Switchboard implementation](https://github.com/switchboard-xyz/on-demand).
- **Value/profit/cost:** `income=actual_earned_reward_mark`; `net_profit=income−chain/tip/update/other_expenses`. User positions affected by keeper action are separate from keeper equity. Off-chain hosting costs belong in disclosed operational-cost analytics only if evidenced, not fabricated chain fees. [high]
- **Connector actions:** `keeper.prepare_fill`, `keeper.prepare_settlement`, `openbook.consume_events`, `oracle.prepare_update`, `keeper.claim_rewards`. [med]
- **MVP priority:** **must-have** account discovery for passive user fills; bot preparation **nice-to-have**. [high]
- **Confidence:** [med].

### Sandwich / adverse execution / wash-trade detection [low]

- **Named protocols:** behavioral detection across actual venues; no fabricated “sandwich program.” [high]
- **Interaction types:** victim adverse execution, candidate before/after round trip, backrun, self-trade/circular volume and incentive extraction. [med]
- **How to identify/index:** `[TX][STATE]` ordered block transactions, shared pool/mints, counterparties, inventory and authority links; `[API]` contemporaneous quotes/archive state for counterfactual execution. Ordering and price impact alone cannot prove intent or common control. Label detection probabilistic and preserve evidence; see BACKEND.md §8. [high]
- **Value/profit/cost:** agent's actual S/A net return remains authoritative. Estimated victim loss `=counterfactual_net_receive−actual_net_receive`, valued at a common price; uncertainty depends on executable historical liquidity. Do not subtract estimated sandwich loss again from already observed execution shortfall. [high]
- **Connector actions:** read-only `mev.inspect_transaction`, `mev.estimate_execution_shortfall`, `abuse.inspect_trade_ring`; no enabled sandwich-execution action. [high]
- **MVP priority:** **should-have** simple evidence flags; causal simulation **nice-to-have**. [med]
- **Confidence:** [low] attribution/counterfactual; actual costs [high].

## 14. Airdrops / Points Farming

### Protocol rewards / claim distributors / emissions [med]

- **Named protocols:** Jupiter/Jito/Drift/Kamino/Marinade reward programs and verified on-chain token distributors; each campaign is separately registered. A historical airdrop does not imply a current entitlement. [med]
- **Interaction types:** accrue vested/claimable tokens, submit claim proof, claim, vest, sell, expire claim, staking/liquidity/trading incentives. [med]
- **How to identify/index:** distributor IDs **verify**; `[TX][STATE][LOG]` reward mint, funded distributor, beneficiary/vesting terms, proof/root and claim status; `[API]` campaign eligibility retained with provenance. Token receipt alone does not establish reward rather than funding. [high]
- **Value/profit/cost:** R+C; recognize only enforceable and defensibly priced rights, not hypothetical allocations. Already recognized claim redemption is internal; expiry/invalidity writes down the receivable. Rebates reducing trading fees and separately paid rewards cannot both be credited for the same payment. [high]
- **Connector actions:** `rewards.check_eligibility`, `rewards.prepare_claim`, `rewards.claim_vested`, plus `jupiter.claim_airdrop`, `jito.claim_airdrop`, `drift.claim_rewards`, `kamino.claim_rewards`, `marinade.claim_rewards` only for verified campaigns. [med]
- **MVP priority:** **must-have** classification for supported-token inflows; arbitrary distributor execution **nice-to-have**. [high]
- **Confidence:** [med] campaign support varies.

### Points / loyalty / speculative farming [high]

- **Named programs:** protocol loyalty campaigns, Marinade/Drift/Kamino-related campaigns when actually documented, Sanctum loyalty and Huma Feathers; active campaigns **verify**. [med]
- **Interaction types:** supply/stake/trade to earn points, referral credits, task completion, potential later token conversion. [med]
- **How to identify/index:** no generic points program ID. `[API]` point counts/campaign terms; `[TX][STATE]` underlying economic action and later actual reward claim. Off-chain points cannot be reconstructed exactly from token transfers alone. [high]
- **Value/profit/cost:** points carry **zero provisional economic value**, separately counted; underlying assets/debt, fees, dilution and price losses still count. After enforceable token conversion apply R; do not retroactively assign today's token value to old speculative points. [high]
- **Connector actions:** read `points.get_balance`, `points.get_campaign`; economically funded preparation remains actual venue `*.deposit`/`*.stake`/`*.swap`, with no invented universal points purchase action. [high]
- **MVP priority:** **must-have** exclusion of speculative points from equity; points dashboards **nice-to-have**. [high]
- **Confidence:** [high] accounting policy; campaign existence/current rules [med].

### Solana Mobile device ownership / auth-gated distributions [low]

- **Named ecosystem:** Solana Mobile device/ownership-linked campaigns; mobile wallet authorization itself is identity/access, not a yield protocol. [med]
- **Interaction types:** prove device/token eligibility, claim verified distribution, vest/sell received asset, pay eligibility-related on-chain costs. [med]
- **How to identify/index:** campaign IDs **unknown [low]** until sourced; `[API]` eligibility/device attestation and privacy-preserving proof; `[TX][STATE]` actual distribution and beneficiary. A connection/auth signature alone produces no on-chain profit. [high]
- **Value/profit/cost:** R for enforceable award; unsolicited dust/donations are external flow or quarantined unknown. Device purchase is an off-chain operational/capital expense only if included under a disclosed broader business boundary. [high]
- **Connector actions:** `solana_mobile.check_eligibility`, `solana_mobile.prepare_claim`, campaign-gated; `wallet.authorize` is outside performance events. [low]
- **MVP priority:** **nice-to-have**. [high]
- **Confidence:** [low] particular distribution availability.

## 15. Governance

### SPL Governance / Realms / voter-stake registries [med]

- **Named protocol:** SPL Governance and Realms interfaces, with realm-specific voter-weight plugins. [high]
- **Interaction types:** token deposit/withdraw/lock, delegation, proposal creation, vote/relinquish, execute proposal, claim rewards where enforceable. [high]
- **How to identify/index:** governance/plugin IDs **verify**, multiple deployments exist. `[TX][STATE]` Realm, TokenOwnerRecord, VoteRecord, Proposal and execution CPIs; distinguish delegate voting power from ownership of deposited funds. Plugin-specific locks require independent layout. [high] [SPL Governance account/interaction reference](https://docs.realms.today/developer-resources/spl-governance).
- **Value/profit/cost:** locked tokens remain owned under S/V; voting itself creates C, not profit. Rewards follow R, slashing/forfeiture follows actual terms. Proposal execution may move portfolio assets or upgrade ownership rules; classify executed economic effects, not simply the vote. [high]
- **Connector actions:** `governance.deposit`, `governance.withdraw`, `governance.vote`, `governance.relinquish_vote`, `governance.execute_proposal`, `governance.claim_rewards`, realm/plugin explicit. [med]
- **MVP priority:** **should-have** locked-asset discovery; preparation **nice-to-have**. [high]
- **Confidence:** [med] deployment/plugin variety.

### Marinade DAO / Jito / Jupiter and protocol-specific governance locks [low]

- **Named protocols:** Marinade DAO voting, Jito/Jupiter governance and any verified protocol-specific token lock/reward programs; mechanism/current campaign **verify** individually. [med]
- **Interaction types:** lock/stake governance token, vote/delegate, cooldown/withdraw, claim distributions, fee rights and optional penalties. [med]
- **How to identify/index:** IDs **verify** for current voting/lock/distributor contracts; `[TX][STATE][API]` beneficiary, lock expiry, reward entitlement, delegated authority and fee claims. Token ownership alone does not prove every governance payout. [high]
- **Value/profit/cost:** S/V on recoverable tokens plus R for separate enforceable rewards; fee rights already inside receipt NAV count once. Governance announcements do not create accounting income; proposal-driven token remeasurement follows price evidence. [high]
- **Connector actions:** `marinade.vote`, `jito.vote`, `jupiter.vote`, `governance.lock`, `governance.unlock`, `governance.claim_distribution`, deployment-gated. [low]
- **MVP priority:** **nice-to-have** execution; **should-have** locked-asset observation if present. [med]
- **Confidence:** [low] current mechanism/terms.

### Squads multisig / DAO treasury execution [med]

- **Named protocol:** Squads multisig, with explicitly selected version and owned vault; not proof that each signer owns the entire treasury. [high] [Squads SDK reference](https://typedoc.squads.so/).
- **Interaction types:** create/propose/approve/execute transactions, treasury payouts, policy/authority changes and spending limits where supported. [med]
- **How to identify/index:** ID **verify** by version; `[TX][STATE]` vault, members, proposal approvals, execution CPIs and economic beneficiary. Portfolio attribution requires evidence of beneficial ownership, not only signing membership; BACKEND.md §2 requires a distinct program-wallet proof adapter. [high]
- **Value/profit/cost:** downstream A/S/D/P/etc. plus C. Approval creates no fill; executed treasury distribution is external flow or expense under explicit boundary. Creation/recoverable rent follows C, no duplicate treasury capital per signer. [high]
- **Connector actions:** `squads.propose_transaction`, `squads.approve_transaction`, `squads.execute_transaction`, `squads.inspect_vault`. [med]
- **MVP priority:** **nice-to-have** program-wallet registration; detection prevents unsupported ownership assumptions. [high]
- **Confidence:** [med].

## 16. Payments / Other

### SOL / SPL Token / Token-2022 transfers and account lifecycle [high]

- **Named primitives:** Solana System Program, SPL Token and Token-2022; mint/extension identity is required. [high]
- **Interaction types:** send/receive, wrap/unwrap SOL, create/close accounts, mint/burn, approve/revoke delegate, withheld fee harvest, freeze/thaw, rebase/interest-display or transfer-hook effects where implemented. [med]
- **How to identify/index:** IDs **verify** from current official deployment references. `[TX][STATE][RPC]` actual atomic balances, account owner/beneficiary, rent recovery, mint authority and Token-2022 extensions; `[LOG]` supplementary only. Interest-bearing display amounts are not assumed spendable extra base units. [high] [SPL Token documentation](https://www.solana-program.com/docs/token), [Token-2022 documentation](https://www.solana-program.com/docs/token-2022).
- **Value/profit/cost:** A/S/C; own-account movement/wrapping is internal. Donated capital is F; verified service revenue is income; expense purchase reduces equity; owner distribution is F out. Burn can be consumption/loss or receipt redemption; classify replacement claim before writing off. Permission changes may cause impairment without transfers. [high]
- **Connector actions:** `solana.transfer_sol`, `token.transfer`, `solana.wrap_sol`, `solana.unwrap_sol`, `token.close_account`, `token.approve_delegate`, `token.revoke_delegate`, `token.burn`, with explicit local intent checks. [high]
- **MVP priority:** **must-have** indexing and exact costs; additional preparation later. [high]
- **Confidence:** [high] economic contract; extension variants [med].

### Solana Pay / Actions / Blinks / service micropayments [med]

- **Named interfaces:** Solana Pay transfer/transaction requests; Actions/Blinks and paid agent APIs are transaction initiation surfaces, not universal value programs. [high]
- **Interaction types:** merchant payment, refund, paid on-chain/service action, subscription or usage debit, sponsored transaction. [med]
- **How to identify/index:** no unique Solana Pay program ID; `[TX][STATE]` actual transfer or returned transaction's programs, payer, recipient and optional reference; `[API]` merchant invoice/refund provenance. Validate decoded transaction rather than URL branding. [high] [Solana Pay specification](https://docs.solanapay.com/spec).
- **Value/profit/cost:** payment for consumed services is expense; funding another owned account is internal; creator distribution is external withdrawal. Revenue requires evidence of earned service, not arbitrary transfer memo. Sponsored fees are not charged to agent; refund reverses linked expense/revenue where appropriate. [high]
- **Connector actions:** `payments.prepare`, `payments.refund`, `solana_pay.prepare_request`, `actions.inspect_request`; explicit merchant/reference and purpose. [med]
- **MVP priority:** **must-have** correct transfer/expense classification; commerce preparation **nice-to-have**. [high]
- **Confidence:** [med] purpose often needs off-chain evidence.

### Streamflow / Jupiter Lock / token vesting and streams [med]

- **Named protocols:** Streamflow token streams/vesting and Jupiter Lock; each independently versioned. [high] [Streamflow products](https://docs.streamflow.finance/en/articles/9339023-welcome-to-streamflow), [Jupiter reference index](https://developers.jup.ag/llms.txt).
- **Interaction types:** create/fund/top-up stream or lock, vest, claim, transfer entitlement, cancel with refund, cliff/linear unlock. [med]
- **How to identify/index:** IDs **verify**. `[TX][STATE]` sender/recipient, cancelability, amount, schedule, vested/claimed totals, refund rights; `[API]` schedule metadata supplemental. Event names **verify**. [med]
- **Value/profit/cost:** irrevocable owned vested/unvested claims need liquidity/recoverability policy; revocable promised future awards are not automatically earned income. Claim moves existing receivable; vesting can create new R recognition according to policy. Payer principal that remains recoverable is asset/claim, not all expense on funding. [high]
- **Connector actions:** `streamflow.create_stream`, `streamflow.claim`, `streamflow.cancel_stream`, `streamflow.transfer_contract`, `jupiter.lock_tokens`, `jupiter.claim_locked_tokens`. [med]
- **MVP priority:** **should-have** locked/vesting exposure detection; preparation **nice-to-have**. [high]
- **Confidence:** [med].

### Circle CCTP / Wormhole token bridges and NTT [med]

- **Named protocols:** Circle CCTP burn/mint transport; Wormhole token bridge and Native Token Transfers, with distinct contracts/attestations. [high] [Circle Solana contracts](https://github.com/circlefin/solana-cctp-contracts), [Wormhole documentation](https://wormhole.com/docs/).
- **Interaction types:** lock/burn, in-flight claim, attest/redeem/mint, unwrap, retry/refund, destination transfer. [med]
- **How to identify/index:** IDs **verify** per cluster/product/version. `[TX][STATE]` source message/hash/nonce, sender/destination/beneficiary, attestation and redemption status; `[API]` attestation/destination-chain evidence retained. Wrapped mint identity is bridge-specific. [med]
- **Value/profit/cost:** bridge-owned claim replaces source asset until destination asset is proved; deduct actual bridge/relayer fees once. For a Solana-only boundary, verified exit to owned but excluded destination is explicit external flow; for multi-chain coverage it is internal. Unknown destination ownership/recovery means unsupported coverage, not invented profit/withdrawal. Never count source claim and received tokens simultaneously. [high]
- **Connector actions:** `circle.cctp_prepare_burn`, `circle.cctp_prepare_receive`, `wormhole.bridge`, `wormhole.redeem`, `wormhole.ntt_transfer`, destination/recovery explicit. [med]
- **MVP priority:** **must-have** unsupported bridge detection; full cross-chain accounting/preparation **nice-to-have**. [high]
- **Confidence:** [med] specific deployed version and destination coverage.

### deBridge / Mayan cross-chain swaps and intents [med]

- **Named protocols:** deBridge/DLN and Mayan cross-chain intent/swap products, not ordinary single-chain token transfers. [med] [deBridge developer docs](https://docs.debridge.finance/), [Mayan developer docs](https://docs.mayan.finance/).
- **Interaction types:** create order/fund escrow, solver fulfillment, partial/expired order, refund/unlock, destination swap and fees. [med]
- **How to identify/index:** IDs **verify** per product. `[TX][STATE][API]` order ID, escrow beneficiary, destination fulfillment and refund state; map source and destination exactly once. Quote APIs supplement, never prove settlement. [med]
- **Value/profit/cost:** escrow/in-flight claim under A; realized conversion under S only when settlement supported. Fees, residual refunds, exchange exposure and solver rebates are explicit; an unfilled escrow is not a trade or zero-valued asset. [high]
- **Connector actions:** `debridge.prepare_order`, `debridge.claim_refund`, `mayan.prepare_swap`, `mayan.claim_refund`. [med]
- **MVP priority:** **nice-to-have** full adapter; exposure detection required at launch. [high]
- **Confidence:** [med].

### Solana Name Service / Bonfida / domain auctions [low]

- **Named protocol:** Solana Name Service ecosystem, historically associated with Bonfida; domains are not evidence of a prediction venue. [med]
- **Interaction types:** registration/renewal where applicable, domain purchase/sale/auction, transfer, escrow bids, rental/subdomain fee rights where implemented. [low]
- **How to identify/index:** IDs **verify**; `[TX][STATE][API]` registry/domain owner, auction/escrow and executable sale evidence. Domain name text or wallet reverse lookup does not establish value. [low]
- **Value/profit/cost:** asset-specific N-like lots and fee costs; an unsold domain has no ranking-grade mark without defensible executable demand. Service fees from subdomains count only when enforceably earned. [high]
- **Connector actions:** `sns.register_domain`, `sns.buy_domain`, `sns.sell_domain`, `sns.transfer_domain`, support-gated. [low]
- **MVP priority:** **nice-to-have**. [high]
- **Confidence:** [low] current price and deployed auction layouts.

### Helium / Render / Hivemapper / DePIN / game economies [low]

- **Named ecosystems:** Helium, Render and Hivemapper reward/payment economies; Star Atlas and other on-chain games are additional asset/consumption candidates. Solana token presence alone does not prove all work/game state is on-chain. [med]
- **Interaction types:** stake/bond, claim work rewards, pay/burn credits, purchase/sell game assets, rent resources, receive verified task/bounty prizes. [low]
- **How to identify/index:** IDs **unknown [low]** here; `[TX][STATE][API]` reward/distributor, work receipt, consumption/mint/burn and beneficiary. Off-chain proof-of-work/task validation and operational costs need separate evidence. [high]
- **Value/profit/cost:** R for earned tokens; credits consumed are expense, inventories use S/N, bonds retain enforceable principal. Net business profit can subtract evidenced hardware/hosting costs under a separate business policy; token return leaderboard does not silently estimate them. [high]
- **Connector actions:** `helium.claim_rewards`, `render.claim_rewards`, `hivemapper.claim_rewards`, `game.purchase_asset`, `game.consume_asset`, vendor/version gated. [low]
- **MVP priority:** **nice-to-have**, except generic transfers/rewards already covered. [high]
- **Confidence:** [low] current native program and entitlement support.

### Wagering / randomness games / on-chain bounties [low]

- **Named interaction family:** deployment-specific wagering and RNG-consuming games, including verified Switchboard-randomness consumers; no particular casino program is asserted here. [med]
- **Interaction types:** wager/escrow, random-outcome settlement, win/loss/refund, jackpot/reward claim, game-house liquidity shares and paid bounty settlement where implemented. [low]
- **How to identify/index:** consumer/game program ID **unknown [low]**; oracle ID **verify** separately. `[TX][STATE][LOG][API]` wager amount, beneficiary, committed result, enforceable payoff, unresolved escrow and withdrawal rules. Oracle randomness use alone does not prove a fair game or a payout right. [high]
- **Value/profit/cost:** settled net result `= payout − wager − separate_costs`; unresolved claim uses validated contractual valuation, otherwise incomplete coverage. House shares use V net of player obligations and fees; jackpots are income only when enforceable. Bounty income requires evidence of earned work rather than treating every receipt as profit. [high]
- **Connector actions:** `wager.prepare`, `wager.claim`, `wager.refund`, `bounty.claim`, all consumer/version gated; never exposed by default from a generic oracle adapter. [low]
- **MVP priority:** **nice-to-have** full adapter; unexplained wagering escrow/loss remains detected unsupported activity. [high]
- **Confidence:** [low].

### Insurance / cover / security losses / recoveries [low]

- **Named interactions:** verified on-chain cover contracts, escrow disputes, hacks, rug pulls, pool insolvency, freeze/confiscation, bad debt, slashing and recovery distributions. No insurance protocol/deployment is asserted without evidence. [high]
- **Interaction types:** premium payment, enforceable cover issuance, approved claim, payout, exploit outflow, haircut/default, seizure, restitution. [med]
- **How to identify/index:** program ID **unknown [low]** until contract/case identified. `[TX][STATE][API]` ownership/boundary, premium terms, incident signatures, claim decision and beneficiary; distinguish actual recovery right from an announced compensation plan. Never auto-classify unfamiliar exploit transfer as neutral withdrawal. [high]
- **Value/profit/cost:** consumed premium is expense; enforceable recovery claim valued for recoverability, payout not second income. Unauthorized asset loss is loss after evidence review; balance shortfall already booked is not subtracted again as incident loss. Default write-down must cite evidence/version and trigger replay/coverage review. [high]
- **Connector actions:** `cover.prepare_purchase`, `cover.prepare_claim`, read `incidents.inspect_loss`, `recoveries.inspect_claim`; payouts require verified terms. [low]
- **MVP priority:** **must-have** evidence-backed losses/unknown classification; insurance preparation **nice-to-have**. [high]
- **Confidence:** [low] individual contract/case, accounting [high].

### Tradgents registration bond [high]

- **Named protocol:** proposed Tradgents per-agent returnable bond program; no deployment inherited from BACKEND.md. [high]
- **Interaction types:** bond deposit, eligible withdrawal after unregister/cooldown; slashing is an unresolved post-MVP product proposal. [high]
- **How to identify/index:** ID **unknown [low] until deployed and audited**. `[TX][STATE]` configured program, agent/PDA/beneficiary, `500000000` lamports principal excluding rent/fees, finalized one-use deposit/withdraw and upgrade authority; ordinary transfer is insufficient. See BACKEND.md §2. [high]
- **Value/profit/cost:** principal is excluded from trading capital/TWR, with recoverable bond tracked separately; onboarding costs disclosed separately; any future slash is trust penalty, not trading PnL. PDA control does not erase conditional-custody economics. [high]
- **Connector actions:** `tradgents.prepare_bond`, `tradgents.verify_bond`, `tradgents.prepare_bond_withdraw`; preparation disabled until deployment contract settled. [high]
- **MVP priority:** **must-have**, deployment gated; demo `bond_not_enforced` disables competitive eligibility. [high]
- **Confidence:** [high] specification; deployed implementation [low].

### Chain fees / account rent / transaction and permission administration [high]

- **Named primitives:** Solana fee payer, Compute Budget, account creation/closure, address lookup tables, durable nonce and program deployment/authority administration. [high]
- **Interaction types:** successful/failed transaction costs, sponsored fees, priority bid/tip, rent lock/refund, lookup-table create/extend/deactivate/close, nonce maintenance and authority changes. [med]
- **How to identify/index:** IDs **verify** against core registry; `[TX][RPC][STATE]` `meta.err`, actual `meta.fee`, lamport deltas, rent beneficiary and closure rights; decode compute instructions for context, not a second fee bill. [high] [Solana transaction fee reference](https://solana.com/docs/core/fees).
- **Value/profit/cost:** C. Landed failed trade incurs fees without a fill; rejected RPC request alone is no chain cost. Recoverable rent is an asset, lost/nonrecoverable rent rights need evidence. A third-party fee payer's charge is not the agent's expense. Nonce/lookup-table state has recoverable rent but no speculative token value. [high]
- **Connector actions:** read `solana.inspect_transaction_costs`; preparation `solana.create_lookup_table`, `solana.close_lookup_table`, `solana.advance_nonce`, `solana.close_account`, local-policy gated. [med]
- **MVP priority:** **must-have** generic indexing/cost reconciliation. [high]
- **Confidence:** [high] accounting; variants [med].

## Adapter acceptance and connector-action reference

### Minimum adapter record [high]

Each registry entry must retain `protocol_key`, `product`, cluster, deployed program IDs, source links/commit, IDL/layout hash, active/historical/unknown status, effective slot interval, ownership derivation, allowed action schemas, decoding/state/price methods, confidence, supported interaction types and separate capabilities for `detect`, `decode`, `value`, `attribute_fills`, `prepare`, `copy`. A protocol declared by an agent is only a hint. This is the implementation contract proposed by this catalog, consistent with BACKEND.md §§2, 4, 9. [high]

Action input schemas must distinguish exact-in/exact-out; base/quote/contract units; maker versus taker; market type and subaccount; supported token programs/extensions; repay-all/close-all semantics; optional triggers; and maximum leverage/liquidation constraints. Use decimal strings and explicitly named atomics, not an ambiguous universal `amount`. Unsupported actions return `unsupported_action`; do not alias an unsupported leverage action to a spot swap. [high]

| Capability / state | Required evidence and behavior | Confidence |
|---|---|---|
| Detected only | Verified program match or unresolved invocation plus raw evidence; does not imply complete balances or working preparation. | [high] |
| Equity-only | Ownership/state/prices reconstruct economic equity including debt; per-fill attribution unavailable and labeled. Do not manufacture fills from snapshot changes. | [high] |
| Fully indexed | Ordered interaction journal, complete beneficial balances/claims/debt, historical marks, exact fees and reconciliation. | [high] |
| Preparation enabled | Verified live program/IDL, input schema, complete unsigned instruction/CPI inspection, local-signing flow, limits/expiry and representative simulation fixtures. | [high] |
| Copy eligible | MVP only validated Jupiter spot fill with fresh follower quote, amounts and local signing. LP/leverage/vesting/bridge products do not silently inherit copy support. | [high] |
| Historical/recovery | Read/backfill permitted with versioned evidence; new trading disabled; withdrawal preparation only when current recoverability confirmed. | [high] |
| Unsupported/incomplete | Preserve raw activity/last-good state with timestamp; flag unknown amounts/marks/debt and block fully covered competitive claims. | [high] |

### Required economic fixtures [high]

- One direct and one CPI/routed success per program version; multiple fills per instruction and two registered counterparties; legacy/v0 address resolution; keeper fill with no wallet-address hit. [high]
- A failed landed transaction, separately paid tip, rent-funded/closed account, sponsored fee, SOL wrap/unwrap, and Token-2022 net transfer where supported; all fees exactly once. [high]
- Supply/borrow/repay plus interest without transaction, liquidation/default, cross-bucket conservation and intraperiod creator funding; test unknown debt/price rejection. [high]
- LP fee collection versus embedded accrual, position transfer, partial withdrawal and rebalance; receipt/underlying and position-NFT double-count protection. [high]
- mSOL delayed ticket before/after claim; staking reward/rate growth; Drift funding, partial close, settlement and loss; value each without counting realized or claim proceeds twice. [high]
- Queued vault withdrawal, rewards claimed after recognition, points conversion, NFT escrow/cNFT ownership if supported, bridged in-flight claim and destination completion, governance lock/unlock and unauthorized outflow classification. [high]
- Historical replay with captured slot-aligned state/prices, missing/truncated logs, unsupported schema after program upgrade, reindex revisions, stale provider data and exact returned capabilities. [high]

Independent captured signatures/balances must corroborate fixtures; mocked SDK outputs alone are insufficient. These are acceptance requirements, not runtime tests claimed to have passed in this documentation task. See BACKEND.md §10 Verification before shipping. [high]

## Summary and MVP prioritization

### Estimated category effort and risk [med]

Estimates are **engineer-days for the first representative production-quality indexing adapter/interaction set per category**, including fixtures, account discovery, historical state/price handling and reconciliation after shared ingestion exists. They are planning estimates, not delivery guarantees, and do not mean every named program/version fits in the range. Action preparation usually adds roughly 30–60% for newly supported categories; issuer/eligibility work and unavailable archive data can dominate. Shared math reduces duplicated work but requires independent venue validation. [med]

| Category | First representative indexing effort | Risk / main uncertainty | Recommended launch stance | Confidence |
|---|---:|---|---|---|
| 1. Spot / aggregators | 3–6 days | Medium: route deduplication, upgrades, Token-2022, price gaps | Jupiter plus observed CPI venue recognition | [med] |
| 2. Order books | 2–5 days | Medium–high: partial fills, seats/open orders, unsettled balances | Drift discovery; other books later | [med] |
| 3. LP | 6–12 days | High: tick/bin reconstruction, fee rights, share supply | Detect; add one family after launch | [med] |
| 4. Launchpads | 3–7 days | High: curve versions, migration, realizable price manipulation | Observe; no sniping/issuer preparation at launch | [med] |
| 5. Lending / loops | 6–12 days | High: indices, liabilities, liquidations, multi-leg loops | Drift spot debt required; Kamino extension first | [med] |
| 6. Perps | 6–12 days | High: maintained release, funding/fees, settlement, recoverability | Verified Drift equity; fills gated | [med] |
| 7. Options | 4–8 days | Very high: live venue availability, exercise units, sparse marks | Historical/unsupported detection | [med] |
| 8. Staking / restaking | 3–6 days | Medium for plain LST; high for restaking/slash/recovery | Marinade; native discovery; JitoSOL next | [med] |
| 9. Vaults / structured | 5–10 days | High: NAV/debt/fees, queues, managers and off-chain credit | Detect; add after underlying adapter | [med] |
| 10. Stable / RWA | 4–8 days | Low–medium plain stable marks; very high issuer NAV/corporate actions | USDC/SOL marks, depeg-aware policy | [med] |
| 11. Prediction | 4–8 days | High: mint/event mapping, resolution, external enforceability | Detect; later dedicated coverage | [med] |
| 12. NFT | 5–10 days | Very high: asset-specific prices, escrow and compressed ownership | Credentials needed by supported products only | [med] |
| 13. Arbitrage / MEV / bots | 4–8 days | High: bundle evidence, causal attribution and reward beneficiary | Exact costs/liquidation losses; attribution later | [med] |
| 14. Airdrops / points | 2–4 days | Medium: reward versus donation, enforceability/vesting | Known reward classification; points excluded | [med] |
| 15. Governance | 2–5 days | Medium–high: plugins, locks, treasury ownership | Detect owned locked assets; preparation later | [med] |
| 16. Payments / other | 5–10 days | High overall: purpose, ownership, cross-chain and impairment | Generic transfers/fees/unknown evidence required | [med] |

The table totals **64–131 engineer-days** for representative category coverage before preparation, with overlapping families requiring shared ownership of work. Add roughly **8–12 days** for reusable adapter registry, precision/price/state capture and reconciliation infrastructure if absent: **72–143 engineer-days** in that planning model. Complete validation of every named venue/version here is a larger, continually maintained program, provisionally **180–350+ engineer-days [low]**, excluding indefinite issuer/provider/legal/deployment delays. Team calendar time is not the sum of engineer-days; concurrency does not remove shared prerequisites. [med]

### Recommended MVP scope [high]

1. **Core evidence/accounting:** finalized ingestion, owned-account discovery, SOL/SPL balances, actual failed/success fees and tips, recoverable rent, external/internal flows, unsupported exposure flags, historical USD price capture and conservation. SOL/wrapped SOL and native USDC are the minimum priced inventory; other assets need defensible marks before fully covered ranking. [high]
2. **Jupiter swaps:** one economic fill per route, actual input/output ownership, quote versus executed evidence, Raydium/Orca/Meteora/other observed CPI recognition. Enable only `jupiter.swap` preparation and fresh Jupiter spot copy, per BACKEND.md §§1–2, 10. Quote responses are decoded and checked before local signing. [high]
3. **Marinade:** mSOL/SOL stake and stake-account deposit, rate snapshots, delayed unstake ticket/claim and any verified instant conversion path. Market-acquired mSOL is staking exposure regardless of swap venue. Native stake account discovery prevents capital from disappearing from the portfolio. [high]
4. **Drift, release gated:** complete user/subaccount discovery and unweighted economic equity including collateral, spot debt, perp PnL, funding, losses and charges. Enable per-fill attribution only after independent reconciliation; otherwise explicitly qualified equity-only coverage with unsupported metrics disabled. Resolve the archive/maintained-release question before promising mainnet actions. [high]
5. **Inflow/loss integrity and ranking:** distinguish rewards, creator funding and unknown donations; speculative points excluded; no arbitrary zero for unpriced holdings; unknown material protocol activity blocks fully covered claims. Keep BACKEND.md §6's history/trade requirements and Sharpe-first production ranking. [high]
6. **Bond and connector boundary:** audited/configured bond deployment is independent launch gate; no platform signer, pooled trading assets or automatic mirroring. Later action names are discoverable proposals only when capability status permits. [high]

Incremental adapter work for this deliberately narrow MVP is provisionally **12–22 engineer-days [med]** after ingestion/pricing infrastructure exists, allowing shared spot/fee/state work and an equity-only Drift fallback. That estimate does not add registration, bond deployment/review, social UI, full metrics service or all backend delivery tasks. Align with BACKEND.md §10's three-week plan and preserve recovery buffer; missing authoritative Drift releases or historical price/state data can prevent the planned lane from shipping. [med]

### Post-MVP roadmap [med]

| Phase | Protocol/interactions | Exit condition | Confidence |
|---|---|---|---|
| Coverage first | JitoSOL/common SPL stake pools, native rewards, direct Raydium/Orca/Meteora swaps, Jupiter Trigger/Recurring escrows | Slot-aligned beneficial balances, failed-fee fixtures, complete prices and owner discovery | [med] |
| Lending and liquidity | Kamino Lending, Save, marginfi; one Orca or Raydium CLMM; Meteora DLMM next | Debt/indices and tick/bin positions reconcile; liquidation and fee accrual fixtures pass | [med] |
| Additional derivatives/vaults | Jupiter Perps/JLP, verified Flash/Adrena, Kamino liquidity/Earn and Lulo | Underlying equity validated first; fees/claims/queues and payout caps proven | [med] |
| Agent preparation expansion | Marinade, validated Drift, later lending/LP actions; MCP/CLI transport | Versioned schemas, unsigned local-signing validation, explicit capabilities; no implicit leverage copy | [med] |
| Specialized markets | Prediction resolution/mint mapping, xStocks/Ondo corporate actions, Exponent/RateX, NFTs/loans, restaking | Reliable historical valuation and enforceable ownership/redemption; eligibility supported | [med] |
| Research and legacy | Causal MEV, cross-chain portfolio, sunset recovery, options, DePIN/business accounting | Independent archived evidence, explicit uncertainty, no contamination of fully covered ranking | [med] |

Sequence is a proposal, not authorization to install packages or implement pooled/follower custody. Add new adapters only when actual agent demand and supported valuation justify the maintenance cost. [high]

### Top open questions about Solana protocol support [med]

1. **Drift continuity:** which maintained SDK/source/deployed release and actual market state are authoritative after the archive redirect? Does the validated economic-equity API include every debt/funding/fee/settlement constraint? Keep current support unasserted until verified. [high]
2. **Deployment provenance:** which source/IDL/schema maps to each program at each slot, and how do upgrades invalidate parsers/preparation? Recheck addresses above against live executable accounts; textual source checks are not binary verification. [high]
3. **Ownership discovery:** can provider history/subscriptions discover every PDA, escrow, transferred position credential, stake account and keeper-modified subaccount at the supported wallet count? What is the starting historical coverage boundary? [med]
4. **Historical marks/state:** where do reliable intraflow token marks, old pool bins/ticks, funding indices, issuer NAV and corporate actions come from? Current SDK snapshots cannot fill archival gaps; quantify API/archival-RPC costs and retention. [high]
5. **Realizable valuation:** when should NAV, oracle, executable bid or size-aware unwind value drive ranking? How are stale, self-manipulated curves, insolvent claims, settlement caps and thin NFT/RWA liquidity handled consistently? [med]
6. **Token-2022:** which transfer fees, hooks, confidential balances, pausing/freezing, display-interest and other extensions are supported by each routing/LP/lending adapter? Unsupported debits/visibility cannot silently count as complete coverage. [high]
7. **Yield decomposition:** can fees/rewards be separated from principal/price exposure using state checkpoints rather than inferred from raw NAV change? How are manager fees, insurance losses and queued redemptions recognized once? [med]
8. **Prediction/options availability:** which event/option markets actually remain live on Solana mainnet, and who controls resolution/redemption? A documentation listing or roadmap alone is insufficient. [high]
9. **Cross-chain boundary:** will Tradgents stay Solana-only or value owned destination assets/claims? How are bridge failure, solver expiry and unverified destination ownership represented without neutralizing losses? [med]
10. **RWA eligibility/data:** can each agent redeem directly, are marks delayed outside exchange hours, and who supplies splits/dividend/FX histories? Who maintains issuer instrument/mint and transfer-restriction registries? [med]
11. **Operational readiness:** which protocols justify preparation versus observation only; who owns SDK/version upgrades, regression signatures and reconciliation alerts? APIs change independently from chain programs. [med]
12. **Ranking/product gates:** how should economically valid buy-and-hold staking agents handle the inherited ten-trade threshold, without counting claims/epochs as trades? What exact bond powers/return rules are approved and deployed? Preserve BACKEND.md's existing rules until explicitly changed. [high]

> Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
