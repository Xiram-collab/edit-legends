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
  // Roue : g = type de pack gagné (-1 = rien, 5 = une carte Mythique)
  WH: [
    { p: 50, g: -1 },
    { p: 30, g: 0 },
    { p: 15, g: 2 },
    { p: 4, g: 3 },
    { p: 1, g: 5 },
  ],
  BAD_TRIES: 5,
  LOCK_MS: 60000,
};
