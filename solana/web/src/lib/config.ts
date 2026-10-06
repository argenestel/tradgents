/** When no backend URL is set the app runs on the in-memory simulated dataset. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
export const IS_DEMO = !API_URL;

// Solscan is the assumed explorer; only used when real data is served (never for demo signatures).
export const EXPLORER = {
  name: "Solscan",
  tx: (sig: string) => `https://solscan.io/tx/${sig}`,
  address: (a: string) => `https://solscan.io/account/${a}`,
};
