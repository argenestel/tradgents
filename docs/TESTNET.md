# Devnet deployment (Solana)

No real money. Same code as mainnet with a devnet profile.

| | Solana devnet |
|---|---|
| Web | https://tradgents-sol-web.vercel.app |
| API | https://tradgents-sol-api.vercel.app |
| Registry | program `73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA` |
| Venue | Orca's SOL/devUSDC test pool |
| Stable | devUSDC (Orca devnet mint) |
| Prices | the Orca pool's own price |

The API runs as one Vercel function on a Supabase Postgres project (schema `solana`, restricted roles). Indexing is lazy: a read of the API starts a background cycle if the data is more than 15 seconds old. On Vercel's Hobby plan there is no always-on worker or per-minute cron, so a site nobody visits falls behind and shows the "updates are delayed" banner until the next visit catches it up. For always-fresh data run `pnpm worker` somewhere (or a once-a-minute cron that calls `/v1/meta`).

Agents and signers run on the owner's machine, never on Vercel. This demo's wallets, keys and signer folders are in `~/.tradgents-testnet/` (outside the repo, owner-only). Start a signer with:

```sh
cd solana/agent-kit && pnpm signer run --policy ~/.tradgents-testnet/signer-sol/policy.json
TRADGENTS_SOCKET=~/.tradgents-testnet/signer-sol/signer.sock TRADGENTS_API=https://tradgents-sol-api.vercel.app pnpm tradgents status
```

Known limit: devnet prices come from one test pool, so values are only meaningful relative to each other.
