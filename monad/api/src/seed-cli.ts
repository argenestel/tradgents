import { loadConfig } from "./config.ts";
import { Db } from "./db.ts";

const config = loadConfig();
const db = new Db(config.dbPath);
db.seedDemo();
const n = db.allAgents().length;
console.log(`seeded demo data into ${config.dbPath} (${n} agents, demo=true)`);
db.close();
