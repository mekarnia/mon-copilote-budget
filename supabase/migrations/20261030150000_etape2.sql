-- Étape 2 : suivi, photos de ticket, imports, restauration d'une sauvegarde.

-- ---------- Suivi ----------

/** Totaux par jour, sens et catégorie, hors catégories techniques : la matière de l'écran Suivi. */
create or replace function public.totaux_jour(p_du date, p_au date)
returns table (date date, type text, category_id bigint, total bigint)
language sql
stable
set search_path = ''
as $$
  select t.date, t.type, t.category_id, sum(t.amount)::bigint
  from public.transactions t join public.categories c on c.id = t.category_id
  where c.technical_key is null and t.type in ('expense', 'income') and t.date between p_du and p_au
  group by t.date, t.type, t.category_id
  -- Un ordre stable : le navigateur lit le résultat par tranches de 1 000 lignes.
  order by t.date, t.type, t.category_id
$$;

/** Les libellés qui reviennent le plus parmi les dépenses évitables d'une période. */
create or replace function public.libelles_evitables(p_du date, p_au date)
returns table (label text, count bigint, total bigint, category_name text)
language sql
stable
set search_path = ''
as $$
  select min(t.label), count(*), sum(t.amount)::bigint, min(c.name)
  from public.transactions t
  join public.categories c on c.id = t.category_id
  left join public.categories p on p.id = c.parent_id
  where t.type = 'expense' and t.label <> '' and t.date between p_du and p_au and (c.avoidable or coalesce(p.avoidable, false))
  group by lower(t.label)
  order by count(*) desc, sum(t.amount) desc
  limit 5
$$;

-- ---------- Imports ----------

/** Les imports avec le nom du portefeuille et le nombre d'opérations encore rattachées. */
create or replace function public.imports_detail()
returns table (id bigint, bank text, wallet_id bigint, wallet_name text, file_name text, created_count integer,
               skipped_count integer, created_at timestamptz, remaining bigint)
language sql
stable
set search_path = ''
as $$
  select i.id, i.bank, i.wallet_id, w.name, i.file_name, i.created_count, i.skipped_count, i.created_at,
         (select count(*) from public.transactions t where t.import_id = i.id)
  from public.imports i join public.wallets w on w.id = i.wallet_id
  order by i.id desc
$$;

-- ---------- Photos de ticket ----------
-- Un compartiment privé ; chaque foyer a son dossier (son identifiant), et
-- seuls ses membres y lisent et y écrivent. Les photos s'affichent par lien signé.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tickets', 'tickets', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "tickets : lecture dans son foyer" on storage.objects
  for select to authenticated
  using (bucket_id = 'tickets' and (storage.foldername(name))[1] = (select public.mon_foyer())::text);
create policy "tickets : ajout dans son foyer" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tickets' and (storage.foldername(name))[1] = (select public.mon_foyer())::text);
create policy "tickets : remplacement dans son foyer" on storage.objects
  for update to authenticated
  using (bucket_id = 'tickets' and (storage.foldername(name))[1] = (select public.mon_foyer())::text)
  with check (bucket_id = 'tickets' and (storage.foldername(name))[1] = (select public.mon_foyer())::text);
create policy "tickets : suppression dans son foyer" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tickets' and (storage.foldername(name))[1] = (select public.mon_foyer())::text);

-- ---------- Restauration d'une sauvegarde ----------

/** Pendant une restauration, les règles viennent du fichier : pas d'apprentissage à chaque ligne. */
create or replace function public.apprendre_regle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare motif text := public.normaliser_libelle(new.label);
begin
  if current_setting('app.restauration', true) = 'oui' then return null; end if;
  if new.type = 'transfer' or new.status <> 'confirmed' or new.category_id is null or char_length(motif) < 3 then
    return null;
  end if;
  if tg_op = 'INSERT' and new.recurrence_id is not null then return null; end if;
  if exists (select 1 from public.categories where id = new.category_id and technical_key is not null) then return null; end if;
  insert into public.category_rules (foyer_id, pattern, category_id, wallet_id)
    values (new.foyer_id, motif, new.category_id, new.wallet_id)
    on conflict (foyer_id, pattern) do update
      set category_id = excluded.category_id, wallet_id = excluded.wallet_id,
          hits = public.category_rules.hits + 1, updated_at = now();
  return null;
end $$;

/** Une valeur booléenne de sauvegarde : true/false (Supabase) ou 1/0 (version PC). */
create or replace function public.booleen(v jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case jsonb_typeof(v) when 'boolean' then v::text::boolean when 'number' then v::text::numeric <> 0
              when 'string' then lower(v #>> '{}') in ('1', 'true', 't') else false end
$$;

/** Une date de création de sauvegarde, ou maintenant si elle est absente ou illisible. */
create or replace function public.horodatage(v text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  return coalesce(v::timestamptz, now());
exception when others then
  return now();
end $$;

/**
 * Remplace toutes les données du foyer par celles d'une sauvegarde JSON, de la
 * version PC comme de cette version. Les identifiants sont renumérotés : ceux
 * du fichier ne servent qu'à retrouver les liens (catégorie d'une opération,
 * portefeuille d'un projet…). Tout se fait dans une seule transaction : une
 * erreur au milieu ne laisse rien de modifié.
 */
create or replace function public.restaurer_sauvegarde(p_donnees jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  foyer uuid := public.mon_foyer();
  r jsonb;
  nouveau bigint;
  m_w jsonb := '{}';
  m_c jsonb := '{}';
  m_p jsonb := '{}';
  m_r jsonb := '{}';
  m_i jsonb := '{}';
  n_tx integer := 0;
  ignorees integer := 0;
begin
  if foyer is null then raise exception 'Aucun foyer'; end if;
  if jsonb_typeof(p_donnees -> 'wallets') <> 'array' or jsonb_typeof(p_donnees -> 'transactions') <> 'array' then
    raise exception 'Fichier de sauvegarde invalide';
  end if;
  if jsonb_array_length(p_donnees -> 'wallets') = 0 then
    raise exception 'La sauvegarde ne contient aucun portefeuille';
  end if;

  perform set_config('app.suppression_foyer', 'oui', true);
  perform set_config('app.restauration', 'oui', true);

  delete from public.transactions where foyer_id = foyer;
  delete from public.budgets where foyer_id = foyer;
  delete from public.category_rules where foyer_id = foyer;
  delete from public.recurrences where foyer_id = foyer;
  delete from public.projects where foyer_id = foyer;
  delete from public.imports where foyer_id = foyer;
  delete from public.chat_messages where foyer_id = foyer;
  delete from public.weekly_advice where foyer_id = foyer;
  delete from public.settings where foyer_id = foyer;
  delete from public.categories where foyer_id = foyer;
  delete from public.wallets where foyer_id = foyer;

  for r in select e from jsonb_array_elements(p_donnees -> 'wallets') e order by (e ->> 'id')::bigint loop
    insert into public.wallets (foyer_id, name, type, initial_balance, archived)
      values (foyer, left(coalesce(nullif(r ->> 'name', ''), 'Portefeuille'), 60),
              case when r ->> 'type' in ('courant', 'especes', 'livret', 'autre') then r ->> 'type' else 'autre' end,
              coalesce((r ->> 'initial_balance')::bigint, 0), public.booleen(r -> 'archived'))
      returning id into nouveau;
    m_w := m_w || jsonb_build_object(r ->> 'id', nouveau);
  end loop;

  -- Catégories principales d'abord, puis leurs sous-catégories.
  for r in select e from jsonb_array_elements(coalesce(p_donnees -> 'categories', '[]')) e
           order by (e ->> 'parent_id') is not null, (e ->> 'sort')::int nulls last, (e ->> 'id')::bigint loop
    if (r ->> 'parent_id') is not null and not (m_c ? (r ->> 'parent_id')) then continue; end if;
    insert into public.categories (foyer_id, name, kind, parent_id, icon, sort, technical_key, avoidable)
      values (foyer, left(coalesce(nullif(r ->> 'name', ''), 'Sans nom'), 60),
              case when r ->> 'kind' in ('expense', 'income', 'technical') then r ->> 'kind' else 'expense' end,
              (m_c ->> (r ->> 'parent_id'))::bigint, left(r ->> 'icon', 4), coalesce((r ->> 'sort')::int, 0),
              case when r ->> 'technical_key' in ('transfer', 'adjustment') then r ->> 'technical_key' end,
              public.booleen(r -> 'avoidable'))
      on conflict (foyer_id, technical_key) do nothing
      returning id into nouveau;
    if nouveau is not null then m_c := m_c || jsonb_build_object(r ->> 'id', nouveau); end if;
    nouveau := null;
  end loop;
  -- Les deux catégories techniques sont indispensables aux virements et aux corrections de solde.
  insert into public.categories (foyer_id, name, kind, icon, sort, technical_key)
    select foyer, x.nom, 'technical', x.icon, 1000, x.cle
    from (values ('Virement interne', '🔁', 'transfer'), ('Ajustement de solde', '⚖️', 'adjustment')) x(nom, icon, cle)
    where not exists (select 1 from public.categories c where c.foyer_id = foyer and c.technical_key = x.cle);

  for r in select e from jsonb_array_elements(coalesce(p_donnees -> 'projects', '[]')) e loop
    if not (m_w ? (r ->> 'wallet_id')) then continue; end if;
    insert into public.projects (foyer_id, name, target, due_date, wallet_id, done)
      values (foyer, left(r ->> 'name', 80), greatest(1, (r ->> 'target')::bigint), (r ->> 'due_date')::date,
              (m_w ->> (r ->> 'wallet_id'))::bigint, public.booleen(r -> 'done'))
      returning id into nouveau;
    m_p := m_p || jsonb_build_object(r ->> 'id', nouveau);
  end loop;

  for r in select e from jsonb_array_elements(coalesce(p_donnees -> 'recurrences', '[]')) e loop
    if not (m_w ? (r ->> 'wallet_id')) then continue; end if;
    insert into public.recurrences (foyer_id, label, type, amount, frequency, day, wallet_id, to_wallet_id, category_id, next_date, active)
      values (foyer, left(r ->> 'label', 120), r ->> 'type', (r ->> 'amount')::bigint, r ->> 'frequency', (r ->> 'day')::int,
              (m_w ->> (r ->> 'wallet_id'))::bigint, (m_w ->> (r ->> 'to_wallet_id'))::bigint, (m_c ->> (r ->> 'category_id'))::bigint,
              (r ->> 'next_date')::date, public.booleen(r -> 'active'))
      returning id into nouveau;
    m_r := m_r || jsonb_build_object(r ->> 'id', nouveau);
  end loop;

  for r in select e from jsonb_array_elements(coalesce(p_donnees -> 'imports', '[]')) e loop
    if not (m_w ? (r ->> 'wallet_id')) then continue; end if;
    insert into public.imports (foyer_id, bank, wallet_id, file_name, created_count, skipped_count, created_at)
      values (foyer, coalesce(r ->> 'bank', ''), (m_w ->> (r ->> 'wallet_id'))::bigint, coalesce(r ->> 'file_name', ''),
              coalesce((r ->> 'created_count')::int, 0), coalesce((r ->> 'skipped_count')::int, 0), public.horodatage(r ->> 'created_at'))
      returning id into nouveau;
    m_i := m_i || jsonb_build_object(r ->> 'id', nouveau);
  end loop;

  for r in select e from jsonb_array_elements(p_donnees -> 'transactions') e order by (e ->> 'id')::bigint loop
    if not (m_w ? (r ->> 'wallet_id'))
       or (r ->> 'type') not in ('expense', 'income', 'transfer')
       or (r ->> 'type' = 'transfer' and not (m_w ? (r ->> 'to_wallet_id')))
       or coalesce((r ->> 'amount')::bigint, 0) <= 0 then
      ignorees := ignorees + 1;
      continue;
    end if;
    insert into public.transactions (foyer_id, type, amount, date, time, wallet_id, to_wallet_id, category_id, project_id,
                                     recurrence_id, import_id, label, note, status, payment_method, created_at)
      values (foyer, r ->> 'type', (r ->> 'amount')::bigint, (r ->> 'date')::date,
              case when r ->> 'time' ~ '^\d{2}:\d{2}$' then r ->> 'time' end,
              (m_w ->> (r ->> 'wallet_id'))::bigint, (m_w ->> (r ->> 'to_wallet_id'))::bigint, (m_c ->> (r ->> 'category_id'))::bigint,
              (m_p ->> (r ->> 'project_id'))::bigint, (m_r ->> (r ->> 'recurrence_id'))::bigint, (m_i ->> (r ->> 'import_id'))::bigint,
              left(coalesce(r ->> 'label', ''), 120), left(coalesce(r ->> 'note', ''), 500),
              case when r ->> 'status' = 'to_verify' then 'to_verify' else 'confirmed' end,
              case when r ->> 'payment_method' in ('card', 'cash') then r ->> 'payment_method' end,
              public.horodatage(r ->> 'created_at'));
    n_tx := n_tx + 1;
  end loop;

  insert into public.budgets (foyer_id, category_id, month, amount)
    select foyer, (m_c ->> (e ->> 'category_id'))::bigint, e ->> 'month', (e ->> 'amount')::bigint
    from jsonb_array_elements(coalesce(p_donnees -> 'budgets', '[]')) e
    where m_c ? (e ->> 'category_id') and e ->> 'month' ~ '^\d{4}-\d{2}$' and (e ->> 'amount')::bigint >= 0
    on conflict do nothing;

  insert into public.category_rules (foyer_id, pattern, category_id, wallet_id, hits, updated_at)
    select foyer, e ->> 'pattern', (m_c ->> (e ->> 'category_id'))::bigint, (m_w ->> (e ->> 'wallet_id'))::bigint,
           coalesce((e ->> 'hits')::int, 1), public.horodatage(e ->> 'updated_at')
    from jsonb_array_elements(coalesce(p_donnees -> 'category_rules', '[]')) e
    where m_c ? (e ->> 'category_id') and coalesce(e ->> 'pattern', '') <> ''
    on conflict (foyer_id, pattern) do nothing;

  insert into public.settings (foyer_id, key, value)
    select foyer, e ->> 'key', e ->> 'value'
    from jsonb_array_elements(coalesce(p_donnees -> 'settings', '[]')) e
    where coalesce(e ->> 'key', '') not in ('', 'aiKey') and char_length(e ->> 'key') <= 100 and e ->> 'value' is not null
    on conflict do nothing;

  insert into public.chat_messages (foyer_id, role, content, created_at)
    select foyer, e ->> 'role', e ->> 'content', public.horodatage(e ->> 'created_at')
    from jsonb_array_elements(coalesce(p_donnees -> 'chat_messages', '[]')) e
    where e ->> 'role' in ('user', 'assistant') and e ->> 'content' is not null
    order by (e ->> 'id')::bigint;

  perform set_config('app.restauration', '', true);
  return jsonb_build_object('transactions', n_tx, 'ignorees', ignorees,
                            'portefeuilles', jsonb_array_length(p_donnees -> 'wallets'),
                            'categories', (select count(*) from public.categories where foyer_id = foyer));
end $$;

revoke all on function public.totaux_jour(date, date), public.libelles_evitables(date, date), public.imports_detail(),
  public.restaurer_sauvegarde(jsonb), public.booleen(jsonb), public.horodatage(text) from public, anon;
grant execute on function public.totaux_jour(date, date), public.libelles_evitables(date, date), public.imports_detail(),
  public.restaurer_sauvegarde(jsonb), public.booleen(jsonb), public.horodatage(text) to authenticated;
