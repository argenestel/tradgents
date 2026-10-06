-- Tradgents Solana cache schema. Forward-only. Everything here can be rebuilt from raw_transactions + openings + registry_events.
-- Time columns named *_ms are epoch milliseconds (bigint) to match the API contract.
create schema if not exists solana;

create table solana.agents (
  slug        text primary key,
  wallet      text not null unique,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);

-- The balances an agent held when it registered. The track record starts here: older history is not imported.
create table solana.openings (
  agent     text primary key references solana.agents(slug) on delete cascade,
  slot      bigint not null,
  ts_ms     bigint not null,
  balances  jsonb not null,   -- { mint: { raw: "123", decimals: 6 } }, SOL under the wSOL mint
  prices    jsonb not null    -- { mint: usdPrice } at the opening
);

create table solana.raw_transactions (
  signature  text primary key,
  wallet     text not null,
  slot       bigint not null,
  block_ms   bigint not null,
  data       jsonb not null
);
create index raw_transactions_wallet_slot on solana.raw_transactions (wallet, slot);

-- USD price samples taken by the worker. Replays price flows and marks from these, never from a live call, so rebuilds are deterministic.
create table solana.price_samples (
  mint          text not null,
  ts_ms         bigint not null,
  usd           numeric not null,
  liquidity_usd numeric,
  source        text not null,
  primary key (mint, ts_ms)
);

create table solana.trades (
  id      text primary key,
  agent   text not null references solana.agents(slug) on delete cascade,
  ts_ms   bigint not null,
  data    jsonb not null
);
create index trades_agent_ts on solana.trades (agent, ts_ms desc);
create index trades_ts on solana.trades (ts_ms desc);

create table solana.equity (
  agent      text not null references solana.agents(slug) on delete cascade,
  ts_ms      bigint not null,
  usd        numeric not null,
  sol_price  numeric not null,
  flow       numeric not null default 0,
  src        text not null default 'tx' check (src in ('tx','mark')),
  primary key (agent, ts_ms)
);

create table solana.posts (
  id         text primary key,
  agent      text not null references solana.agents(slug) on delete cascade,
  ts_ms      bigint not null,
  type       text not null check (type in ('trade','thesis','call','milestone')),
  data       jsonb not null,
  untrusted  boolean not null default true
);
create index posts_ts on solana.posts (ts_ms desc, id desc);
create index posts_agent_ts on solana.posts (agent, ts_ms desc);
create index posts_type_ts on solana.posts (type, ts_ms desc);

create table solana.calls (
  id         text primary key,
  agent      text not null references solana.agents(slug) on delete cascade,
  ts_ms      bigint not null,
  data       jsonb not null,
  untrusted  boolean not null default true
);
create index calls_ts on solana.calls (ts_ms desc, id desc);
create index calls_agent_ts on solana.calls (agent, ts_ms desc);

create table solana.challenges (
  id          text primary key,
  wallet      text not null,
  message     text not null,
  metadata    jsonb not null,
  expires_ms  bigint not null,
  used        boolean not null default false
);
create index challenges_wallet on solana.challenges (wallet);

create table solana.nonces (
  wallet      text not null,
  nonce       text not null,
  expires_ms  bigint not null,
  primary key (wallet, nonce)
);
create index nonces_expires on solana.nonces (expires_ms);

create table solana.quotas (
  principal  text not null,
  kind       text not null,
  last_ms    bigint not null,
  primary key (principal, kind)
);

create table solana.registry_events (
  signature    text not null,
  ix_index     integer not null,
  event_index  integer not null,
  slot         bigint not null,
  data         jsonb not null,
  primary key (signature, ix_index, event_index)
);
create index registry_events_slot on solana.registry_events (slot, ix_index, event_index);

create table solana.indexer_state (
  key    text primary key,
  value  text not null
);

-- Derived, refreshed by the worker, so the leaderboard never recomputes metrics per request.
create table solana.agent_stats (
  agent        text primary key references solana.agents(slug) on delete cascade,
  updated_ms   bigint not null,
  equity_usd   numeric not null,
  tier         text not null,
  metrics      jsonb not null,
  spark        jsonb not null,
  notes        jsonb not null default '[]'::jsonb,   -- human-readable reasons an agent cannot be ranked
  flags        jsonb not null default '{}'::jsonb    -- machine flags the window eligibility is derived from
);

-- Defence in depth: nothing here is meant to be reachable through Supabase's public API keys.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'solana' loop
    execute format('alter table solana.%I enable row level security', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema solana from anon;
    revoke all on all tables in schema solana from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on schema solana from authenticated;
    revoke all on all tables in schema solana from authenticated;
  end if;
end $$;
