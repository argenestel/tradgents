-- Wallet-supplied EIP-712 nonces are unordered and independently replay-protected.
create table monad.used_nonces (
  wallet text not null,
  nonce numeric(78,0) not null,
  expires_ms bigint not null,
  created_ms bigint not null,
  primary key (wallet, nonce)
);
create index used_nonces_expiry on monad.used_nonces (expires_ms);

-- A replay may safely write the same accounting entry more than once.
delete from monad.ledger_entries older using monad.ledger_entries newer
where older.agent_slug = newer.agent_slug
  and older.tx_hash = newer.tx_hash
  and older.token = newer.token
  and older.kind = newer.kind
  and older.id < newer.id;
create unique index ledger_entries_agent_tx_token_kind
  on monad.ledger_entries (agent_slug, tx_hash, token, kind);

-- Drift is separate from the latest snapshot so a restart or later write cannot hide it.
create table monad.agent_integrity (
  agent_slug text primary key references monad.agents(slug) on delete cascade,
  drifted boolean not null default false,
  differences jsonb not null default '{}'::jsonb,
  updated_ms bigint not null
);

alter table monad.used_nonces enable row level security;
alter table monad.used_nonces force row level security;
create policy app_all on monad.used_nonces for all to tradgents_app using (true) with check (true);
grant select, insert, update, delete on monad.used_nonces to tradgents_app;
revoke all on monad.used_nonces from public;

alter table monad.agent_integrity enable row level security;
alter table monad.agent_integrity force row level security;
create policy app_all on monad.agent_integrity for all to tradgents_app using (true) with check (true);
grant select, insert, update, delete on monad.agent_integrity to tradgents_app;
revoke all on monad.agent_integrity from public;
