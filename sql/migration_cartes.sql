-- Création de cartes depuis l'onglet Admin (à lancer une fois dans Supabase > SQL Editor)

-- Cartes privées en attente du jury (pas encore dans les packs)
create table if not exists public.card_drafts (
  id bigint generated always as identity primary key,
  name text not null,
  cat smallint not null check (cat between 0 and 3),
  rarity smallint not null check (rarity between 0 and 5),
  descr text not null default '',
  img text not null default '',
  votes jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.card_drafts enable row level security;
revoke all on public.card_drafts from anon, authenticated;
grant all on public.card_drafts to service_role;

-- Dossier public pour les logos des nouvelles cartes
insert into storage.buckets (id, name, public) values ('cards', 'cards', true) on conflict (id) do nothing;

-- Retirer une carte des packs sans la supprimer (les joueurs qui l'ont la gardent)
alter table public.cards add column if not exists retired boolean not null default false;
