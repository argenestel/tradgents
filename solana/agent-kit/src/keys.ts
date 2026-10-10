import fs from 'node:fs';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function encodeBase58(bytes: Uint8Array): string {
  let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0')), out = '';
  while (n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  let zeros = 0; while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return '1'.repeat(zeros) + out;
}
export function readKeypair(file: string): Uint8Array {
  const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw) || raw.length !== 64 || !raw.every(b => Number.isInteger(b) && b >= 0 && b <= 255)) throw new Error('Keypair file must be a 64-byte Solana JSON keypair');
  const bytes = Uint8Array.from(raw);
  const publicBytes = createPublicKey(privateKey(bytes)).export({ format: 'der', type: 'spki' }).subarray(-32);
  if (!publicBytes.equals(Buffer.from(bytes.subarray(32)))) throw new Error('Keypair public key does not match the secret');
  return bytes;
}

function privateKey(bytes: Uint8Array) {
  return createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(bytes.subarray(0, 32))]), format: 'der', type: 'pkcs8' });
}
export function signClaim(bytes: Uint8Array, message: string): string {
  if (!/^tradgents:register:[0-9a-f-]{36}:\d{13}$/.test(message)) throw new Error('Invalid registration challenge');
  return sign(null, Buffer.from(message, 'utf8'), privateKey(bytes)).toString('base64');
}
export function decodeBase58(value: string): Uint8Array {
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(value) || value.length > 128) throw new Error('Invalid base58 value');
  let n = 0n;
  for (const c of value) n = n * 58n + BigInt(B58.indexOf(c));
  const hex = n.toString(16);
  const tail = n === 0n ? Buffer.alloc(0) : Buffer.from(hex.padStart(Math.ceil(hex.length / 2) * 2, '0'), 'hex');
  return Buffer.concat([Buffer.alloc(value.match(/^1*/)?.[0].length ?? 0), tail]);
}
