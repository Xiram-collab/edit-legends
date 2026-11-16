-- Nouvelles catégories de cartes (4 Creative Warrior, 5 Buildfighter, 6 Mappeur, 7 Esport)
-- À lancer une fois dans Supabase > SQL Editor.
-- Sans ça, proposer une carte dans ces catégories donne « Erreur serveur ».
alter table public.card_drafts drop constraint if exists card_drafts_cat_check;
alter table public.card_drafts add constraint card_drafts_cat_check check (cat between 0 and 7);
