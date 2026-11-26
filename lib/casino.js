// Casino : machine à sous, plus ou moins et pubs simulées.
// Tout est tiré et compté ici, côté serveur : la page ne fait qu'afficher le résultat.
const G = require('./game');

const DEF = {
  BETS: [10, 25, 50, 100, 250, 500, 1000],
  INS_MAX: 1000000,       // crédits maximum dans la machine
  // gain = mise × multiplicateur. T3 = 3 cartes de la même rareté (Commun .. Mythique), T2 = 2 cartes de la même rareté
  T3: [4, 7, 14, 30, 80, 250],
  T2: [0.5, 1, 1.5, 2, 5, 10],
  C2: 2,                  // 2 trèfles + n'importe quoi
  FREE: 5,                // 3 trèfles = tours gratuits
  // chance de chaque rareté sur un rouleau : SPLO pour les grosses mises, SPHI pour les petites (plus de chance)
  // mêmes chances quelle que soit la mise (rendu ~93 %)
  SPLO: [0.275, 0.2375, 0.19, 0.135, 0.1025, 0.06],
  SPHI: [0.275, 0.2375, 0.19, 0.135, 0.1025, 0.06],
  CL: { lo: 0.1675, hi: 0.1675 }, // chance d'un trèfle
  HL_MARGE: 0.95,         // plus ou moins : cote = marge / chance
  HL_MAX: 1000000,
  HL_COTE_MAX: 10,
  ADS: { coins: 100, max: 5, n: 3, sec: 5 },
};

function cfgOf(over) {
  const c = JSON.parse(JSON.stringify(DEF));
  if (over && typeof over === 'object') {
    const arr = (k, n) => { if (Array.isArray(over[k]) && over[k].length === n && over[k].every((x) => Number.isFinite(+x) && +x >= 0)) c[k] = over[k].map(Number); };
    arr('T3', 6); arr('T2', 6); arr('SPLO', 6); arr('SPHI', 6);
    if (Number.isFinite(+over.C2) && +over.C2 >= 0) c.C2 = +over.C2;
    if (over.CL && Number.isFinite(+over.CL.lo) && Number.isFinite(+over.CL.hi)) c.CL = { lo: clamp(+over.CL.lo, 0.01, 0.4), hi: clamp(+over.CL.hi, 0.01, 0.4) };
    if (Number.isFinite(+over.HL_MARGE)) c.HL_MARGE = clamp(+over.HL_MARGE, 0.5, 1);
    if (over.ADS) { const a = over.ADS; if (Number.isFinite(+a.coins)) c.ADS.coins = clamp(Math.round(+a.coins), 0, 10000); if (Number.isFinite(+a.max)) c.ADS.max = clamp(Math.round(+a.max), 0, 50); }
  }
  ['SPLO', 'SPHI'].forEach((k) => { const t = c[k].reduce((a, b) => a + b, 0) || 1; c[k] = c[k].map((x) => x / t); });
  return c;
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const luck = (b) => clamp(1 - Math.log10(Math.max(10, b) / 10) / 2, 0, 1);
const pClover = (c, b) => c.CL.lo + (c.CL.hi - c.CL.lo) * luck(b);
const probs = (c, b) => { const L = luck(b); return c.SPLO.map((x, k) => x + (c.SPHI[k] - x) * L); };

function reel(c, b, rand) {
  if (rand() < pClover(c, b)) return 6;
  const P = probs(c, b); let t = rand();
  for (let k = 0; k < 6; k++) { t -= P[k]; if (t < 0) return k; }
  return 5;
}
// multiplicateur d'un tirage (sans les 3 trèfles)
function mult(c, res) {
  const cl = res.filter((r) => r === 6).length;
  if (cl === 2) return c.C2;
  const cnt = {}; res.forEach((r) => { if (r < 6) cnt[r] = (cnt[r] || 0) + 1; });
  let m = 0;
  Object.keys(cnt).forEach((r) => { if (cnt[r] === 3) m = c.T3[r]; else if (cnt[r] === 2) m = c.T2[r]; });
  return m;
}
// retour au joueur (en tenant compte des tours gratuits), calcul exact
function rtp(c, b) {
  const cl = pClover(c, b), P = probs(c, b).map((x) => x * (1 - cl)).concat([cl]);
  let r = 0, hit = 0;
  for (let a = 0; a < 7; a++) for (let d = 0; d < 7; d++) for (let e = 0; e < 7; e++) {
    if (a === 6 && d === 6 && e === 6) continue;
    const pr = P[a] * P[d] * P[e], m = mult(c, [a, d, e]); r += pr * m; if (m > 0) hit += pr;
  }
  const p3 = cl * cl * cl;
  return { rtp: r / (1 - c.FREE * p3), hit, p3 };
}

function cas(S) {
  if (!S.cas || typeof S.cas !== 'object') S.cas = {};
  const k = S.cas;
  k.cred = Math.max(0, Math.floor(+k.cred || 0)); k.free = Math.max(0, Math.floor(+k.free || 0)); k.fbet = Math.floor(+k.fbet || 0);
  if (!k.st) k.st = { bet: 0, won: 0, hb: 0, hw: 0, ads: 0 };
  if (!Array.isArray(k.log)) k.log = [];
  return k;
}
const err = (m) => new G.GameError(m);
const intOf = (v) => Math.floor(+v);
// derniers tirages du joueur (pour l'admin), 30 au plus
const LOG_MAX = 30;
function logIt(k, e) { k.log.push(e); if (k.log.length > LOG_MAX) k.log.splice(0, k.log.length - LOG_MAX); }

// ---------- machine à sous ----------
function slotInsert(S, v) {
  const k = cas(S); v = intOf(v);
  if (!(v >= 10)) throw err('Insère au moins 10 Coins');
  if (v > S.money) throw err('Pas assez de Coins');
  if (k.cred + v > DEF.INS_MAX) throw err('La machine est pleine');
  S.money -= v; k.cred += v;
  return { cred: k.cred };
}
function slotSpin(S, c, bet, rand, now) {
  const k = cas(S); bet = intOf(bet);
  let b, free = false;
  if (k.free > 0) { free = true; k.free--; b = k.fbet || 10; }
  else {
    if (!c.BETS.includes(bet)) throw err('Mise inconnue');
    if (k.cred < bet) throw err(k.cred ? 'Pas assez de crédits pour cette mise' : 'Insère des Coins dans la machine');
    k.cred -= bet; b = bet; k.st.bet += bet;
  }
  const res = [reel(c, b, rand), reel(c, b, rand), reel(c, b, rand)];
  let g = 0, won = 0;
  if (res.every((r) => r === 6)) { k.free += c.FREE; k.fbet = b; won = c.FREE; }
  else { g = Math.floor(b * mult(c, res)); k.cred += g; k.st.won += g; }
  k.st.n = (k.st.n || 0) + 1; if (free) k.st.fs = (k.st.fs || 0) + 1;
  logIt(k, { t: now || Date.now(), g: 's', b, w: g, r: res.join(''), f: free ? 1 : 0, fw: won });
  return { res, gain: g, bet: b, wasFree: free, freeWon: won, cred: k.cred, free: k.free, fbet: k.fbet };
}
function slotCash(S) {
  const k = cas(S);
  if (k.free > 0) throw err('Joue d\'abord tes tours gratuits');
  const g = k.cred; if (!g) throw err('Rien à encaisser');
  S.money += g; k.cred = 0;
  return { cashed: g, cred: 0 };
}

// ---------- plus ou moins (par rareté) ----------
const rarP = (RAR) => { const t = RAR.reduce((a, r) => a + r.p, 0); return RAR.map((r) => r.p / t); };
function pools(cards) { const by = [[], [], [], [], [], []]; cards.forEach((x, i) => { if (x && x[0] !== '?' && !x[5] && by[x[2]]) by[x[2]].push(i); }); return by; }
function drawCard(cards, RAR, rand, not) {
  const P = rarP(RAR), by = pools(cards);
  let t = rand(), r = 0; for (; r < 5; r++) { t -= P[r]; if (t < 0) break; }
  while (!by[r].length && r > 0) r--;
  const L = by[r]; if (!L.length) throw err('Aucune carte');
  let i = L[Math.floor(rand() * L.length)];
  if (i === not && L.length > 1) i = L[(L.indexOf(i) + 1) % L.length];
  return i;
}
function odds(c, RAR, r) {
  const P = rarP(RAR); let hi = 0, lo = 0; P.forEach((q, k) => { if (k > r) hi += q; else if (k < r) lo += q; });
  // cote = marge / chance, mais jamais plus de ×HL_COTE_MAX : les paris très improbables paient moins (pas de ×41 ni de ×316)
  const co = (x) => (x > 0 && c.HL_MARGE / x >= 1.01 ? Math.max(1.01, Math.min(c.HL_COTE_MAX, Math.round((c.HL_MARGE / x) * 100) / 100)) : 0);
  return { hi, lo, eq: P[r], cH: co(hi), cL: co(lo), cE: co(P[r]) };
}
function hlStart(S, c, cards, RAR, bet, rand) {
  const k = cas(S); bet = intOf(bet);
  if (k.hl) throw err('Une partie est déjà en cours');
  if (!c.BETS.includes(bet)) throw err('Mise inconnue');
  if (S.money < bet) throw err('Pas assez de Coins');
  S.money -= bet; k.st.hb += bet;
  k.hl = { cur: drawCard(cards, RAR, rand), pot: bet, bet, n: 0 };
  return { hl: k.hl };
}
function hlGuess(S, c, cards, RAR, d, rand, now) {
  const k = cas(S), h = k.hl; d = Math.sign(+d || 0);
  if (!h || !cards[h.cur]) throw err('Pas de partie en cours');
  const r = cards[h.cur][2], o = odds(c, RAR, r), co = d > 0 ? o.cH : d < 0 ? o.cL : o.cE;
  if (!co) throw err('Pari impossible');
  const nx = drawCard(cards, RAR, rand, h.cur), v = cards[nx][2];
  const ok = d > 0 ? v > r : d < 0 ? v < r : v === r;
  const prev = h.cur;
  if (ok) { h.pot = Math.min(c.HL_MAX, Math.floor(h.pot * co)); h.n++; h.cur = nx; }
  else { k.hl = null; k.st.hn = (k.st.hn || 0) + 1; logIt(k, { t: now || Date.now(), g: 'h', b: h.bet, w: 0, n: h.n + 1 }); }
  return { ok, prev, next: nx, cote: co, hl: k.hl };
}
function hlCash(S, now) {
  const k = cas(S), h = k.hl;
  if (!h) throw err('Pas de partie en cours');
  S.money += h.pot; k.st.hw += h.pot; k.hl = null; k.st.hn = (k.st.hn || 0) + 1;
  logIt(k, { t: now || Date.now(), g: 'h', b: h.bet, w: h.pot, n: h.n });
  return { cashed: h.pot };
}

// ---------- pubs simulées (en attendant AdSense) ----------
function adStart(S, c, day, now) {
  const k = cas(S); if (!k.ad || k.ad.d !== day) k.ad = { d: day, n: 0, t: 0 };
  if (k.ad.n >= c.ADS.max) throw err('Tu as regardé tes ' + c.ADS.max + ' pubs du jour, reviens demain');
  k.ad.t = now;
  return { ad: k.ad };
}
function adClaim(S, c, day, now) {
  const k = cas(S), a = k.ad;
  if (!a || a.d !== day || !a.t) throw err('Lance d\'abord les pubs');
  if (now - a.t < (c.ADS.n * c.ADS.sec - 1) * 1000) throw err('Regarde les pubs jusqu\'au bout');
  if (a.n >= c.ADS.max) throw err('Tu as regardé tes ' + c.ADS.max + ' pubs du jour, reviens demain');
  a.n++; a.t = 0; S.money += c.ADS.coins; k.st.ads += c.ADS.coins;
  return { got: c.ADS.coins, ad: a };
}

// ce que la page reçoit (aucun secret : les chances sont affichées aux joueurs)
function publicCas(c) { return { BETS: c.BETS, T3: c.T3, T2: c.T2, C2: c.C2, FREE: c.FREE, SPLO: c.SPLO, SPHI: c.SPHI, CL: c.CL, HL_MARGE: c.HL_MARGE, HL_COTE_MAX: c.HL_COTE_MAX, ADS: c.ADS }; }

module.exports = { DEF, cfgOf, luck, pClover, probs, mult, rtp, cas, slotInsert, slotSpin, slotCash, hlStart, hlGuess, hlCash, odds, adStart, adClaim, publicCas, drawCard };
