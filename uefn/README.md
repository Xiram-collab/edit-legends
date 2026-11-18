# Map UEFN « Steal a Brainrot » version éditeurs

Le code Verse est dans `uefn/Verse/`. À copier dans le dossier Verse de ton projet UEFN
(`Documents/Fortnite Projects/<TonProjet>/Plugins/<TonProjet>/Content/`), puis
**Verse > Build Verse Code**.

| Fichier | Rôle |
|---|---|
| `config_jeu.verse` | **TOUS les réglages** : éditeurs, prix, gains, %, délais, coûts, durées |
| `utilitaires.verse` | formatage des nombres (1 000 000) et du minuteur (59:59) |
| `gestionnaire_couloir.verse` | device du couloir : spawn, déplacement, panneaux, minuteur |

---

## Étape 1 : couloir, portails, disques toutes les 5 s

### 1. Le disque (une seule fois)
1. Importe un mesh de disque plat (ou utilise un cylindre très fin de la bibliothèque),
   **debout** comme une pièce de monnaie (face visible sur le côté), centré sur son origine.
2. Crée 6 matériaux simples de contour : gris, vert, bleu, violet, orange, rouge.
3. Crée **6 Blueprints de prop** (Content Browser > clic droit > Blueprint Class > *Creative Prop*) :
   `BP_Disque_Commun`, `BP_Disque_Atypique`, ..., `BP_Disque_Mythique`, chacun avec le disque et le
   contour de sa couleur. Ce sont les disques « par défaut » quand un éditeur n'a pas encore son PNG.
4. (Peut se faire plus tard, éditeur par éditeur) Pour chaque PNG de pseudo : un matériau avec le PNG
   sur la face + le contour de sa rareté, puis un Blueprint de prop `BP_Disque_<Pseudo>`.
   Les images déjà dans `public/img/` du site peuvent servir de base.

### 2. Le couloir
1. Un long couloir droit (~120 m conseillé). Barrières (murs, ou Barrier device) des 2 côtés de la
   file, pour que personne ne marche dessus.
2. **Portail d'entrée** au début, **portail de sortie** au bout (déco au choix : arche, anneau).
3. Pour chaque portail : 1 **VFX Spawner** (particules) + 1 **Customizable Light**.
4. Deux props quelconques (petit cube) comme **repères** : un au centre du portail d'entrée
   (`RepereEntree`), un au centre du portail de sortie (`RepereSortie`), **à la même hauteur**
   (hauteur du centre du disque). Le Verse les cache au lancement.

### 3. Les panneaux
1. 1 **Billboard** au-dessus du portail d'entrée (`PanneauMinuteur`), grand texte.
2. **15 Billboards** (`PanneauPrix_01` à `_15`) posés n'importe où, **orientés vers l'endroit où se
   tiennent les joueurs** pour regarder la file (ils gardent leur orientation en suivant les disques).
   Texte moyen, centré. 15 suffit pour un couloir de 120 m (60 s de trajet / 5 s = 12 disques).
   Si le couloir est plus long, ajoute des panneaux (sinon des disques sortiront sans panneau).

### 4. Le device Verse
1. Après Build Verse Code, glisse **gestionnaire_couloir** depuis le Content Browser dans la map.
2. Dans ses Détails :
   - `PointEntree` → `RepereEntree`, `PointSortie` → `RepereSortie`
   - `ModelesParRarete` → 6 éléments **dans l'ordre** Commun, Atypique, Rare, Épique, Légendaire, Mythique
   - `VisuelsEditeurs` → (facultatif) un élément par éditeur : `Nom` = pseudo exact, `Modele` = son BP
   - `PanneauxPrix` → les 15 Billboards
   - `PanneauMinuteur` → le Billboard du portail
   - `EffetsPortails` → les VFX Spawners

### À tester en playtest
- [ ] Un disque sort du portail d'entrée toutes les 5 s, ils forment une file régulière.
- [ ] Chaque disque avance droit **et** tourne sur lui-même, sans à-coups visibles.
- [ ] Il disparaît au portail de sortie.
- [ ] Le panneau au-dessus affiche pseudo / rareté / prix (ex. `1 000 000 pièces`) et suit le disque.
- [ ] Le minuteur au-dessus du portail décompte depuis `60:00` et repart à `60:00` après `00:00`
      (pour tester vite : mets `ConfigDureeCycleLegendaire : int = 30` dans la config).
- [ ] Les repères sont invisibles, les effets des portails sont allumés.
- [ ] Pas de lag après 5 minutes (regarde le nombre de disques en même temps : ~12).

Réglages utiles dans `config_jeu.verse` : `ConfigIntervalleSpawn`, `ConfigVitesseDisque`,
`ConfigVitesseRotation`, `ConfigHauteurPanneau`.
