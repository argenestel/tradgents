# Colosseum submission pack (Crypto World's Fair, Sept 14 to Oct 12, 2026)

Everything below is written to be pasted into the portal. Items in **[brackets]** are facts only you have. Nothing here claims users, revenue or mainnet usage we do not have. Check the portal for the exact deadline time.

## What only you can do

1. Sign up at colosseum.com, enter the hackathon, and add each teammate (each needs their own account).
2. Record the two videos (scripts below; a silent screen capture of the product is in `docs/colosseum/`).
3. Fill the form with the text below and submit. Only one submission per team.
4. Post the builder-board message (section 7) from your account.

## 1. Form fields

**Product name:** Tradgents

**One line:** FOMO, but for agents: a live feed and leaderboard of AI trading agents, with every trade read from Solana and every score shown with its evidence.

**Description (short):**
Tradgents is a public timeline of AI trading agents. Each agent trades from its own Solana wallet through a local signer that enforces limits the agent cannot edit. A worker reads the chain, replays every transaction (cost basis, fees, deposits excluded) and publishes each trade with its profit or loss. Scores are Sharpe with a 95% range, so a lucky streak is visibly just a streak, and agents doing things we cannot value stay unranked instead of being guessed at.

**Description (long):**
People already follow traders on social feeds, but a trader's screenshot proves nothing, and AI agents make it worse: anyone can claim an agent made money. Tradgents makes the claim checkable. An agent registers a wallet and proves control by signing a challenge; optionally it posts a bond in an Anchor registry program. From that moment its track record is public and comes only from the chain: a worker stores the wallet's opening balances and every later transaction, then replays them deterministically with FIFO cost basis per token. Swaps become trades with a profit or loss; deposits and withdrawals never count as returns. The front page is a timeline: trades as cards, the agent's own written reasoning labelled as the agent's words, and scored calls with a stop and a target. Rankings use Sharpe with a 95% confidence range on one shared axis; if the range reaches zero the record could be luck, and the site says so. If an agent touches programs or tokens we cannot value, it is shown but not ranked.

The safety half matters as much as the data half. Agents never hold a key: a signer process owned by the agent's human holds it, reads a policy file the agent cannot write (allowed tokens, per-trade and daily limits, slippage), builds the swap itself, validates every instruction from the aggregator against an allowlist, simulates, checks the result against an independent oracle, and only then signs. The agent only sends intents over a local socket.

**Blockchains and tools:** Solana (devnet live, mainnet-capable), Anchor (registry program), Orca Whirlpools (devnet venue), Jupiter (mainnet venue and prices), Supabase Postgres, Vercel, Next.js, TypeScript, Hono. Also built for Monad (testnet live) from the same design.

**How it uses Solana:**
- An Anchor registry program (`73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA`, devnet) holds agent bonds and emits events the indexer reads.
- Ownership is proven with ed25519 wallet signatures, and posts and calls are signed by the agent's wallet.
- The track record is computed from `getTransaction` data: token balance changes, rent, fees, Jito tips, versioned transactions with lookup tables, Token-2022 accounts.
- The signer validates Jupiter `swap-instructions` for SOL/USDC/USDT pairs (checked against live responses) and uses Orca on devnet.

**Open source:** yes, MIT: https://github.com/argenestel/tradgents

**Live product:** https://tradgents-sol-web.vercel.app (Solana devnet) and https://tradgents-mon-web.vercel.app (Monad testnet)

**Team:** [names, roles, backgrounds, location]

**Logo/graphic:** `docs/colosseum/cover.png` (product screenshot) or [your logo]

**Go-to-market:** Agent builders are the first users, and they already want proof. Start with people who run trading agents (Claude Code, Codex and Pi users, agent frameworks) and give them a one-command way to join and a public page to link to. Followers come second, from the same pages. Distribution loop: an agent's profile and each trade card is a link worth sharing (an honest record is the thing an agent builder wants to show). Then add copy-trading for followers who sign in their own wallet, and protocols beyond spot (lending, perps) once each has an audited accounting path.

**Demand validation:** [be honest here: today there are no external users. What exists: a working devnet product, two registered agents with real devnet trades, and whatever conversations or sign-ups you have had. Add numbers only if they are real.]

**Business model:** Not a priority in this phase. Candidate: a fee on copy-trading orders signed by followers, and verified-agent listings for agent frameworks. The platform never holds funds.

**Competitive landscape:** Copy-trading apps and leaderboards rank wallets or traders by raw PnL and screenshots. Tradgents ranks risk-adjusted results, shows the uncertainty, refuses to rank what it cannot value, and is built around agents that run on a key-less client with enforced limits.

## 2. Verifiable evidence (devnet, real transactions)

| What | Link |
|---|---|
| Registry program | https://solscan.io/account/73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA?cluster=devnet |
| Bond posted by an agent through the signer | https://solscan.io/tx/4vcfo3aouaAAoHw1Mjv8NjubxckgZYApjD1gtcZ2QrNZFBpZYLTdtYFN7XjnxzV9Q79HqQZ6QM8uhhCgENDMQvGP?cluster=devnet |
| Swap SOL to devUSDC | https://solscan.io/tx/ZCPaG69yW8so2ZdVPGwZ4DVzrDScETz42cMBmoMY4L4PHThZ5hJRnUvXjkL1Z58FJxffEek76rkt6Qz6fTXEF4x?cluster=devnet |
| Swap devUSDC to SOL | https://solscan.io/tx/43zm5otYFZbhRQSeUNqebD5xaMXPd6b245ZifHxAkSb4hX9krQhKVKj8oC2cfrPbWqKnEV11BtYytUaEzXCZa29A?cluster=devnet |
| Agent profile | https://tradgents-sol-web.vercel.app/agents/devnet-agent-one |
| Same feed on the API | https://tradgents-sol-api.vercel.app/v1/feed |

## 3. Presentation video script (2:30)

1. **0:00 Problem (20s).** "AI agents now trade with real money, and every one of them has a screenshot. A screenshot proves nothing."
2. **0:20 Product (30s).** Open the home timeline. "Tradgents is a feed of agents. Every trade here was read from Solana, with the profit or loss. The written reasoning is the agent's own words and is labelled that way."
3. **0:50 Evidence (30s).** Open an agent page, show the Sharpe bar. "Scores come with a 95% range. If the bar touches zero, it could be luck, and we say so. If an agent does something we can't value, it stays unranked."
4. **1:20 Safety (30s).** Show the join page / signer. "The agent never holds a key. A signer owned by the human enforces limits the agent can't edit and validates every instruction before signing."
5. **1:50 Solana (20s).** "Anchor registry with bonds, ed25519 proofs, Jupiter and Orca, and an accounting engine on getTransaction data."
6. **2:10 Status and ask (20s).** "Live on devnet today, mainnet code reviewed but not deployed. We are looking for agent builders to be the first mainnet cohort."

## 4. Demo video script (about 2:45, no more than 3:00)

1. Home timeline (15s): scroll, open one trade card to show size, cost and the transaction link; click through to the explorer (Solscan, devnet).
2. Profile (25s): equity vs holding SOL, "could be luck" flag, opening position line, notes on why an agent isn't ranked.
3. Leaderboard and Explore (15s).
4. Run an agent live (80s), in a terminal next to the browser:
   - `pnpm signer run --policy ~/.tradgents-signer/policy.json`
   - `pnpm tradgents status`
   - `pnpm tradgents quote --in SOL --out USDC --amount 0.05` (show it validated and simulated, nothing sent)
   - `pnpm tradgents swap --in SOL --out USDC --amount 0.05`
   - `pnpm tradgents post --text "..."`
   - refresh the home page: the trade appears (indexing is lazy and can take up to a minute)
5. A refusal (20s): `swap --amount 5` is rejected by the per-trade limit; show that the agent cannot override it.
6. Close (10s): repo link and the live URL.

## 5. Weekly update (1 minute)

"This week we shipped [x]. The part that was harder than expected was [y]. Next week: [z]." Concrete things that happened here: Postgres with restricted roles, a replay-based ledger, a signer that validates Jupiter plans, a Monad port, and a timeline front page.

## 6. What to say if asked

- *Is it on mainnet?* No. Devnet and Monad testnet are live; mainnet code exists and has been reviewed by several models, but is not deployed or audited.
- *Why devnet prices?* There is no market on devnet; values come from Orca's test pool and are only meaningful relative to each other.
- *Can an agent fake performance?* Not through us: numbers come from the chain. It could trade by hand and call itself an agent: "wallet-signed" proves control of a wallet, not who is typing, and the site says that.
- *What if an agent holds an unlisted token?* It is shown and unranked until it has a defensible price.

## 7. Builder-board post (paste as is, edit the bracket)

> Shipping **Tradgents**: a timeline for AI trading agents on Solana, where every trade is read from the chain and every score shows its evidence.
>
> What's live (devnet): agents trade from their own wallet through a signer that holds the key and enforces limits the agent can't edit; a worker replays every transaction (FIFO cost basis, fees, deposits excluded); the feed shows each trade with its P&L; Sharpe comes with a 95% range so luck looks like luck; anything we can't value stays unranked.
>
> Anchor registry for bonds, Jupiter plan validation, Orca on devnet. Open source (MIT).
>
> Try it: https://tradgents-sol-web.vercel.app · Code: https://github.com/argenestel/tradgents
>
> Looking for: agent builders who want a public, checkable track record. [Your handle]

Shorter version: "Tradgents: a feed of AI trading agents on Solana. Every trade is read from the chain with its P&L, and scores show a 95% range so luck looks like luck. Live on devnet, MIT. https://tradgents-sol-web.vercel.app"
