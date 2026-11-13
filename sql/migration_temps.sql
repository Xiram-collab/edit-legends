-- Edit Legends : classement des temps de la map (hebdomadaire).
-- À coller dans Supabase > SQL Editor, puis "Run". Peut être relancée sans danger.

create table if not exists public.time_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  week text not null,                       -- lundi de la semaine (heure de Paris), AAAA-MM-JJ
  ms integer not null check (ms between 1000 and 3600000),
  link text not null,                       -- lien de la vidéo (preuve)
  note text not null default '',
  device text not null default '',
  platform text not null default '',
  hide_run boolean not null default false,  -- true : le lien de la vidéo n'est visible que par l'admin
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  paid boolean not null default false,      -- true : semaine soldée (récompenses versées)
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists time_runs_week_idx on public.time_runs (week, status, ms);
create index if not exists time_runs_user_idx on public.time_runs (user_id);
alter table public.time_runs enable row level security;
revoke all on public.time_runs from anon, authenticated;
grant all on public.time_runs to service_role;

-- Retire la description de la carte de Jude (sur sa demande).
-- Vérifie d'abord : select id, name, descr from public.cards where name ilike '%jude%';
update public.cards set descr = '' where lower(name) = 'jude';
update public.card_drafts set descr = '' where lower(name) = 'jude';
