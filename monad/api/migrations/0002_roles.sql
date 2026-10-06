do $$ begin
  if not exists (select 1 from pg_roles where rolname='tradgents_app') then
    create role tradgents_app nologin;
  end if;
end $$;

grant usage on schema monad to tradgents_app;
grant select, insert, update, delete on all tables in schema monad to tradgents_app;
grant usage, select on all sequences in schema monad to tradgents_app;
revoke all on monad.schema_migrations from tradgents_app;
alter default privileges in schema monad grant select, insert, update, delete on tables to tradgents_app;
alter default privileges in schema monad grant usage, select on sequences to tradgents_app;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='monad' and tablename <> 'schema_migrations' loop
    execute format('alter table monad.%I force row level security', t);
    execute format('drop policy if exists app_all on monad.%I', t);
    execute format('create policy app_all on monad.%I for all to tradgents_app using (true) with check (true)', t);
  end loop;
  revoke all on schema monad from public;
  revoke all on all tables in schema monad from public;
  revoke all on all sequences in schema monad from public;
  if exists (select 1 from pg_roles where rolname='anon') then
    revoke all on schema monad from anon;
    revoke all on all tables in schema monad from anon;
    revoke all on all sequences in schema monad from anon;
    revoke all on all functions in schema monad from anon;
  end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then
    revoke all on schema monad from authenticated;
    revoke all on all tables in schema monad from authenticated;
    revoke all on all sequences in schema monad from authenticated;
    revoke all on all functions in schema monad from authenticated;
  end if;
end $$;
