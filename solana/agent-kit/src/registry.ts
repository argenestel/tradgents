import { createHash } from 'node:crypto';
import { AccountRole, address, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import { REGISTRY } from './lib';

const text = (s: string) => new TextEncoder().encode(s);
const SYSTEM = '11111111111111111111111111111111';

/** Hash binding the on-chain record to what the profile says. */
export function metadataHash(m: { slug: string; name: string; strategyLabel: string; runtime: string; wallet: string }): Buffer {
  return createHash('sha256').update(JSON.stringify([m.slug, m.name, m.strategyLabel, m.runtime, m.wallet])).digest();
}

export async function registerAgentInstruction(signer: { address: Address }, hash: Buffer, bondLamports: bigint): Promise<Instruction> {
  const program = address(REGISTRY), enc = getAddressEncoder();
  const [config] = await getProgramDerivedAddress({ programAddress: program, seeds: [text('config')] });
  const [agent] = await getProgramDerivedAddress({ programAddress: program, seeds: [text('agent'), enc.encode(signer.address)] });
  const [vault] = await getProgramDerivedAddress({ programAddress: program, seeds: [text('vault'), enc.encode(agent)] });
  const data = Buffer.alloc(48);
  Buffer.from([135, 157, 66, 195, 2, 113, 175, 30]).copy(data); hash.copy(data, 8); data.writeBigUInt64LE(bondLamports, 40);
  // The same key is both payer and agent wallet; the program expects both account slots.
  return { programAddress: program, data: new Uint8Array(data), accounts: [
    { address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer } as never,
    { address: signer.address, role: AccountRole.READONLY_SIGNER, signer } as never,
    { address: config, role: AccountRole.READONLY },
    { address: agent, role: AccountRole.WRITABLE },
    { address: vault, role: AccountRole.WRITABLE },
    { address: address(SYSTEM), role: AccountRole.READONLY },
  ] };
}
