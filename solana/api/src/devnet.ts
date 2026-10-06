import { WSOL } from './config';
import { priceFromWhirlpool } from './pool';
import { FixedPrices, type PriceQuote, type PriceSource } from './prices';
import type { Rpc } from './rpc';

export const ORCA_POOL = '3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt'; // Orca devnet SOL/devUSDC
export const ORCA_POOL_NOTE = "devUSDC at Orca's devnet pool price (devnet has no real market)";

/** Devnet has no market, so SOL is priced from the Orca devnet pool itself. Tokens other than devUSDC have no price. */
export class OrcaDevnetPrices implements PriceSource {
  constructor(private readonly rpc: Rpc) {}
  async get(mints: string[]): Promise<Map<string, PriceQuote>> {
    const info = await this.rpc.call<{ value: { data: [string, string] } | null }>('getAccountInfo', [ORCA_POOL, { encoding: 'base64', commitment: 'finalized' }]);
    if (!info.value) throw new Error('Orca devnet pool account not found');
    return new FixedPrices({ [WSOL]: priceFromWhirlpool(Buffer.from(info.value.data[0], 'base64')) }).get(mints);
  }
}
