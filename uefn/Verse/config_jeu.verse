# ============================================================================
#  CONFIG DU JEU — "Steal a Brainrot" version éditeurs Fortnite
#  TOUS les réglages de la map sont ici. Modifie ce fichier, recompile, c'est tout.
#  (Les autres fichiers Verse ne contiennent aucun chiffre "magique".)
# ============================================================================

using { /Verse.org/Simulation }

# ----------------------------------------------------------------------------
#  RARETÉS
# ----------------------------------------------------------------------------

# Les 6 raretés, de la plus courante à la plus rare.
rarete := enum:
    Commun
    Atypique
    Rare
    Epique
    Legendaire
    Mythique

# Ordre officiel des raretés (sert pour les boucles et les tirages).
ToutesLesRaretes : []rarete = array:
    rarete.Commun
    rarete.Atypique
    rarete.Rare
    rarete.Epique
    rarete.Legendaire
    rarete.Mythique

# Nom affiché sur les panneaux.
NomRarete(R : rarete) : string =
    case (R):
        rarete.Commun => "COMMUN"
        rarete.Atypique => "ATYPIQUE"
        rarete.Rare => "RARE"
        rarete.Epique => "ÉPIQUE"
        rarete.Legendaire => "LÉGENDAIRE"
        rarete.Mythique => "MYTHIQUE"

# Couleur (pour info et pour les matériaux de contour : gris, vert, bleu, violet, orange, rouge).
CouleurRareteHex(R : rarete) : string =
    case (R):
        rarete.Commun => "#9E9E9E"
        rarete.Atypique => "#3CB43C"
        rarete.Rare => "#2D7DFF"
        rarete.Epique => "#A040E6"
        rarete.Legendaire => "#FF8C1A"
        rarete.Mythique => "#E62828"

# Position de la rareté dans ToutesLesRaretes (0 = Commun ... 5 = Mythique).
IndexRarete(R : rarete) : int =
    case (R):
        rarete.Commun => 0
        rarete.Atypique => 1
        rarete.Rare => 2
        rarete.Epique => 3
        rarete.Legendaire => 4
        rarete.Mythique => 5

# ----------------------------------------------------------------------------
#  LISTE DES ÉDITEURS (125)
#  Pour ajouter / retirer un éditeur : modifie simplement la liste de sa rareté.
#  Le nom doit être EXACTEMENT celui utilisé dans la liste des visuels du device
#  (gestionnaire_couloir > VisuelsEditeurs) pour que son disque texturé soit utilisé.
# ----------------------------------------------------------------------------

EditeursMythiques : []string = array{
    "Brux", "DragonnP", "Ewarz", "Jaguar", "Mathor", "Mr Brocoli",
    "Nathook", "Skymania", "Snaz", "TheFunnyP", "Traki", "Zywa"}

EditeursLegendaires : []string = array{
    "aXz", "Chikzy", "Dogsy", "E4 Marmotte", "Ether", "Eweement", "Howl", "korentchoin",
    "Kuro", "Nicosse", "Nyxo", "Sleys", "Tiroguale", "Volty", "Xiram", "Zeydo"}

EditeursEpiques : []string = array{
    "AyanoEditz-1", "Camerupt", "Clow", "Dono", "Fleekzy", "Jey", "Jitter", "La banane",
    "Lankyf", "MaT", "Minato", "MisterLink", "Nayress", "Newzy", "Niivers", "Pokesantix",
    "Skyzen", "Speedy", "Strom", "Tizeef", "Vorax", "WaYz", "Zweko"}

EditeursRares : []string = array{
    "Atrox", "Azzer", "Bounchkreu", "bruc", "Cryx", "cWix", "Dreaken", "E4 Banco",
    "E4 Bluee", "EnzoP", "Eren", "Fernos", "Gonne", "Jelimox", "Just ZiNoX", "Kakuzuu",
    "LatiiX", "Loteimo", "Luminex", "Meliodas", "NayToo", "niiwuu", "Paulito", "Pikouille",
    "psiky", "Sweazzy", "Trev", "Turturie", "zacduc", "zokey"}

EditeursAtypiques : []string = array{
    "Aero", "Aleski", "Casual Beluga", "ErenCup1", "IZUKI", "Juiqa", "Kwayz", "Lakitu",
    "Leax", "Monks", "Mxtl9", "nytrox", "Ocram", "Slash", "Sloww", "Swayze",
    "Tid Sneax", "Tinouska", "Viamco", "XiRozZ", "yuuz"}

EditeursCommuns : []string = array{
    "Atlas", "Ban", "Baxie", "Bill Wick", "El Kino", "Flew loup", "Itax", "Jongalbus",
    "Keny", "Kyubot", "La pomme", "Melon", "Nolan", "nox", "RecK", "Roi Borgne",
    "Shin", "TheKarmaP", "Theo Izr", "Titan", "Tsuno", "Yuko", "Zyrox"}

# Liste des éditeurs d'une rareté donnée.
EditeursDeRarete(R : rarete) : []string =
    case (R):
        rarete.Commun => EditeursCommuns
        rarete.Atypique => EditeursAtypiques
        rarete.Rare => EditeursRares
        rarete.Epique => EditeursEpiques
        rarete.Legendaire => EditeursLegendaires
        rarete.Mythique => EditeursMythiques

# ----------------------------------------------------------------------------
#  COULOIR ET SPAWN (étape 1)
# ----------------------------------------------------------------------------

# Un disque sort du portail toutes les X secondes.
ConfigIntervalleSpawn : float = 5.0

# Vitesse d'avance des disques dans le couloir (cm par seconde ; 200 = 2 m/s).
ConfigVitesseDisque : float = 200.0

# Vitesse de rotation des disques sur eux-mêmes (degrés par seconde).
ConfigVitesseRotation : float = 90.0

# Précision du mouvement : le trajet est découpé en petits pas de X secondes.
# (Doit rester petit pour que la rotation soit fluide : VitesseRotation x Pas < 180.)
ConfigPasMouvement : float = 0.5

# Hauteur du panneau prix au-dessus du centre du disque (cm).
ConfigHauteurPanneau : float = 250.0

# Durée du cycle du minuteur au-dessus du portail (secondes). 3600 = 1 heure.
ConfigDureeCycleLegendaire : int = 3600

# Texte au-dessus du minuteur.
ConfigTexteMinuteur : string = "LÉGENDAIRE GARANTI DANS"

# ----------------------------------------------------------------------------
#  PROBABILITÉS DE TIRAGE en % (étape 2 / étape 7 pour les boosts)
#  Niveau de boost : 1 = normal, 2 = boost x2, 3 = boost x3.
# ----------------------------------------------------------------------------

ChanceRarete(R : rarete, NiveauBoost : int) : float =
    if (NiveauBoost >= 3):
        case (R):
            rarete.Commun => 24.54
            rarete.Atypique => 25.0
            rarete.Rare => 33.0
            rarete.Epique => 13.5
            rarete.Legendaire => 3.9
            rarete.Mythique => 0.06
    else if (NiveauBoost = 2):
        case (R):
            rarete.Commun => 41.36
            rarete.Atypique => 25.0
            rarete.Rare => 22.0
            rarete.Epique => 9.0
            rarete.Legendaire => 2.6
            rarete.Mythique => 0.04
    else:
        case (R):
            rarete.Commun => 58.18
            rarete.Atypique => 25.0
            rarete.Rare => 11.0
            rarete.Epique => 4.5
            rarete.Legendaire => 1.3
            rarete.Mythique => 0.02

# ----------------------------------------------------------------------------
#  ÉCONOMIE (étape 3 / 4)
# ----------------------------------------------------------------------------

# Prix d'achat d'un perso.
PrixRarete(R : rarete) : int =
    case (R):
        rarete.Commun => 100
        rarete.Atypique => 500
        rarete.Rare => 2500
        rarete.Epique => 12500
        rarete.Legendaire => 75000
        rarete.Mythique => 1000000

# Gain par seconde d'un perso posé dans la base.
GainParSecondeRarete(R : rarete) : float =
    case (R):
        rarete.Commun => 1.0
        rarete.Atypique => 5.5
        rarete.Rare => 30.0
        rarete.Epique => 160.0
        rarete.Legendaire => 1000.0
        rarete.Mythique => 16000.0

# Part du prix rendue à la revente (0.5 = 50 %).
ConfigPartRevente : float = 0.5

# Argent de départ d'un nouveau joueur.
ConfigArgentDepart : int = 250

# ----------------------------------------------------------------------------
#  AMÉLIORATIONS (étape 4)
# ----------------------------------------------------------------------------

ConfigEmplacementsDepart : int = 3
ConfigEmplacementsMax : int = 15
# Coût de chaque niveau d'emplacement (+1 emplacement par niveau, 12 niveaux).
CoutsEmplacements : []int = array{500, 1000, 2500, 5000, 12000, 25000, 60000, 120000, 300000, 600000, 1500000, 3000000}

# +10 % de vitesse par niveau (5 niveaux, max +50 %).
ConfigBonusVitesseParNiveau : float = 0.10
CoutsVitesse : []int = array{300, 1500, 8000, 40000, 200000}

# +10 % de revenu par niveau sur tous les persos (10 niveaux, max x2).
ConfigBonusRevenuParNiveau : float = 0.10
CoutsRevenu : []int = array{1000, 2500, 6000, 15000, 40000, 100000, 250000, 600000, 1500000, 4000000}

# Déblocage des barrières rouges.
ConfigCoutBarrieres : int = 2000

# ----------------------------------------------------------------------------
#  VOL (étape 6)
# ----------------------------------------------------------------------------

# Temps d'interaction maintenue pour voler (secondes).
ConfigDureeVol : float = 5.0
# Multiplicateur de vitesse du voleur tant qu'il porte un disque (0.7 = 30 % plus lent).
ConfigVitesseVoleur : float = 0.7

# ----------------------------------------------------------------------------
#  BOOSTS (étape 7)
# ----------------------------------------------------------------------------

# Durée d'un boost de chance (secondes). 1200 = 20 minutes.
ConfigDureeBoost : float = 1200.0

# ----------------------------------------------------------------------------
#  HOLOS (étape 11)
# ----------------------------------------------------------------------------

ConfigChanceHolo : float = 2.0          # en %
ConfigMultiplicateurPrixHolo : int = 3
ConfigMultiplicateurGainHolo : float = 3.0
