// Missions et titres : définitions et calcul de progression, 100 % côté serveur.
// Un titre se débloque une fois pour toujours (S.titles). Une mission de pack se récupère via l'action 'claim'.
const G = require('./game');
const C = require('./config');

const MYTHIC_CHOICE = 4;   // index de « Mythique au choix » dans C.WH (compteurs S.wheel)

// Contexte de calcul : tout ce dont une condition peut avoir besoin
function context(S, cards, ext, ms) {
  const ncat = 8;   // 0-3 : catégories d'origine ; 4-7 : Creative Warrior, Buildfighter, Mappeur, Esport
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
  // V3 : les C.V3_NEW dernières cartes visibles (même logique que « nouvelles cartes » sur l'accueil)
  const v3Ids = []; for (let i = cards.length - 1; i >= 0 && v3Ids.length < (C.V3_NEW || 0); i--) { const c = cards[i]; if (c && c[0] !== '?' && !c[5]) v3Ids.push(i); }
  const v3Total = v3Ids.length, v3RarOwned = Array(6).fill(0), v3RarTotal = Array(6).fill(0); let v3Owned = 0, cmax = 0;
  v3Ids.forEach((i) => { const r = cards[i][2]; v3RarTotal[r]++; if ((S.col[i] || 0) > 0) { v3Owned++; v3RarOwned[r]++; } });
  cards.forEach((c) => { if (c && c[0] !== '?' && !c[5]) cmax += C.SCORE[c[2]] || 0; });
  const sum = G.summary(S, cards);
  const k = G.parisKeys(ms);
  const p = S.per || {};
  const day = p.dk === k.dk, week = p.wk === k.wk;
  const vitLeg = (S.vitrine || []).filter((i) => i != null && cards[i] && (S.col[i] || 0) > 0 && cards[i][2] >= 4).length;
  return {
    S, owned, total, catOwned, catTotal, rarOwned, rarTotal, rarGot, rarCopies, vitLeg, v3Total, v3Owned, v3RarOwned, v3RarTotal, cmax, holo: sum.holo, holoRar: sum.holoRar, score: sum.score, cscore: sum.cscore,
    opened: S.opened || 0, runs: Math.max(S.runs || 0, ext.runs || 0), friends: ext.friends || 0, sold: S.sold || 0, mkSold: S.mkSold || 0, mkBought: S.mkBought || 0, spins: S.spins || 0,
    chain: S.chain || 0, maxMoney: S.maxMoney || 0, accepted: S.accepted || 0, mythicWon: (S.wheel || [])[MYTHIC_CHOICE] || 0,
    dOpened: day ? p.do || 0 : 0, wOpened: week ? p.wo || 0 : 0, dRuns: day ? p.dr || 0 : 0, wRuns: week ? p.wr || 0 : 0, wLeg: week ? p.wl || 0 : 0,
    keys: k, now: ms,
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
  // Retiré le temps que les nouvelles catégories (Creative Warrior, Buildfighter, Mappeur, Esport) aient des cartes. Ceux qui l'ont le gardent.
  { retired: true, id: 'globe', n: 'Globe-trotter', d: 'Posséder au moins 3 cartes de chaque catégorie', v: (x) => Math.min(...x.catOwned.slice(0, 4).map((n) => Math.min(n, 3))) * 4 + 0, g: () => 12, raw: (x) => x.catOwned.reduce((s, n) => s + Math.min(n, 3), 0) },
  Object.assign({ id: 'influenceurs', n: 'Fan d\'influenceurs', d: 'Posséder tous les Influenceurs' }, full(1)),
  Object.assign({ id: 'architecte', n: 'Architecte', d: 'Posséder toutes les Structures' }, full(3)),
  Object.assign({ id: 'cartographe', n: 'Cartographe', d: 'Posséder toutes les cartes Maps' }, full(2)),
  Object.assign({ id: 'editeurs', n: 'Roi des éditeurs', d: 'Posséder tous les Éditeurs' }, full(0)),
  Object.assign({ id: 'chanceux', n: 'Chanceux', d: 'Posséder 1 Mythique' }, rar(5, 1)),
  Object.assign({ id: 'triple', n: 'Triplé d\'or', d: 'Posséder 3 Mythiques différentes' }, rar(5, 3)),
  Object.assign({ id: 'pantheon', n: 'Panthéon', d: 'Posséder 6 Mythiques différentes' }, rar(5, 6)),
  { id: 'mythe', n: 'Mythe vivant', d: 'Posséder toutes les Mythiques', v: (x) => x.rarOwned[5], g: (x) => x.rarTotal[5] },
  Object.assign({ id: 'sang', n: 'Sang bleu', d: 'Posséder 5 Légendaires différentes' }, rar(4, 5)),
  // v1 : retiré (V2 = nouvelles Légendaires). Ceux qui l'ont déjà le gardent, plus personne ne peut l'obtenir.
  { id: 'noblesse', n: 'Noblesse complète (v1)', d: 'Posséder toutes les Légendaires (ancienne version)', v: (x) => x.rarOwned[4], g: (x) => x.rarTotal[4], retired: true },
  { id: 'noblesse2', n: 'Noblesse complète (v2)', d: 'Posséder toutes les Légendaires (v2)', v: (x) => x.rarOwned[4], g: (x) => x.rarTotal[4] },
  { id: 'pluie', n: 'Pluie de Légendaires', d: 'Obtenir 15 Légendaires (doublons compris)', v: (x) => x.rarGot[4], g: () => 15 },
  { id: 'arc', n: 'Arc-en-ciel', d: 'Avoir 3 cartes de chaque rareté en même temps', v: (x) => x.rarOwned.reduce((s, n) => s + Math.min(n, 3), 0), g: () => 18 },
  { id: 'boulimique', n: 'Boulimique', d: 'Ouvrir 100 packs', v: (x) => x.opened, g: () => 100 },
  { id: 'insatiable', n: 'Insatiable', d: 'Ouvrir 300 packs', v: (x) => x.opened, g: () => 300 },
  { id: 'speedrunner', n: 'Speedrunner', d: 'Faire 25 runs sur la map', v: (x) => x.runs, g: () => 25 },
  { id: 'machine', n: 'Machine', d: 'Faire 50 runs sur la map', v: (x) => x.runs, g: () => 50 },
  { id: 'roue', n: 'Roi de la roue', d: 'Faire 25 tours de roue payants', v: (x) => x.spins, g: () => 25 },
  { id: 'russe', n: 'Roulette russe', d: 'Gagner « Mythique au choix » à la roue', v: (x) => x.mythicWon, g: () => 1 },
  // Retiré : la relance n'existe plus à la roue. Ceux qui l'ont déjà le gardent, plus personne ne peut l'obtenir.
  { id: 'espoir', n: 'Dernier espoir', d: 'Enchaîner 5 relances d\'affilée à la roue (ancienne version)', v: (x) => x.chain, g: () => 5, secret: true, retired: true },
  { id: 'coffre', n: 'Coffre-fort', d: 'Avoir 20 000 Coins en même temps', v: (x) => x.maxMoney, g: () => 20000, secret: true },
  { id: 'fortune', n: 'Fortune', d: 'Avoir 5 000 Coins en même temps', v: (x) => x.maxMoney, g: () => 5000 },
  { id: 'marchand', n: 'Marchand', d: 'Revendre 200 doublons', v: (x) => x.sold, g: () => 200 },
  { id: 'negociant', n: 'Négociant', d: 'Vendre 10 cartes sur le marché', v: (x) => x.mkSold, g: () => 10 },
  { id: 'magnat', n: 'Magnat du marché', d: 'Vendre 50 cartes sur le marché', v: (x) => x.mkSold, g: () => 50 },
  { id: 'encherisseur', n: 'Client fidèle', d: 'Acheter 10 cartes sur le marché', v: (x) => x.mkBought, g: () => 10 },
  // Nouveaux titres sur les points de collection (le max actuel est ~1 539 avec toutes les cartes). Les anciens titres de score restent à ceux qui les ont.
  { id: 'pts500', n: 'Collection d\'argent', d: 'Atteindre 500 points de collection', v: (x) => x.cscore, g: () => 500 },
  { id: 'pts1000', n: 'Collection d\'or', d: 'Atteindre 1 000 points de collection', v: (x) => x.cscore, g: () => 1000 },
  { id: 'pts1500', n: 'Collection de platine', d: 'Atteindre 1 500 points de collection', v: (x) => x.cscore, g: () => 1500 },
  // Plus haut palier de points, accessible avec la V3 (90 % du score maximum au plus)
  { id: 'pts2000', n: 'Collection de diamant', d: 'Atteindre 2 000 points de collection', v: (x) => x.cscore, g: (x) => Math.min(2000, Math.floor(x.cmax * 0.9)) },
  { id: 'elite', n: 'Collectionneur d\'élite', d: 'Posséder 150 cartes différentes', v: (x) => x.owned, g: (x) => Math.min(150, x.total) },
  // Titres V3 (désactivés tant qu'il n'y a pas de cartes V3 : objectif impossible)
  { id: 'v3_pionnier', n: 'Pionnier V3', d: 'Posséder 15 cartes de la V3', v: (x) => x.v3Owned, g: (x) => (x.v3Total ? Math.min(15, x.v3Total) : 1e9) },
  { id: 'v3_explorateur', n: 'Explorateur V3', d: 'Posséder la moitié des cartes de la V3', v: (x) => x.v3Owned, g: (x) => (x.v3Total ? Math.ceil(x.v3Total / 2) : 1e9) },
  { id: 'v3_mythiques', n: 'Mythiques V3', d: 'Posséder toutes les Mythiques de la V3', v: (x) => x.v3RarOwned[5], g: (x) => (x.v3RarTotal[5] ? x.v3RarTotal[5] : 1e9) },
  { id: 'v3_legendaires', n: 'Légendaires V3', d: 'Posséder toutes les Légendaires de la V3', v: (x) => x.v3RarOwned[4], g: (x) => (x.v3RarTotal[4] ? x.v3RarTotal[4] : 1e9) },
  { id: 'v3_maitre', n: 'Maître de la V3', d: 'Posséder toutes les cartes de la V3', v: (x) => x.v3Owned, g: (x) => (x.v3Total ? x.v3Total : 1e9) },
  // Titres Holo (cartes brillantes : chaque carte différente possédée en Holo compte une fois)
  { id: 'holo1', n: 'Premier reflet', d: 'Obtenir 1 carte Holo', v: (x) => x.holo, g: () => 1 },
  { id: 'holo10', n: 'Chasseur de brillants', d: 'Posséder 10 cartes Holo différentes', v: (x) => x.holo, g: () => 10 },
  { id: 'holo30', n: 'Collection étincelante', d: 'Posséder 30 cartes Holo différentes', v: (x) => x.holo, g: () => 30 },
  { id: 'holo75', n: 'Éclat suprême', d: 'Posséder 75 cartes Holo différentes', v: (x) => x.holo, g: () => 75 },
  { id: 'hololeg', n: 'Légende brillante', d: 'Posséder une Légendaire Holo', v: (x) => x.holoRar[4], g: () => 1 },
  { id: 'holomyth', n: 'Mythe holographique', d: 'Posséder une Mythique Holo', v: (x) => x.holoRar[5], g: () => 1, secret: true },
  { id: 'jury', n: 'Jury d\'honneur', d: 'Faire accepter 3 cartes proposées', v: (x) => x.accepted, g: () => 3 },
  { id: 'sociable', n: 'Sociable', d: 'Avoir 5 amis', v: (x) => x.friends, g: () => 5 },
];
// « Globe-trotter » compte au total (3 par catégorie, 4 catégories)
TITLES.find((t) => t.id === 'globe').v = (x) => x.catOwned.slice(0, 4).reduce((s, n) => s + Math.min(n, 3), 0);
TITLES.forEach((t) => { delete t.raw; });

// ----- missions de packs : récompense = pack(s) en attente (jamais Mythique ni Légendaire) -----
// kind : once (à paliers : chaque palier se récupère une fois, puis le suivant apparaît) | day | week (se renouvellent, heure de Paris)
// rw : type de pack en attente (0 Commun, 2 Rare, 3 Épique, 6 Carte au hasard) ; n : nombre de packs
const PACK_LABEL = { 0: 'Pack Commun', 2: 'Pack Rare', 3: 'Pack Épique', 6: 'Carte au hasard' };
const lab = (rw, n) => (n > 1 ? n + ' × ' : '') + (n > 1 && rw === 6 ? 'Cartes au hasard' : PACK_LABEL[rw]);
const T = (g, rw, n = 1) => ({ g: typeof g === 'function' ? g : () => g, rw, n });
const MISSIONS = [
  { id: 'm_echauf', kind: 'once', n: 'Échauffement', d: (g) => 'Ouvrir ' + g + ' packs', v: (x) => x.opened, tiers: [T(20, 2), T(50, 2), T(100, 3), T(200, 3), T(400, 3, 2)] },
  { id: 'm_runs', kind: 'once', n: 'Série de runs', d: (g) => 'Faire ' + g + ' runs au total', v: (x) => x.runs, tiers: [T(10, 3), T(50, 3), T(100, 3), T(250, 3, 2), T(500, 3, 3)] },
  { id: 'm_epiques', kind: 'once', n: 'Chasseur d\'Épiques', d: (g) => 'Obtenir ' + g + ' cartes Épiques (doublons compris)', v: (x) => x.rarGot[3], tiers: [T(10, 3), T(25, 3), T(50, 3), T(100, 3, 2)] },
  { id: 'm_legs', kind: 'once', n: 'Chasseur de Légendaires', d: (g) => 'Obtenir ' + g + ' cartes Légendaires (doublons compris)', v: (x) => x.rarGot[4], tiers: [T(3, 3), T(10, 3), T(25, 3, 2), T(50, 3, 3)] },
  { id: 'm_coll', kind: 'once', n: 'Collectionneur confirmé', d: (g) => 'Posséder ' + g + ' cartes différentes', v: (x) => x.owned, tiers: [T(40, 3), T(55, 3), T(70, 3, 2), T((x) => Math.min(100, x.total), 3, 2), T((x) => Math.min(130, x.total), 3, 2), T((x) => x.total, 3, 3)] },
  { id: 'm_v3', kind: 'once', n: 'Découverte V3', d: (g) => 'Posséder ' + g + ' cartes de la V3', v: (x) => x.v3Owned, tiers: [T((x) => (x.v3Total ? Math.min(10, x.v3Total) : 1e9), 2), T((x) => (x.v3Total ? Math.min(25, x.v3Total) : 1e9), 3), T((x) => (x.v3Total ? Math.min(40, x.v3Total) : 1e9), 3, 2), T((x) => (x.v3Total ? x.v3Total : 1e9), 3, 3)] },
  { id: 'm_holo', kind: 'once', n: 'Reflets', d: (g) => 'Posséder ' + g + ' cartes Holo différentes', v: (x) => x.holo, tiers: [T(1, 2), T(5, 3), T(15, 3), T(40, 3, 2)] },
  { id: 'm_vit', kind: 'once', n: 'Vitrine de rêve', d: () => 'Mettre 3 Légendaires ou mieux dans ta vitrine', v: (x) => x.vitLeg, tiers: [T(3, 2)] },
  { id: 'm_vente', kind: 'once', n: 'Marché', d: (g) => 'Revendre ' + g + ' doublons', v: (x) => x.sold, tiers: [T(50, 6), T(150, 6), T(400, 6, 2), T(1000, 6, 3)] },
  { id: 'm_mkvente', kind: 'once', n: 'Vendeur du marché', d: (g) => 'Vendre ' + g + ' cartes sur le marché', v: (x) => x.mkSold, tiers: [T(1, 0), T(5, 2), T(15, 3), T(40, 3, 2)] },
  { id: 'm_mkachat', kind: 'once', n: 'Acheteur malin', d: (g) => 'Acheter ' + g + ' cartes sur le marché', v: (x) => x.mkBought, tiers: [T(1, 0), T(5, 2), T(15, 3), T(40, 3, 2)] },
  { id: 'm_amis', kind: 'once', n: 'Social', d: (g) => 'Avoir ' + g + ' amis', v: (x) => x.friends, tiers: [T(5, 2), T(15, 2), T(30, 3)] },
  { id: 'q_packs', kind: 'day', n: 'Quotidienne : ouvreur', d: (g) => 'Ouvrir ' + g + ' packs aujourd\'hui', v: (x) => x.dOpened, tiers: [T(10, 0)] },
  { id: 'q_run', kind: 'day', n: 'Quotidienne : runner', d: (g) => 'Faire ' + g + ' runs aujourd\'hui', v: (x) => x.dRuns, tiers: [T(3, 6)] },
  { id: 'h_packs', kind: 'week', n: 'Hebdo : ouvreur', d: (g) => 'Ouvrir ' + g + ' packs cette semaine', v: (x) => x.wOpened, tiers: [T(60, 2)] },
  { id: 'h_runs', kind: 'week', n: 'Hebdo : runner', d: (g) => 'Faire ' + g + ' runs cette semaine', v: (x) => x.wRuns, tiers: [T(12, 3)] },
  { id: 'h_legs', kind: 'week', n: 'Hebdo : légendes', d: (g) => 'Obtenir ' + g + ' Légendaires cette semaine', v: (x) => x.wLeg, tiers: [T(5, 3)] },
];

// Couleur d'un titre selon sa rareté réelle (part des joueurs qui l'ont) : 0 Commun .. 5 Mythique
function tierOf(pct) { return pct > 25 ? 0 : pct > 10 ? 1 : pct > 3 ? 2 : pct > 1 ? 3 : pct > 0.3 ? 4 : 5; }

const claimKey = (m, x) => (m.kind === 'day' ? x.keys.dk : m.kind === 'week' ? x.keys.wk : 'once');
// Nombre de paliers déjà récupérés (day/week : 0 ou 1 pour la période en cours)
function doneTiers(S, m, x) {
  if (m.kind === 'once') return Math.max(0, +(S.claimed || {})[m.id] || 0);
  const box = m.kind === 'day' ? S.dclaim : S.wclaim;
  return box && box[m.id] === claimKey(m, x) ? 1 : 0;
}
function pending(S, m, x) {   // palier en cours : { tier, k } ou null si tout est récupéré
  const k = doneTiers(S, m, x);
  return k >= m.tiers.length ? null : { tier: m.tiers[k], k };
}
function packReady(S, m, x) { const p = pending(S, m, x); return !!p && m.v(x) >= p.tier.g(x); }
const titleReady = (S, t, x) => !t.retired && !(S.titles || {})[t.id] && t.v(x) >= t.g(x);

// Nombre de choses à récupérer (pastille rouge)
function readyCount(S, x) {
  return MISSIONS.filter((m) => packReady(S, m, x)).length + TITLES.filter((t) => titleReady(S, t, x)).length;
}

// Vue envoyée au client. stats = { counts: {id: n}, total } (part des joueurs par titre)
function view(S, x, stats) {
  const tot = Math.max(1, stats.total || 1);
  const pctOf = (id) => { const n = (stats.counts || {})[id] || 0; return Math.round((n / tot) * 1000) / 10; };
  const titles = TITLES.filter((t) => !t.retired || (S.titles || {})[t.id]).map((t) => {
    const own = !!(S.titles || {})[t.id], g = t.g(x), pct = pctOf(t.id);
    return { id: t.id, n: t.n, d: t.secret && !own ? 'Titre secret' : t.d, v: Math.min(t.v(x), g), g, own, ready: !own && t.v(x) >= g, pct, t: tierOf(pct), secret: !!t.secret, at: own ? S.titles[t.id] : 0 };
  });
  const packs = MISSIONS.map((m) => {
    const p = pending(S, m, x), tier = p ? p.tier : m.tiers[m.tiers.length - 1], g = tier.g(x), v = m.v(x);
    return { id: m.id, kind: m.kind, n: m.n, d: m.d(g), v: Math.min(v, g), g, rw: tier.rw, rl: lab(tier.rw, tier.n), step: p ? p.k + 1 : m.tiers.length, steps: m.tiers.length, claimed: !p, ready: !!p && v >= g };
  });
  return { titles, packs, equipped: TITLES.some((t) => t.id === S.title) ? S.title : null, nbOwn: titles.filter((t) => t.own).length, mc: readyCount(S, x) };
}

// Récupère tout ce qui est prêt (ids = liste ciblée, ou null pour tout). Renvoie ce qui a été obtenu.
function claim(S, x, ids) {
  const want = ids ? new Set(ids) : null;
  const got = { packs: [], titles: [] };
  if (want) {
    const known = new Set([...MISSIONS.map((m) => m.id), ...TITLES.map((t) => t.id)]);
    for (const id of want) if (!known.has(id)) throw new G.GameError('Mission inconnue');
  }
  MISSIONS.forEach((m) => {
    if (want && !want.has(m.id)) return;
    for (let guard = 0; guard < 12 && packReady(S, m, x); guard++) {
      const { tier } = pending(S, m, x);
      if (m.kind === 'once') { if (!S.claimed) S.claimed = {}; S.claimed[m.id] = doneTiers(S, m, x) + 1; }
      else { const k = m.kind === 'day' ? 'dclaim' : 'wclaim'; if (!S[k]) S[k] = {}; S[k][m.id] = claimKey(m, x); }
      S.wp[tier.rw] = (S.wp[tier.rw] || 0) + tier.n;
      got.packs.push({ id: m.id, rw: tier.rw, n: tier.n, label: lab(tier.rw, tier.n) });
    }
  });
  if (!S.titles || typeof S.titles !== 'object') S.titles = {};
  TITLES.forEach((t) => {
    if (want && !want.has(t.id)) return;
    if (titleReady(S, t, x)) { S.titles[t.id] = x.now; got.titles.push({ id: t.id, n: t.n }); }
  });
  if (want && !got.packs.length && !got.titles.length) throw new G.GameError('Rien à récupérer');
  return got;
}

module.exports = { TITLES, MISSIONS, PACK_LABEL, context, view, claim, tierOf, readyCount };
