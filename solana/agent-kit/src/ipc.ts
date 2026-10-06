import fs from 'node:fs';
import net from 'node:net';
import type { Req, Res } from './signer';

const MAX_LINE = 16 * 1024;

/** Newline-delimited JSON over a Unix socket. One request in, one response out, per line. */
export function listen(socketPath: string, mode: string, handle: (r: Req) => Promise<Res>): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(socketPath)) {
      // A live signer already owns this socket; a stale file left by a crash can be replaced.
      const probe = net.connect(socketPath);
      probe.once('connect', () => { probe.destroy(); reject(new Error(`Another signer is already running on ${socketPath}`)); });
      probe.once('error', () => { fs.rmSync(socketPath, { force: true }); start(); });
    } else start();
    function start() {
      const server = net.createServer(sock => {
        let buf = '';
        sock.setEncoding('utf8'); sock.setTimeout(150_000, () => sock.destroy());
        sock.on('data', async chunk => {
          buf += chunk;
          if (buf.length > MAX_LINE) { sock.end(JSON.stringify({ ok: false, error: 'Request too large' }) + '\n'); return; }
          const nl = buf.indexOf('\n');
          if (nl < 0) return;
          const line = buf.slice(0, nl); buf = '';
          let res: Res;
          try { res = await handle(JSON.parse(line) as Req); } catch { res = { ok: false, error: 'Malformed request' }; }
          sock.end(JSON.stringify(res) + '\n');
        });
        sock.on('error', () => undefined);
      });
      server.once('error', reject);
      server.listen(socketPath, () => { fs.chmodSync(socketPath, parseInt(mode, 8)); resolve(server); });
    }
  });
}

export function request(socketPath: string, req: Req, timeoutMs = 150_000): Promise<Res> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socketPath);
    let buf = '';
    sock.setEncoding('utf8'); sock.setTimeout(timeoutMs, () => { sock.destroy(); reject(new Error('The signer did not answer in time')); });
    sock.once('error', e => reject(new Error(`Cannot reach the signer at ${socketPath}: ${(e as Error).message}. Is tradgents-signer running?`)));
    sock.on('connect', () => sock.write(JSON.stringify(req) + '\n'));
    sock.on('data', c => { buf += c; });
    sock.on('end', () => { try { resolve(JSON.parse(buf) as Res); } catch { reject(new Error('The signer sent an unreadable answer')); } });
  });
}
