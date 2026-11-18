# ============================================================================
#  GESTIONNAIRE DU COULOIR (étape 1)
#  - Fait sortir un disque du portail d'entrée toutes les X secondes (voir config).
#  - Le disque avance en ligne droite jusqu'au portail de sortie en tournant sur lui-même,
#    puis disparaît.
#  - Un panneau (Billboard) suit chaque disque : pseudo, rareté, prix.
#  - Minuteur de 1 h (en boucle) affiché au-dessus du portail d'entrée.
# ============================================================================

using { /Fortnite.com/Devices }
using { /Verse.org/Simulation }
using { /Verse.org/Random }
using { /UnrealEngine.com/Temporary/SpatialMath }

# Un éditeur tiré au sort : son pseudo et sa rareté.
editeur_tire := struct:
    Nom : string
    Rarete : rarete

# Associe le pseudo d'un éditeur au disque texturé avec son PNG (à remplir dans UEFN).
visuel_editeur := class<concrete>:
    # Pseudo EXACT (comme dans config_jeu.verse).
    @editable
    Nom : string = ""
    # Le prop "disque" avec la texture de l'éditeur.
    @editable
    Modele : creative_prop_asset = DefaultCreativePropAsset

gestionnaire_couloir := class(creative_device):

    # --- À relier dans UEFN (panneau Détails du device) ---

    # Repère (prop invisible) placé au centre du portail d'ENTRÉE : point de départ des disques.
    @editable
    PointEntree : creative_prop = creative_prop{}

    # Repère (prop invisible) placé au centre du portail de SORTIE : point d'arrivée.
    @editable
    PointSortie : creative_prop = creative_prop{}

    # Disque par défaut de chaque rareté, dans l'ordre :
    # 0 Commun, 1 Atypique, 2 Rare, 3 Épique, 4 Légendaire, 5 Mythique.
    # Utilisé quand l'éditeur n'a pas encore son disque texturé.
    @editable
    ModelesParRarete : []creative_prop_asset = array{}

    # Disques texturés par éditeur (un par PNG). Facultatif : peut être rempli petit à petit.
    @editable
    VisuelsEditeurs : []visuel_editeur = array{}

    # Réserve de panneaux Billboard qui suivent les disques (en placer ~15).
    @editable
    PanneauxPrix : []billboard_device = array{}

    # Billboard au-dessus du portail d'entrée qui affiche le minuteur.
    @editable
    PanneauMinuteur : billboard_device = billboard_device{}

    # Effets des portails (VFX Spawner, lumières...) activés au lancement.
    @editable
    EffetsPortails : []vfx_spawner_device = array{}

    # --- État interne ---

    # Panneaux disponibles (non attachés à un disque).
    var PanneauxLibres : []billboard_device = array{}
    # Position de rangement des panneaux libres (sous le portail d'entrée, hors de vue).
    var PositionRangement : vector3 = vector3{}
    # Secondes restantes avant le prochain Légendaire garanti.
    var SecondesRestantes : int = 0

    # ------------------------------------------------------------------
    #  Démarrage
    # ------------------------------------------------------------------
    OnBegin<override>()<suspends> : void =
        set PositionRangement = PointEntree.GetTransform().Translation - vector3{Z := 2000.0}
        set PanneauxLibres = PanneauxPrix
        for (Panneau : PanneauxPrix):
            RangerPanneau(Panneau)
        for (Effet : EffetsPortails):
            Effet.Enable()
        # Le repère d'entrée et de sortie ne doivent pas se voir en jeu.
        PointEntree.Hide()
        PointSortie.Hide()
        spawn{ BoucleMinuteur() }
        BoucleSpawn()

    # ------------------------------------------------------------------
    #  Spawn régulier des disques
    # ------------------------------------------------------------------
    BoucleSpawn()<suspends> : void =
        loop:
            Editeur := TirerEditeur()
            spawn{ LancerDisque(Editeur) }
            Sleep(ConfigIntervalleSpawn)

    # Étape 1 : un éditeur au hasard parmi les 125 (chances égales).
    # (L'étape 2 remplacera ceci par le tirage pondéré par rareté.)
    TirerEditeur() : editeur_tire =
        var Tous : []editeur_tire = array{}
        for (R : ToutesLesRaretes, Nom : EditeursDeRarete(R)):
            set Tous += array{editeur_tire{Nom := Nom, Rarete := R}}
        if (Choix := Tous[GetRandomInt(0, Tous.Length - 1)]):
            Choix
        else:
            editeur_tire{Nom := "?", Rarete := rarete.Commun}

    # Trouve le bon modèle de disque : celui de l'éditeur s'il existe, sinon celui de sa rareté.
    ModelePour(Editeur : editeur_tire) : creative_prop_asset =
        for (Visuel : VisuelsEditeurs, Visuel.Nom = Editeur.Nom):
            return Visuel.Modele
        if (Modele := ModelesParRarete[IndexRarete(Editeur.Rarete)]):
            return Modele
        DefaultCreativePropAsset

    # Fait vivre un disque : apparition, trajet, disparition.
    LancerDisque(Editeur : editeur_tire)<suspends> : void =
        Depart := PointEntree.GetTransform().Translation
        Arrivee := PointSortie.GetTransform().Translation
        Resultat := SpawnProp(ModelePour(Editeur), Depart, IdentityRotation())
        if (Disque := Resultat(0)?):
            MaybePanneau := PrendrePanneau()
            if (Panneau := MaybePanneau?):
                Texte := "{Editeur.Nom}\n{NomRarete(Editeur.Rarete)}\n{FormaterNombre(PrixRarete(Editeur.Rarete))} pièces"
                Panneau.SetText(TexteEnMessage(Texte))
                if (Panneau.TeleportTo[Depart + vector3{Z := ConfigHauteurPanneau}, Panneau.GetTransform().Rotation]) {}
                Panneau.ShowText()
            DeplacerDisque(Disque, MaybePanneau, Depart, Arrivee)
            # Arrivé au portail de sortie sans être acheté : il disparaît.
            if (Disque.IsValid[]):
                Disque.Dispose()
            if (Panneau := MaybePanneau?):
                RendrePanneau(Panneau)

    # Avance pas à pas de Depart à Arrivee en tournant (MoveTo ne sait pas faire plusieurs tours d'un coup).
    DeplacerDisque(Disque : creative_prop, MaybePanneau : ?billboard_device, Depart : vector3, Arrivee : vector3)<suspends> : void =
        Trajet := Distance(Depart, Arrivee)
        DureeTotale := Trajet / ConfigVitesseDisque
        NbPas := if (N := Ceil[DureeTotale / ConfigPasMouvement]) then Max(N, 1) else 1
        DureePas := DureeTotale / (NbPas * 1.0)
        var Angle : float = 0.0
        for (I := 1..NbPas):
            # Le disque a pu être acheté (étape 3) : on arrête de le déplacer.
            if (not Disque.IsValid[]):
                return
            Alpha := (I * 1.0) / (NbPas * 1.0)
            Position := Depart + (Arrivee - Depart) * Alpha
            set Angle += ConfigVitesseRotation * DureePas
            if (Angle >= 360.0):
                set Angle -= 360.0
            Rotation := MakeRotationFromYawPitchRollDegrees(Angle, 0.0, 0.0)
            sync:
                Disque.MoveTo(Position, Rotation, DureePas)
                DeplacerPanneau(MaybePanneau, Position + vector3{Z := ConfigHauteurPanneau}, DureePas)

    # Déplace le panneau (s'il y en a un) en gardant son orientation.
    DeplacerPanneau(MaybePanneau : ?billboard_device, Position : vector3, Duree : float)<suspends> : void =
        if (Panneau := MaybePanneau?):
            Panneau.MoveTo(Position, Panneau.GetTransform().Rotation, Duree)
        else:
            Sleep(Duree)

    # ------------------------------------------------------------------
    #  Réserve de panneaux
    # ------------------------------------------------------------------
    PrendrePanneau() : ?billboard_device =
        if (Panneau := PanneauxLibres[0], Reste := PanneauxLibres.Slice[1, PanneauxLibres.Length]):
            set PanneauxLibres = Reste
            option{Panneau}
        else:
            false

    RendrePanneau(Panneau : billboard_device) : void =
        RangerPanneau(Panneau)
        set PanneauxLibres += array{Panneau}

    RangerPanneau(Panneau : billboard_device) : void =
        Panneau.HideText()
        if (Panneau.TeleportTo[PositionRangement, Panneau.GetTransform().Rotation]) {}

    # ------------------------------------------------------------------
    #  Minuteur de 1 h au-dessus du portail d'entrée
    # ------------------------------------------------------------------
    BoucleMinuteur()<suspends> : void =
        loop:
            set SecondesRestantes = ConfigDureeCycleLegendaire
            loop:
                PanneauMinuteur.SetText(TexteEnMessage("{ConfigTexteMinuteur}\n{FormaterDuree(SecondesRestantes)}"))
                if (SecondesRestantes <= 0):
                    break
                Sleep(1.0)
                set SecondesRestantes -= 1
            # Étape 2 : ici on fera sortir le Légendaire garanti.
