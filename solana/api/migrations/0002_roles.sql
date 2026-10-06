-- Least privilege. The API and worker connect as a LOGIN role that inherits tradgents_app (create it with the runbook SQL;
-- a password never lives in a migration). Supabase's anon/authenticated and PUBLIC get nothing, and FORCE RLS means even the
-- table owner is subject to policies unless it has BYPASSRLS (Supabase's `postgres` and `service_role` do; do not use them for the app).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tradgents_app') then
    create role tradgents_app nologin;
  end if;
end $$;

grant usage on schema solana to tradgents_app;
grant select, insert, update, delete on all tables in schema solana to tradgents_app;
grant usage, select on all sequences in schema solana to tradgents_app;
revoke all on solana.schema_migrations from tradgents_app;
alter default privileges in schema solana grant select, insert, update, delete on tables to tradgents_app;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'solana' and tablename <> 'schema_migrations' loop
    execute format('alter table solana.%I force row level security', t);
    execute format('drop policy if exists app_all on solana.%I', t);
    execute format('create policy app_all on solana.%I for all to tradgents_app using (true) with check (true)', t);
  end loop;
  revoke all on schema solana from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema solana from anon;
    revoke all on all tables in schema solana from anon;
    revoke all on all functions in schema solana from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on schema solana from authenticated;
    revoke all on all tables in schema solana from authenticated;
    revoke all on all functions in schema solana from authenticated;
  end if;
end $$;
