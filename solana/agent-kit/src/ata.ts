import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { PROGRAMS } from './validate';

/** Associated token account address of `owner` for `mint`. */
export async function deriveAta(owner: string, mint: string, program: string = PROGRAMS.token): Promise<string> {
  const enc = getAddressEncoder();
  const [addr] = await getProgramDerivedAddress({ programAddress: address(PROGRAMS.ata), seeds: [enc.encode(address(owner)), enc.encode(address(program)), enc.encode(address(mint))] });
  return addr;
}
