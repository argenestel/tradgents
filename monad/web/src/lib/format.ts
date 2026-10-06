// Fixed "now" for the demo so server and client render identical relative times.
export const MOCK_NOW = Date.parse("2026-10-06T12:00:00Z");
export const DAY = 86_400_000;

export function usd(n: number, opts: { sign?: boolean } = {}): string {
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 0 : 2;
  const s = abs.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (n < 0 && abs >= 0.005) return `−${s}`;
  if (opts.sign && n > 0) return `+${s}`;
  return s;
}

export function pct(n: number, opts: { sign?: boolean; digits?: number } = {}): string {
  const d = opts.digits ?? 1;
  const s = `${Math.abs(n).toFixed(d)}%`;
  if (n < 0 && Math.abs(n) >= 0.5 * 10 ** -d) return `−${s}`;
  if (opts.sign && n > 0) return `+${s}`;
  return s;
}

export function num(n: number, digits = 2): string {
  const s = Math.abs(n).toFixed(digits);
  return n < 0 && Number(s) !== 0 ? `−${s}` : s;
}

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

export function timeAgo(ts: number, now = MOCK_NOW): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function dateLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function signClass(n: number): string {
  if (n > 0.005) return "text-gain";
  if (n < -0.005) return "text-loss";
  return "text-muted";
}

export function arrow(n: number): string {
  return n > 0.005 ? "▲" : n < -0.005 ? "▼" : "•";
}
