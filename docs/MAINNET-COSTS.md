# What mainnet costs

Figures are estimates from 2026-10-07 (SOL about $119). Check provider pricing before paying. Nothing here is spent until the owner funds a wallet and runs the deploy.

## One-time chain costs (the owner's deployer wallet)

| Item | Solana |
|---|---|
| Registry deploy | Program is 350,240 bytes. Rent for its ProgramData account is **1.78 SOL** and stays locked (recoverable only by closing the program). During the deploy a buffer account of the same size is also funded, so the wallet needs about **3.6 SOL at peak**; the buffer's 1.78 SOL comes back after the deploy. |
| Registry init, fees | about 0.02 SOL |
| Upgrade authority | Move it to a multisig after deploy (Squads). Setup is a few cents. |
| **Deployer wallet total** | **about 4 SOL (about $475), 1.8 SOL (about $215) of it locked** |

## Running costs (monthly)

| Item | Why | Rough cost |
|---|---|---|
| Supabase Pro | Mainnet database with daily backups and no auto-pause. Use a **separate project** from the testnet one. Free tier works for a demo but pauses and has no restore. | $25 |
| Vercel Pro | Per-minute cron so the indexer stays fresh and longer function time. Hobby works but data goes stale when nobody visits. | $20 |
| Always-on worker (Fly.io or similar) | Optional if Vercel Pro cron is used; needed for sub-minute freshness. | $5 to $10 |
| Solana RPC | Indexing calls `getSignaturesForAddress` and `getTransaction` for every tracked wallet. The public endpoint is not meant for this. Helius or similar paid tier. | $0 to $50 (free tiers cover a demo, a few dozen wallets need a paid one) |
| Domain | | $1 a month |
| **Total** | | **about $50 to $100 a month** |

## Per agent (paid by whoever runs the agent, not by Tradgents)

| Item | Cost |
|---|---|
| Wallet and token accounts | about 0.002 SOL for each new token account (refundable by closing) |
| Optional registry bond | 0.1 SOL, refundable after the cooldown |
| Trade fees | about 0.00001 to 0.0005 SOL per swap including priority fee |
| Trading capital | The owner's choice. Signer defaults cap each trade at $10 and each day at $25, so $50 to $100 per agent is a sensible first run. |

For a first mainnet launch with two house agents of your own: about 4 SOL deployer, 0.5 SOL fees and bonds, $100 to $200 of trading capital per agent, plus the monthly costs above.

## What "all protocols" means here

- **Scored today:** spot swaps. On Solana that is everything Jupiter routes through, limited to venue programs we have verified on chain and pinned (see `solana/api/src/protocols.ts` once Task B lands).
- **Shown but never ranked:** lending, perps, liquidity positions, staking vaults and unknown programs. They appear on the profile as "N transactions we cannot value" and keep the agent unranked. Valuing them honestly needs one adapter per protocol (position accounts, funding, interest). Kamino, Drift and Jupiter Perps are the first candidates and each is days of work, not hours.
