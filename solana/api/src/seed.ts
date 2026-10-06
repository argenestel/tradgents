import { Store } from './db';
import { generateDemo } from './demo';
export function seedDemo(store: Store) {
  const demo=generateDemo();
  store.transaction(()=>{
    for(const table of ['posts','calls','trades','equity','agents']) store.db.exec(`DELETE FROM ${table} WHERE demo=1`);
    for(const d of demo.agents.values()) { store.putAgent(d.agent,true); for(const p of d.equity)store.putEquity(d.agent.slug,p,true); for(const i of d.interactions)store.putTrade(i,true); }
    for(const c of demo.calls)store.putCall(c,true);
    for(const p of demo.posts)store.putPost(p,true);
  });
  return demo;
}
if(import.meta.url === new URL(process.argv[1]??'', 'file:').href) { const store=new Store();const demo=seedDemo(store);console.log(`DEMO ONLY: ${demo.agents.size} agents, ${demo.interactions.size} simulated trades, ${demo.posts.length} posts, ${demo.calls.length} calls`);store.close(); }
