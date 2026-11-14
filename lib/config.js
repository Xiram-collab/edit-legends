// Réglages du jeu : source unique, utilisée par le serveur (le client reçoit les mêmes valeurs via /api/game "me").
module.exports = {
  HOUR: 3600000,
  MAXSTOCK: 10,
  START_STOCK: 10,
  // p = chance (%) qu'une carte tirée soit de cette rareté ; v = valeur de revente d'un doublon
  RAR: [
    { p: 50, v: 2 },
    { p: 25, v: 5 },
    { p: 17, v: 12 },
    { p: 5.5, v: 40 },
    { p: 2, v: 150 },
    { p: 0.5, v: 600 },
  ],
  // g = rareté minimale garantie sur la 5e carte
  PACKS: [
    { g: 2, price: 400 },
    { g: 3, price: 1000 },
    { g: 4, price: 3500 },
  ],
  // Roue (somme = 100 %). t = type : none (ancien « rien », gardé pour les anciens compteurs), pack (g = type de pack,
  // 5 = Mythique au choix), relance (tour gratuit), card (une carte au hasard à récupérer dans les packs en attente, g = 6 ; rareté tirée à l'ouverture comme dans un pack), coins (v = Coins).
  // L'ordre ne doit pas changer : les compteurs des joueurs (S.wheel) sont indexés dessus.
  WH: [
    { p: 0, t: 'none' },
    { p: 15, t: 'pack', g: 0 },
    { p: 5, t: 'pack', g: 2 },
    { p: 4, t: 'pack', g: 3 },
    { p: 1, t: 'pack', g: 5 },
    { p: 10, t: 'relance' },
    { p: 60, t: 'card', g: 6 },
    { p: 4, t: 'coins', v: 50 },
    { p: 1, t: 'coins', v: 200 },
  ],
  RELANCE_MAX: 5,
  // Prix (Coins) d'un tour de roue sans code, pour ceux qui veulent
  // Lancement du site : Jour et Hebdo montrent le Global tant que la clé de la période est <= à ces dates (1er reset : minuit, puis lundi)
  PERIOD_ALL: { day: '2026-11-13', week: '2026-11-09' },
  SPIN_PRICE: 150,
  // Points de classement par carte DIFFÉRENTE possédée, selon la rareté (Commun ... Mythique)
  SCORE: [1, 2, 4, 10, 25, 60],
  // Types de packs en attente que l'admin peut donner (5 = une carte Mythique)
  ADMIN_WP: [0, 2, 3, 4, 5, 6],
  // Classement des temps de la map (hebdomadaire, reset le lundi à minuit heure de Paris).
  // Récompense par place (index 0 = 1er) : c = Coins, g = pack en attente offert (3 = Épique+, 2 = Rare+), absent = pas de pack.
  TIME_REWARDS: [
    { c: 2500, g: 3 }, { c: 1800, g: 2 }, { c: 1200, g: 2 }, { c: 800 }, { c: 600 },
    { c: 500 }, { c: 450 }, { c: 400 }, { c: 350 }, { c: 300 },
  ],   // valable pour CHAQUE classement (Manette et Clavier / souris) : top 10 de chacun
  TIME_MAX_PENDING: 3,            // propositions en attente par joueur
  TIME_GRACE_MS: 3 * 24 * 3600000, // après la fin de la semaine, les récompenses sont versées quand l'admin a tout traité, ou après ce délai
  // Marché entre joueurs (enchères) : mise de départ minimale par rareté, durée d'une offre, plafonds
  MARKET: { MIN: [10, 25, 100, 500, 1000, 1500], OLD_MIN: [20, 50, 200, 1000, 2000, 3000], REPRICE_BEFORE: '2026-11-14T01:30:00Z', HOURS: 12, MAX_ACTIVE: 5, MAX_PRICE: 10000000, SOLD_SHOWN: 20, SOLD_DAYS: 2 },
  CARD_PROPOSALS_MAX: 30,          // propositions de cartes en attente par joueur
  MYCARD_LOGO_DAYS: 30,            // un joueur associé à sa carte peut changer son logo une fois par mois
  MYCARD_DESCR_MAX: 200,
  BAD_TRIES: 5,
  LOCK_MS: 60000,
};
