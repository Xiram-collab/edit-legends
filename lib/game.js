// Logique du jeu, 100 % côté serveur. Fonctions pures : l'aléatoire est injecté (rand() -> [0,1)).
const C = require('./config');

function newState(now) {
  return {
    stock: C.START_STOCK, last: now, col: {}, pulled: {}, money: 0, opened: 0, wp: {},
    team: Array(11).fill(null), tier: {}, tord: [], tnames: {}, jtier: {}, jord: [], mute: false, hide: false,
    bad: 0, lock: 0,
  };
}

// Complète un état ancien/incomplet avec les valeurs par défaut.
function normalizeState(S, now) {
  const d = newState(now);
  for (const k of Object.keys(d)) if (S[k] === undefined || S[k] === null) S[k] = d[k];
  if (!Array.isArray(S.team) || S.team.length !== 11) S.team = d.team;
  return S;
}

function regen(S, now) {
  if (S.stock >= C.MAXSTOCK) { S.last = now; return; }
  const k = Math.floor((now - S.last) / C.HOUR);
  if (k > 0) {
    S.stock = Math.min(C.MAXSTOCK, S.stock + k);
    S.last = S.stock >= C.MAXSTOCK ? now : S.last + k * C.HOUR;
  }
}

function pickTier(min, rand) {
  let t = 0;
  for (let i = min; i < C.RAR.length; i++) t += C.RAR[i].p;
  let r = rand() * t;
  for (let i = min; i < C.RAR.length; i++) { r -= C.RAR[i].p; if (r < 0) return i; }
  return C.RAR.length - 1;
}

// cards : tableau de lignes [nom, catégorie, rareté, description, image] (index = identifiant de la carte)
function pickCard(cards, tier, rand) {
  let l = [];
  cards.forEach((c, i) => { if (c && c[2] === tier) l.push(i); });
  if (!l.length) {
    for (let d = 1; d < C.RAR.length && !l.length; d++) {
      for (const t of [tier - d, tier + d]) {
        if (!l.length && t >= 0 && t < C.RAR.length) cards.forEach((c, i) => { if (c && c[2] === t) l.push(i); });
      }
    }
  }
  return l[Math.floor(rand() * l.length)];
}

function drawPack(cards, g, rand) {
  const out = [];
  for (let i = 0; i < 5; i++) out.push(pickCard(cards, pickTier(0, rand), rand));
  if (g > 0) out[4] = pickCard(cards, pickTier(g, rand), rand);
  return out;
}

function addCards(S, ids) {
  ids.forEach((i) => { S.col[i] = (S.col[i] || 0) + 1; S.pulled[i] = (S.pulled[i] || 0) + 1; });
}

function wheelPick(rand) {
  let r = rand() * 100;
  for (let i = 0; i < C.WH.length; i++) { r -= C.WH[i].p; if (r < 0) return i; }
  return 0;
}

class GameError extends Error { constructor(msg, code) { super(msg); this.code = code || 400; } }

function openFree(S, cards, rand, now) {
  regen(S, now);
  if (S.stock < 1) throw new GameError('Plus de pack gratuit en stock');
  S.stock--;
  if (S.stock === C.MAXSTOCK - 1) S.last = now;
  const ids = drawPack(cards, 0, rand);
  addCards(S, ids); S.opened++;
  return ids;
}

function buyPack(S, cards, g, rand) {
  const p = C.PACKS.find((x) => x.g === g);
  if (!p) throw new GameError('Pack inconnu');
  if (S.money < p.price) throw new GameError('Pas assez de V-Bucks');
  S.money -= p.price;
  const ids = drawPack(cards, g, rand);
  addCards(S, ids); S.opened++;
  return ids;
}

function sellOne(S, cards, i) {
  if (!cards[i] || !(S.col[i] > 1)) throw new GameError('Aucun doublon à vendre');
  S.col[i]--;
  const v = C.RAR[cards[i][2]].v;
  S.money += v;
  return v;
}

function sellAll(S, cards) {
  let t = 0;
  cards.forEach((c, i) => { const n = S.col[i] || 0; if (c && n > 1) { t += (n - 1) * C.RAR[c[2]].v; S.col[i] = 1; } });
  S.money += t;
  return t;
}

function openWaiting(S, cards, g, rand) {
  if (!(S.wp[g] > 0)) throw new GameError('Aucun pack en attente de ce type');
  S.wp[g]--;
  let ids;
  if (g === 5) ids = [pickCard(cards, 5, rand)];
  else { ids = drawPack(cards, g, rand); S.opened++; }
  addCards(S, ids);
  return ids;
}

// Utilise un code valide : la roue tourne et la récompense va dans les packs en attente.
function spinForReward(S, rand) {
  const res = wheelPick(rand);
  const w = C.WH[res];
  if (w.g >= 0) S.wp[w.g] = (S.wp[w.g] || 0) + 1;
  return res;
}

// Préférences modifiables par le joueur (équipe, tier list, son). Tout est validé.
function sanitizePrefs(S, p, cards) {
  const n = cards.length;
  const okId = (x) => Number.isInteger(x) && x >= 0 && x < n;
  if (Array.isArray(p.team) && p.team.length === 11) S.team = p.team.map((x) => (okId(x) ? x : null));
  const tierObj = (o) => {
    const out = {};
    if (o && typeof o === 'object') for (const k of Object.keys(o)) if (okId(+k) && typeof o[k] === 'string' && o[k].length <= 3) out[k] = o[k];
    return out;
  };
  const ordArr = (a) => (Array.isArray(a) ? a.filter(okId).slice(0, n + 5) : []);
  if ('tier' in p) S.tier = tierObj(p.tier);
  if ('jtier' in p) S.jtier = tierObj(p.jtier);
  if ('tord' in p) S.tord = ordArr(p.tord);
  if ('jord' in p) S.jord = ordArr(p.jord);
  if (p.tnames && typeof p.tnames === 'object') {
    const o = {};
    for (const k of Object.keys(p.tnames).slice(0, 20)) if (typeof p.tnames[k] === 'string') o[k.slice(0, 8)] = p.tnames[k].slice(0, 30);
    S.tnames = o;
  }
  if (typeof p.mute === 'boolean') S.mute = p.mute;
  if (typeof p.hide === 'boolean') S.hide = p.hide;
}

// Outils du mode test (réservés à l'administrateur).
function adminAction(S, cards, a, v, i, rand, now) {
  let ids = null, res = null;
  const out = {};
  switch (a) {
    case 'm': S.money += Math.max(0, Math.min(1e9, +v || 0)); break;
    case 'm0': S.money = 0; break;
    case 's': S.stock += Math.max(0, Math.min(1000, +v || 0)); break;
    case 's0': S.stock = 0; break;
    case 'sfull': S.stock = Math.max(S.stock, C.MAXSTOCK); S.last = now; break;
    case 'c': if (!cards[i]) throw new GameError('Carte inconnue'); addCards(S, [i]); break;
    case 'call': cards.forEach((c, k) => { if (c) addCards(S, [k]); }); break;
    case 'creset': S.col = {}; break;
    case 'rst': S.col = {}; S.pulled = {}; S.opened = 0; break;
    case 'wpa': [0, 2, 3, 5].forEach((g) => { S.wp[g] = (S.wp[g] || 0) + 1; }); break;
    case 'wt': res = spinForReward(S, rand); break;
    case 'p': ids = drawPack(cards, +v || 0, rand); addCards(S, ids); S.opened++; break;
    case 'p10': ids = []; for (let q = 0; q < 10; q++) ids = ids.concat(drawPack(cards, 0, rand)); addCards(S, ids); S.opened += 10; break;
    default: throw new GameError('Action inconnue');
  }
  if (ids) out.cards = ids;
  if (res !== null) out.res = res;
  return out;
}

// Résumé utilisé par le classement (recalculé à chaque enregistrement).
// Score = points de rareté x exemplaires OBTENUS (doublons compris, même revendus) : il mesure l'activité.
// owned / mythics comptent les cartes différentes actuellement possédées.
function summary(S, cards) {
  let owned = 0, mythics = 0, score = 0;
  cards.forEach((c, i) => {
    if (!c) return;
    const have = S.col[i] || 0, got = Math.max(have, S.pulled[i] || 0);
    if (have > 0) { owned++; if (c[2] === 5) mythics++; }
    score += (C.SCORE[c[2]] || 0) * got;
  });
  return { owned, mythics, score, opened: S.opened || 0, hidden: !!S.hide };
}

// Actions de l'administrateur sur le compte d'un joueur (le joueur cible est S).
function playerAction(S, cards, a, v, i, now) {
  const n = Math.trunc(+v) || 0;
  switch (a) {
    case 'm': S.money = Math.max(0, Math.min(1e12, S.money + Math.max(-1e12, Math.min(1e12, n)))); break;
    case 'mset': S.money = Math.max(0, Math.min(1e12, n)); break;
    case 's': S.stock = Math.max(0, Math.min(1000, S.stock + n)); if (S.stock < C.MAXSTOCK) S.last = Math.min(S.last, now); break;
    case 'wp': {
      if (!C.ADMIN_WP.includes(+i)) throw new GameError('Type de pack inconnu');
      S.wp[+i] = Math.max(0, Math.min(1000, (S.wp[+i] || 0) + n)); break;
    }
    case 'c': {
      if (!cards[i]) throw new GameError('Carte inconnue');
      S.col[i] = Math.max(0, Math.min(1000, (S.col[i] || 0) + n));
      if (!S.col[i]) delete S.col[i];
      break;
    }
    case 'cclear': S.col = {}; break;
    case 'rst': S.col = {}; S.pulled = {}; S.opened = 0; break;
    default: throw new GameError('Action inconnue');
  }
}

module.exports = { summary, playerAction, newState, normalizeState, regen, pickTier, pickCard, drawPack, addCards, wheelPick, openFree, buyPack, sellOne, sellAll, openWaiting, spinForReward, sanitizePrefs, adminAction, GameError };
