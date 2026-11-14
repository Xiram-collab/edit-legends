-- Edit Legends : marché (enchères) + « Ma carte » — à coller dans Supabase > SQL Editor, puis "Run". Peut être relancée sans danger.

-- 1) Association joueur <-> carte (faite par le propriétaire dans Admin > Cartes). Un joueur = une carte, une carte = un joueur.
create table if not exists public.card_owner (
  card_id integer primary key,
  user_id uuid not null unique,
  img_at timestamptz            -- dernier changement de logo (1 fois par mois)
);
alter table public.card_owner enable row level security;
revoke all on public.card_owner from anon, authenticated;

-- 2) Marché : une ligne par offre
create table if not exists public.market (
  id bigint generated always as identity primary key,
  seller uuid not null,
  card integer not null,
  start integer not null,                  -- mise de départ
  buynow integer,                          -- prix d'achat immédiat (facultatif)
  bid integer not null default 0,          -- meilleure mise
  bidder uuid,                             -- meilleur enchérisseur
  bids integer not null default 0,
  status text not null default 'open',     -- open | sold | expired
  buyer uuid,
  final integer,
  created_at timestamptz not null default now(),
  ends_at timestamptz not null,
  closed_at timestamptz,
  card_done boolean not null default true, -- carte livrée ?
  pay_done boolean not null default true   -- paiement du vendeur fait ?
);
create index if not exists market_status_idx on public.market (status, ends_at);
alter table public.market enable row level security;
revoke all on public.market from anon, authenticated;
