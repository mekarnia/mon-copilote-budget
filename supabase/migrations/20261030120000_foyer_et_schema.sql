-- Mon copilote budget — schéma Supabase, étape 1.
--
-- Un foyer regroupe plusieurs comptes (vous et votre conjoint) qui voient les
-- mêmes données. Chaque ligne métier porte le foyer_id, et la sécurité par
-- ligne (RLS) ne laisse voir que celles du foyer de l'utilisateur connecté.
-- Les clés étrangères composites (foyer_id, id) empêchent de rattacher une
-- opération au portefeuille ou à la catégorie d'un autre foyer, même en
-- devinant son identifiant.

-- ---------- Foyer et membres ----------

create table public.foyers (
  id uuid primary key default gen_random_uuid(),
  nom text not null default 'Mon foyer' check (char_length(nom) between 1 and 60),
  code_invitation text not null unique,
  cree_par uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.membres (
  user_id uuid primary key references auth.users (id) on delete cascade,
  foyer_id uuid not null references public.foyers (id) on delete cascade,
  prenom text not null default '' check (char_length(prenom) <= 40),
  role text not null default 'membre' check (role in ('proprietaire', 'membre')),
  created_at timestamptz not null default now()
);
create index membres_foyer_idx on public.membres (foyer_id);

/** Le foyer de l'utilisateur connecté. Un compte appartient à un seul foyer. */
create or replace function public.mon_foyer()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select foyer_id from public.membres where user_id = auth.uid()
$$;

-- ---------- Tables métier ----------

create table public.wallets (
  id bigint generated always as identity primary key,
  foyer_id uuid not null default public.mon_foyer() references public.foyers (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  type text not null check (type in ('courant', 'especes', 'livret', 'autre')),
  initial_balance bigint not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (foyer_id, id)
);

create table public.categories (
  id bigint generated always as identity primary key,
  foyer_id uuid not null default public.mon_foyer() references public.foyers (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null check (kind in ('expense', 'income', 'technical')),
  parent_id bigint,
  icon text check (char_length(icon) <= 4),
  sort integer not null default 0,
  technical_key text check (technical_key in ('transfer', 'adjustment')),
  avoidable boolean not null default false,
  unique (foyer_id, id),
  unique (foyer_id, technical_key),
  foreign key (foyer_id, parent_id) references public.categories (foyer_id, id) on delete cascade
);
create index categories_parent_idx on public.categories (foyer_id, parent_id);

create table public.projects (
  id bigint generated always as identity primary key,
  foyer_id uuid not null default public.mon_foyer() references public.foyers (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  target bigint not null check (target > 0),
  due_date date,
  wallet_id bigint not null,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  unique (foyer_id, id),
  foreign key (foyer_id, wallet_id) references public.wallets (foyer_id, id)
);
create index projects_wallet_idx on public.projects (foyer_id, wallet_id);

create table public.recurrences (
  id bigint generated always as identity primary key,
  foyer_id uuid not null default public.mon_foyer() references public.foyers (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  type text not null check (type in ('expense', 'income', 'transfer')),
  amount bigint not null check (amount > 0),
  frequency text not null check (frequency in ('monthly', 'weekly')),
  day integer not null check (day between 0 and 31),
  wallet_id bigint not null,
  to_wallet_id bigint,
  category_id bigint,
  next_date date not null,
  active boolean not null default true,
  unique (foyer_id, id),
  foreign key (foyer_id, wallet_id) references public.wallets (foyer_id, id),
  foreign key (foyer_id, to_wallet_id) references public.wallets (foyer_id, id),
  foreign key (foyer_id, category_id) references public.categories (foyer_id, id) on delete set null (category_id)
);
create index recurrences_wallet_idx on public.recurrences (foyer_id, wallet_id);
create index recurrences_to_wallet_idx on public.recurrences (foyer_id, to_wallet_id);
create index recurrences_category_idx on public.recurrences (foyer_id, category_id);

create table public.imports (
  id bigint generated always as identity primary key,
  foyer_id uuid not null default public.mon_foyer() references public.foyers (id) on delete cascade,
  bank text not null,
  wallet_id bigint not null,
  file_name text not null default '',
  created_count integer not null default 0,
  skipped_count integer not null default 0,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (foyer_id, id),
  foreign key (foyer_id, wallet_id) references public.wallets (foyer_id, id)
);
create index imports_wallet_idx on public.imports (foyer_id, wallet_id);

create table public.transactions (
  id bigint generated always as identity primary key,
  foyer_id uuid not null default public.mon_foyer() references public.foyers (id) on delete cascade,
  type text not null check (type in ('expense', 'income', 'transfer')),
  amount bigint not null check (amount > 0),
  date date not null,
  time text check (time ~ '^\d{2}:\d{2}$'),
  wallet_id bigint not null,
  to_wallet_id bigint,
  category_id bigint,
  project_id bigint,
  recurrence_id bigint,
  import_id bigint,
  label text not null default '' check (char_length(label) <= 120),
  note text not null default '' check (char_length(note) <= 500),
  photo_path text,
  status text not null default 'confirmed' check (status in ('confirmed', 'to_verify')),
  payment_method text check (payment_method in ('card', 'cash')),
  -- Qui a saisi la dépense : vous ou votre conjoint.
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (type <> 'transfer' or (to_wallet_id is not null and to_wallet_id <> wallet_id)),
  foreign key (foyer_id, wallet_id) references public.wallets (foyer_id, id),
  foreign key (foyer_id, to_wallet_id) references public.wallets (foyer_id, id),
  foreign key (foyer_id, category_id) references public.categories (foyer_id, id) on delete set null (category_id),
  foreign key (foyer_id, project_id) references public.projects (foyer_id, id) on delete set null (project_id),
  foreign key (foyer_id, recurrence_id) references public.recurrences (foyer_id, id) on delete set null (recurrence_id),
  foreign key (foyer_id, import_id) references public.imports (foyer_id, id) on delete set null (import_id)
);
create index transactions_foyer_date_idx on public.transactions (foyer_id, date desc, id desc);
create index transactions_wallet_idx on public.transactions (foyer_id, wallet_id);
create index transactions_to_wallet_idx on public.transactions (foyer_id, to_wallet_id);
create index transactions_category_idx on public.transactions (foyer_id, category_id);
create index transactions_project_idx on public.transactions (foyer_id, project_id);
create index transactions_recurrence_idx on public.transactions (foyer_id, recurrence_id);
create index transactions_import_idx on public.transactions (foyer_id, import_id);
create index transactions_status_idx on public.transactions (foyer_id, status);
create index transactions_created_by_idx on public.transactions (created_by);
create index imports_created_by_idx on public.imports (created_by);
create index foyers_cree_par_idx on public.foyers (cree_par);

create table public.budgets (
  foyer_id uuid not null default public.mon_foyer() references public.foyers (id) on delete cascade,
  category_id bigint not null,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  amount bigint not null check (amount >= 0),
  primary key (foyer_id, category_id, month),
  foreign key (foyer_id, category_id) references public.categories (foyer_id, id) on delete cascade
);

create table public.category_rules (
  id bigint generated always as identity primary key,
  foyer_id uuid not null default public.mon_foyer() references public.foyers (id) on delete cascade,
  pattern text not null,
  category_id bigint not null,
  wallet_id bigint,
  hits integer not null default 1,
  updated_at timestamptz not null default now(),
  unique (foyer_id, pattern),
  foreign key (foyer_id, category_id) references public.categories (foyer_id, id) on delete cascade,
  foreign key (foyer_id, wallet_id) references public.wallets (foyer_id, id) on delete set null (wallet_id)
);
create index category_rules_category_idx on public.category_rules (foyer_id, category_id);
create index category_rules_wallet_idx on public.category_rules (foyer_id, wallet_id);

create table public.settings (
  foyer_id uuid not null default public.mon_foyer() references public.foyers (id) on delete cascade,
  key text not null check (char_length(key) <= 100),
  value text not null,
  primary key (foyer_id, key)
);

create table public.chat_messages (
  id bigint generated always as identity primary key,
  foyer_id uuid not null default public.mon_foyer() references public.foyers (id) on delete cascade,
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index chat_messages_foyer_idx on public.chat_messages (foyer_id, id);
create index chat_messages_user_idx on public.chat_messages (user_id);

create table public.weekly_advice (
  foyer_id uuid not null default public.mon_foyer() references public.foyers (id) on delete cascade,
  week text not null,
  message text not null,
  insights jsonb not null,
  generated_by text not null,
  created_at timestamptz not null default now(),
  primary key (foyer_id, week)
);

-- Journal des appels IA : écrit seulement par les fonctions serveur (service role).
create table public.ai_calls (
  id bigint generated always as identity primary key,
  foyer_id uuid not null references public.foyers (id) on delete cascade,
  model text not null,
  fonction text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  micro_usd bigint not null,
  duree_ms integer not null,
  created_at timestamptz not null default now()
);
create index ai_calls_foyer_date_idx on public.ai_calls (foyer_id, created_at);

-- ---------- Sécurité par ligne ----------

alter table public.foyers enable row level security;
alter table public.membres enable row level security;

create policy "foyer : lecture par ses membres" on public.foyers
  for select to authenticated using (id = (select public.mon_foyer()));
create policy "foyer : renommage par ses membres" on public.foyers
  for update to authenticated using (id = (select public.mon_foyer())) with check (id = (select public.mon_foyer()));

create policy "membres : lecture dans son foyer" on public.membres
  for select to authenticated using (foyer_id = (select public.mon_foyer()));
create policy "membres : modifier son prénom" on public.membres
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and foyer_id = (select public.mon_foyer()));

do $$
declare t text;
begin
  foreach t in array array['wallets', 'categories', 'projects', 'recurrences', 'imports', 'transactions',
                           'budgets', 'category_rules', 'settings', 'chat_messages', 'weekly_advice']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "données du foyer" on public.%I for all to authenticated
         using (foyer_id = (select public.mon_foyer()))
         with check (foyer_id = (select public.mon_foyer()))', t);
  end loop;
end $$;

alter table public.ai_calls enable row level security;
create policy "journal IA : lecture dans son foyer" on public.ai_calls
  for select to authenticated using (foyer_id = (select public.mon_foyer()));

-- Les catégories techniques ne se modifient ni ne se suppriment.
create or replace function public.proteger_categorie_technique()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.technical_key is not null and current_setting('app.suppression_foyer', true) is distinct from 'oui' then
    raise exception 'Catégorie technique : non modifiable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger categories_techniques_protegees
  before update or delete on public.categories
  for each row when (old.technical_key is not null)
  execute function public.proteger_categorie_technique();

-- ---------- Création du foyer et invitation ----------

/** Catégories et portefeuilles de départ, identiques à la version locale. */
create or replace function public.semer_foyer(p_foyer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  groupe record;
  enfant text;
  parent_id bigint;
  ordre integer := 0;
begin
  for groupe in
    select * from (values
      ('Maison', 'expense', '🏠', null::text, array['Loyer ou crédit', 'Électricité et gaz', 'Eau', 'Internet et téléphone', 'Assurance habitation', 'Entretien et travaux']),
      ('Courses', 'expense', '🛒', null, array['Supermarché', 'Boulangerie', 'Marché']),
      ('Enfants', 'expense', '🧒', null, array['École et cantine', 'Garde', 'Activités', 'Vêtements', 'Jouets et cadeaux']),
      ('Transport', 'expense', '🚗', null, array['Carburant', 'Transports en commun', 'Entretien et assurance voiture', 'Parking et péage']),
      ('Santé', 'expense', '💊', null, array['Médecin et pharmacie', 'Mutuelle', 'Optique et dentaire']),
      ('Sorties et loisirs', 'expense', '🎉', null, array['Restaurant', 'Sorties', 'Abonnements', 'Vacances', 'Sport']),
      ('Perso', 'expense', '👕', null, array['Vêtements', 'Beauté et coiffeur', 'Divers']),
      ('Banque et impôts', 'expense', '🏦', null, array['Impôts', 'Frais bancaires', 'Assurances autres']),
      ('Revenus', 'income', '💶', null, array['Salaire', 'Aides (CAF, APL)', 'Remboursements', 'Autres revenus']),
      ('Virement interne', 'technical', '🔁', 'transfer', array[]::text[]),
      ('Ajustement de solde', 'technical', '⚖️', 'adjustment', array[]::text[])
    ) as g(nom, kind, icon, cle, enfants)
  loop
    insert into public.categories (foyer_id, name, kind, parent_id, icon, sort, technical_key)
      values (p_foyer, groupe.nom, groupe.kind, null, groupe.icon, ordre, groupe.cle)
      returning id into parent_id;
    ordre := ordre + 1;
    foreach enfant in array groupe.enfants loop
      insert into public.categories (foyer_id, name, kind, parent_id, sort, avoidable)
        values (p_foyer, enfant, groupe.kind, parent_id, ordre,
                enfant in ('Restaurant', 'Sorties', 'Livraison repas', 'Vêtements'));
      ordre := ordre + 1;
    end loop;
  end loop;

  insert into public.wallets (foyer_id, name, type, initial_balance) values
    (p_foyer, 'Compte courant', 'courant', 0),
    (p_foyer, 'Espèces', 'especes', 0),
    (p_foyer, 'Livret', 'livret', 0);
end $$;
revoke all on function public.semer_foyer(uuid) from public, anon, authenticated;

/** Un code d'invitation lisible à l'oral : 8 caractères sans 0/O ni 1/I. */
create or replace function public.nouveau_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 8)
$$;

/** Premier compte du foyer : il le crée, devient propriétaire, et le foyer reçoit ses catégories. */
create or replace function public.creer_foyer(p_nom text default 'Mon foyer', p_prenom text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare nouveau uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if exists (select 1 from public.membres where user_id = auth.uid()) then
    raise exception 'Ce compte appartient déjà à un foyer';
  end if;
  insert into public.foyers (nom, code_invitation, cree_par)
    values (coalesce(nullif(trim(p_nom), ''), 'Mon foyer'), public.nouveau_code(), auth.uid())
    returning id into nouveau;
  insert into public.membres (user_id, foyer_id, prenom, role)
    values (auth.uid(), nouveau, left(trim(coalesce(p_prenom, '')), 40), 'proprietaire');
  perform public.semer_foyer(nouveau);
  return nouveau;
end $$;

/** Le conjoint rejoint le foyer avec le code affiché dans Réglages. */
create or replace function public.rejoindre_foyer(p_code text, p_prenom text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare cible uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if exists (select 1 from public.membres where user_id = auth.uid()) then
    raise exception 'Ce compte appartient déjà à un foyer';
  end if;
  select id into cible from public.foyers where code_invitation = upper(trim(p_code));
  if cible is null then
    -- Une seconde d'attente : un code ne se devine pas à la vitesse du réseau.
    perform pg_sleep(1);
    raise exception 'Code d''invitation inconnu';
  end if;
  if (select count(*) from public.membres where foyer_id = cible) >= 6 then
    raise exception 'Ce foyer compte déjà 6 membres';
  end if;
  insert into public.membres (user_id, foyer_id, prenom, role)
    values (auth.uid(), cible, left(trim(coalesce(p_prenom, '')), 40), 'membre');
  return cible;
end $$;

/** Changer le code : l'ancien ne permet plus d'entrer. */
create or replace function public.renouveler_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare code text := public.nouveau_code();
begin
  update public.foyers set code_invitation = code where id = public.mon_foyer();
  if not found then raise exception 'Aucun foyer'; end if;
  return code;
end $$;

revoke all on function public.creer_foyer(text, text), public.rejoindre_foyer(text, text), public.renouveler_code(), public.nouveau_code()
  from public, anon;
grant execute on function public.creer_foyer(text, text), public.rejoindre_foyer(text, text), public.renouveler_code()
  to authenticated;
revoke all on function public.mon_foyer() from public, anon;
grant execute on function public.mon_foyer() to authenticated;
