#!/usr/bin/env node
import { existsSync,lstatSync,readFileSync,unlinkSync } from 'node:fs';
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
import { UNISWAP_V2_FACTORY,UNISWAP_V2_ROUTER } from './venue.ts';

const envSchema=z.object({MONAD_RPC_URL:z.string().url(),MONAD_CHAIN_ID:z.coerce.number().int().default(143),REGISTRY_ADDRESS:z.string().refine(isAddress),SIGNER_DIR:z.string().min(1),SIGNER_POLICY_FILE:z.string().min(1),SIGNER_KEY_FILE:z.string().min(1),TRADGENTS_SIGNER_SOCKET:z.string().optional(),TRADGENTS_SIGNER_SOCKET_MODE:z.enum(['0600','0660']).default('0600'),LOG_LEVEL:z.enum(['fatal','error','warn','info','debug','trace','silent']).default('info')});
const reqSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('status')}).strict(),
  z.object({type:z.literal('swap'),intent:z.unknown()}).strict(),
  z.object({type:z.literal('sign'),message:z.unknown()}).strict(),
]);
const rpcChain=defineChain({id:143,name:'Monad',nativeCurrency:{name:'Monad',symbol:'MON',decimals:18},rpcUrls:{default:{http:['https://rpc.monad.xyz']}}});
function uid(){return typeof process.getuid==='function'?process.getuid():-1;}
function assertSecretFile(path:string):void {
  const st=lstatSync(path);if(st.isSymbolicLink()||!st.isFile())throw new Error('signer key must be a regular file');
  if(st.uid!==uid()||(st.mode&0o077)!==0)throw new Error('signer key must be owned by the signer and mode 0600 or stricter');
}
function errorMessage(e:unknown):string{return e instanceof Error?e.message:'request rejected';}

export async function startSigner(env:NodeJS.ProcessEnv=process.env):Promise<()=>Promise<void>> {
  const checked=envSchema.safeParse(env);if(!checked.success)throw new Error(`invalid signer environment: ${checked.error.issues.map(i=>i.message).join('; ')}`);
  const e=checked.data;if(e.MONAD_CHAIN_ID!==143)throw new Error('signer is mainnet-only; MONAD_CHAIN_ID must be 143');
  const dir=resolve(e.SIGNER_DIR),policyPath=resolve(e.SIGNER_POLICY_FILE),keyPath=resolve(e.SIGNER_KEY_FILE),socketPath=resolve(e.TRADGENTS_SIGNER_SOCKET??join(dir,'signer.sock'));
  assertPrivateDirectory(dir,uid());assertRootOwnedPolicyFile(policyPath,0);assertSecretFile(keyPath);
  const policy=loadPolicy(policyPath);
  if(policy.chainId!==143||policy.registryAddress.toLowerCase()!==e.REGISTRY_ADDRESS.toLowerCase())throw new Error('policy and signer registry/chain settings do not match');
  const rawKey=readFileSync(keyPath,'utf8').trim();if(!/^0x[0-9a-fA-F]{64}$/.test(rawKey))throw new Error('signer key file must contain a 32-byte 0x-prefixed key');
  const account=privateKeyToAccount(rawKey as `0x${string}`);
  if(account.address.toLowerCase()!==policy.walletAddress.toLowerCase())throw new Error('signer key does not match policy wallet');
  const client=createPublicClient({chain:rpcChain,transport:http(e.MONAD_RPC_URL,{timeout:15_000,retryCount:2})});
  const chainId=await client.getChainId();if(chainId!==143)throw new Error(`RPC chain ID ${chainId} is not mainnet 143`);
  for(const [label,address] of [['registry',policy.registryAddress],['router',UNISWAP_V2_ROUTER],['factory',UNISWAP_V2_FACTORY],...policy.tokens.map(t=>[t.symbol,t.address] as const)] as Array<[string,Address]>) {
    const code=await client.getCode({address});if(!code||code==='0x')throw new Error(`${label} has no bytecode at configured chain`);
  }
  const walletClient=createWalletClient({account,chain:rpcChain,transport:http(e.MONAD_RPC_URL,{timeout:15_000,retryCount:2})});
  const logger=pino({level:e.LOG_LEVEL,redact:{paths:['*.key','*.privateKey','*.authorization','*.signature'],censor:'[REDACTED]'}});
  const ledger=new SpendLedger(dir,policy,uid()),pausePath=join(dir,'PAUSE');
  if(existsSync(socketPath)){const st=lstatSync(socketPath);if(!st.isSocket()||st.uid!==uid())throw new Error('refusing to replace non-owned signer socket path');unlinkSync(socketPath);}
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
          if(parsed.data.type==='status')reply={ok:true,result:{wallet:account.address,chainId:143,paused:existsSync(pausePath),spend:ledger.read()}};
          else {
            if(existsSync(pausePath))throw new Error('signer is paused');
            if(parsed.data.type==='swap')reply={ok:true,result:await executeSwap(parsed.data.intent,{client,walletClient,account,policy,ledger})};
            else reply={ok:true,result:{signature:await signTradgentsMessage(account,policy,parsed.data.message)}};
          }
        }catch(error){reply={ok:false,error:errorMessage(error)};logger.warn({type:'signer_request_rejected',error:error instanceof Error?error.name:'unknown'});}
        socket.end(JSON.stringify(reply)+'\n');
      }).catch(error=>{logger.error({error:error instanceof Error?error.name:'unknown'},'signer request queue failed');socket.end(JSON.stringify({ok:false,error:'signer unavailable'})+'\n');});
    });
    socket.on('error',()=>undefined);
  });
  await new Promise<void>((resolveListen,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.removeListener('error',reject);resolveListen();});});
  const {chmodSync}=await import('node:fs');chmodSync(socketPath,e.TRADGENTS_SIGNER_SOCKET_MODE==='0660'?0o660:0o600);
  logger.info({wallet:account.address,chainId:143,socket:socketPath},'signer daemon ready');
  return async()=>{await new Promise<void>(resolveClose=>server.close(()=>resolveClose()));try{unlinkSync(socketPath);}catch{}logger.info('signer daemon stopped');};
}

if(import.meta.url===new URL(`file://${process.argv[1]}`).href){
  let stop:undefined|(()=>Promise<void>);
  try{stop=await startSigner();}catch(error){console.error(`tradgents-signer: ${error instanceof Error?error.name:'startup failed'}`);process.exit(1);}
  const shutdown=async()=>{if(stop){await stop();stop=undefined;}};
  process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
}
