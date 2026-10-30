-- Étape 3 : le coffre des clés Anthropic, une par foyer.
-- Personne ne la lit depuis l'application : ni les membres du foyer, ni le
-- navigateur. Seule la fonction « ia », avec le rôle de service, s'en sert.
create table public.cles_ia (
  foyer_id uuid primary key references public.foyers (id) on delete cascade,
  cle text not null,
  updated_at timestamptz not null default now()
);
alter table public.cles_ia enable row level security;
-- Aucune politique : la sécurité par ligne refuse tout aux rôles de l'API.
revoke all on public.cles_ia from public, anon, authenticated;
grant all on public.cles_ia to service_role;

-- Le journal IA est écrit par la fonction, lu par le foyer pour le résumé du mois.
create index if not exists ai_calls_foyer_mois_idx on public.ai_calls (foyer_id, created_at desc);
