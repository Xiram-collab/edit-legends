-- Un joueur compte comme « actif » chaque jour où il est venu (et plus seulement le dernier jour).
create table if not exists public.activity_days (
  user_id text not null,
  day date not null,
  primary key (user_id, day)
);
alter table public.activity_days enable row level security;
-- On garde ce qu'on sait déjà : le dernier jour de chaque joueur.
insert into public.activity_days (user_id, day)
select user_id, (last_seen at time zone 'Europe/Paris')::date from public.profiles where last_seen is not null
on conflict do nothing;
