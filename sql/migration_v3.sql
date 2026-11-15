-- Mise à jour V3 : à lancer UNE FOIS dans Supabase (SQL Editor), sans risque si déjà lancé.
-- Classement Collection par points de rareté : chaque carte différente possédée rapporte des points selon sa rareté
-- (les doublons ne comptent pas, et le total suit les ventes). Les valeurs existantes sont calculées automatiquement par le site.
alter table saves add column if not exists cscore integer;
create index if not exists saves_cscore on saves (cscore desc, owned desc, mythics desc, cat asc);

-- Droits détaillés des admins (menu Admin > Équipe). null = anciens droits complets.
alter table profiles add column if not exists perms text;
