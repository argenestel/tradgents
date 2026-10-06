# Tradgents MONAD — Protocol Interaction Catalog

Every way an agent can create or lose value on Monad, grouped for the indexer and the connector.

Addresses are from [`monad-crypto/protocols` mainnet](https://github.com/monad-crypto/protocols/tree/main/mainnet) or [canonical contracts](https://github.com/monad-crypto/protocols/blob/main/mainnet/CANONICAL.jsonc) unless marked **verify**. Event *signatures* (topic0) are included only when they are canonical ERC/Uniswap/Aave/Morpho topics we already know; otherwise **verify** against the verified ABI on MonadVision.

Confidence: **[high]** protocol+address in the registry; **[med]** standard ABI assumed (same bytecode as other chains); **[low]** existence known, decoding unknown.

Connector names match `BACKEND.md` §3.5.

**MVP priority:** categories 1, 2, 5, 6 (spot, orderbook fills, lending, perps) plus gas (16). Everything else is later unless it falls out of ERC-20 `Transfer` for free.

---

## Shared primitives

These are not venues. They fire on almost every interaction.

| Primitive | How to identify | Value / cost | Connector | Conf |
|---|---|---|---|---|
| Native MON transfer | `tx.value` or internal `CALL` value (needs traces) | Flow if counterparty not a protocol; else venue-specific | `wallet.transfer` | [high] |
| ERC-20 `Transfer` | topic0 `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` | Δ inventory; USD via price table | (decoded into venue fills) | [high] |
| ERC-20 `Approval` | topic0 `0x8c5be1e5ebec7d5bd14f71427d1e84c3c04c9959cbe6c195309c97ca132cd15b` (`Approval(address,address,uint256)`) | Gas only; hygiene | `wallet.approve` | [high] |
| Permit2 | `0x000000000022d473030f116ddee9f6b43ac78ba3` | Gas; allowance surface | `wallet.permit2` | [high] |
| WMON wrap/unwrap | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` `Deposit`/`Withdrawal` | Not PnL (MON↔WMON) | `wallet.wrap` | [high] |
| Gas | every tx from agent | **`gas_limit × effective_gas_price`** (Monad charges limit, not used) | implicit | [high] |
| ERC-4337 UserOp | `EntryPoint` v0.6–0.9 (CANONICAL.jsonc); Jiffyscan | Inner calls are the real fills; gas may be paymaster-paid | implicit | [high] |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | Unwrap inner logs | implicit | [high] |

Pricing oracles (mark-to-market, not venues):

- **Pyth** PriceFeed `0x2880aB155794e7179c9eE2e38200202908C17B43` — `MON_USD` feed id `0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1` [high]
- **Chainlink** push proxies e.g. `ETH_USD` `0x1B1414782B859871781bA3E4B0979b9ca57A0A04`, `BTC_USD` `0xc1d4C3331635184fA4C3c22fb92211B2Ac9E0546` — full list in `chainlink.jsonc` [high]

Unknown-asset gate: if a token has no Pyth/Chainlink print, mark 0 and exclude from eligible if >5% of equity (`BACKEND.md` §6.5).

---

## 1. Spot DEX / Aggregators — **MVP**

Agent swaps token A for token B. One agent-visible fill even if the router hops.

**PnL:** FIFO lots on the sold token; inventory of the bought token at USD cost. Fee = venue fee (inside amounts) + gas. Slippage vs Pyth mid is diagnostic, not a second PnL.

### Kuru Flow (aggregator) [high]

- Addresses: `KuruFlowEntryPoint` `0xb3e6778480b2E488385E8205eA05E20060B813cb`, `KuruFlowRouter` `0x465D06d4521ae9Ce724E0c182Daad5D8a2Ff7040`, `KuruFlowRouterV2` `0x0d3a1BE29e6dEd63c7a5678b31e847D68F71FFa2`
- Index: txs `to` these routers + ERC-20 Transfers where agent is `from`/`to`. Inner pool events are `legs[]`. Official quote API `https://ws.kuru.io` (JWT). [high]
- Events: **verify** (not in Monad docs). Do not guess topic0.
- Connector: `spot.swap` / `kuru.market` (Flow is the default MVP swap).
- Copy-trade: prefill quote calldata; user signs. Calldata from the API **lacks `0x` prefix** — add it. [high]

### 1inch [high]

- `AggregationRouterV6` `0x111111125421cA6dc452d289314280a0f8842A65`, `Aqua` `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`, `SwapVMRouter` `0x111111338c5091E8440b67B168bAe16a668AC0De`
- Index: router `to` + Transfers. Also intent/limit via 1inch Limit Order Protocol — **verify** Monad-specific order settlement events.
- Connector: `spot.swap` (`venue=1inch`).

### 0x / Matcha [high]

- `AllowanceHolder` `0x0000000000001fF3684f28c67538d4D072C22734`, `MonadSettler` `0x478cF28Fd1Ba92a6afd04F44b05833F6dF7f1486`, plus MetaTxn/Intent/Bridge settlers in `matcha.jsonc`
- Index: settler `to` + Transfers. Gasless meta-txs: the agent may not be `tx.from` — match on Transfer and settler logs.
- Connector: `spot.swap` (`venue=0x`).

### Uniswap (v2 / v3 / v4) [high]

- V2 Factory `0x182a927119d56008d921126764bf884221b10f59` Router02 `0x4b2ab38dbf28d31d467aa8993f6c2585981d6804`
- V3 Factory `0x204faca1764b154221e35c0d20abb3c525710498` SwapRouter `0xd6145b2d3f379919e8cdeda7b97e37c4b2ca9c40` NPM `0x7197e214c0b767cfb76fb734ab638e2c192f4e53`
- V4 PoolManager `0x188d586ddcf52439676ca21a244753fa19f9ea8e` PositionManager `0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016`
- UniversalRouter `0x0d97dc33264bfc1c226207428a79b26757fb9dc3` (plus `2.1.1` / `2.1.2` in `uniswap.jsonc`)
- Index:
  - V2 `Swap` on pair contracts (standard Uni v2 topic0 `0xd78ad95fa46c994b6551d0da85fc275fe6d97c4340a5026e4f1753eb2ce4b7dd`) [med — confirm bytecode]
  - V3 `Swap` on pools (topic0 `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`) [med]
  - V4: `Swap` on PoolManager — **verify** v4 topic (different ABI than v3)
  - Always also UniversalRouter `to`
- Connector: `spot.swap` (`venue=uniswap`).

### PancakeSwap [high]

- V2 Factory/Router, V3 Factory `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865`, SmartRouter `0x21114915Ac6d5A2e156931e20B20b038dEd0Be7C`
- Index: same Uni-style `Swap` events (Pancake v3 is Uni-v3-like). [med]
- Connector: `spot.swap` (`venue=pancake`).

### Other spot venues (index as `spot_swap` if agent touches them)

| Protocol | Notes | Conf |
|---|---|---|
| OctoSwap | V1+V2 AMM, own factory/router | [high] addr / [med] events |
| SushiSwap | **Aggregator only** on Monad (`RedSnwapper` `0xac4c6e212a361c968f1725b4d055b47e63f80b75`); no Sushi AMM | [high] |
| Curve | Stableswap/Twocrypto/Tricrypto factories in `curve.jsonc`; `TokenExchange` **verify** | [high]/[med] |
| Balancer v3 | Vault `0xbA1333333333a1BA1108E8412f11850A5C319bA9` | [high] |
| LFJ (Trader Joe DLMM) | `LBRouter` `0x18556DA13313f3532c54711497A8FedAC273220E` | [high] |
| Bean Exchange DLMM | `DLMM_Router` `0x721aC9E688E6b86F48b08DB2ba2D4B7bBBd12665` | [high] |
| iZiSwap | `factory` `0x8c7d3063579BdB0b90997e18A770eaE32E1eBb08` | [high] |
| WooFi | `WooRouterV2` `0x4c4af8dbc524681930a27b2f1af5bcc8062e6fb7` | [high] |
| Monorail | `AggregationRouter` `0xa68a7f0601effdc65c64d9c47ca1b18d96b4352c` — Monad-native agg | [high] |
| Fly Trade | `MagpieRouterV3_1` `0x956df8424b556f0076e8abf5481605f5a791cc7f` | [high] |
| KyberSwap, OpenOcean, OKX agg, Fibrous, Rubic, Eisen, Matcha Meta | listed in protocols repo | [high] names / **verify** addresses per file |

---

## 2. Orderbooks — **MVP (fills)**

Resting orders are not PnL. Fills are spot (or perps — see §6). Escrowed margin is equity.

### Kuru DEX (hybrid AMM-orderbook) [high]

- `Router` `0xd651346d7c789536ebf06dc72aE3C8502cd695CC`, `MarginAccount` `0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5`
- Markets (examples): MON/USDC `0x065C9d28E428A0db40191a54d33d5b7c71a9C394`, WETH/USDC `0xa6aFD386135B7D41A6C40C525abC4A1019b0D132`
- Index: **verify** trade/fill events on market contracts. Until then, infer from MarginAccount token movements + Transfers.
- Connector: `kuru.limitOrder`, `kuru.cancel`, `kuru.market`
- Maker rebate: **unknown** — verify before wash analysis.

### Crystal [high]

- `Crystal` `0x508254c838B2e936B0631440c5C6E3AB3a4a98BD`, MON/USDC market `0x39fAE95717cfD4bdA22317F1c124660A166b6BEc`
- CLOB + backstop AMM + launchpad. Events **verify**.
- Connector: `crystal.limitOrder` (later; not MVP unless we pick Crystal over Kuru).

### Clober [high]

- `BookManager` `0x6657d192273731C3cAc646cc82D5F28D0CBE8CCC`, `Controller` `0x19b68a2b909D96c05B623050C276FBD457De8e83`, `Router` `0x7B58A24C5628881a141D630f101Db433D419B372`
- Events **verify** (segmented-tree CLOB; not Uni-like).
- Connector: `clober.limitOrder` (later).

### LFJ LimitOrderV2 [high]

- `LimitOrderV2` `0xDbeeB3FB3e864e490e71b1d5c86c3de683cA4626` — later.

---

## 3. AMM / CLMM LP — later (unless a reference agent LPs)

**PnL components:** fee income + IL vs HODL of entry amounts + emissions (Merkl, etc.) − gas. Equity = current withdrawable amounts + uncollected fees.

| Protocol | Interaction | Index | Connector | Conf |
|---|---|---|---|---|
| Uniswap v2 | mint/burn/sync | `Mint`/`Burn` on pair; LP token Transfers | `lp.deposit` / `lp.withdraw` | [high]/[med] |
| Uniswap v3 | mint/increase/decrease/collect | NPM `0x7197e214c0b767cfb76fb734ab638e2c192f4e53` + `Transfer` of position NFT | `lp.clmmDeposit` | [high] |
| Uniswap v4 | modifyLiquidity | PositionManager `0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016` — **verify** events | `lp.clmmDeposit` | [high]/[med] |
| Pancake v3 | same as Uni v3 | NPM `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | same | [high] |
| Curve LP | add/remove liquidity | factory pools; **verify** | `lp.curveDeposit` | [high]/[med] |
| Balancer v3 | add/remove | Vault `0xbA1333…` | `lp.balDeposit` | [high] |
| LFJ / Bean DLMM | add/remove bins | LBRouter / DLMM_Router | `lp.dlmmDeposit` | [high] |
| iZiSwap | liquidityManager | `0x19b683A2F45012318d9B2aE1280d68d3eC54D663` | `lp.iziDeposit` | [high] |
| Kuru vaults | `Vault` `0x4869a4c7657cef5e5496c9ce56dde4cd593e4923` | **verify** | `kuru.vaultDeposit` | [high]/[low] |

IL math: store `{amount0_in, amount1_in, ts_in}`; at mark, compute HODL USD vs LP USD.

---

## 4. Launchpads / bonding curves — later (high volume, messy)

**PnL:** same as spot on the curve; graduation/migration is a **transfer between venues**, not a gain. Watch for hidden fees and unsold inventory.

### nad.fun [high] — named in product brief

- Bonding curve `0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE`, router `0x6F6B8F1a20703309951a5127c45B49b1CD981A22`
- V2 curve `0x9f3832732923252A21044F21eE6bd87F09514ae4`, V2 router `0x8986C8fD44eb85294A725a7e61AF35E76bA26F91`
- Also DEX deployer/router, LP manager, treasuries — see `nad_fun.jsonc`
- Index: **verify** `Swap`/curve events on `BONDING_CURVE` / `V2_BONDING_CURVE`. Token registry `0x3Be9198208c198e2a4dab9A575764C8468DC83c6` (v1) / v2 registry.
- Connector: `launchpad.buy` / `launchpad.sell` (`venue=nadfun`)

### Others [high] names

| Protocol | Address (entry) | Notes |
|---|---|---|
| Doppler | TokenFactory `0xaa47d2977d622dbdfd33eef6a8276727c52eb4e5` | Uni v3/v4 initializers |
| Clanker | `Clanker` `0xF9a0C289Eab6B571c6247094a853810987E5B26D` | AI token launcher |
| Kuru MonadDeployer | `0xe29309e308af3EE3B1a414E97c37A58509f27D1E` | one-step token+market |
| Crystal launchpad | via Crystal router | **verify** |
| Flap, Mintpad, Printr, Memetok, Esp Fun | listed | later; do not invent |

---

## 5. Lending / borrowing / leverage loops — **MVP (Morpho first)**

**PnL:** interest income (Δ supply index × shares) − interest expense (Δ borrow index) − liquidation penalty + rewards − gas. Leverage loops = same, plus the inner swap (spot fill).

Health factor is **risk**, not return. Liquidation is a fill of kind `liquidation`.

### Morpho [high] — brief MVP

- `Morpho` (Blue) `0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee`
- IRM `AdaptiveCurveIrm` `0x09475a3D6eA8c314c592b1a3799bDE044E2F400F`
- Bundler3 `0x82b684483e844422FD339df0b67b3B111F02c66E`
- MetaMorpho factory `0x33f20973275B2F574488b18929cd7DCBf1AbF275`
- VaultV2 factory `0x8B2F922162FBb60A6a072cC784A2E4168fB0bb0c`
- URD (rewards) `0xA3E73eC1792bb127B0915dE9842eB999C12C0c34`
- Events (Morpho Blue standard, **confirm bytecode**): `Supply`, `Withdraw`, `Borrow`, `Repay`, `Liquidate`, `SupplyCollateral`, `WithdrawCollateral`, `AccrueInterest` [med]
- Equity: `position(market, user)` shares × `market.totalSupplyAssets/totalSupplyShares` minus borrow analog; collateral at oracle.
- Connector: `morpho.supply` `morpho.withdraw` `morpho.borrow` `morpho.repay` `morpho.supplyCollateral`

### Aave V3 [high]

- `POOL` `0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef`
- `ORACLE` `0x0c02b2c2038066C10Eab8fe1D5Cdb73d5a78A1Bf`
- aTokens/vTokens for USDC, USDT0, AUSD, WETH, cbBTC, wstETH, weETH, USDe, mUSD, syrupUSDC, … in `aave_v3.jsonc`
- USDC token `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` [high from this file]
- Events: `Supply`, `Withdraw`, `Borrow`, `Repay`, `LiquidationCall`, `ReserveDataUpdated` [med]
- Connector: `aave.supply` `aave.withdraw` `aave.borrow` `aave.repay`

### Curvance [high] addr / [low] events

- `CentralRegistry` `0x1310f352f1389969Ece6741671c4B919523912fF`
- Markets: cWMON, caprMON, cshMON, csMON, cUSDC, cWETH, cWBTC, cAUSD, … (full list in `curvance.jsonc`)
- Position managers / zappers listed. **Do not decode until ABI verified.** Equity via `ProtocolViewer` `0xeD12668728c95DDa3411f29d5347356E6da222dA` if the view is stable.
- Connector: `curvance.supply` (later)

### Euler [high] addr / [med] events

- `eVaultFactory` `0xba4dd672062de8feedb665dd4410658864483f1e`, `evc` `0x7a9324e8f270413fa2e458f5831226d99c7477cd`
- Per-vault `Transfer`/`Deposit`/`Withdraw`/`Borrow`/`Repay` — **verify** EVK ABI.
- Connector: `euler.supply` (later)

### Neverland [high]

- Aave-v3 fork. Pool proxy `0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585`
- Treat as Aave-like. Connector: `neverland.supply` (later)

### Gearbox [high] addr / [low] events

- Prime brokerage / leveraged farming. `Address_Provider` `0xF7f0a609BfAb9a0A98786951ef10e5FE26cC1E38`
- Later. Loops will look like borrow + swap + supply.

### Timeswap [high] addr / [low] events

- Oracleless fixed-term. Factories in `timeswap.jsonc`. Later.

Liquidation **as keeper** is category 12.

---

## 6. Perps — **MVP (Perpl), equity-first if ABI slips**

**PnL:** realized on close + funding cashflows + liquidation − fees − gas. Unrealized = venue mark − entry, using **venue** mark if it exists, else Pyth.

### Perpl [high] addr / [low] events — brief MVP

- `Exchange` `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F`
- On-chain CLOB perps, isolated margin, delegated accounts, 1-click. Docs: https://docs.perpl.xyz
- Index: **verify ABI**. Until funding/fill events are known, mark agent equity via whatever view the Exchange exposes (unknown) or do **not** claim fill-level PnL.
- Connector: `perpl.open` `perpl.close` `perpl.modify`
- Delegated accounts: the agent wallet may not be `tx.from`. Follow the delegated mapping **once documented**.

### Bean Exchange perps [high] name / [low] surface

- Category includes perps; only DLMM addresses listed. **Unknown** perp contracts. Do not invent.

### Blinq [high]

- `Diamond` `0x928dc8afe312df45576b15b08c086c5427fd8207` tagged prediction + perps. **verify**. Later.

If Perpl slips in week 2, ship Morpho + spot fully and show Perpl as “equity-only / decoder in progress” — same honest fallback as Drift in the Solana plan.

---

## 7. Liquid staking / restaking / native staking

**PnL:** Δ (LST × exchange rate × asset USD) is yield. Stake/unstake is a venue transfer, not a swap gain. Unbonding delays are inventory, not losses.

| Protocol | Token / contract | Index | Connector | Conf |
|---|---|---|---|---|
| Magma | gMON `0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081`; Delegator `0xb1d57de83d80a2abac91714744dfe97e71b73dc0` | Transfers of gMON + **verify** stake events; rate = `convertToAssets` or equivalent **verify** | `lst.stake` `venue=magma` | [high] |
| aPriori | aprMON `0x0c65A0BC65a5D819235B71F554D210D3F80E0852`; swap `0x4F02a29dF8510975D293AAb0B32aF7340f406Fb4` | same | `lst.stake` `venue=apriori` | [high] |
| Kintsu | StakedMonad proxy `0xA3227C5969757783154C60bF0bC1944180ed81B9` | same | `lst.stake` `venue=kintsu` | [high] |
| FastLane shMON | `ShMonad` `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c` | same | `lst.stake` `venue=shmonad` | [high] |
| Puffer | pufETH `0x37D6382B6889cCeF8d6871A8b60E667115eDDBcF` | restaked ETH LST | `lst.stake` `venue=puffer` | [high] |
| SatLayer | pool `0x6CaEAFfC53B91094542B6cB9C51f448DB74dfd8C` | BTC economic layer — **verify** | later | [high]/[low] |
| StakeStone | STONEUSD `0x095957ceb9f317ac1328f0ab3123622401766d71` | later | later | [high] |
| Native staking | precompile `0x0000000000000000000000000000000000001000` | **verify** view/events in staking-precompile docs | `stake.native` | [high] addr / [med] ABI |

MEV-related LST yield (Magma, aPriori, FastLane) still shows up as Δ rate. Do not try to attribute “MEV income” separately in MVP.

---

## 8. Yield vaults

**PnL:** Δ (shares × NAV). Deposit/redeem = flow into the vault bucket.

| Protocol | Entry | Notes | Conf |
|---|---|---|---|
| Upshift earnAUSD | token proxy `0x103222f020e98Bba0AD9809A011FDF8e6F067496`; listed contract `0x36eDbF0C834591BFdfCaC0Ef9605528c75c406aA` | “primary liquid yield token”; allocates AUSD | [high] |
| Morpho MetaMorpho / VaultV2 | factories in §5 | ERC-4626-like **verify** | [high] |
| Euler Earn | `eulerEarnFactory` `0xf463d4acb650cc6c4e1d6cd4d0d1b0cb224094cf` | later | [high] |
| Pendle | Router `0x888888888889758F76e7103c6CbF23ABbF58F946`; MarketFactory `0xA3cb62a49b66eB2536cf6F3C7AC82293784888A3` | PT/YT: mark each token; YT decays. Later. | [high] |
| Beefy, Lagoon, Mellow, Velvet, Aarna | listed | later; do not invent ABIs | [high] names |
| Kuru Vault/Vault2 | see §3 | later | [high] |

Connector: `vault.deposit` / `vault.redeem`.

---

## 9. Stablecoins / RWA

Mostly **inventory**, not a strategy. PnL = depeg vs $1 + yield if the token is a savings stable.

| Asset | Address | Notes | Conf |
|---|---|---|---|
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | from Aave/Kuru metadata | [high] |
| AUSD | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` | | [high] |
| USDT0 | `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` | | [high] |
| USDe | `0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34` | | [high] |
| mUSD | `0xacA92E438df0B2401fF60dA7E4337B687a2435DA` | | [high] |
| WETH | `0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242` | | [high] |
| wstETH | `0x10Aeaf63194db8d453d4D85a06E5eFE1dd0b5417` | | [high] |
| cbBTC | `0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b` | | [high] |
| Midas mROX | `0x6CF55183eA297ba200Cf88419Bba156EBA2Ed206` | RWA; NAV via Midas feeds | [high] |
| Centrifuge | Hub `0xA4A7Bb3831958463b3FE3E27A6a160F764341953` | RWA infra | [high] |
| Aave GHO | oracles listed; token address **verify** | | [med] |

Connector: none beyond `spot.swap` / lend. Depeg is implicit in USD marks.

Circle CCTP, Agora, Mento: listed — treat mints/redemptions as flows at $1 unless the oracle disagrees.

---

## 10. Prediction markets — later

**PnL:** shares × resolution − cost − fees. Unresolved: mark at last trade or AMM price if any; otherwise cost (conservative) and **ineligible** if large.

| Protocol | Entry | Conf |
|---|---|---|
| Castora | `Castora` `0x9e1e6f277df3f2cd150ae1e08b05f45b3297be6d` | [high] |
| Parletto | Escrow `0x30038f7cfc1fc0d5f026f5093f239b367c12711d` | [high] |
| Rocket Markets | Market `0x5fabe7eb6629058bcaa0d2041cacd32638a7480b` | [high] |
| Trendle | Trading `0xae0830d7588ab44e5d4443168a8d666b54f385fe` | [high] |
| CRSH | Escrow `0x0a2fbf2dbe08880d8d0d7f2f34b4cc3761f729b1` | [high] |
| Blinq | see §6 | [high] |
| Levr Bet / Narbet | listed | [high] names |

Connector (later): `pred.buy` `pred.sell` `pred.redeem`.

Tradgents **calls** (social predictions) are *off-chain* objects scored by our oracle prints — they are not these protocols.

---

## 11. NFTs — later

**PnL:** proceeds − cost − royalties − gas. Floor marks are not eligible-grade.

| Protocol | Entry | Conf |
|---|---|---|
| OpenSea | SeaDrop `0x00005EA00Ac477B1030CE78506496e8C2dE24bf5`; Marketplace `0x0000000000000068F116a894984e2DB1123eB395` | [high] |
| NFTs2Me, Scatter, Mintto | listed | [high] names |

Index ERC-721 `Transfer` + marketplace sale events (**verify** Seaport/SeaDrop topics). Exclude from MVP eligibility.

Connector: none in MVP.

---

## 12. Arbitrage / MEV / liquidations / keepers

Not a separate venue. Detect by **pattern**:

| Pattern | How | PnL | Conf |
|---|---|---|---|
| Cyclic arb | ≥2 `spot_swap` in one tx, start/end same asset | net Δ inventory − gas | [med] |
| CEX-DEX (on-chain leg only) | single swap, no on-chain hedge | we only see the on-chain leg — **do not** invent the hedge | [high] |
| Liquidator | Morpho `Liquidate` / Aave `LiquidationCall` where agent is liquidator | bonus − gas − flash fee | [med] |
| FastLane Atlas | `Atlas` `0x2DA28fedc4643c787CB5c5e84fa6AaDb596875E8`; auction handler `0xD32EdF6642D917DbBE7B8BF8e5d6F5df6a9FFF58` | searcher payments — **verify** events | [high]/[low] |
| Magma / aPriori MEV | LST rate | already in §7 | [high] |

Connector: no special names; fills already captured. Optional tag `style=arb|liq|keeper`.

---

## 13. Airdrops / points farming

| Source | Address | Treatment | Conf |
|---|---|---|---|
| Merkl | `0x3ef3d8ba38ebe18db133cec108f4d14ce00dd9ae` | claim = income at USD if token liquid; else `price_quality=none` | [high] |
| Morpho URD | `0xA3E73eC1792bb127B0915dE9842eB999C12C0c34` | same | [high] |
| Unsolicited ERC-20 | Transfer from unknown | **flow in**, not TWR | [high] |
| Points (off-chain) | n/a | ignore until token exists | [high] |

Connector: `rewards.claim`.

---

## 14. Governance — later

Vote, lock, bribe. Usually not PnL except:

- Selling airdropped governance tokens (spot)
- Vote-escrow NFT value (unreliable — exclude)
- Neverland veNFT (protocol is a lend fork with NFT governance)

No canonical Governor address asserted here. **Unknown** for most venues. Connector: none.

Safe / multisig interaction is wallet infra, not governance.

---

## 15. Bridging / cross-chain

**Always a flow, never Monad-PnL.** Destination value is out of scope until we index the other chain. Large unexplained outflow + later inflow is the tell.

| Protocol | Entry | Conf |
|---|---|---|
| LayerZero V2 | `endpointV2` `0x6F475642a6e85809B1c36Fa62763669b1b48DD5B` | [high] |
| Across | SpokePool `0xd2ecb3afe598b746F8123CaE365a598DA831A449` | [high] |
| Circle CCTP | listed (`circle_cctp.jsonc`) | [high] name |
| Wormhole Portal | listed | [high] name |
| Axelar, deBridge, Bungee, Li.Fi, Mayan, Orbiter, Relay, Garden, Hyperlane Nexus, Avail Nexus | listed | [high] names |
| 0x BridgeSettler | `0xb40e9939bb598C38665A5C99c68020EEB8Cf49FB` | [high] |

Connector: `bridge.out` / `bridge.in` (marks flow). UI disclaimer: “withdrawn from Monad track record.”

---

## 16. Payments / other

| Interaction | How | Value | Connector | Conf |
|---|---|---|---|---|
| x402 payment | Foundation facilitator signer `0x7f6a2850669202519f0FE8aa912451238820Db86`; proxies `x402ExactPermit2Proxy` `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`, `x402UptoPermit2Proxy` `0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002` | Spend of USDC/AUSD for agent services; **cost** | `pay.x402` | [high] |
| ERC-8004 identity mint | Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | gas + any mint fee; not trading PnL | `identity.register` | [high] |
| ERC-8004 feedback | Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | gas | `identity.feedback` | [high] |
| AgentRegistry bond | our contract (not yet deployed) | escrow, not PnL | `agent.register` | n/a |
| Sablier streams | listed | mark streamed-in as flow/income **verify** | later | [high] name |
| Gas sponsorship | paymaster in 4337 receipt | see BACKEND §6.3 | implicit | [high] |

---

## MVP adapter order

Build decoders in this order. Stop and ship rather than guess ABIs.

1. ERC-20 `Transfer` + native value + gas (`gas_limit`) — everything else hangs off this
2. Kuru Flow (or Uni UniversalRouter) — spot
3. Morpho Blue — lend
4. Magma **or** aPriori — LST equity
5. Pyth + Chainlink marks
6. Perpl — only if ABI is in hand; else equity-only
7. Aave V3 — if time
8. nad.fun curve — explicitly cut if it threatens the demo (same as Pump.fun on Solana)

---

## Do-not-invent list

We did **not** find (or did not confirm) on Monad:

- A canonical ERC-7579/7715 factory address
- Perpl fill/funding event signatures
- Kuru CLOB trade topic0
- Curvance cToken event ABI
- Bean Exchange perp contracts
- Ponder as an official Monad indexer
- Any protocol not named in `monad-crypto/protocols` or docs.monad.xyz

If an agent trades an unknown contract: record Transfers, tag `protocol=unknown`, keep them in equity, **drop eligibility** if material.

Re-pull `protocols-mainnet.csv` at build time; this catalog will rot.
