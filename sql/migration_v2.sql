-- Mise à jour V2 : à lancer UNE FOIS dans Supabase (SQL Editor), sans risque si déjà lancé.

-- 1) Classement Collection : date à laquelle le joueur a atteint son nombre de cartes (départage les égalités)
alter table saves add column if not exists cat bigint;
create index if not exists saves_coll on saves (owned desc, mythics desc, cat asc);

-- 2) Propositions de biographie pour « Ma carte »
create table if not exists card_bios (
  id bigint generated always as identity primary key,
  card int not null,
  user_id uuid not null,
  descr text not null,
  status text not null default 'pending',
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists card_bios_user on card_bios (user_id, id desc);
alter table card_bios enable row level security;

-- 3) Récompenses hebdomadaires des classements Runs / Collection (une seule fois par semaine)
create table if not exists board_claims (
  kind text primary key,
  wk text not null
);
alter table board_claims enable row level security;

-- 4) Journal d'activité des joueurs (admin > Système > Activité joueurs)
create table if not exists player_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null,
  detail text not null default '',
  at timestamptz not null default now()
);
create index if not exists player_log_user on player_log (user_id, id desc);
alter table player_log enable row level security;
