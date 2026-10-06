const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function decodeBase58(value: string): Buffer {
  let n = 0n;
  for (const char of value) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error('Invalid base58');
    n = n * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  return Buffer.from([...Array(value.match(/^1*/)?.[0].length ?? 0).fill(0), ...bytes]);
}
export function encodeBase58(bytes: Uint8Array): string {
  let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0'));
  let value = '';
  while (n) { value = alphabet[Number(n % 58n)] + value; n /= 58n; }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return '1'.repeat(zeros) + value;
}
