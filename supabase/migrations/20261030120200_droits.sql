-- Droits d'accès de l'API : les projets Supabase récents n'ouvrent plus les
-- tables par défaut. Seuls les comptes connectés y accèdent, et la sécurité par
-- ligne limite chacun à son foyer. Le rôle anonyme ne reçoit rien.

grant select, insert, update, delete on
  public.wallets, public.categories, public.projects, public.recurrences, public.imports,
  public.transactions, public.budgets, public.category_rules, public.settings,
  public.chat_messages, public.weekly_advice
  to authenticated;

-- Foyer et membres : lecture, et modification de son nom ou de son prénom.
-- Création et adhésion passent uniquement par creer_foyer et rejoindre_foyer.
grant select, update (nom) on public.foyers to authenticated;
grant select, update (prenom) on public.membres to authenticated;

-- Le journal IA s'écrit côté serveur ; le foyer ne fait que le lire.
grant select on public.ai_calls to authenticated;
grant select on public.transactions_detail to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
