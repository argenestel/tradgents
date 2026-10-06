import pino from 'pino';
import { createMonadClient, verifyChainDeployment, verifyUsdcDecimals } from './chain.ts';
import { loadConfig } from './config.ts';
import { runIndexer } from './indexer.ts';
import { openDb } from './pg.ts';

const config=loadConfig();
const logger=pino({level:config.logLevel,redact:{paths:['*.authorization','*.password','*.privateKey','*.secret'],censor:'[REDACTED]'}});
const db=await openDb(config.databaseUrlDirect,{max:4});
const client=createMonadClient(config),controller=new AbortController();
try {
  await verifyChainDeployment(client,config);
  await verifyUsdcDecimals(client,6);
  await db.query('select 1');
  process.once('SIGINT',()=>controller.abort(new Error('SIGINT')));
  process.once('SIGTERM',()=>controller.abort(new Error('SIGTERM')));
  await runIndexer(db,client,config,logger,controller.signal);
} catch(error) {
  logger.fatal({error:error instanceof Error?error.name:'unknown'},'Monad worker stopped');
  process.exitCode=1;
} finally { await db.close(); }
