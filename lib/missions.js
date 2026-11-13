// Missions et titres : définitions et calcul de progression, 100 % côté serveur.
// Un titre se débloque une fois pour toujours (S.titles). Une mission de pack se récupère via l'action 'claim'.
const G = require('./game');

const MYTHIC_CHOICE = 4;   // index de « Mythique au choix » dans C.WH (compteurs S.wheel)

// Contexte de calcul : tout ce dont une condition peut avoir besoin
function context(S, cards, ext, ms) {
  const ncat = 4;
  const catOwned = Array(ncat).fill(0), catTotal = Array(ncat).fill(0);
  const rarOwned = Array(6).fill(0), rarTotal = Array(6).fill(0), rarGot = Array(6).fill(0), rarCopies = Array(6).fill(0);
  let owned = 0, total = 0;
  cards.forEach((c, i) => {
    if (!c) return;
    const have = S.col[i] || 0, got = Math.max(have, S.pulled[i] || 0);
    if (!c[5] || have > 0) { total++; catTotal[c[1]]++; rarTotal[c[2]]++; }
    if (have > 0) { owned++; catOwned[c[1]]++; rarOwned[c[2]]++; rarCopies[c[2]] += have; }
    rarGot[c[2]] += got;
  });
  const sum = G.summary(S, cards);
  const k = G.parisKeys(ms);
  const p = S.per || {};
  const day = p.dk === k.dk, week = p.wk === k.wk;
  const vitLeg = (S.vitrine || []).filter((i) => i != null && cards[i] && (S.col[i] || 0) > 0 && cards[i][2] >= 4).length;
  return {
    S, owned, total, catOwned, catTotal, rarOwned, rarTotal, rarGot, rarCopies, vitLeg, score: sum.score,
    opened: S.opened || 0, runs: Math.max(S.runs || 0, ext.runs || 0), friends: ext.friends || 0, sold: S.sold || 0, spins: S.spins || 0,
    chain: S.chain || 0, maxMoney: S.maxMoney || 0, accepted: S.accepted || 0, mythicWon: (S.wheel || [])[MYTHIC_CHOICE] || 0,
    dOpened: day ? p.do || 0 : 0, wOpened: week ? p.wo || 0 : 0, dRuns: day ? p.dr || 0 : 0, wRuns: week ? p.wr || 0 : 0, wLeg: week ? p.wl || 0 : 0,
    keys: k,
  };
}

const full = (cat) => ({ v: (x) => x.catOwned[cat], g: (x) => x.catTotal[cat] });
const rar = (r, n) => ({ v: (x) => x.rarOwned[r], g: () => n });

// ----- titres : id, nom, description, valeur actuelle, objectif, secret -----
const TITLES = [
  { id: 'collectionneur', n: 'Collectionneur', d: 'Posséder 30 cartes différentes', v: (x) => x.owned, g: () => 30 },
  { id: 'archiviste', n: 'Archiviste', d: 'Posséder 50 cartes différentes', v: (x) => x.owned, g: () => 50 },
  { id: 'presque', n: 'Presque complet', d: 'Posséder 70 cartes différentes', v: (x) => x.owned, g: () => 70 },
  { id: 'legende', n: 'Légende vivante', d: 'Posséder toutes les cartes du jeu', v: (x) => x.owned, g: (x) => x.total },
  { id: 'globe', n: 'Globe-trotter', d: 'Posséder au moins 3 cartes de chaque catégorie', v: (x) => Math.min(...x.catOwned.map((n) => Math.min(n, 3))) * 4 + 0, g: () => 12, raw: (x) => x.catOwned.reduce((s, n) => s + Math.min(n, 3), 0) },
  Object.assign({ id: 'influenceurs', n: 'Fan d\'influenceurs', d: 'Posséder tous les Influenceurs' }, full(1)),
  Object.assign({ id: 'architecte', n: 'Architecte', d: 'Posséder toutes les Structures' }, full(3)),
  Object.assign({ id: 'cartographe', n: 'Cartographe', d: 'Posséder toutes les cartes Map edit' }, full(2)),
  Object.assign({ id: 'editeurs', n: 'Roi des éditeurs', d: 'Posséder tous les Éditeurs' }, full(0)),
  Object.assign({ id: 'chanceux', n: 'Chanceux', d: 'Posséder 1 Mythique' }, rar(5, 1)),
  Object.assign({ id: 'triple', n: 'Triplé d\'or', d: 'Posséder 3 Mythiques différentes' }, rar(5, 3)),
  Object.assign({ id: 'pantheon', n: 'Panthéon', d: 'Posséder 6 Mythiques différentes' }, rar(5, 6)),
  { id: 'mythe', n: 'Mythe vivant', d: 'Posséder toutes les Mythiques', v: (x) => x.rarOwned[5], g: (x) => x.rarTotal[5] },
  Object.assign({ id: 'sang', n: 'Sang bleu', d: 'Posséder 5 Légendaires différentes' }, rar(4, 5)),
  { id: 'noblesse', n: 'Noblesse complète', d: 'Posséder toutes les Légendaires', v: (x) => x.rarOwned[4], g: (x) => x.rarTotal[4] },
  { id: 'pluie', n: 'Pluie de Légendaires', d: 'Obtenir 15 Légendaires (doublons compris)', v: (x) => x.rarGot[4], g: () => 15 },
  { id: 'arc', n: 'Arc-en-ciel', d: 'Avoir 3 cartes de chaque rareté en même temps', v: (x) => x.rarOwned.reduce((s, n) => s + Math.min(n, 3), 0), g: () => 18 },
  { id: 'boulimique', n: 'Boulimique', d: 'Ouvrir 100 packs', v: (x) => x.opened, g: () => 100 },
  { id: 'insatiable', n: 'Insatiable', d: 'Ouvrir 300 packs', v: (x) => x.opened, g: () => 300 },
  { id: 'speedrunner', n: 'Speedrunner', d: 'Faire 25 runs sur la map', v: (x) => x.runs, g: () => 25 },
  { id: 'machine', n: 'Machine', d: 'Faire 50 runs sur la map', v: (x) => x.runs, g: () => 50 },
  { id: 'roue', n: 'Roi de la roue', d: 'Faire 25 tours de roue payants', v: (x) => x.spins, g: () => 25 },
  { id: 'russe', n: 'Roulette russe', d: 'Gagner « Mythique au choix » à la roue', v: (x) => x.mythicWon, g: () => 1 },
  { id: 'espoir', n: 'Dernier espoir', d: 'Enchaîner 5 relances d\'affilée à la roue', v: (x) => x.chain, g: () => 5, secret: true },
  { id: 'fortune', n: 'Fortune', d: 'Avoir 5 000 Coins en même temps', v: (x) => x.maxMoney, g: () => 5000 },
  { id: 'marchand', n: 'Marchand', d: 'Revendre 200 doublons', v: (x) => x.sold, g: () => 200 },
  { id: 'or', n: 'Score d\'or', d: 'Atteindre 2 500 points de score', v: (x) => x.score, g: () => 2500 },
  { id: 'legende2', n: 'Score de légende', d: 'Atteindre 6 000 points de score', v: (x) => x.score, g: () => 6000 },
  { id: 'jury', n: 'Jury d\'honneur', d: 'Faire accepter 3 cartes proposées', v: (x) => x.accepted, g: () => 3 },
  { id: 'sociable', n: 'Sociable', d: 'Avoir 5 amis', v: (x) => x.friends, g: () => 5 },
];
// « Globe-trotter » compte au total (3 par catégorie, 4 catégories)
TITLES.find((t) => t.id === 'globe').v = (x) => x.catOwned.reduce((s, n) => s + Math.min(n, 3), 0);
TITLES.forEach((t) => { delete t.raw; });

// ----- missions de packs : récompense = pack en attente (jamais Mythique) -----
// kind : once (une seule fois) | day | week (se renouvellent, heure de Paris)
// reward : g = type de pack en attente (0 Commun, 2 Rare, 3 Épique, 6 Carte au hasard)
const PACK_LABEL = { 0: 'Pack Commun', 2: 'Pack Rare', 3: 'Pack Épique', 6: 'Carte au hasard' };
const MISSIONS = [
  { id: 'm_echauf', kind: 'once', n: 'Échauffement', d: 'Ouvrir 20 packs', v: (x) => x.opened, g: () => 20, rw: 2 },
  { id: 'm_runs', kind: 'once', n: 'Série de runs', d: 'Faire 10 runs au total', v: (x) => x.runs, g: () => 10, rw: 3 },
  { id: 'm_epiques', kind: 'once', n: 'Chasseur d\'Épiques', d: 'Obtenir 10 cartes Épiques (doublons compris)', v: (x) => x.rarGot[3], g: () => 10, rw: 3 },
  { id: 'm_legs', kind: 'once', n: 'Chasseur de Légendaires', d: 'Obtenir 3 cartes Légendaires', v: (x) => x.rarGot[4], g: () => 3, rw: 3 },
  { id: 'm_coll', kind: 'once', n: 'Collectionneur confirmé', d: 'Posséder 40 cartes différentes', v: (x) => x.owned, g: () => 40, rw: 3 },
  { id: 'm_vit', kind: 'once', n: 'Vitrine de rêve', d: 'Mettre 3 Légendaires ou mieux dans ta vitrine', v: (x) => x.vitLeg, g: () => 3, rw: 2 },
  { id: 'm_vente', kind: 'once', n: 'Marché', d: 'Revendre 50 doublons', v: (x) => x.sold, g: () => 50, rw: 6 },
  { id: 'm_amis', kind: 'once', n: 'Social', d: 'Avoir 5 amis', v: (x) => x.friends, g: () => 5, rw: 2 },
  { id: 'q_packs', kind: 'day', n: 'Quotidienne : ouvreur', d: 'Ouvrir 5 packs aujourd\'hui', v: (x) => x.dOpened, g: () => 5, rw: 0 },
  { id: 'q_run', kind: 'day', n: 'Quotidienne : runner', d: 'Faire 1 run aujourd\'hui', v: (x) => x.dRuns, g: () => 1, rw: 6 },
  { id: 'h_packs', kind: 'week', n: 'Hebdo : ouvreur', d: 'Ouvrir 30 packs cette semaine', v: (x) => x.wOpened, g: () => 30, rw: 2 },
  { id: 'h_runs', kind: 'week', n: 'Hebdo : runner', d: 'Faire 5 runs cette semaine', v: (x) => x.wRuns, g: () => 5, rw: 3 },
  { id: 'h_legs', kind: 'week', n: 'Hebdo : légendes', d: 'Obtenir 3 Légendaires cette semaine', v: (x) => x.wLeg, g: () => 3, rw: 3 },
];

// Couleur d'un titre selon sa rareté réelle (part des joueurs qui l'ont) : 0 Commun .. 5 Mythique
function tierOf(pct) { return pct > 25 ? 0 : pct > 10 ? 1 : pct > 3 ? 2 : pct > 1 ? 3 : pct > 0.3 ? 4 : 5; }

// Débloque tous les titres dont la condition est remplie ; renvoie les nouveaux
function unlock(S, x, ms) {
  if (!S.titles || typeof S.titles !== 'object') S.titles = {};
  const fresh = [];
  TITLES.forEach((t) => { if (!S.titles[t.id] && t.v(x) >= t.g(x)) { S.titles[t.id] = ms; fresh.push(t.id); } });
  return fresh;
}

const claimKey = (m, x) => (m.kind === 'day' ? x.keys.dk : m.kind === 'week' ? x.keys.wk : 'once');
function claimedOf(S, m, x) {
  if (m.kind === 'once') return !!(S.claimed || {})[m.id];
  const box = m.kind === 'day' ? S.dclaim : S.wclaim;
  return !!box && box[m.id] === claimKey(m, x);
}

// Vue envoyée au client. stats = { counts: {id: n}, total } (part des joueurs par titre)
function view(S, x, stats) {
  const tot = Math.max(1, stats.total || 1);
  const pctOf = (id) => { const n = (stats.counts || {})[id] || 0; return Math.round((n / tot) * 1000) / 10; };
  const titles = TITLES.map((t) => {
    const own = !!(S.titles || {})[t.id], g = t.g(x), pct = pctOf(t.id);
    return { id: t.id, n: t.n, d: t.secret && !own ? 'Titre secret' : t.d, v: Math.min(t.v(x), g), g, own, pct, t: tierOf(pct), secret: !!t.secret, at: own ? S.titles[t.id] : 0 };
  });
  const packs = MISSIONS.map((m) => {
    const g = m.g(x), v = m.v(x), claimed = claimedOf(S, m, x);
    return { id: m.id, kind: m.kind, n: m.n, d: m.d, v: Math.min(v, g), g, rw: m.rw, rl: PACK_LABEL[m.rw], claimed, ready: !claimed && v >= g };
  });
  return { titles, packs, equipped: S.title || null, nbOwn: titles.filter((t) => t.own).length };
}

// Récupère la récompense d'une mission de pack
function claim(S, x, id) {
  const m = MISSIONS.find((q) => q.id === id);
  if (!m) throw new G.GameError('Mission inconnue');
  if (claimedOf(S, m, x)) throw new G.GameError('Déjà récupérée');
  if (m.v(x) < m.g(x)) throw new G.GameError('Mission pas encore terminée');
  if (m.kind === 'once') { if (!S.claimed) S.claimed = {}; S.claimed[id] = 1; }
  else { const k = m.kind === 'day' ? 'dclaim' : 'wclaim'; if (!S[k]) S[k] = {}; S[k][id] = claimKey(m, x); }
  S.wp[m.rw] = (S.wp[m.rw] || 0) + 1;
  return { rw: m.rw, label: PACK_LABEL[m.rw] };
}

module.exports = { TITLES, MISSIONS, PACK_LABEL, context, unlock, view, claim, tierOf };
