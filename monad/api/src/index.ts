import { serve } from "@hono/node-server";
import { createPublicClient, http } from "viem";
import { createApp } from "./app.ts";
import { loadConfig, registryDeployed } from "./config.ts";
import { Db } from "./db.ts";
import { Indexer } from "./indexer.ts";

const config = loadConfig();
const db = new Db(config.dbPath);
const client = createPublicClient({
  transport: http(config.rpcUrl),
});
const app = createApp({ db, config, client });

if (registryDeployed(config)) {
  const indexer = new Indexer(db, client, config.registryAddress, config.chainId);
  indexer.start(config.indexerPollMs);
  console.log(`indexer watching ${config.registryAddress} on chain ${config.chainId}`);
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`tradgents api http://localhost:${info.port}`);
});
