-- Imitation minimale de Supabase pour tester les migrations en local :
-- rôles anon/authenticated, schéma auth, auth.uid() lu dans le JWT simulé.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
-- Comme Supabase : l'identifiant vient du JWT, posé par PostgREST dans
-- request.jwt.claims, ou directement dans request.jwt.claim.sub par les tests SQL.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login password 'essai' noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
-- Comme les projets Supabase récents : les tables ne sont pas ouvertes par
-- défaut aux comptes connectés, seules les fonctions le sont.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
