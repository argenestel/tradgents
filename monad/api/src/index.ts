import { serve } from '@hono/node-server';
import pino from 'pino';
import { createApp } from './app.ts';
import { createMonadClient, verifyChainDeployment } from './chain.ts';
import { loadConfig } from './config.ts';
import { openDb } from './pg.ts';

const config=loadConfig();
const logger=pino({level:config.logLevel,redact:{paths:['*.authorization','*.password','*.privateKey','*.secret','req.headers.authorization'],censor:'[REDACTED]'}});
const db=await openDb(config.databaseUrl,{max:10});
const client=createMonadClient(config);
try {
  await verifyChainDeployment(client,config);
  await db.query('select 1');
} catch(error) {
  logger.fatal({error:error instanceof Error?error.name:'unknown'},'startup validation failed');
  await db.close();process.exit(1);
}
const app=createApp({db,config,client,logger});
const server=serve({fetch:app.fetch,hostname:config.host,port:config.port},info=>logger.info({host:config.host,port:info.port,chainId:config.chainId},'Monad API listening'));
let closing=false;
async function shutdown(signal:string){if(closing)return;closing=true;logger.info({signal},'shutting down');server.close();await db.close();process.exit(0);}
process.once('SIGINT',()=>void shutdown('SIGINT'));process.once('SIGTERM',()=>void shutdown('SIGTERM'));
