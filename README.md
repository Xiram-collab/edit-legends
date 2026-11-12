# Edit Legends

Site de cartes à collectionner sur la scène Fortnite edit.

- `public/` : le site (page, images, pages légales)
- `api/game.js` + `lib/` : le serveur (Vercel). Toute la logique du jeu s'exécute ici : tirage des packs, V-Bucks, ventes, codes de la roue, mode test réservé à l'administrateur.
- `sql/migration.sql` : tables Supabase (à coller dans SQL Editor) ; `sql/codes.csv` : les 50 000 codes de la roue.
- `tests/` : `npm install && npm test` lance 26 vérifications du serveur sur une base simulée ; `node tests/devserver.js` lance le site en local.

## Variables à définir dans Vercel (Settings > Environment Variables)
| Nom | Valeur |
|---|---|
| `SUPABASE_URL` | l'adresse du projet Supabase |
| `SUPABASE_SECRET_KEY` | la clé « secret » de Supabase (jamais dans le code) |
| `ADMIN_DISCORD_IDS` | identifiants Discord autorisés à ouvrir l'onglet Test (séparés par des virgules) |

## Ajouter une carte
Supabase > Table Editor > `cards` > Insert row : `id` (suivant le dernier), `name`, `cat` (0 Éditeur, 1 Influenceur, 2 Map edit, 3 Structure), `rarity` (0 Commun … 5 Mythique), `descr`, `img` (nom du fichier dans `public/img`, ou vide). Ne jamais supprimer une carte ni changer un `id`.
