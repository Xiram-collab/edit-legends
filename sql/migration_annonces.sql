-- Annonces affichées dans la cloche de l'en-tête (à lancer une fois dans Supabase > SQL Editor)
create table if not exists announcements (
  id bigint generated always as identity primary key,
  text text not null,
  created_at timestamptz not null default now()
);
alter table announcements enable row level security;
