-- Edit Legends : migration à coller dans Supabase > SQL Editor, puis "Run". Peut être relancée sans danger.

-- 1) Sauvegardes : numéro de version (évite les doubles dépenses si le joueur clique très vite)
alter table public.saves add column if not exists version integer not null default 0;

-- 2) Codes de la roue : "used" est définitif. Pas de lien avec auth.users, donc supprimer un compte ne libère jamais un code.
drop table if exists public.codes;
create table public.codes (
  code text primary key,
  used boolean not null default false,
  used_by uuid,
  used_at timestamptz
);

-- 3) Cartes : tu peux en ajouter depuis Table Editor, elles apparaissent tout de suite sur le site.
--    Ne supprime jamais une carte et ne change pas ses id (les collections des joueurs s'y réfèrent).
--    cat : 0 Éditeur, 1 Influenceur, 2 Map edit, 3 Structure   |   rarity : 0 Commun ... 5 Mythique
create table if not exists public.cards (
  id integer primary key,
  name text not null,
  cat smallint not null,
  rarity smallint not null check (rarity between 0 and 5),
  descr text not null default '',
  img text not null default ''
);

-- 4) Sécurité : personne ne lit ni n'écrit ces tables depuis le navigateur. Seul le serveur (clé secrète) y accède.
alter table public.profiles enable row level security;
alter table public.saves    enable row level security;
alter table public.codes    enable row level security;
alter table public.cards    enable row level security;
revoke all on public.profiles, public.saves, public.codes, public.cards from anon, authenticated;
grant all on public.profiles, public.saves, public.codes, public.cards to service_role;

-- 5) Les 80 cartes actuelles
insert into public.cards (id, name, cat, rarity, descr, img) values
  (0, 'Snaz', 0, 5, '', 'snaz'),
  (1, 'LeBouseuh', 1, 5, '', 'lebouseuh.png'),
  (2, 'Speedy', 0, 3, '', 'speedy.png'),
  (3, 'Nyxo', 0, 4, '', 'nyxo.png'),
  (4, 'Traki', 0, 5, '', 'traki'),
  (5, 'Strom', 0, 3, '', 'strom'),
  (6, 'Just ZiNoX', 0, 2, '', 'zinox'),
  (7, 'Monks', 0, 0, '', 'monks'),
  (8, 'Tinouska', 0, 0, '', 'tinouska'),
  (9, 'nox', 0, 0, '', 'nox'),
  (10, 'DragonnP', 0, 5, '', 'dragonn'),
  (11, 'WaYz', 0, 3, '', 'wayz'),
  (12, 'Trev', 0, 2, '', 'trev'),
  (13, 'FuzionP', 0, 0, '', 'fuzionp'),
  (14, 'NayToo', 0, 2, '', 'naytoo'),
  (15, 'IZUKI', 0, 1, '', 'izuki'),
  (16, 'Xiram', 0, 4, '', 'xiram'),
  (17, 'LatiiX', 0, 2, '', 'latiix'),
  (18, 'aXz', 0, 4, '', 'axz'),
  (19, 'Clow', 0, 3, '', 'clow'),
  (20, 'zacduc', 0, 2, '', 'zacduc'),
  (21, 'Paulito', 0, 2, '', ''),
  (22, 'Ban', 0, 0, '', 'ban'),
  (23, 'cWix', 0, 2, '', 'cwix'),
  (24, 'Roi Borgne', 0, 0, '', 'roiborgne'),
  (25, 'Zyrox', 0, 0, '', 'zyrox'),
  (26, 'XiRozZ', 0, 1, '', 'xirozz'),
  (27, 'ErWaX', 1, 0, '', 'erwax'),
  (28, 'E4 Banco', 0, 2, '', ''),
  (29, 'Meliodas', 0, 2, '', 'meliodas'),
  (30, 'Shin', 0, 0, '', 'shin'),
  (31, 'Minato', 0, 3, '', 'minato'),
  (32, 'Tizeef', 0, 3, '', 'tizeef'),
  (33, 'Dono', 0, 3, '', ''),
  (34, 'La pomme', 0, 0, '', 'lapomme'),
  (35, 'Titan', 0, 0, '', 'titan'),
  (36, 'Nayress', 0, 3, '', 'nayress'),
  (37, 'Itax', 0, 0, '', ''),
  (38, 'Bill Wick', 0, 0, '', 'billwick'),
  (39, 'Srambad', 1, 1, '', 'srambad'),
  (40, 'Cumly', 1, 1, '', 'cumly'),
  (41, 'Coqto', 1, 1, '', 'coqto'),
  (42, 'Practice Raider', 2, 3, '', 'praider'),
  (43, 'BiomeEdit', 2, 1, '', 'biomeedit'),
  (44, 'XiramEditMap', 2, 1, '', 'xirammap'),
  (45, 'WayzEdit1', 2, 0, '', 'wayzedit'),
  (46, 'Editverse', 2, 1, '', 'editverse'),
  (47, 'Versa Edit Practice', 2, 1, '', 'versaedit'),
  (48, 'Nainspeed', 2, 3, '', 'nainspeed'),
  (49, 'TrakiFastEdit', 2, 2, '', 'trakifast'),
  (50, 'Itax Impossible', 2, 0, '', 'itaximpossible'),
  (51, 'Itax Speed Boosts', 2, 0, '', 'itaxspeed'),
  (52, 'Itax Edit Course', 2, 0, '', 'itaxcourse'),
  (53, 'Meliodas Structure', 3, 0, '', 'meliodasstruct'),
  (54, 'Luminex', 0, 2, '', 'luminex'),
  (55, 'E4 Marmotte', 0, 4, '', 'e4marmotte'),
  (56, 'bL Crew', 3, 0, '', 'blcrew'),
  (57, 'Ocram', 0, 1, '', 'ocram'),
  (58, 'Jongalbus', 0, 0, '', 'jongalbus'),
  (59, 'Lakitu', 0, 1, '', 'lakitu'),
  (60, 'El Kino', 0, 0, '', 'elkino'),
  (61, 'Kwayz', 0, 1, '', 'kwayz'),
  (62, 'Tiroguale', 0, 4, '', 'tiroguale'),
  (63, 'Jaguar', 0, 5, '', 'jaguar'),
  (64, 'AyanoEditz-1', 0, 3, '', 'ayano'),
  (65, 'Mr Brocoli', 0, 5, '', 'brocoli'),
  (66, 'Ewarz', 0, 5, '', 'ewarz'),
  (67, 'Mathor', 0, 5, '', 'mathor'),
  (68, 'Cryx', 0, 2, '', 'cryx.png'),
  (69, 'Bouzitournament', 2, 5, '', 'bouzi'),
  (70, 'Mongraal', 2, 5, '', 'mongraal'),
  (71, 'XeloMelz', 2, 2, '', ''),
  (72, 'EtherSpeedCup', 2, 4, '', 'ether'),
  (73, 'Raider v4', 2, 4, '', 'raider'),
  (74, '669', 3, 4, '', '669'),
  (75, '999', 3, 4, '', '999'),
  (76, '69', 3, 1, '', '69'),
  (77, 'Flew', 3, 4, '', 'flew'),
  (78, 'RTC', 3, 0, '', 'rtc'),
  (79, 'P7', 3, 3, '', 'p7')
on conflict (id) do update set name = excluded.name, cat = excluded.cat, rarity = excluded.rarity, descr = excluded.descr, img = excluded.img;
