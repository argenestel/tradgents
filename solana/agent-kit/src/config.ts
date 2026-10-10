import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const DEFAULT_API = 'https://tradgents-sol-api.vercel.app';
export const networkSchema = z.enum(['mainnet-beta', 'devnet']);
export type Network = z.infer<typeof networkSchema>;
export const expandPath = (file: string) => path.resolve(file.replace(/^~(?=\/)/, os.homedir()));
export const signerDir = () => expandPath(process.env.TRADGENTS_SIGNER_DIR ?? path.join(os.homedir(), '.tradgents-signer'));
export const clientDir = () => expandPath(process.env.TRADGENTS_HOME ?? path.join(os.homedir(), '.tradgents'));
export const socketPath = () => process.env.TRADGENTS_SOCKET ?? path.join(signerDir(), 'signer.sock');
/** The installer sets TRADGENTS_NETWORK to the network of the site it came from. */
export const defaultNetwork = (): Network => networkSchema.parse(process.env.TRADGENTS_NETWORK ?? 'mainnet-beta');
export const apiBase = () => (process.env.TRADGENTS_API ?? DEFAULT_API).replace(/\/$/, '');

/** Only deliberately public messages may be returned to an agent. */
export class AgentError extends Error {}
export function safeError(error: unknown): string {
  if (error instanceof AgentError) return error.message;
  if (error instanceof z.ZodError) return 'Invalid input. Check the command or tool schema.';
  return 'Operation failed. Check connectivity and owner diagnostics; do not retry a swap until its outcome is known.';
}
