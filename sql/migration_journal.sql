-- Journal d'activité des joueurs (admin > Système > Activité). À lancer une fois dans Supabase.
create table if not exists player_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null,
  detail text not null default '',
  at timestamptz not null default now()
);
create index if not exists player_log_user on player_log (user_id, id desc);
alter table player_log enable row level security;   -- accessible uniquement par le serveur (clé service)
