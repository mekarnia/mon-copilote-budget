-- Deux foyers : Yaniss + conjointe d'un côté, un inconnu de l'autre.
-- Chaque bloc agit sous le rôle « authenticated » avec un identifiant simulé.
\set ON_ERROR_STOP 1
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'lui@exemple.fr'),
  ('00000000-0000-0000-0000-00000000000b', 'elle@exemple.fr'),
  ('00000000-0000-0000-0000-00000000000c', 'inconnu@exemple.fr');

create temp table resultat (essai text, ok boolean);
grant all on resultat to authenticated;

-- Lui crée le foyer.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.creer_foyer('Foyer Mekarnia', 'Yaniss') is not null as foyer_cree;
insert into resultat select 'catégories semées', count(*) = 47 from public.categories;
insert into resultat select 'portefeuilles semés', count(*) = 3 from public.wallets;
insert into public.transactions (type, amount, date, wallet_id, category_id, label)
  select 'expense', 4550, current_date, (select id from public.wallets where name = 'Compte courant'),
         (select id from public.categories where name = 'Supermarché'), 'CB CARREFOUR 12/10';
insert into resultat select 'règle apprise', exists (select 1 from public.category_rules where pattern = 'carrefour');
insert into resultat select 'auteur enregistré', (select created_by_prenom from public.transactions_detail limit 1) = 'Yaniss';
create temp table code as select code_invitation from public.foyers;
reset role;
grant select on code to authenticated;

-- Elle rejoint avec le code et voit la même dépense.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.rejoindre_foyer((select code_invitation from code), 'Sarah') is not null as rejoint;
insert into resultat select 'conjointe voit la dépense', count(*) = 1 from public.transactions;
insert into public.transactions (type, amount, date, wallet_id, category_id, label)
  select 'expense', 1200, current_date, (select id from public.wallets where name = 'Espèces'),
         (select id from public.categories where name = 'Boulangerie'), 'Boulangerie Paul';
insert into resultat select 'accueil commun', (public.accueil(to_char(current_date, 'YYYY-MM'))->>'expense')::bigint = 5750;
insert into resultat select 'deux membres visibles', count(*) = 2 from public.membres;

-- L'inconnu crée son propre foyer et ne voit rien de l'autre.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select public.creer_foyer('Autre', 'X') is not null;
insert into resultat select 'inconnu : aucune transaction', count(*) = 0 from public.transactions;
insert into resultat select 'inconnu : un seul foyer visible', count(*) = 1 from public.foyers;
insert into resultat select 'inconnu : un seul membre visible', count(*) = 1 from public.membres;
insert into resultat select 'inconnu : solde nul', (public.accueil(to_char(current_date, 'YYYY-MM'))->>'expense')::bigint = 0;
reset role; select essai, ok from resultat;
