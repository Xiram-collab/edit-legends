-- V5 : réglages du casino modifiables dans l'admin + demandes d'association « Ma carte ».
-- À lancer une fois dans Supabase > SQL Editor > Run.

-- 1. Réglages (clé -> valeur JSON). Utilisé par Admin > Casino.
create table if not exists public.settings (
  k text primary key,
  v jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;
revoke all on public.settings from anon, authenticated;

-- 2. Demandes d'association : un joueur demande que telle carte soit la sienne. L'admin accepte ou refuse.
create table if not exists public.card_claims (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  card_id integer not null,
  note text not null default '',
  status text not null default 'new',   -- new | accepted | refused
  created_at timestamptz not null default now()
);
create index if not exists card_claims_status on public.card_claims (status);
alter table public.card_claims enable row level security;
revoke all on public.card_claims from anon, authenticated;
