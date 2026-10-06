import {
  AccountRole, address, appendTransactionMessageInstructions, compressTransactionMessageUsingAddressLookupTables, createKeyPairSignerFromBytes, createSolanaRpc,
  createTransactionMessage, mainnet, fetchAddressesForLookupTables, getBase64EncodedWireTransaction, getSignatureFromTransaction, pipe,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
  type Address, type Instruction,
} from '@solana/kit';
import type { JupIx } from './validate';

export interface AcctInfo { lamports: bigint; owner: string; data: Buffer }
export interface Chain {
  genesis(): Promise<string>;
  accounts(addrs: string[]): Promise<(AcctInfo | null)[]>;
  /** Compile, sign with the signer's key and return the wire transaction. The key never leaves this object. */
  buildSigned(ixs: JupIx[], lookupTables: string[]): Promise<{ wire: string; signature: string }>;
  simulate(wire: string, addrs: string[]): Promise<{ err: unknown; logs: string[]; accounts: (AcctInfo | null)[] }>;
  send(wire: string, signature: string): Promise<void>;
}

const roleOf = (a: { isSigner: boolean; isWritable: boolean }) =>
  a.isSigner ? (a.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER) : (a.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY);
const decode = (v: { lamports: bigint | number; owner: string; data: [string, string] } | null): AcctInfo | null =>
  v ? { lamports: BigInt(v.lamports), owner: v.owner, data: Buffer.from(v.data[0], 'base64') } : null;

export async function solanaChain(rpcUrl: string, secret: Uint8Array): Promise<Chain & { wallet: string }> {
  const rpc = createSolanaRpc(mainnet(rpcUrl));
  const signer = await createKeyPairSignerFromBytes(secret);
  return {
    wallet: signer.address,
    genesis: async () => (await rpc.getGenesisHash().send()) as string,
    async accounts(addrs) {
      if (!addrs.length) return [];
      const r = await rpc.getMultipleAccounts(addrs.map(a => address(a)), { encoding: 'base64', commitment: 'confirmed' }).send();
      return r.value.map(v => decode(v as never));
    },
    async buildSigned(ixs, lookupTables) {
      const { value: bh } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
      const instructions: Instruction[] = ixs.map(ix => ({
        programAddress: address(ix.programId), data: new Uint8Array(Buffer.from(ix.data, 'base64')),
        accounts: ix.accounts.map(a => a.isSigner && a.pubkey === signer.address ? { address: address(a.pubkey), role: roleOf(a), signer } : { address: address(a.pubkey), role: roleOf(a) }) as never,
      }));
      let msg = pipe(createTransactionMessage({ version: 0 }), m => setTransactionMessageFeePayerSigner(signer, m), m => setTransactionMessageLifetimeUsingBlockhash(bh, m), m => appendTransactionMessageInstructions(instructions, m));
      if (lookupTables.length) {
        const tables = await fetchAddressesForLookupTables(lookupTables.map(a => address(a)) as Address[], rpc as never);
        msg = compressTransactionMessageUsingAddressLookupTables(msg as never, tables) as never;
      }
      const signed = await signTransactionMessageWithSigners(msg as never);
      return { wire: getBase64EncodedWireTransaction(signed), signature: getSignatureFromTransaction(signed) };
    },
    async simulate(wire, addrs) {
      const r = await rpc.simulateTransaction(wire as never, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: addrs.map(a => address(a)) } }).send();
      return { err: r.value.err, logs: (r.value.logs ?? []) as string[], accounts: (r.value.accounts ?? []).map(v => decode(v as never)) };
    },
    async send(wire, signature) {
      await rpc.sendTransaction(wire as never, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3n } as never).send();
      const deadline = Date.now() + 75_000; // a blockhash is valid for roughly 60 to 90 seconds
      while (Date.now() < deadline) {
        const st = (await rpc.getSignatureStatuses([signature as never], { searchTransactionHistory: false }).send()).value[0];
        if (st?.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(st.err, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`);
        if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return;
        await new Promise(r => setTimeout(r, 1000));
      }
      throw new Error(`Transaction ${signature} was not confirmed in time; check the explorer before retrying`);
    },
  };
}
