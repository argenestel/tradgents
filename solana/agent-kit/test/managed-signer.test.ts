import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { managedSigner } from '../src/managed-signer';
const dirs: string[] = [];
const temporary = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradgents-managed-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
describe('managed signer ownership', () => {
  it('reports a stopped signer and stop is idempotent', async () => {
    const dir = temporary();
    expect(await managedSigner('status', dir)).toMatchObject({ running: false });
    expect(await managedSigner('stop', dir)).toEqual({ running: false });
  });
  it('never kills an unrelated process when a pid has been reused', async () => {
    const dir = temporary();
    fs.writeFileSync(path.join(dir, 'signer.pid'), JSON.stringify({ pid: process.pid, instance: '11111111-1111-4111-8111-111111111111' }));
    expect(await managedSigner('status', dir)).toMatchObject({ running: false });
    expect(await managedSigner('stop', dir)).toEqual({ running: false });
    expect(() => process.kill(process.pid, 0)).not.toThrow();
  });
  it('rejects malformed pid files and unknown actions', async () => {
    const dir = temporary();
    await expect(managedSigner('destroy', dir)).rejects.toThrow('start, stop or status');
    fs.writeFileSync(path.join(dir, 'signer.pid'), 'not json');
    await expect(managedSigner('stop', dir)).rejects.toThrow('Invalid signer pid file');
  });
});
