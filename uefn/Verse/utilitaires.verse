# ============================================================================
#  Petites fonctions utiles (formatage de textes et de nombres).
# ============================================================================

using { /Verse.org/Simulation }

# Transforme un texte Verse en "message" (le type attendu par les devices Billboard / HUD).
TexteEnMessage<localizes>(Texte : string) : message = "{Texte}"

# Écrit un nombre avec des espaces tous les 3 chiffres : 1000000 -> "1 000 000".
FormaterNombre(N : int) : string =
    if (N < 0):
        return "-{FormaterNombre(-N)}"
    if (N < 1000):
        return "{N}"
    if (Haut := Quotient[N, 1000], Bas := Mod[N, 1000]):
        BasTexte := if (Bas < 10) then "00{Bas}" else if (Bas < 100) then "0{Bas}" else "{Bas}"
        return "{FormaterNombre(Haut)} {BasTexte}"
    "{N}"

# Écrit un nombre sur 2 chiffres : 5 -> "05".
DeuxChiffres(N : int) : string =
    if (N < 10) then "0{N}" else "{N}"

# Écrit une durée en secondes au format MM:SS (ex : 3599 -> "59:59").
FormaterDuree(TotalSecondes : int) : string =
    if (Minutes := Quotient[TotalSecondes, 60], Secondes := Mod[TotalSecondes, 60]):
        "{DeuxChiffres(Minutes)}:{DeuxChiffres(Secondes)}"
    else:
        "00:00"
