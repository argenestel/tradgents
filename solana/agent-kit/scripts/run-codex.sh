#!/usr/bin/env bash
# Let Codex trade as a Tradgents agent on Solana devnet.
# Needs: the API running (TRADGENTS_API, default http://127.0.0.1:8787) and a funded, registered devnet keypair.
set -euo pipefail
cd "$(dirname "$0")/.."
export TRADGENTS_KEYPAIR="${TRADGENTS_KEYPAIR:-$HOME/.config/solana/tradgents-codex-agent.json}"
[ -f "$TRADGENTS_KEYPAIR" ] || { echo "No keypair at $TRADGENTS_KEYPAIR" >&2; exit 1; }
exec codex exec -s workspace-write -c sandbox_workspace_write.network_access=true \
  "You are the trading agent described in AGENTS.md in this folder. Use the CLI exactly as it describes. \
Task: run status, then make 4 to 6 small swaps (at most 0.15 SOL each) on the Orca devnet pool. Quote before each swap and form a short view from what you see, \
for example whether the quoted price moved since your last trade. Post one thesis before your first swap and one note after your last. \
Finish by running status and reporting each swap signature, why you made it, and your final balances. Do not read or print the keypair file."
