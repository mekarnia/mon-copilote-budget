-- Calculs de l'étape 1, portés depuis server/services/*.ts.
-- Toutes ces fonctions s'exécutent avec les droits de l'appelant (security
-- invoker) : la sécurité par ligne s'applique, chacun ne calcule que sur son foyer.

-- ---------- Dates ----------

/** Prochaine occurrence >= p_depuis : jour du mois borné à la fin du mois, ou jour de semaine (0 = dimanche). */
create or replace function public.prochaine_occurrence(p_frequence text, p_jour integer, p_depuis date)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  mois date := date_trunc('month', p_depuis)::date;
  candidat date;
begin
  if p_frequence = 'weekly' then
    return p_depuis + ((p_jour - extract(dow from p_depuis)::int + 7) % 7);
  end if;
  candidat := mois + (least(p_jour, extract(day from (mois + interval '1 month - 1 day'))::int) - 1);
  if candidat < p_depuis then
    mois := (mois + interval '1 month')::date;
    candidat := mois + (least(p_jour, extract(day from (mois + interval '1 month - 1 day'))::int) - 1);
  end if;
  return candidat;
end $$;

/** Mois de la forme 'AAAA-MM' -> premier et dernier jour. */
create or replace function public.bornes_mois(p_mois text, out debut date, out fin date)
language sql
immutable
set search_path = ''
as $$
  select to_date(p_mois || '-01', 'YYYY-MM-DD'),
         (to_date(p_mois || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date
$$;

-- ---------- Libellés et règles ----------

/**
 * Comme normalizeLabel : minuscules, sans accents ni ponctuation, sans les
 * mots bancaires, sans les nombres isolés (dates, références).
 */
create or replace function public.normaliser_libelle(p_libelle text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(normalize(lower(coalesce(p_libelle, '')), NFD), '[̀-ͯ]', '', 'g'),
                 '(cb|carte|paiement|prlv|prelevement|vir|virement|sepa|facture|achat)\M', ' ', 'g'),
               '[^a-z0-9 ]+', ' ', 'g'),
             '\m\d+\M', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

/** Règle exacte d'abord, puis motif contenu en mots entiers (le plus long gagne). */
create or replace function public.regle_pour(p_libelle text)
returns table (category_id bigint, wallet_id bigint)
language sql
stable
set search_path = ''
as $$
  with n as (select public.normaliser_libelle(p_libelle) as v)
  select r.category_id, r.wallet_id
  from public.category_rules r, n
  where n.v <> '' and (
    r.pattern = n.v
    or (char_length(r.pattern) >= 3 and char_length(n.v) >= 3
        and (position(' ' || r.pattern || ' ' in ' ' || n.v || ' ') > 0
             or position(' ' || n.v || ' ' in ' ' || r.pattern || ' ') > 0)))
  order by (r.pattern = n.v) desc, char_length(r.pattern) desc
  limit 1
$$;

-- ---------- Cohérence des transactions ----------

/** Un virement prend la catégorie technique ; une dépense ou un revenu n'a pas de destination. */
create or replace function public.normaliser_transaction()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type = 'transfer' then
    select id into new.category_id from public.categories
      where foyer_id = new.foyer_id and technical_key = 'transfer';
    new.payment_method := null;
  else
    new.to_wallet_id := null;
  end if;
  return new;
end $$;
create trigger transactions_normalisees
  before insert or update of type, category_id, to_wallet_id, payment_method on public.transactions
  for each row execute function public.normaliser_transaction();

/**
 * Chaque catégorie choisie par l'utilisateur crée ou renforce une règle.
 * Pas d'apprentissage pour les échéances automatiques ni pour les lignes
 * importées tant qu'elles ne sont pas confirmées.
 */
create or replace function public.apprendre_regle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare motif text := public.normaliser_libelle(new.label);
begin
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
create trigger transactions_apprentissage
  after insert or update of status, category_id, label on public.transactions
  for each row execute function public.apprendre_regle();

-- ---------- Vues de lecture ----------

/** Transactions avec les noms à afficher, et le prénom de qui l'a saisie. */
create or replace view public.transactions_detail
with (security_invoker = true) as
select t.*,
       c.name as category_name,
       c.technical_key,
       c.parent_id as category_parent_id,
       w.name as wallet_name,
       w2.name as to_wallet_name,
       m.prenom as created_by_prenom
from public.transactions t
left join public.categories c on c.id = t.category_id
join public.wallets w on w.id = t.wallet_id
left join public.wallets w2 on w2.id = t.to_wallet_id
left join public.membres m on m.user_id = t.created_by;

/** Solde de chaque portefeuille à une date (par défaut : toutes les opérations). */
create or replace function public.soldes(p_date date default '9999-12-31', p_archives boolean default false)
returns table (id bigint, name text, type text, initial_balance bigint, archived boolean, balance bigint)
language sql
stable
set search_path = ''
as $$
  select w.id, w.name, w.type, w.initial_balance, w.archived,
         w.initial_balance + coalesce((
           select sum(case
             when t.type = 'income' and t.wallet_id = w.id then t.amount
             when t.type in ('expense', 'transfer') and t.wallet_id = w.id then -t.amount
             when t.type = 'transfer' and t.to_wallet_id = w.id then t.amount
             else 0 end)
           from public.transactions t
           where (t.wallet_id = w.id or t.to_wallet_id = w.id) and t.date <= p_date), 0)::bigint
  from public.wallets w
  where p_archives or not w.archived
  order by w.id
$$;

/** Projets avec l'épargne réunie et le montant mensuel nécessaire. */
create or replace function public.projets(p_aujourdhui date default current_date)
returns table (id bigint, name text, target bigint, due_date date, wallet_id bigint, wallet_name text,
               saved bigint, remaining bigint, ratio double precision, monthly_needed bigint, done boolean)
language sql
stable
set search_path = ''
as $$
  with p as (
    select p.*, w.name as wallet_name,
           coalesce((select sum(case when t.to_wallet_id = p.wallet_id then t.amount else -t.amount end)
                     from public.transactions t where t.project_id = p.id and t.type = 'transfer'), 0)::bigint as saved
    from public.projects p join public.wallets w on w.id = p.wallet_id
  )
  select p.id, p.name, p.target, p.due_date, p.wallet_id, p.wallet_name, p.saved,
         greatest(0, p.target - p.saved),
         least(1.0, p.saved::double precision / p.target),
         case when p.due_date is not null and p.target > p.saved then
           ceil((p.target - p.saved)::numeric / greatest(1,
             (extract(year from age(p.due_date, p_aujourdhui)) * 12 + extract(month from age(p.due_date, p_aujourdhui)))::int + 1))::bigint
         end,
         p.done or p.saved >= p.target
  from p
  order by p.id
$$;

/** Échéances des récurrences actives entre deux dates incluses. */
create or replace function public.echeances(p_du date, p_au date)
returns table (recurrence_id bigint, label text, amount bigint, date date, type text)
language plpgsql
stable
set search_path = ''
as $$
declare
  r record;
  prochaine date;
  garde integer;
begin
  for r in select * from public.recurrences where active loop
    prochaine := case when r.next_date < p_du then public.prochaine_occurrence(r.frequency, r.day, p_du) else r.next_date end;
    garde := 0;
    while prochaine <= p_au and garde < 60 loop
      recurrence_id := r.id; label := r.label; amount := r.amount; date := prochaine; type := r.type;
      return next;
      prochaine := public.prochaine_occurrence(r.frequency, r.day, prochaine + 1);
      garde := garde + 1;
    end loop;
  end loop;
end $$;

/** Lignes de budget d'un mois : couleur verte sous 80 %, orange jusqu'à 100 %, rouge au-delà. */
create or replace function public.lignes_budget(p_mois text)
returns table (category_id bigint, category_name text, icon text, amount bigint, spent bigint, ratio double precision, status text)
language sql
stable
set search_path = ''
as $$
  with b as (select * from public.bornes_mois(p_mois)),
  depense as (
    select coalesce(c.parent_id, c.id) as parent, sum(t.amount)::bigint as total
    from public.transactions t join public.categories c on c.id = t.category_id, b
    where t.type = 'expense' and c.technical_key is null and t.date between b.debut and b.fin
    group by 1
  )
  select c.id, c.name, c.icon, coalesce(bu.amount, 0), coalesce(d.total, 0),
         case when coalesce(bu.amount, 0) > 0 then coalesce(d.total, 0)::double precision / bu.amount else 0 end,
         case when coalesce(bu.amount, 0) = 0 then 'none'
              when coalesce(d.total, 0) > bu.amount then 'red'
              when coalesce(d.total, 0) >= 0.8 * bu.amount then 'orange'
              else 'green' end
  from public.categories c
  left join public.budgets bu on bu.category_id = c.id and bu.month = p_mois
  left join depense d on d.parent = c.id
  where c.parent_id is null and c.kind = 'expense'
  order by c.sort
$$;

/** L'écran d'accueil en un appel : reste à dépenser, répartition, échéances, alertes. */
create or replace function public.accueil(p_mois text, p_aujourdhui date default current_date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  b record;
  depuis date;
  revenus bigint;
  depenses bigint;
  a_venir_dep bigint := 0;
  a_venir_rev bigint := 0;
begin
  select * into b from public.bornes_mois(p_mois);
  select coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
         coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)
    into revenus, depenses
    from public.transactions t join public.categories c on c.id = t.category_id
    where c.technical_key is null and t.date between b.debut and b.fin;
  depuis := case when p_aujourdhui > b.fin then b.fin + 1 else p_aujourdhui end;
  if depuis <= b.fin then
    select coalesce(sum(e.amount) filter (where e.type = 'expense'), 0),
           coalesce(sum(e.amount) filter (where e.type = 'income'), 0)
      into a_venir_dep, a_venir_rev
      from public.echeances(depuis, b.fin) e;
  end if;

  return jsonb_build_object(
    'month', p_mois,
    'income', revenus,
    'expense', depenses,
    'upcomingExpense', a_venir_dep,
    'remaining', revenus + a_venir_rev - depenses - a_venir_dep,
    'byCategory', coalesce((
      select jsonb_agg(jsonb_build_object('categoryId', x.id, 'name', x.name, 'icon', x.icon, 'total', x.total) order by x.total desc)
      from (select p.id, p.name, p.icon, sum(t.amount)::bigint as total
            from public.transactions t
            join public.categories c on c.id = t.category_id
            join public.categories p on p.id = coalesce(c.parent_id, c.id)
            where t.type = 'expense' and c.technical_key is null and t.date between b.debut and b.fin
            group by p.id, p.name, p.icon) x), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object('recurrenceId', e.recurrence_id, 'label', e.label, 'amount', e.amount, 'date', e.date, 'type', e.type) order by e.date)
      from public.echeances(p_aujourdhui, p_aujourdhui + 7) e), '[]'::jsonb),
    'redBudgets', coalesce((
      select jsonb_agg(jsonb_build_object('categoryId', l.category_id, 'categoryName', l.category_name, 'icon', l.icon,
                                          'amount', l.amount, 'spent', l.spent, 'ratio', l.ratio, 'status', l.status))
      from public.lignes_budget(p_mois) l where l.status = 'red'), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'target', p.target, 'dueDate', p.due_date,
                                          'walletId', p.wallet_id, 'walletName', p.wallet_name, 'saved', p.saved,
                                          'remaining', p.remaining, 'ratio', p.ratio, 'monthlyNeeded', p.monthly_needed, 'done', p.done))
      from public.projets(p_aujourdhui) p where not p.done), '[]'::jsonb),
    'walletsTotal', coalesce((select sum(s.balance) from public.soldes() s), 0)
  );
end $$;

-- ---------- Actions ----------

/** « Corriger le solde » : l'écart devient une opération d'ajustement, hors statistiques. */
create or replace function public.ajuster_portefeuille(p_wallet bigint, p_solde_reel bigint, p_date date default current_date)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  actuel bigint;
  ecart bigint;
begin
  select s.balance into actuel from public.soldes(p_date, true) s where s.id = p_wallet;
  if actuel is null then raise exception 'Portefeuille introuvable'; end if;
  ecart := p_solde_reel - actuel;
  if ecart <> 0 then
    insert into public.transactions (type, amount, date, wallet_id, category_id, label)
      select case when ecart > 0 then 'income' else 'expense' end, abs(ecart), p_date, p_wallet, c.id, 'Correction du solde'
      from public.categories c where c.technical_key = 'adjustment';
  end if;
  return ecart;
end $$;

/** Un portefeuille déjà utilisé s'archive au lieu d'être supprimé. */
create or replace function public.supprimer_portefeuille(p_wallet bigint)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.wallets where id = p_wallet) then return 'not_found'; end if;
  if exists (select 1 from public.transactions where wallet_id = p_wallet or to_wallet_id = p_wallet)
     or exists (select 1 from public.recurrences where wallet_id = p_wallet or to_wallet_id = p_wallet)
     or exists (select 1 from public.projects where wallet_id = p_wallet)
     or exists (select 1 from public.imports where wallet_id = p_wallet) then
    update public.wallets set archived = true where id = p_wallet;
    return 'archived';
  end if;
  delete from public.wallets where id = p_wallet;
  return 'deleted';
end $$;

/** Suppression d'une catégorie : ses opérations et récurrences passent sur p_vers. */
create or replace function public.supprimer_categorie(p_categorie bigint, p_vers bigint default null)
returns boolean
language plpgsql
set search_path = ''
as $$
declare ids bigint[];
begin
  if not exists (select 1 from public.categories where id = p_categorie and technical_key is null) then return false; end if;
  select array_agg(id) into ids from public.categories where id = p_categorie or parent_id = p_categorie;
  if p_vers is null and exists (select 1 from public.transactions where category_id = any (ids)) then
    raise exception 'Choisir une catégorie de réaffectation';
  end if;
  if p_vers is not null then
    update public.transactions set category_id = p_vers where category_id = any (ids);
    update public.recurrences set category_id = p_vers where category_id = any (ids);
  end if;
  delete from public.categories where id = p_categorie;
  return true;
end $$;

/** Auto-complétion : derniers libellés distincts, avec la catégorie utilisée la dernière fois. */
create or replace function public.suggestions_libelles(p_texte text, p_limite integer default 8)
returns table (label text, category_id bigint, wallet_id bigint, type text, payment_method text)
language sql
stable
set search_path = ''
as $$
  select x.label, x.category_id, x.wallet_id, x.type, x.payment_method from (
    select distinct on (t.label) t.label, t.category_id, t.wallet_id, t.type, t.payment_method, t.date, t.id
    from public.transactions t
    where t.label <> '' and t.type <> 'transfer' and t.label ilike '%' || p_texte || '%'
    order by t.label, t.id desc
  ) x
  order by x.date desc, x.id desc
  limit least(p_limite, 20)
$$;

/** Totaux du mois pour une catégorie et sa catégorie parente (encart du formulaire). */
create or replace function public.contexte_categorie(p_categorie bigint, p_mois text, p_type text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  b record;
  cat record;
  parent record;
  pid bigint;
begin
  select * into b from public.bornes_mois(p_mois);
  select * into cat from public.categories where id = p_categorie;
  if cat.id is null or cat.technical_key is not null then return null; end if;
  pid := coalesce(cat.parent_id, cat.id);
  select id, name, icon into parent from public.categories where id = pid;
  return jsonb_build_object(
    'month', p_mois,
    'currentId', cat.id,
    'parent', (
      select jsonb_build_object('id', parent.id, 'name', parent.name, 'icon', parent.icon,
                                'total', coalesce(sum(t.amount), 0), 'count', count(*))
      from public.transactions t join public.categories c on c.id = t.category_id
      where t.type = p_type and t.date between b.debut and b.fin and (t.category_id = pid or c.parent_id = pid)),
    'subs', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'total', s.total, 'count', s.n) order by s.total desc)
      from (select ch.id, ch.name,
                   coalesce(sum(t.amount), 0)::bigint as total, count(t.id) as n
            from public.categories ch
            left join public.transactions t on t.category_id = ch.id and t.type = p_type and t.date between b.debut and b.fin
            where ch.parent_id = pid
            group by ch.id, ch.name) s
      where s.n > 0 or s.id = cat.id), '[]'::jsonb)
  );
end $$;

revoke all on function public.prochaine_occurrence(text, integer, date), public.bornes_mois(text),
  public.normaliser_libelle(text), public.regle_pour(text), public.soldes(date, boolean), public.projets(date),
  public.echeances(date, date), public.lignes_budget(text), public.accueil(text, date),
  public.ajuster_portefeuille(bigint, bigint, date), public.supprimer_portefeuille(bigint),
  public.supprimer_categorie(bigint, bigint), public.suggestions_libelles(text, integer),
  public.contexte_categorie(bigint, text, text)
  from public, anon;
grant execute on function public.prochaine_occurrence(text, integer, date), public.bornes_mois(text),
  public.normaliser_libelle(text), public.regle_pour(text), public.soldes(date, boolean), public.projets(date),
  public.echeances(date, date), public.lignes_budget(text), public.accueil(text, date),
  public.ajuster_portefeuille(bigint, bigint, date), public.supprimer_portefeuille(bigint),
  public.supprimer_categorie(bigint, bigint), public.suggestions_libelles(text, integer),
  public.contexte_categorie(bigint, text, text)
  to authenticated;
revoke all on function public.normaliser_transaction(), public.apprendre_regle(), public.proteger_categorie_technique()
  from public, anon, authenticated;
