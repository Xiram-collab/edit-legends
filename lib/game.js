// Logique du jeu, 100 % côté serveur. Fonctions pures : l'aléatoire est injecté (rand() -> [0,1)).
const C = require('./config');

function newState(now) {
  return {
    stock: C.START_STOCK, last: now, col: {}, pulled: {}, money: 0, opened: 0, wp: {},
    team: Array(11).fill(null), vitrine: [null, null, null], extra: { coach: null, stade: null, club: null }, tier: {}, tord: [], tnames: {}, jtier: {}, jord: [], mute: false, hide: false, hidep: false,
    bad: 0, lock: 0,
    titles: {}, title: null, claimed: {}, dclaim: {}, wclaim: {}, sold: 0, spins: 0, chain: 0, maxMoney: 0, runs: 0, accepted: 0, mkSold: 0, mkBought: 0,
  };
}

// Complète un état ancien/incomplet avec les valeurs par défaut.
function normalizeState(S, now) {
  const d = newState(now);
  for (const k of Object.keys(d)) if (S[k] === undefined || S[k] === null) S[k] = d[k];
  if (!Array.isArray(S.team) || S.team.length !== 11) S.team = d.team;
  if (!Array.isArray(S.vitrine) || S.vitrine.length !== 3) S.vitrine = d.vitrine;
  if (!S.extra || typeof S.extra !== 'object') S.extra = d.extra;
  for (const k of ['coach', 'stade', 'club']) if (S.extra[k] === undefined) S.extra[k] = null;
  return S;
}

// Remet un joueur à zéro comme un nouveau joueur (garde seulement ses réglages d'affichage).
function resetPlayer(S, now) {
  const keep = { mute: S.mute, hide: S.hide, hidep: S.hidep, jl: S.jl };
  const fresh = newState(now);
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, fresh, keep);
}

// Retire une carte supprimée de l'état d'un joueur (collection, équipe, tier lists).
function purgeCard(S, id) {
  delete S.col[id]; delete S.pulled[id]; delete S.tier[id]; delete S.jtier[id];
  S.team = S.team.map((x) => (x === id ? null : x));
  if (Array.isArray(S.vitrine)) S.vitrine = S.vitrine.map((x) => (x === id ? null : x));
  if (S.extra) for (const k of Object.keys(S.extra)) if (S.extra[k] === id) S.extra[k] = null;
  S.tord = (S.tord || []).filter((x) => x !== id); S.jord = (S.jord || []).filter((x) => x !== id);
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
  cards.forEach((c, i) => { if (c && !c[5] && c[2] === tier) l.push(i); });
  if (!l.length) {
    for (let d = 1; d < C.RAR.length && !l.length; d++) {
      for (const t of [tier - d, tier + d]) {
        if (!l.length && t >= 0 && t < C.RAR.length) cards.forEach((c, i) => { if (c && !c[5] && c[2] === t) l.push(i); });
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

// Marché : retire un exemplaire de la collection (si c'était le dernier, la carte quitte aussi l'équipe, la vitrine et les emplacements).
function releaseCard(S, id) {
  if (!(S.col[id] > 0)) throw new GameError('Tu ne possèdes pas cette carte');
  S.col[id]--;
  if (!S.col[id]) {
    delete S.col[id];
    S.team = S.team.map((x) => (x === id ? null : x));
    if (Array.isArray(S.vitrine)) S.vitrine = S.vitrine.map((x) => (x === id ? null : x));
    if (S.extra) for (const k of Object.keys(S.extra)) if (S.extra[k] === id) S.extra[k] = null;
  }
}
// Marché : ajoute un exemplaire reçu (achat ou carte rendue au vendeur)
function giveCard(S, id) {
  S.col[id] = (S.col[id] || 0) + 1;
  S.pulled[id] = Math.max(S.pulled[id] || 0, S.col[id]);
}

function wheelPick(rand, noRelance) {
  let tot = 0;
  C.WH.forEach((w) => { if (!(noRelance && w.t === 'relance')) tot += w.p; });
  let r = rand() * tot;
  for (let i = 0; i < C.WH.length; i++) {
    if (noRelance && C.WH[i].t === 'relance') continue;
    r -= C.WH[i].p; if (r < 0) return i;
  }
  return C.WH.findIndex((w) => w.p > 0);
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
  if (S.money < p.price) throw new GameError('Pas assez de Coins');
  S.money -= p.price;
  const ids = drawPack(cards, g, rand);
  addCards(S, ids); S.opened++;
  return ids;
}

function sellOne(S, cards, i) {
  if (!cards[i] || !(S.col[i] > 1)) throw new GameError('Aucun doublon à vendre');
  S.col[i]--; S.sold = (S.sold || 0) + 1;
  const v = C.RAR[cards[i][2]].v;
  S.money += v;
  return v;
}

// Vente rapide : items = [[carte, quantité], ...]. Seuls les doublons se vendent (il reste toujours 1 exemplaire). Tout ou rien.
function sellMany(S, cards, items) {
  if (!Array.isArray(items) || !items.length || items.length > 500) throw new GameError('Aucune carte sélectionnée');
  const take = {};
  for (const it of items) {
    const i = Array.isArray(it) ? +it[0] : NaN, n = Array.isArray(it) ? Math.floor(+it[1]) : NaN;
    if (!cards[i] || !(n >= 1)) throw new GameError('Sélection invalide');
    take[i] = (take[i] || 0) + n;
  }
  let t = 0, cnt = 0;
  for (const k of Object.keys(take)) {
    const i = +k, n = take[k];
    if (n > (S.col[i] || 0) - 1) throw new GameError('Tu ne peux vendre que tes doublons (une copie est gardée)');
    t += n * C.RAR[cards[i][2]].v; cnt += n;
  }
  for (const k of Object.keys(take)) S.col[k] -= take[k];
  S.sold = (S.sold || 0) + cnt; S.money += t;
  return { gain: t, count: cnt };
}

function sellAll(S, cards) {
  let t = 0;
  cards.forEach((c, i) => { const n = S.col[i] || 0; if (c && n > 1) { t += (n - 1) * C.RAR[c[2]].v; S.sold = (S.sold || 0) + n - 1; S.col[i] = 1; } });
  S.money += t;
  return t;
}

function openWaiting(S, cards, g, rand, pick) {
  if (!(S.wp[g] > 0)) throw new GameError('Aucun pack en attente de ce type');
  const myth = []; cards.forEach((c, i) => { if (c && !c[5] && c[2] === 5) myth.push(i); });
  if (g === 5 && myth.length && !myth.includes(pick)) throw new GameError('Choisis la carte Mythique que tu veux');
  S.wp[g]--;
  let ids;
  if (g === 5) ids = [myth.length ? pick : pickCard(cards, 5, rand)];
  else if (g === 6) ids = [pickCard(cards, pickTier(0, rand), rand)]; // carte au hasard : rareté comme dans un pack
  else { ids = drawPack(cards, g, rand); S.opened++; }
  addCards(S, ids);
  return ids;
}

// Un tour de roue : applique la récompense (pack ou carte en attente, Coins) et compte le résultat.
function spinOnce(S, cards, rand, noRelance) {
  const res = wheelPick(rand, noRelance);
  const w = C.WH[res];
  if (!Array.isArray(S.wheel)) S.wheel = [];
  while (S.wheel.length < C.WH.length) S.wheel.push(0);
  S.wheel[res]++;
  const out = { res };
  if (w.t === 'pack' || w.t === 'card') S.wp[w.g] = (S.wp[w.g] || 0) + 1;
  else if (w.t === 'coins') { S.money += w.v; out.coins = w.v; }
  return out;
}

// Utilise un code valide : la roue tourne ; une relance rejoue gratuitement (5 de suite au maximum).
function spinForReward(S, rand, cards) {
  const spins = [];
  for (let n = 0; ; n++) {
    const o = spinOnce(S, cards || [], rand, n >= C.RELANCE_MAX);
    spins.push(o);
    if (C.WH[o.res].t !== 'relance') break;
  }
  const last = spins[spins.length - 1];
  S.chain = Math.max(S.chain || 0, spins.length - 1);   // relances d'affilée (titre secret)
  return { res: last.res, spins, card: last.card, coins: last.coins };
}

// Préférences modifiables par le joueur (équipe, tier list, son). Tout est validé.
function sanitizePrefs(S, p, cards) {
  const n = cards.length;
  const okId = (x) => Number.isInteger(x) && x >= 0 && x < n;
  if (Array.isArray(p.team) && p.team.length === 11) S.team = p.team.map((x) => (okId(x) ? x : null));
  if (p.team !== undefined || p.extra !== undefined) {
    // coach (éditeur ou influenceur pas déjà dans l'équipe), stade (map), club (structure) : cartes possédées
    const src = p.extra && typeof p.extra === 'object' ? p.extra : S.extra || {};
    const used = new Set(S.team || []);
    const ok = (x, cats) => okId(x) && (S.col[x] || 0) > 0 && cats.includes(cards[x][1]) && !used.has(x);
    S.extra = { coach: ok(src.coach, [0, 1]) ? src.coach : null, stade: ok(src.stade, [2]) ? src.stade : null, club: ok(src.club, [3]) ? src.club : null };
  }
  if (Array.isArray(p.vitrine) && p.vitrine.length === 3) {
    const seen = new Set();
    S.vitrine = p.vitrine.map((x) => (okId(x) && (S.col[x] || 0) > 0 && !seen.has(x) && seen.add(x) ? x : null));
  }
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
  if (typeof p.hidep === 'boolean') S.hidep = p.hidep;
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
    case 'wpa': [0, 2, 3, 5, 6].forEach((g) => { S.wp[g] = (S.wp[g] || 0) + 1; }); break;
    case 'wt': { const sp = spinForReward(S, rand, cards); res = sp.res; out.spins = sp.spins; break; }
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

// ----- classements par période (heure de Paris) : jour = AAAA-MM-JJ, semaine = lundi de la semaine -----
const PFMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
function parisKeys(ms) {
  const dk = PFMT.format(new Date(ms));
  const [y, m, d] = dk.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return { dk, wk: t.toISOString().slice(0, 10) };
}
// Début (ms) de la semaine suivante : prochain lundi 00:00 heure de Paris
function nextWeekStart(ms) {
  const wk = parisKeys(ms).wk;
  let lo = ms, hi = ms + 8 * 86400000;
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (parisKeys(mid).wk === wk) lo = mid; else hi = mid; }
  return hi;
}
function rollPer(S, ms) {
  const k = parisKeys(ms);
  const p = S.per && typeof S.per === 'object' ? S.per : (S.per = {});
  if (p.dk !== k.dk) { p.dk = k.dk; p.d = 0; p.dr = 0; p.do = 0; p.dl = 0; }
  if (p.wk !== k.wk) { p.wk = k.wk; p.w = 0; p.wr = 0; p.wo = 0; p.wl = 0; }
  for (const f of ['d', 'dr', 'do', 'dl', 'w', 'wr', 'wo', 'wl']) if (!(p[f] > 0)) p[f] = 0;
  return p;
}
// Points gagnés pendant l'action (jamais négatifs : revendre ou purger ne retire rien)
// Compteurs suivis par période : score, packs ouverts, Légendaires et mieux obtenues
function counters(S, cards) {
  let leg = 0;
  cards.forEach((c, i) => { if (c && c[2] >= 4) leg += Math.max(S.col[i] || 0, S.pulled[i] || 0); });
  return { score: summary(S, cards).score, opened: S.opened || 0, leg, money: S.money || 0 };
}
function trackScore(S, before, after, ms) {
  const p = rollPer(S, ms);
  const up = (a, b) => Math.max(0, (a || 0) - (b || 0));
  const gs = up(after.score, before.score), go = up(after.opened, before.opened), gl = up(after.leg, before.leg);
  p.d += gs; p.w += gs; p.do += go; p.wo += go; p.dl += gl; p.wl += gl;
  if (after.money > (S.maxMoney || 0)) S.maxMoney = after.money;
}
function trackRun(S, ms) { const p = rollPer(S, ms); p.dr += 1; p.wr += 1; S.runs = (S.runs || 0) + 1; }

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
    case 'rst': resetPlayer(S, now); break;
    default: throw new GameError('Action inconnue');
  }
}

module.exports = { sellMany, releaseCard, giveCard, counters, parisKeys, nextWeekStart, trackScore, trackRun, resetPlayer, purgeCard, summary, playerAction, newState, normalizeState, regen, pickTier, pickCard, drawPack, addCards, wheelPick, openFree, buyPack, sellOne, sellAll, openWaiting, spinForReward, sanitizePrefs, adminAction, GameError };
