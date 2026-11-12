-- Propositions de cartes : statut « nouvelle » / « jury » + notifications personnelles (à lancer une fois dans Supabase > SQL Editor)
alter table card_drafts add column if not exists status text not null default 'jury';

create table if not exists notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user on notifications(user_id);
alter table notifications enable row level security;
