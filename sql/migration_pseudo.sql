-- Pseudo et avatar modifiables (à lancer une fois dans Supabase > SQL Editor)
alter table profiles add column if not exists custom_name text;
alter table profiles add column if not exists no_avatar boolean not null default false;
alter table profiles add column if not exists d_name text;
alter table profiles add column if not exists d_avatar text;
