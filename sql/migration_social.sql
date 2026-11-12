-- Edit Legends : classement, amis, partage et administration.
-- À coller dans Supabase > SQL Editor, puis "Run". Peut être relancée sans danger.

-- 1) Résumé de chaque joueur pour le classement (mis à jour automatiquement par le site)
alter table public.saves add column if not exists owned   integer not null default 0;
alter table public.saves add column if not exists mythics integer not null default 0;
alter table public.saves add column if not exists score   integer not null default 0;
alter table public.saves add column if not exists opened  integer not null default 0;
alter table public.saves add column if not exists hidden  boolean not null default false;
create index if not exists saves_score_idx   on public.saves (score desc);
create index if not exists saves_owned_idx   on public.saves (owned desc);
create index if not exists saves_mythics_idx on public.saves (mythics desc);

-- 2) Profils : date d'inscription, dernière visite, identifiant du lien de partage
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists last_seen  timestamptz;
alter table public.profiles add column if not exists share_id   text;
create unique index if not exists profiles_share_id_key on public.profiles (share_id);
update public.profiles p set created_at = u.created_at, last_seen = coalesce(p.last_seen, u.last_sign_in_at, u.created_at)
  from auth.users u where u.id = p.user_id;

-- 3) Amis : a = celui qui invite, b = celui qui reçoit l'invitation
create table if not exists public.friends (
  a uuid not null references auth.users(id) on delete cascade,
  b uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a <> b)
);
create index if not exists friends_b_idx on public.friends (b);

-- 4) Journal des actions de l'administrateur sur les comptes des joueurs
create table if not exists public.admin_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  admin_id uuid,
  target_id uuid,
  action text not null,
  detail jsonb
);
create index if not exists admin_log_at_idx on public.admin_log (at desc);

-- 5) Sécurité : seules les fonctions du serveur (clé secrète) accèdent à ces tables
alter table public.friends   enable row level security;
alter table public.admin_log enable row level security;
revoke all on public.friends, public.admin_log from anon, authenticated;
grant all on public.friends, public.admin_log to service_role;

-- 6) Remplit le classement avec les collections déjà existantes.
--    Score = points x exemplaires obtenus (doublons compris, même revendus) :
--    Commun 1, Atypique 2, Rare 4, Épique 10, Légendaire 25, Mythique 60.
update public.saves s set
  owned   = (select count(*) from jsonb_each_text(coalesce(s.data::jsonb -> 'col', '{}'::jsonb)) e where e.value::int > 0),
  mythics = (select count(*) from jsonb_each_text(coalesce(s.data::jsonb -> 'col', '{}'::jsonb)) e
             join public.cards c on c.id = e.key::int where e.value::int > 0 and c.rarity = 5),
  score   = (select coalesce(sum(
               (case c.rarity when 0 then 1 when 1 then 2 when 2 then 4 when 3 then 10 when 4 then 25 else 60 end)
               * greatest(coalesce((s.data::jsonb -> 'col' ->> c.id::text)::int, 0), coalesce((s.data::jsonb -> 'pulled' ->> c.id::text)::int, 0))
             ), 0) from public.cards c),
  opened  = coalesce((s.data::jsonb ->> 'opened')::int, 0),
  hidden  = coalesce((s.data::jsonb ->> 'hide')::boolean, false);
