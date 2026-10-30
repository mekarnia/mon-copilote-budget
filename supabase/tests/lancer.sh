#!/bin/sh
# Recrée une base vierge, applique les migrations et joue les scénarios RLS.
# Usage : PGHOST=/chemin/socket PGPORT=5433 sh supabase/tests/lancer.sh
set -e
cd "$(dirname "$0")/.."
P="psql -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists essai" -c "create database essai"
$P -d essai -f tests/stub-supabase.sql
for f in migrations/*.sql; do $P -d essai -f "$f"; done
$P -d essai -tA -F ' | ' -f tests/rls.sql | grep '|'
# Tentatives de l'inconnu qui doivent toutes échouer.
attaque() {
  nom="$1"; requete="$2"
  if $P -d essai -tA -c "set role authenticated" \
       -c "select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false)" \
       -c "$requete" >/dev/null 2>/tmp/attaque.err; then
    echo "$nom | ÉCHEC : acceptée"; exit 1
  fi
  echo "$nom | refusée : $(grep -o 'ERROR: .*' /tmp/attaque.err | head -1 | cut -c8-90)"
}
attaque "dépense sur le portefeuille d'un autre foyer" \
  "insert into public.transactions (type, amount, date, wallet_id, category_id) select 'expense', 1, current_date, 1, id from public.categories where name = 'Supermarché'"
attaque "catégorie d'un autre foyer" \
  "insert into public.transactions (type, amount, date, wallet_id, category_id) select 'expense', 1, current_date, min(id), 10 from public.wallets"
attaque "portefeuille créé dans un autre foyer" \
  "insert into public.wallets (foyer_id, name, type) select foyer_id, 'pirate', 'autre' from public.membres where prenom = 'Yaniss' union all select gen_random_uuid(), 'pirate', 'autre'"
attaque "déplacer sa dépense vers un autre foyer" \
  "insert into public.transactions (type, amount, date, wallet_id, category_id) select 'expense', 1, current_date, min(w.id), (select id from public.categories where name = 'Supermarché') from public.wallets w; update public.transactions set foyer_id = gen_random_uuid()"
attaque "rejoindre un second foyer" "select public.rejoindre_foyer('AAAAAAAA', '')"
attaque "semer un autre foyer" "select public.semer_foyer(gen_random_uuid())"
attaque "renommer une catégorie technique" "update public.categories set name = 'x' where technical_key = 'transfer' returning id"
attaque "lire le foyer de l'autre par son code" "select 1/count(*) from public.foyers where nom = 'Foyer Mekarnia'"
attaque "changer de foyer en modifiant sa fiche membre" \
  "update public.membres set foyer_id = (select foyer_id from public.membres where prenom = 'Yaniss') where user_id = auth.uid()"
attaque "se nommer propriétaire" "update public.membres set role = 'proprietaire' where user_id = auth.uid()"
if $P -d essai -tA -c "set role anon" -c "select count(*) from public.transactions" >/dev/null 2>&1; then
  echo "visiteur anonyme | ÉCHEC : lecture acceptée"; exit 1
fi
echo "visiteur anonyme | refusé"
