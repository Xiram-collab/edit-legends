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

## Sauvegarde automatique (GitHub Actions)
Le workflow `.github/workflows/backup.yml` exporte chaque jour les tables Supabase (profiles, saves, cards, codes) dans une archive **chiffrée** conservée 90 jours (onglet Actions > dernière exécution > Artifacts).
Secrets à créer (Settings > Secrets and variables > Actions) : `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `BACKUP_PASSPHRASE` (phrase de 12 caractères ou plus, à garder précieusement : sans elle, la sauvegarde est illisible).
Restauration :
```
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in sauvegarde-AAAA-MM-JJ.tar.gz.enc -out sauvegarde.tar.gz   # demande le mot de passe
tar -xzf sauvegarde.tar.gz
SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/restore.js backup
```

## Communauté et administration

- **Migration à lancer une fois** : `sql/migration_social.sql` (Supabase > SQL Editor > Run). Elle ajoute le classement, les amis, le lien de partage et le journal admin, et remplit le classement avec les collections existantes.
- Onglet **Communauté** : classement (score, cartes, Mythiques, packs), amis (demande + acceptation, collection visible entre amis), Mon 11, tier list, partage de collection (`/c/<id>`, page publique sans V-Bucks).
- Onglet **Admin** (propriétaire = `ADMIN_DISCORD_IDS`, admins nommés depuis la fiche d'un joueur) : liste des joueurs, fiche joueur (V-Bucks, packs gratuits, packs en attente, cartes +/-), statistiques globales, journal de toutes les actions.
