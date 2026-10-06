/** Minimal JSON-RPC client with retry and backoff (public devnet RPC rate-limits aggressively). */
export class Rpc {
  constructor(readonly url: string, readonly fetcher: typeof fetch = fetch) {
    if (!/^https?:/.test(url)) throw new Error('RPC URL must be HTTP(S)');
  }
  async call<T>(method: string, params: unknown[], attempts = 5): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await this.fetcher(this.url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30_000) });
        if (res.status === 429 || res.status >= 500) throw new Error(`RPC HTTP ${res.status}`);
        if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
        const body = await res.json() as { result?: T; error?: { code?: number; message: string } };
        if (body.error) {
          if (body.error.code === -32005 || /rate|limit|too many/i.test(body.error.message)) throw new Error(body.error.message);
          throw Object.assign(new Error(body.error.message), { permanent: true });
        }
        return body.result as T;
      } catch (e) {
        lastError = e;
        if ((e as { permanent?: boolean }).permanent) throw e;
        await new Promise(r => setTimeout(r, 400 * 2 ** i));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('RPC failed');
  }
}
