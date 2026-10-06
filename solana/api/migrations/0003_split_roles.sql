-- The public API process and the indexer worker should not share one all-powerful role. If the API is compromised it must not be able to
-- rewrite raw chain data, prices, trades or stats. `tradgents_read` (the API) reads everything it serves and writes only the signed-write
-- tables; `tradgents_app` (the worker) keeps full access. Log in with two different LOGIN roles, one in each group.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tradgents_read') then
    create role tradgents_read nologin;
  end if;
end $$;

grant usage on schema solana to tradgents_read;
grant select on solana.agents, solana.trades, solana.equity, solana.posts, solana.calls, solana.agent_stats, solana.price_samples, solana.indexer_state,
  solana.challenges, solana.nonces, solana.quotas to tradgents_read;
-- registering, claiming a wallet, and signed posts and calls
grant insert, update on solana.agents to tradgents_read;
grant insert, update on solana.challenges to tradgents_read;
grant insert, update, delete on solana.nonces to tradgents_read;
grant insert, update on solana.quotas to tradgents_read;
grant insert on solana.posts to tradgents_read;
grant insert on solana.calls to tradgents_read;

do $$
declare t text;
begin
  for t in select unnest(array['agents','trades','equity','posts','calls','agent_stats','price_samples','indexer_state','challenges','nonces','quotas']) loop
    execute format('drop policy if exists read_all on solana.%I', t);
    execute format('create policy read_all on solana.%I for all to tradgents_read using (true) with check (true)', t);
  end loop;
end $$;
