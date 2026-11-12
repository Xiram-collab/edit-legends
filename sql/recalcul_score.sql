-- Edit Legends : recalcule le classement (à lancer une fois après le changement de calcul du score).
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
