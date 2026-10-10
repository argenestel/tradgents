import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AgentError, expandPath, signerDir } from './config';
import { request } from './ipc';
import { loadPolicy } from './policy';

const pidSchema = z.object({ pid: z.number().int().positive(), instance: z.string().uuid() }).strict();
function readPid(file: string) {
  if (!fs.existsSync(file)) return undefined;
  try { return pidSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch { throw new AgentError('Invalid signer pid file. Owner must inspect it before starting or stopping.'); }
}
function ownsProcess(record: z.infer<typeof pidSchema>): boolean {
  try {
    process.kill(record.pid, 0);
    const command = process.platform === 'linux' ? fs.readFileSync(`/proc/${record.pid}/cmdline`, 'utf8').split('\0') : execFileSync('ps', ['-p', String(record.pid), '-o', 'command='], { encoding: 'utf8' }).trim().split(/\s+/);
    return command.includes('--signer-run') && command.includes(record.instance);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') throw new AgentError('Cannot verify signer process ownership. Owner diagnostics required.');
    return false;
  }
}
export async function managedSigner(action: string, dir = signerDir()) {
  dir = expandPath(dir);
  const pidfile = path.join(dir, 'signer.pid'), logfile = path.join(dir, 'signer.log');
  const existing = readPid(pidfile), running = existing ? ownsProcess(existing) : false;
  if (action === 'status') return { running, ...(running ? { pid: existing!.pid } : {}), log: logfile };
  if (action === 'stop') {
    if (!running) { fs.rmSync(pidfile, { force: true }); return { running: false }; }
    process.kill(existing!.pid, 'SIGTERM');
    for (let i = 0; i < 50 && ownsProcess(existing!); i++) await delay(100);
    if (ownsProcess(existing!)) throw new AgentError('Signer has not stopped yet. Inspect owner diagnostics; no forced kill was sent.');
    fs.rmSync(pidfile, { force: true });
    return { running: false };
  }
  if (action !== 'start') throw new AgentError('signer needs start, stop or status.');
  if (running) return { running: true, pid: existing!.pid, log: logfile };
  const policyFile = path.join(dir, 'policy.json'), policy = loadPolicy(policyFile);
  if (existing) fs.rmSync(pidfile, { force: true });
  // Exclusive lock prevents two owners from launching the same managed signer.
  const lock = path.join(dir, 'signer.start.lock');
  let lockFd: number;
  try { lockFd = fs.openSync(lock, 'wx', 0o600); } catch { throw new AgentError('Signer start is already in progress. Owner must inspect a stale start lock before removing it.'); }
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const logFd = fs.openSync(logfile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o600);
    fs.fchmodSync(logFd, 0o600);
    const instance = randomUUID(), entry = fileURLToPath(import.meta.url);
    const cliEntry = entry.endsWith('.ts') ? fileURLToPath(new URL('./cli.ts', import.meta.url)) : entry;
    try { child = spawn(process.execPath, [...(cliEntry.endsWith('.ts') ? ['--import', 'tsx'] : []), cliEntry, '--signer-run', '--policy', policyFile, '--instance', instance], { detached: true, stdio: ['ignore', logFd, logFd], env: process.env }); }
    finally { fs.closeSync(logFd); }
    let spawnError = false;
    child.on('error', () => { spawnError = true; });
    if (!child.pid) throw new AgentError('Could not launch signer. Check owner diagnostics.');
    const record = { pid: child.pid, instance };
    fs.writeFileSync(pidfile, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    for (let i = 0; i < 100; i++) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) break;
      if (fs.existsSync(policy.socketPath)) {
        try {
          const response = await request(policy.socketPath, { cmd: 'status' }, 500);
          if (response.ok && ownsProcess(record)) { child.unref(); return { running: true, pid: child.pid, log: logfile }; }
        } catch { /* Wait for readiness, not just process creation. */ }
      }
      await delay(100);
    }
    child.kill('SIGTERM'); fs.rmSync(pidfile, { force: true });
    throw new AgentError('Signer did not become ready. Check RPC/network and private owner log before retrying.');
  } finally {
    fs.closeSync(lockFd); fs.rmSync(lock, { force: true });
    child?.unref();
  }
}
