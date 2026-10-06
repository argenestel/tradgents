import { hashStr } from "@/lib/rng";
import { PROTOCOLS } from "@/lib/protocols";
import type { ProtocolId } from "@/lib/types";

/** Simple geometric marks (24×24, drawn white on a coloured disc). Original shapes, not real brand logos. */
const GLYPHS: Record<string, React.ReactNode> = {
  wings: <path d="M12 12C9 5 3.5 5.5 4.5 10c.7 3.3 4.6 3.6 7.5 2Zm0 0c3-7 8.5-6.5 7.5-2-.7 3.3-4.6 3.6-7.5 2Zm0 .6c-3 .1-5.6 2.4-4.4 5.2.9 2 3.7 1.4 4.4-5.2Zm0 0c3 .1 5.6 2.4 4.4 5.2-.9 2-3.7 1.4-4.4-5.2Z" />,
  triangle: <path d="M12 4.5 20 19H4L12 4.5Zm0 5.2L8.3 16.5h7.4L12 9.7Z" fillRule="evenodd" />,
  waves: <path d="M3 9c3-3 6 3 9 0s6 3 9 0v2.4c-3 3-6-3-9 0s-6-3-9 0V9Zm0 5.6c3-3 6 3 9 0s6 3 9 0V17c-3 3-6-3-9 0s-6-3-9 0v-2.4Z" />,
  cube: <path d="M12 3.5 19.5 8v8L12 20.5 4.5 16V8L12 3.5Zm0 2.3L6.6 9 12 12.2 17.4 9 12 5.8ZM6 10.8v4.1l5 3v-4.2l-5-2.9Zm12 0-5 2.9v4.2l5-3v-4.1Z" fillRule="evenodd" />,
  ring: <path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 3.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Z" fillRule="evenodd" />,
  diamond: <path d="M12 3.5 20.5 12 12 20.5 3.5 12 12 3.5Zm0 4.6L8.1 12l3.9 3.9 3.9-3.9L12 8.1Z" fillRule="evenodd" />,
  spark: <path d="M12 3c.8 5.2 3.8 8.2 9 9-5.2.8-8.2 3.8-9 9-.8-5.2-3.8-8.2-9-9 5.2-.8 8.2-3.8 9-9Z" />,
  bars: <path d="M5 13h3v6H5v-6Zm5.5-8h3v14h-3V5ZM16 9h3v10h-3V9Z" />,
};
const GLYPH_KEYS = Object.keys(GLYPHS);

const PROTOCOL_GLYPH: Record<string, string> = {
  // Monad
  kuru: "ring", uniswap: "spark", morpho: "wings", curvance: "diamond", magma: "triangle", upshift: "bars", perpl: "waves", nadfun: "cube",
  // Solana
  jupiter: "spark", kamino: "diamond", drift: "waves", marinade: "triangle", meteora: "wings", orca: "ring", raydium: "triangle", other: "diamond", pumpfun: "cube", jito: "bars",
};

function Mark({ glyph, size, className = "" }: { glyph: string; size: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden className={className}>
      {GLYPHS[glyph]}
    </svg>
  );
}

/** Tradgents mark: a confidence interval — whiskers with the point estimate. */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden>
      <path d="M3 16h26M3 8.5v15M29 8.5v15" stroke="var(--fg)" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="19.5" cy="16" r="5.6" fill="var(--accent)" />
    </svg>
  );
}

const AVATAR_COLORS = ["#2036e6", "#0c1633", "#0e6b5c", "#6a2c70", "#126e82", "#1e5aa8", "#4b5fd1", "#2b5d34"];

/** Agent avatar: flat tile with a geometric mark chosen from the name. */
export function AgentGlyph({ name, size = 36 }: { name: string; size?: number }) {
  const glyph = GLYPH_KEYS[hashStr(name) % GLYPH_KEYS.length];
  const bg = AVATAR_COLORS[hashStr(name + "c") % AVATAR_COLORS.length];
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center text-white" style={{ width: size, height: size, background: bg, borderRadius: Math.round(size * 0.24) }}>
      <Mark glyph={glyph} size={size * 0.58} />
    </span>
  );
}

/** Protocol logo disc (original mark in the protocol's brand colour). */
export function ProtocolLogo({ id, size = 22 }: { id: ProtocolId; size?: number }) {
  const p = PROTOCOLS[id];
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full text-white" style={{ width: size, height: size, background: p.color }}>
      <Mark glyph={PROTOCOL_GLYPH[id] ?? GLYPH_KEYS[hashStr(id) % GLYPH_KEYS.length]} size={size * 0.62} />
    </span>
  );
}

const TOKEN_STYLE: Record<string, { bg: string; fg?: string; glyph?: string }> = {
  MON: { bg: "#6b4ef6", glyph: "ring" },
  gMON: { bg: "#0e1a30", glyph: "triangle" },
  USDC: { bg: "#2775ca" },
  AUSD: { bg: "#2775ca" },
  WETH: { bg: "#4b5563", glyph: "diamond" },
  WBTC: { bg: "#e08a1e" },
  SOL: { bg: "#7a4cf0", glyph: "bars" },
  mSOL: { bg: "#0f766e", glyph: "triangle" },
  JitoSOL: { bg: "#3f6212", glyph: "bars" },
  JUP: { bg: "#0f766e", glyph: "spark" },
};

/** Token icon disc. */
export function TokenIcon({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const t = TOKEN_STYLE[symbol] ?? { bg: `hsl(${hashStr(symbol) % 360} 45% 38%)` };
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full font-mono font-bold text-white" style={{ width: size, height: size, background: t.bg, fontSize: size * 0.4 }}>
      {t.glyph ? <Mark glyph={t.glyph} size={size * 0.58} /> : symbol.replace(/^[a-z]+/, "").slice(0, 1) || symbol[0]}
    </span>
  );
}
