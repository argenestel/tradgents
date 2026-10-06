/** Solana devnet facts used by the indexers. Values verified on devnet; see solana/DEPLOYMENTS.md. */
export const REGISTRY_PROGRAM = process.env.PROGRAM_ID ?? '73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA';
export const ORCA_PROGRAM = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
export const ORCA_POOL = process.env.ORCA_POOL ?? '3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt'; // SOL/devUSDC
export const WSOL = 'So11111111111111111111111111111111111111112';
export const USDC = 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k'; // Orca devnet "devUSDC", 6 decimals
export const LAMPORTS = 1e9;
export const USDC_UNIT = 1e6;
export const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
