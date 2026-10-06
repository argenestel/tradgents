import { chmodSync,mkdtempSync,existsSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { expect,it } from 'vitest';
import { acquireSignerLock,assertSocketNotLive } from '../src/signer.ts';

function directory(){const dir=mkdtempSync(join(tmpdir(),'signer-safe-'));chmodSync(dir,0o700);return dir;}
it('holds the signer lock exclusively and recovers a dead pid lock',()=>{
  const dir=directory(),release=acquireSignerLock(dir);
  expect(()=>acquireSignerLock(dir)).toThrow(/another signer process/);
  release();expect(existsSync(join(dir,'signer.lock'))).toBe(false);
  writeFileSync(join(dir,'signer.lock'),'2147483647\n',{mode:0o600});
  const recovered=acquireSignerLock(dir);expect(existsSync(join(dir,'signer.lock'))).toBe(true);recovered();
});
it('refuses to unlink a socket that accepts connections and removes a stale owned socket',async()=>{
  const dir=directory(),path=join(dir,'signer.sock'),server=createServer();
  await new Promise<void>(resolve=>server.listen(path,resolve));
  await expect(assertSocketNotLive(path)).rejects.toThrow(/already accepts connections/);
  expect(existsSync(path)).toBe(true);
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  await assertSocketNotLive(path);expect(existsSync(path)).toBe(false);
});
