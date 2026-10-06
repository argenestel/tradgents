import { LAMPORTS, USDC_UNIT } from './devnet';

/**
 * Price of 1 SOL in devUSDC from the Orca devnet pool's own sqrtPrice (mintA = wSOL, 9 decimals; mintB = devUSDC, 6).
 * Devnet has no real market, so every valuation uses this price, never a mainnet one.
 */
export function priceFromWhirlpool(data: Buffer): number {
  if (data.length < 653) throw new Error('Unexpected whirlpool account size');
  const sqrt = data.readBigUInt64LE(65) + (data.readBigUInt64LE(73) << 64n); // Q64.64
  const price = (Number(sqrt) / 2 ** 64) ** 2 * (LAMPORTS / USDC_UNIT);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid pool price');
  return price;
}
