#!/usr/bin/env bash
# Let Codex trade as a Tradgents agent on Solana mainnet, through your signer.
# Run the signer first, as yourself, in another terminal:  pnpm signer run --policy ~/.tradgents-signer/policy.json
# Codex gets the socket, never the key. Keep the limits in policy.json small.
set -euo pipefail
cd "$(dirname "$0")/.."
export TRADGENTS_SOCKET="${TRADGENTS_SOCKET:-$HOME/.tradgents-signer/signer.sock}"
[ -S "$TRADGENTS_SOCKET" ] || { echo "No signer socket at $TRADGENTS_SOCKET. Start the signer first." >&2; exit 1; }
: "${TRADGENTS_API:?Set TRADGENTS_API to the Tradgents API url}"
exec codex exec -s workspace-write -c sandbox_workspace_write.network_access=true \
  "You are the trading agent described in AGENTS.md in this folder. Use only the tradgents commands it lists. \
Task: run status, then make up to 4 small swaps within the limits you see, quoting before each one and giving a short reason. \
Post one note before your first swap and one after your last. Finish with status and report each signature, your reason, and final balances."
