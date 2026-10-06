import { mkdtempSync,chmodSync,writeFileSync,unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect,it } from 'vitest';
import { DEFAULT_POLICY,parsePolicy } from '../src/policy.ts';
import { SpendLedger,assertPrivateDirectory } from '../src/spend-ledger.ts';
import { expectTypeOf } from 'vitest';

function setup(){const dir=mkdtempSync(join(tmpdir(),'signer-ledger-'));chmodSync(dir,0o700);const policy=parsePolicy({...DEFAULT_POLICY,perTradeLimitUsd:10,perDayLimitUsd:15});return {dir,policy};}
it('fsync-backed spend reservations survive restarts and reset on UTC day change',()=>{
  const {dir,policy}=setup(),uid=process.getuid?.()??-1,ledger=new SpendLedger(dir,policy,uid);
  const first=ledger.reserve(7,'trade-1',`0x${'01'.repeat(32)}`,Date.UTC(2025,0,1,12));expect(first.usedUsd).toBe(7);
  expect(new SpendLedger(dir,policy,uid).read(Date.UTC(2025,0,1,13)).usedUsd).toBe(7);
  expect(new SpendLedger(dir,policy,uid).read(Date.UTC(2025,0,2,0)).usedUsd).toBe(0);
  expect(()=>ledger.reserve(9,'trade-2',`0x${'02'.repeat(32)}`,Date.UTC(2025,0,1,13))).toThrow(/per-day/);
  expect(()=>ledger.reserve(11,'trade-3',`0x${'03'.repeat(32)}`,Date.UTC(2025,0,2,1))).toThrow(/per-trade/);
});
it('fails closed while another live process holds the cross-process reservation lock',()=>{
  const {dir,policy}=setup(),ledger=new SpendLedger(dir,policy),lock=join(dir,'spend-ledger.lock');
  writeFileSync(lock,`${process.pid}\n`,{mode:0o600});
  expect(()=>ledger.reserve(1,'blocked',`0x${'03'.repeat(32)}`,Date.UTC(2025,0,1))).toThrow(/timed out waiting/);
  expect(ledger.read(Date.UTC(2025,0,1)).usedUsd).toBe(0);unlinkSync(lock);
});
it('fails closed on group/world accessible directories or corrupt spend ledgers',()=>{
  const {dir,policy}=setup(),uid=process.getuid?.()??-1;expect(()=>assertPrivateDirectory(dir,uid)).not.toThrow();chmodSync(dir,0o755);expect(()=>assertPrivateDirectory(dir,uid)).toThrow(/accessible/);chmodSync(dir,0o700);
  writeFileSync(join(dir,'spend-ledger.json'),'{bad',{mode:0o600});const ledger=new SpendLedger(dir,policy,uid);expect(()=>ledger.read()).toThrow();
});
