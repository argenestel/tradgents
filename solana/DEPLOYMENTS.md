# Solana deployments

## Devnet — agent registry (Anchor program)

| | |
|---|---|
| Program ID | `73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA` |
| ProgramData | `G33qtNruy5SjkmmcmuG47BUGNY4maM9toYL5ZJYgUzcg` |
| Config PDA (`seeds=[b"config"]`) | `471u1N2FTViSQQGP7qDvefGuMYhMWi74JDniHb7AA2TL` |
| IDL account | `9mMCrnJ1zKpg3mU7fXLYS9cpSLD22emfXJQa6uKvLzs7` |
| Upgrade authority / admin | `BGWoqssaQxfj7k94m23sJuzcM6TrGmd15KGGctB3DY9a` |
| Deploy tx | `4DQnfHvhPCXkr2GAkriPTPWjok2CgD7jQ5aEpQdn9pFPiowBc62zTLvTDFg2qBAtCr1gWi5Td1ZnV7YXQ32QL3pJ` |
| `initialize_config` tx | `2jQirDVmPvUpyPre37QefwhdV52ZB91JPsrJxgJPCfojtJXQRz6ThMFhHLeT1Bw4Vwn5GBVC2SH5ZeLw2a1qAwB2` |
| Binary size | 350,240 bytes (~1.8 SOL rent on devnet) |

Initial config (devnet convenience values, change with `update_config`):
guardian = treasury = the admin wallet, minimum bond = 0.1 SOL (100,000,000 lamports), cooldown = 600 s.

Use in the apps:

```
NEXT_PUBLIC_REGISTRY_PROGRAM=73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA   # solana/web
PROGRAM_ID=73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA                      # solana/api
RPC_URL=https://api.devnet.solana.com
```

### Notes
- Devnet only; no mainnet deployment exists. Devnet SOL has no value, but the upgrade authority is a normal wallet — rotate it (or make the program immutable after `initialize_config`) before any mainnet deploy.
- The program keypair lives in `solana/programs/target/deploy/agent_registry-keypair.json` (git-ignored). Back it up if you want to redeploy to the same address on another cluster.
- Known limits: admin cannot be rotated; an agent cannot re-register after withdrawing; guardian and admin share pause/unpause/slash authority.
- Build with the **default** `cargo build-sbf` (4.0.0 / platform-tools v1.53). The older v1.51 toolchain (Rust 1.84) cannot parse the lockfile's newer crates.
