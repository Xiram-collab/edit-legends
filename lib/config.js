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
  // Points de classement par carte DIFFÉRENTE possédée, selon la rareté (Commun ... Mythique)
  SCORE: [1, 2, 4, 10, 25, 60],
  // Types de packs en attente que l'admin peut donner (5 = une carte Mythique)
  ADMIN_WP: [0, 2, 3, 4, 5, 6],
  BAD_TRIES: 5,
  LOCK_MS: 60000,
};
