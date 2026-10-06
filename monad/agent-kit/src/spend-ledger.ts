import { closeSync,existsSync,fsyncSync,lstatSync,openSync,readFileSync,renameSync,writeFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import type { SignerPolicy } from './policy.ts';
import { assertTradeLimits } from './validation.ts';

export interface SpendLedgerData {version:1;day:string;usedUsd:number;trades:{id:string;tsMs:number;usd:number;intentHash:string}[]}
const utcDay=(now:number)=>new Date(now).toISOString().slice(0,10);
function uid():number {return typeof process.getuid==='function'?process.getuid():-1;}
export function assertPrivateDirectory(path:string,ownerUid=uid()):void {
  const st=lstatSync(path);if(st.isSymbolicLink()||!st.isDirectory())throw new Error('signer directory must be a directory');
  if(st.uid!==ownerUid)throw new Error(`signer directory must be owned by uid ${ownerUid}`);
  if((st.mode&0o077)!==0)throw new Error('signer directory must not be accessible by group or others');
}
function validateData(v:unknown):SpendLedgerData {
  if(!v||typeof v!=='object')throw new Error('spend ledger is corrupt');const d=v as Record<string,unknown>;
  if(d.version!==1||typeof d.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.day)||typeof d.usedUsd!=='number'||!Number.isFinite(d.usedUsd)||d.usedUsd<0||!Array.isArray(d.trades))throw new Error('spend ledger is corrupt');
  let total=0;
  for(const item of d.trades){if(!item||typeof item!=='object')throw new Error('spend ledger is corrupt');const t=item as Record<string,unknown>;if(typeof t.id!=='string'||typeof t.tsMs!=='number'||!Number.isSafeInteger(t.tsMs)||Math.abs(t.tsMs)>8.64e15||typeof t.usd!=='number'||!Number.isFinite(t.usd)||t.usd<=0||typeof t.intentHash!=='string'||!/^0x[0-9a-f]{64}$/i.test(t.intentHash)||new Date(t.tsMs).toISOString().slice(0,10)!==d.day)throw new Error('spend ledger is corrupt');total+=t.usd;}
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
  reserve(usd:number,tradeId:string,intentHash:string,now=Date.now()):SpendLedgerData {
    const current=this.read(now);assertTradeLimits(this.policy,current.usedUsd,usd);
    const next:SpendLedgerData={version:1,day:utcDay(now),usedUsd:current.usedUsd+usd,trades:[...current.trades,{id:tradeId,tsMs:now,usd,intentHash}]};
    this.atomicWrite(next);return next;
  }
  private atomicWrite(data:SpendLedgerData):void {
    const temp=join(this.directory,`.spend-ledger.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
    const fd=openSync(temp,'wx',0o600);
    try{writeFileSync(fd,JSON.stringify(data));fsyncSync(fd);}finally{closeSync(fd);}
    renameSync(temp,this.path);
    const dirFd=openSync(dirname(this.path),'r');try{fsyncSync(dirFd);}finally{closeSync(dirFd);}
  }
}
