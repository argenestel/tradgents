import { closeSync,existsSync,fsyncSync,lstatSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import type { SignerPolicy } from './policy.ts';
import { assertTradeLimits } from './validation.ts';

export interface SpendLedgerData {version:1;day:string;usedUsd:number;trades:{id:string;tsMs:number;usd:number;intentHash:string;poolLiquidityUsd?:number;gasReserveUsd?:number}[]}
const utcDay=(now:number)=>new Date(now).toISOString().slice(0,10);
function uid():number {return typeof process.getuid==='function'?process.getuid():-1;}
function alive(pid:number):boolean {try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code==='EPERM';}}
function withFileLock<T>(path:string,ownerUid:number,fn:()=>T):T {
  let fd:number|undefined;
  for(let attempt=0;attempt<200;attempt++){
    try{fd=openSync(path,'wx',0o600);writeFileSync(fd,`${process.pid}\n`);fsyncSync(fd);break;}
    catch(error){
      if(fd!==undefined){closeSync(fd);fd=undefined;try{unlinkSync(path);}catch{}}
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      const st=lstatSync(path);if(st.isSymbolicLink()||!st.isFile()||st.uid!==ownerUid||(st.mode&0o077)!==0)throw new Error('spend ledger lock is not a private signer-owned regular file');
      const pid=Number(readFileSync(path,'utf8').trim());if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('spend ledger lock is corrupt');
      if(!alive(pid)){try{unlinkSync(path);}catch{}continue;}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
    }
  }
  if(fd===undefined)throw new Error('timed out waiting for the spend ledger lock');
  try{return fn();}finally{closeSync(fd);try{if(Number(readFileSync(path,'utf8').trim())===process.pid)unlinkSync(path);}catch{}}
}
export function assertPrivateDirectory(path:string,ownerUid=uid()):void {
  const st=lstatSync(path);if(st.isSymbolicLink()||!st.isDirectory())throw new Error('signer directory must be a directory');
  if(st.uid!==ownerUid)throw new Error(`signer directory must be owned by uid ${ownerUid}`);
  if((st.mode&0o077)!==0)throw new Error('signer directory must not be accessible by group or others');
}
function validateData(v:unknown):SpendLedgerData {
  if(!v||typeof v!=='object')throw new Error('spend ledger is corrupt');const d=v as Record<string,unknown>;
  if(d.version!==1||typeof d.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.day)||typeof d.usedUsd!=='number'||!Number.isFinite(d.usedUsd)||d.usedUsd<0||!Array.isArray(d.trades))throw new Error('spend ledger is corrupt');
  let total=0;
  for(const item of d.trades){if(!item||typeof item!=='object')throw new Error('spend ledger is corrupt');const t=item as Record<string,unknown>;if(typeof t.id!=='string'||typeof t.tsMs!=='number'||!Number.isSafeInteger(t.tsMs)||Math.abs(t.tsMs)>8.64e15||typeof t.usd!=='number'||!Number.isFinite(t.usd)||t.usd<=0||typeof t.intentHash!=='string'||!/^0x[0-9a-f]{64}$/i.test(t.intentHash)||new Date(t.tsMs).toISOString().slice(0,10)!==d.day||t.poolLiquidityUsd!==undefined&&(typeof t.poolLiquidityUsd!=='number'||!Number.isFinite(t.poolLiquidityUsd)||t.poolLiquidityUsd<0)||t.gasReserveUsd!==undefined&&(typeof t.gasReserveUsd!=='number'||!Number.isFinite(t.gasReserveUsd)||t.gasReserveUsd<0))throw new Error('spend ledger is corrupt');total+=t.usd;}
  if(total!==d.usedUsd)throw new Error('spend ledger total does not reconcile');
  return d as unknown as SpendLedgerData;
}
export class SpendLedger {
  readonly path:string;
  constructor(private readonly directory:string,private readonly policy:SignerPolicy,private readonly ownerUid=uid()) {
    assertPrivateDirectory(directory,ownerUid);this.path=join(directory,'spend-ledger.json');
  }
  read(now=Date.now()):SpendLedgerData {
    if(!existsSync(this.path))return {version:1,day:utcDay(now),usedUsd:0,trades:[]};
    const st=lstatSync(this.path);if(st.isSymbolicLink()||!st.isFile()||st.uid!==this.ownerUid||(st.mode&0o077)!==0)throw new Error('spend ledger must be a private signer-owned regular file');
    const d=validateData(JSON.parse(readFileSync(this.path,'utf8')));
    const today=utcDay(now);if(d.day>today)throw new Error('system clock moved backwards relative to the spend ledger');
    if(d.day<today)return {version:1,day:today,usedUsd:0,trades:[]};return d;
  }
  reserve(usd:number,tradeId:string,intentHash:string,now=Date.now(),metadata:{poolLiquidityUsd?:number;gasReserveUsd?:number}={}):SpendLedgerData {
    return withFileLock(join(this.directory,'spend-ledger.lock'),this.ownerUid,()=>{
      const current=this.read(now);assertTradeLimits(this.policy,current.usedUsd,usd);
      const next:SpendLedgerData={version:1,day:utcDay(now),usedUsd:current.usedUsd+usd,trades:[...current.trades,{id:tradeId,tsMs:now,usd,intentHash,...metadata}]};
      this.atomicWrite(next);return next;
    });
  }
  private atomicWrite(data:SpendLedgerData):void {
    const temp=join(this.directory,`.spend-ledger.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
    const fd=openSync(temp,'wx',0o600);
    try{writeFileSync(fd,JSON.stringify(data));fsyncSync(fd);}finally{closeSync(fd);}
    renameSync(temp,this.path);
    const dirFd=openSync(dirname(this.path),'r');try{fsyncSync(dirFd);}finally{closeSync(dirFd);}
  }
}
