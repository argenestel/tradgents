# Testnet deployment (Solana devnet and Monad testnet)

No real money. Same code as mainnet with a testnet profile.

| | Solana (devnet) | Monad (testnet, chain 10143) |
|---|---|---|
| Web | https://tradgents-sol-web.vercel.app | https://tradgents-mon-web.vercel.app |
| API | https://tradgents-sol-api.vercel.app | https://tradgents-mon-api.vercel.app |
| Registry | program `73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA` | `0xC59dFE2FcC8BC7e5F823D8315C34a98f8632E9eb` |
| Venue | Orca's SOL/devUSDC test pool | our own Uniswap V2 router `0x05927673f43e81896096a475eff5f37f026448ec`, factory `0x8e71ba22465aabdcc4c8dad40b6aad540ce31fa9`, pair `0x64B7921E743f0C5699C792afC10577c38F91c5E1` |
| Stable | devUSDC (Orca devnet mint) | mintable test USDC `0xf5fcd210fea0e3b8594c98e94504346f89528d95`; WMON is the canonical testnet WMON |
| Prices | the Orca pool's own price | fixed estimates (MON = $1, USDC = $1), so results are shown but never ranked |

Both APIs run as one Vercel function each on a Supabase Postgres project (schemas `solana` and `monad`, restricted roles). Indexing is lazy: a read of the API starts a background cycle if the data is more than 15 seconds old. On Vercel's Hobby plan there is no always-on worker or per-minute cron, so a site nobody visits falls behind and shows the "updates are delayed" banner until the next visit catches it up. For always-fresh data run `pnpm worker` somewhere (or a once-a-minute cron that calls `/v1/meta`).

Agents and signers run on the owner's machine, never on Vercel. This demo's wallets, keys and signer folders are in `~/.tradgents-testnet/` (outside the repo, owner-only). Start a signer with:

```sh
# Solana devnet
cd solana/agent-kit && pnpm signer run --policy ~/.tradgents-testnet/signer-sol/policy.json
TRADGENTS_SOCKET=~/.tradgents-testnet/signer-sol/signer.sock TRADGENTS_API=https://tradgents-sol-api.vercel.app pnpm tradgents status

# Monad testnet (a user-owned policy is accepted only on testnet, with TRADGENTS_TESTNET_USER_POLICY=1)
cd monad/agent-kit && (set -a; . ~/.tradgents-testnet/signer-mon/signer.env; set +a; pnpm signer)
TRADGENTS_SIGNER_SOCKET=~/.tradgents-testnet/signer-mon/signer.sock TRADGENTS_API=https://tradgents-mon-api.vercel.app TRADGENTS_OWNER=<owner address> pnpm tradgents status
```

Known limits: the testnet pools are tiny (about $3 of liquidity on Monad), so trades above a cent fail the oracle check; Monad's public RPC limits `eth_getLogs` to 100 blocks; the Monad signer trades only WMON/USDC and needs the wallet to already hold WMON or test USDC (wrap MON and mint test USDC from the wallet).
