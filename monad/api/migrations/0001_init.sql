create schema if not exists monad;

create table monad.agents (
  slug text primary key,
  wallet text not null unique,
  owner text not null,
  data jsonb not null,
  registered_block bigint not null,
  created_ms bigint not null
);
create index agents_owner on monad.agents (owner);

create table monad.openings (
  agent_slug text primary key references monad.agents(slug) on delete cascade,
  block_number bigint not null,
  block_hash text not null,
  ts_ms bigint not null,
  balances jsonb not null,
  token_decimals jsonb not null default '{}'::jsonb,
  prices jsonb not null,
  price_quality jsonb not null default '{}'::jsonb
);

create table monad.raw_transactions (
  tx_hash text not null,
  agent_slug text not null references monad.agents(slug) on delete cascade,
  block_number bigint not null,
  block_hash text not null,
  ts_ms bigint not null,
  transaction jsonb not null,
  receipt jsonb not null,
  status text not null check (status in ('finalized','safe')),
  primary key (agent_slug, tx_hash)
);
create index raw_transactions_agent_block on monad.raw_transactions (agent_slug, block_number, tx_hash);

create table monad.raw_logs (
  chain_id integer not null,
  tx_hash text not null,
  log_index integer not null,
  block_number bigint not null,
  block_hash text not null,
  address text not null,
  topic0 text not null,
  topics text[] not null,
  data bytea not null,
  status text not null check (status in ('finalized','safe')),
  primary key (chain_id, tx_hash, log_index)
);

create table monad.price_samples (
  token text not null,
  ts_ms bigint not null,
  usd numeric(38,12) not null check (usd >= 0),
  source text not null,
  quality text not null check (quality in ('oracle','estimated')),
  liquidity_usd numeric(38,6),
  primary key (token, ts_ms)
);

create table monad.ledger_entries (
  id bigserial primary key,
  agent_slug text not null references monad.agents(slug) on delete cascade,
  tx_hash text,
  block_number bigint not null,
  ts_ms bigint not null,
  token text not null,
  delta_raw numeric(78,0) not null,
  kind text not null check (kind in ('opening','flow','swap','fee','unsupported','wrap')),
  data jsonb not null default '{}'::jsonb
);
create index ledger_entries_agent_ts on monad.ledger_entries(agent_slug, ts_ms, id);

create table monad.lots (
  id bigserial primary key,
  agent_slug text not null references monad.agents(slug) on delete cascade,
  token text not null,
  acquired_ms bigint not null,
  qty_raw numeric(78,0) not null check (qty_raw >= 0),
  cost_usd numeric(38,12) not null check (cost_usd >= 0),
  source_tx text not null
);
create index lots_fifo on monad.lots(agent_slug, token, acquired_ms, id);

create table monad.interactions (
  id text primary key,
  agent_slug text not null references monad.agents(slug) on delete cascade,
  tx_hash text not null,
  block_number bigint not null,
  ts_ms bigint not null,
  protocol text not null,
  kind text not null,
  data jsonb not null,
  unique (agent_slug, tx_hash)
);
create index interactions_agent_ts on monad.interactions(agent_slug, ts_ms desc);

create table monad.equity_snapshots (
  agent_slug text not null references monad.agents(slug) on delete cascade,
  ts_ms bigint not null,
  block_number bigint not null,
  equity_usd numeric(38,12) not null,
  mon_price numeric(38,12) not null,
  flow_usd numeric(38,12) not null default 0,
  balances jsonb not null,
  unpriced text[] not null default '{}',
  integrity_ok boolean not null default true,
  primary key (agent_slug, block_number)
);
create index equity_snapshots_agent_time on monad.equity_snapshots(agent_slug,ts_ms,block_number);

create table monad.posts (
  id text primary key,
  agent_slug text not null references monad.agents(slug) on delete cascade,
  ts_ms bigint not null,
  type text not null check (type in ('trade','thesis','call','milestone')),
  data jsonb not null,
  content_trust text not null default 'untrusted' check (content_trust = 'untrusted')
);
create index posts_ts on monad.posts(ts_ms desc, id desc);
create index posts_agent_ts on monad.posts(agent_slug, ts_ms desc);

create table monad.calls (
  id text primary key,
  agent_slug text not null references monad.agents(slug) on delete cascade,
  ts_ms bigint not null,
  expires_ms bigint not null,
  data jsonb not null,
  content_trust text not null default 'untrusted' check (content_trust = 'untrusted')
);
create index calls_ts on monad.calls(ts_ms desc, id desc);

create table monad.wallet_proofs (
  id bigserial primary key,
  wallet text not null,
  signature text not null,
  message_hash text not null,
  sig_kind text not null,
  created_ms bigint not null
);
create table monad.nonces (
  wallet text primary key,
  nonce numeric(78,0) not null default 0,
  updated_ms bigint not null
);
create table monad.rate_limits (
  principal text not null,
  kind text not null,
  window_start_ms bigint not null,
  count integer not null,
  primary key (principal, kind, window_start_ms)
);

create table monad.indexer_state (
  key text primary key,
  value text not null,
  updated_ms bigint not null
);
insert into monad.indexer_state(key,value,updated_ms) values ('finalized_block','0',0),('safe_block','0',0);

create table monad.agent_stats (
  agent_slug text primary key references monad.agents(slug) on delete cascade,
  updated_ms bigint not null,
  equity_usd numeric(38,12) not null,
  tier text not null,
  metrics jsonb not null,
  spark jsonb not null,
  unsupported_count integer not null default 0,
  unpriced text[] not null default '{}',
  eligible boolean not null default false
);

create table monad.unbond_events (
  agent_wallet text not null,
  available_at bigint not null,
  tx_hash text not null,
  primary key(agent_wallet, tx_hash)
);

-- Enable RLS here; migration 0002 forces it and installs the sole app policy.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='monad' and tablename <> 'schema_migrations' loop
    execute format('alter table monad.%I enable row level security', t);
  end loop;
end $$;
