-- Les échéances dues deviennent des opérations. Le serveur local le faisait
-- toutes les heures ; ici, l'application l'appelle à chaque ouverture, avec la
-- date du téléphone (le serveur Supabase vit en UTC). Rejouer est sans effet :
-- next_date avance à chaque opération créée.
create or replace function public.executer_echeances(p_aujourdhui date default current_date)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r record;
  prochaine date;
  garde integer;
  cree integer := 0;
begin
  for r in select * from public.recurrences where active and next_date <= p_aujourdhui for update loop
    prochaine := r.next_date;
    garde := 0;
    while prochaine <= p_aujourdhui and garde < 400 loop
      insert into public.transactions (foyer_id, type, amount, date, wallet_id, to_wallet_id, category_id, recurrence_id, label)
        values (r.foyer_id, r.type, r.amount, prochaine, r.wallet_id, r.to_wallet_id, r.category_id, r.id, r.label);
      cree := cree + 1;
      garde := garde + 1;
      prochaine := public.prochaine_occurrence(r.frequency, r.day, prochaine + 1);
    end loop;
    update public.recurrences set next_date = prochaine where id = r.id;
  end loop;
  return cree;
end $$;
revoke all on function public.executer_echeances(date) from public, anon;
grant execute on function public.executer_echeances(date) to authenticated;
