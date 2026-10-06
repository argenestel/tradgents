import fs from 'node:fs';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function encodeBase58(bytes: Uint8Array): string {
  let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0')), out = '';
  while (n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  let zeros = 0; while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return '1'.repeat(zeros) + out;
}
export function readKeypair(file: string): Uint8Array {
  const bytes = Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')) as number[]);
  if (bytes.length !== 64) throw new Error('Keypair file must be a 64-byte Solana JSON keypair');
  return bytes;
}
