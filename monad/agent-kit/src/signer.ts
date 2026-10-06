#!/usr/bin/env node
import { closeSync,chownSync,chmodSync,existsSync,fsyncSync,lstatSync,openSync,readFileSync,unlinkSync,writeFileSync } from 'node:fs';
import { createServer,connect } from 'node:net';
import { resolve,join } from 'node:path';
import pino from 'pino';
import { createPublicClient,createWalletClient,defineChain,http,isAddress,type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import { assertPrivateDirectory,SpendLedger } from './spend-ledger.ts';
import { assertRootOwnedPolicyFile,loadPolicy } from './policy.ts';
import { signTradgentsMessage } from './signed-messages.ts';
import { executeSwap } from './trade.ts';
import { getSignerNetworkProfile,type SignerNetworkProfile } from './venue.ts';

const envSchema=z.object({MONAD_NETWORK:z.enum(['mainnet','testnet']).default('mainnet'),MONAD_RPC_URL:z.string().url().optional(),MONAD_CHAIN_ID:z.coerce.number().int().positive().optional(),TESTNET_V2_ROUTER:z.string().optional(),TESTNET_V2_FACTORY:z.string().optional(),TESTNET_USDC:z.string().optional(),TESTNET_WMON:z.string().optional(),TESTNET_FIXED_PRICES:z.enum(['true','false']).default('false'),TESTNET_MON_PRICE_USD:z.coerce.number().positive().finite().optional(),REGISTRY_ADDRESS:z.string().refine(isAddress),SIGNER_DIR:z.string().min(1),SIGNER_POLICY_FILE:z.string().min(1),SIGNER_KEY_FILE:z.string().min(1),TRADGENTS_SIGNER_SOCKET:z.string().optional(),TRADGENTS_SIGNER_SOCKET_MODE:z.enum(['0600','0660']).default('0600'),TRADGENTS_SIGNER_SOCKET_GID:z.coerce.number().int().nonnegative().optional(),LOG_LEVEL:z.enum(['fatal','error','warn','info','debug','trace','silent']).default('info')});
const reqSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('status')}).strict(),
  z.object({type:z.literal('swap'),intent:z.unknown()}).strict(),
  z.object({type:z.literal('sign'),message:z.unknown()}).strict(),
]);
function rpcChain(profile:SignerNetworkProfile){return defineChain({id:profile.chainId,name:profile.displayName,nativeCurrency:{name:'Monad',symbol:'MON',decimals:18},rpcUrls:{default:{http:[profile.defaultRpcUrl]}},blockExplorers:{default:{name:profile.displayName,url:profile.explorerBaseUrl}}});}
function uid(){return typeof process.getuid==='function'?process.getuid():-1;}
function assertSecretFile(path:string):void {
  const st=lstatSync(path);if(st.isSymbolicLink()||!st.isFile())throw new Error('signer key must be a regular file');
  if(st.uid!==uid()||(st.mode&0o077)!==0)throw new Error('signer key must be owned by the signer and mode 0600 or stricter');
}
function errorMessage(e:unknown):string{return e instanceof Error?e.message:'request rejected';}
function pidAlive(pid:number):boolean {try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code==='EPERM';}}
export function acquireSignerLock(directory:string):()=>void {
  const path=join(directory,'signer.lock'),owner=uid();
  for(let attempt=0;attempt<3;attempt++){
    let fd:number|undefined;
    try{fd=openSync(path,'wx',0o600);writeFileSync(fd,`${process.pid}\n`);fsyncSync(fd);closeSync(fd);fd=undefined;
      return ()=>{try{if(Number(readFileSync(path,'utf8').trim())===process.pid)unlinkSync(path);}catch{}};
    }catch(error){if(fd!==undefined){closeSync(fd);fd=undefined;try{unlinkSync(path);}catch{}}if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      const st=lstatSync(path);if(st.isSymbolicLink()||!st.isFile()||st.uid!==owner||(st.mode&0o077)!==0)throw new Error('signer lock must be a private signer-owned regular file');
      const pid=Number(readFileSync(path,'utf8').trim());if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('signer lock is corrupt');
      if(pidAlive(pid))throw new Error(`another signer process (pid ${pid}) holds SIGNER_DIR/signer.lock`);
      try{unlinkSync(path);}catch{}
    }
  }
  throw new Error('could not acquire signer lock');
}
export function assertSocketMode(mode:'0600'|'0660',gid?:number):void {
  if(mode==='0660'&&gid===undefined)throw new Error('socket mode 0660 requires TRADGENTS_SIGNER_SOCKET_GID to be explicitly configured');
}
export async function assertSocketNotLive(path:string):Promise<void> {
  if(!existsSync(path))return;
  const st=lstatSync(path);if(!st.isSocket()||st.uid!==uid())throw new Error('refusing to replace non-owned signer socket path');
  await new Promise<void>((resolveProbe,reject)=>{
    const socket=connect(path);let done=false;
    const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();error?reject(error):resolveProbe();};
    const timer=setTimeout(()=>finish(new Error('could not determine whether existing signer socket is live; refusing to unlink')),500);
    socket.once('connect',()=>finish(new Error('signer socket already accepts connections; refusing to unlink it')));
    socket.once('error',error=>{if(['ECONNREFUSED','ENOENT'].includes((error as NodeJS.ErrnoException).code??''))finish();else finish(error);});
  });
  if(existsSync(path))unlinkSync(path);
}

export async function startSigner(env:NodeJS.ProcessEnv=process.env):Promise<()=>Promise<void>> {
  const checked=envSchema.safeParse(env);if(!checked.success)throw new Error(`invalid signer environment: ${checked.error.issues.map(i=>i.message).join('; ')}`);
  const e=checked.data;
  const profile=getSignerNetworkProfile(e.MONAD_NETWORK,env);
  if(e.MONAD_CHAIN_ID!==undefined&&e.MONAD_CHAIN_ID!==profile.chainId)throw new Error(`MONAD_CHAIN_ID ${e.MONAD_CHAIN_ID} does not match ${profile.network} profile chain ${profile.chainId}`);
  if(e.TESTNET_FIXED_PRICES==='true'&&(profile.network!=='testnet'||e.TESTNET_MON_PRICE_USD===undefined))throw new Error('TESTNET_FIXED_PRICES is testnet-only and requires TESTNET_MON_PRICE_USD');
  const rpcUrl=e.MONAD_RPC_URL??profile.defaultRpcUrl;
  const dir=resolve(e.SIGNER_DIR),policyPath=resolve(e.SIGNER_POLICY_FILE),keyPath=resolve(e.SIGNER_KEY_FILE),socketPath=resolve(e.TRADGENTS_SIGNER_SOCKET??join(dir,'signer.sock'));
  assertPrivateDirectory(dir,uid());assertRootOwnedPolicyFile(policyPath,0);assertSecretFile(keyPath);
  assertSocketMode(e.TRADGENTS_SIGNER_SOCKET_MODE,e.TRADGENTS_SIGNER_SOCKET_GID);
  const policy=loadPolicy(policyPath,env);
  if(policy.network!==profile.network||policy.chainId!==profile.chainId||policy.registryAddress.toLowerCase()!==e.REGISTRY_ADDRESS.toLowerCase())throw new Error('policy and signer profile/registry settings do not match');
  const rawKey=readFileSync(keyPath,'utf8').trim();if(!/^0x[0-9a-fA-F]{64}$/.test(rawKey))throw new Error('signer key file must contain a 32-byte 0x-prefixed key');
  const account=privateKeyToAccount(rawKey as `0x${string}`);
  if(account.address.toLowerCase()!==policy.walletAddress.toLowerCase())throw new Error('signer key does not match policy wallet');
  const releaseLock=acquireSignerLock(dir);let cleanupServer:ReturnType<typeof createServer>|undefined;
  try {
  const networkChain=rpcChain(profile);
  const client=createPublicClient({chain:networkChain,transport:http(rpcUrl,{timeout:15_000,retryCount:2})});
  const chainId=await client.getChainId();if(chainId!==profile.chainId)throw new Error(`RPC chain ID ${chainId} does not match ${profile.network} profile ${profile.chainId}`);
  const pinned:Array<[string,Address]>=[['registry',policy.registryAddress],['router',profile.router],['factory',profile.factory],['WMON',profile.wmon],['USDC',profile.usdc],['Pyth',profile.pyth]];
  for(const [label,address] of pinned) {
    const code=await client.getCode({address});if(!code||code==='0x')throw new Error(`${label} has no bytecode at configured ${profile.network} chain`);
  }
  const usdc=policy.tokens.find(t=>t.symbol==='USDC')!;
  const tokenAbi=[{type:'function',name:'decimals',stateMutability:'view',inputs:[],outputs:[{type:'uint8'}]},{type:'function',name:'symbol',stateMutability:'view',inputs:[],outputs:[{type:'string'}]}] as const;
  const decimals=Number(await client.readContract({address:usdc.address,abi:tokenAbi,functionName:'decimals'}));
  if(decimals!==profile.usdcDecimals||decimals!==usdc.decimals)throw new Error(`on-chain USDC decimals ${decimals} do not match profile/policy decimals ${usdc.decimals} (expected 6)`);
  const wmonDecimals=Number(await client.readContract({address:profile.wmon,abi:tokenAbi,functionName:'decimals'})),wmonSymbol=await client.readContract({address:profile.wmon,abi:tokenAbi,functionName:'symbol'});
  if(wmonDecimals!==18||wmonSymbol!=='WMON')throw new Error(`on-chain WMON metadata ${wmonSymbol}/${wmonDecimals} does not match profile WMON/18`);
  const walletClient=createWalletClient({account,chain:networkChain,transport:http(rpcUrl,{timeout:15_000,retryCount:2})});
  const logger=pino({level:e.LOG_LEVEL,redact:{paths:['*.key','*.privateKey','*.authorization','*.signature'],censor:'[REDACTED]'}});
  const ledger=new SpendLedger(dir,policy,uid()),pausePath=join(dir,'PAUSE');
  await assertSocketNotLive(socketPath);
  let chain=Promise.resolve();
  const server=createServer(socket=>{
    let buffered='',finished=false;
    socket.setEncoding('utf8');socket.on('data',chunk=>{
      buffered+=chunk;if(Buffer.byteLength(buffered)>8192){finished=true;socket.end(JSON.stringify({ok:false,error:'request too large'})+'\n');return;}
      const newline=buffered.indexOf('\n');if(newline<0)return;if(finished)return;finished=true;
      const line=buffered.slice(0,newline);
      chain=chain.then(async()=>{
        let reply:{ok:boolean;result?:unknown;error?:string};
        try{
          const parsed=reqSchema.safeParse(JSON.parse(line));if(!parsed.success)throw new Error('invalid signer request');
          if(parsed.data.type==='status')reply={ok:true,result:{wallet:account.address,network:profile.network,chainId:profile.chainId,paused:existsSync(pausePath),spend:ledger.read()}};
          else {
            if(existsSync(pausePath))throw new Error('signer is paused');
            if(parsed.data.type==='swap')reply={ok:true,result:await executeSwap(parsed.data.intent,{client,walletClient,account,policy,ledger,profile,testnetFixedPrices:e.TESTNET_FIXED_PRICES==='true',testnetMonPriceUsd:e.TESTNET_MON_PRICE_USD})};
            else reply={ok:true,result:{signature:await signTradgentsMessage(account,policy,parsed.data.message)}};
          }
        }catch(error){reply={ok:false,error:errorMessage(error)};logger.warn({type:'signer_request_rejected',error:error instanceof Error?error.name:'unknown'});}
        socket.end(JSON.stringify(reply)+'\n');
      }).catch(error=>{logger.error({error:error instanceof Error?error.name:'unknown'},'signer request queue failed');socket.end(JSON.stringify({ok:false,error:'signer unavailable'})+'\n');});
    });
    socket.on('error',()=>undefined);
  });
  cleanupServer=server;
  const oldUmask=process.umask(0o177);
  try{await new Promise<void>((resolveListen,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.removeListener('error',reject);resolveListen();});});}
  finally{process.umask(oldUmask);}
  if(e.TRADGENTS_SIGNER_SOCKET_MODE==='0660')chownSync(socketPath,-1,e.TRADGENTS_SIGNER_SOCKET_GID!);
  chmodSync(socketPath,e.TRADGENTS_SIGNER_SOCKET_MODE==='0660'?0o660:0o600);
  logger.info({wallet:account.address,network:profile.network,chainId:profile.chainId,socket:socketPath},'signer daemon ready');
  return async()=>{try{await new Promise<void>(resolveClose=>server.close(()=>resolveClose()));}finally{try{unlinkSync(socketPath);}catch{}releaseLock();}logger.info('signer daemon stopped');};
  }catch(error){if(cleanupServer?.listening)await new Promise<void>(resolveClose=>cleanupServer!.close(()=>resolveClose()));try{unlinkSync(socketPath);}catch{}releaseLock();throw error;}
}

if(import.meta.url===new URL(`file://${process.argv[1]}`).href){
  let stop:undefined|(()=>Promise<void>);
  try{stop=await startSigner();}catch(error){console.error(`tradgents-signer: ${error instanceof Error?error.name:'startup failed'}`);process.exit(1);}
  const shutdown=async()=>{if(stop){await stop();stop=undefined;}};
  process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
}
