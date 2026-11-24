const assert = require('assert');
const fakeDb = require('./fakeDb');
const { createHandler } = require('../lib/handler');
const C = require('../lib/config');
const cards = require('../data/cards.json');
assert.strictEqual(C.START_STOCK, 10, 'un nouveau joueur commence avec 10 packs');
C.START_STOCK = 3; // les scénarios ci-dessous partent de 3 packs

let clock = 1e12;
const db = fakeDb(cards, ['AAAA2222', 'BBBB3333', 'CCCC4444', 'DDDD5555', 'EEEE6666']);
const { makeCode, checkCode } = require('../lib/codes');
const CODE_NOW = Date.parse('2026-11-24T12:00:00Z');
const MC = [1, 2, 3].map((k) => makeCode(CODE_NOW - k * 60000, 1000 + k));
const h = createHandler(db, { adminIds: '111', now: () => clock, codeNow: () => CODE_NOW });
const call = async (tok, body) => h(tok, body);
let n = 0; const ok = (name) => { n++; console.log('ok  ' + name); };

(async () => {
  let r0;
  // aperçu public des cartes : sans connexion, aucune donnée de joueur
  r0 = await call('', { action: 'preview' }); assert.strictEqual(r0.status, 200); assert.strictEqual(r0.json.cards.length, cards.length); assert.ok(!r0.json.state); ok('aperçu public des cartes sans connexion');
  // connexion obligatoire
  assert.strictEqual((await call('', { action: 'me' })).status, 401); ok('refus sans connexion');
  assert.strictEqual((await call('mauvais', { action: 'me' })).status, 401); ok('refus avec faux jeton');

  // création du compte
  let r = await call('tokB', { action: 'me' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.state.stock, 3); assert.strictEqual(r.json.isAdmin, false);
  assert.strictEqual(r.json.cards.length, cards.length); ok('nouveau compte : 3 packs, cartes chargées');

  // packs gratuits : 3 puis refus
  for (let i = 0; i < 1; i++) { r = await call('tokB', { action: 'open', kind: 'free' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.cards.length, 5); }
  r = await call('tokB', { action: 'open', kind: 'free', n: 5 }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.cards.length, 10); ok('ouverture x5 limitée au stock (2 packs = 10 cartes)');
  assert.strictEqual(r.json.state.stock, 0); assert.strictEqual(r.json.state.opened, 3);
  r = await call('tokB', { action: 'open', kind: 'free' }); assert.strictEqual(r.status, 400); ok('stock gratuit épuisé refusé');
  clock += 3600000; r = await call('tokB', { action: 'me' }); assert.strictEqual(r.json.state.stock, 1); ok('+1 pack gratuit après 1 h');

  // achat sans argent
  r = await call('tokB', { action: 'open', kind: 'buy', g: 2 }); assert.strictEqual(r.status, 400); ok('achat sans Coins refusé');
  r = await call('tokB', { action: 'open', kind: 'buy', g: 9 }); assert.strictEqual(r.status, 400); ok('pack inconnu refusé');

  // le mode test est interdit à Bob, autorisé à Alice
  r = await call('tokB', { action: 'admin', a: 'm', v: 100000 }); assert.strictEqual(r.status, 403); ok('admin refusé à un joueur');
  r = await call('tokA', { action: 'admin', a: 'm', v: 100000 }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.state.money, 100000); ok('admin autorisé pour le compte admin');
  r = await call('tokA', { action: 'me' }); assert.strictEqual(r.json.isAdmin, true);

  // achat
  r = await call('tokA', { action: 'open', kind: 'buy', g: 3 }); assert.strictEqual(r.json.state.money, 99000);
  assert.ok(r.json.cards.some((i) => cards[i][2] >= 3), 'Épique+ garanti'); ok('achat pack Épique+ : débit + carte garantie');

  // revente
  await call('tokA', { action: 'admin', a: 'call' }); await call('tokA', { action: 'admin', a: 'call' });
  const before = (await call('tokA', { action: 'me' })).json.state.money;
  r = await call('tokA', { action: 'sell', all: true }); assert.ok(r.json.gain > 0); assert.strictEqual(r.json.state.money, before + r.json.gain); ok('vente des doublons');
  r = await call('tokA', { action: 'sell', i: 0 }); assert.strictEqual(r.status, 400); ok('vente sans doublon refusée');

  // simultanéité : 12 ouvertures en même temps avec 3 packs en stock -> exactement 3 réussies
  await call('tokB', { action: 'admin', a: 's0' }).catch(() => {});
  db.saves.get('B').data.stock = 3; db.saves.get('B').data.last = clock;
  const rs = await Promise.all(Array.from({ length: 12 }, () => call('tokB', { action: 'open', kind: 'free' })));
  const good = rs.filter((x) => x.status === 200).length;
  assert.strictEqual(good, 3, 'réussies=' + good); assert.strictEqual(db.saves.get('B').data.stock, 0); ok('12 clics simultanés : seulement 3 packs ouverts');

  // codes : un code ne marche qu'une fois pour tout le site
  assert.ok(checkCode('AP6J-L4PV-KLGE-5V').valid && new Date(checkCode('AP6J-L4PV-KLGE-5V').createdAt).toISOString() === '2026-11-12T22:02:00.000Z'); assert.ok(!checkCode('AP6J-L4PV-KLGE-5W').valid); ok('code de référence : valide (12/11 22:02 UTC), et faux si on change un caractère');
  r = await call('tokB', { action: 'code', code: 'AP6J-L4PV-KLGE-5V' }); assert.strictEqual(r.status, 400); assert.ok(/expiré/.test(r.json.error)); ok('code trop ancien refusé');
  r = await call('tokB', { action: 'code', code: makeCode(CODE_NOW + 3600000) }); assert.strictEqual(r.status, 400); ok('code daté du futur refusé');
  db.saves.get('B').data.bad = 0; db.saves.get('B').version++;
  r = await call('tokB', { action: 'code', code: MC[0].toLowerCase() }); assert.strictEqual(r.status, 200); assert.ok(r.json.res > 0 && r.json.res < require('../lib/config').WH.length && Array.isArray(r.json.spins) && r.json.spins.length >= 1); ok('code valide accepté (casse et tiret ignorés)');
  assert.ok(db.codes.has(MC[0]) && db.codes.get(MC[0]).used); ok('code utilisé enregistré sous sa forme normalisée');
  r = await call('tokA', { action: 'code', code: MC[0].replace(/-/g, '') }); assert.strictEqual(r.status, 400); ok('même code refusé à un autre joueur (même sans tirets)');
  r = await call('tokB', { action: 'code', code: MC[0] }); assert.strictEqual(r.status, 400); ok('même code refusé au même joueur');
  db.saves.get('B').data.bad = 0; db.saves.get('A').data.bad = 0; db.saves.get('B').version++; db.saves.get('A').version++;
  const par = await Promise.all([call('tokA', { action: 'code', code: MC[1] }), call('tokB', { action: 'code', code: MC[1] })]);
  assert.strictEqual(par.filter((x) => x.status === 200).length, 1); ok('même code envoyé par 2 joueurs en même temps : un seul gagne');

  // tour de roue payant (150 Coins), sans code
  r = await call('tokC', { action: 'spinpay' }); assert.strictEqual(r.status, 400); assert.ok(/Coins/.test(r.json.error)); ok('roue payante refusée sans assez de Coins');
  await call('tokA', { action: 'apact', id: 'C', a: 'm', v: 1000 });
  r = await call('tokC', { action: 'spinpay' }); assert.strictEqual(r.status, 200); assert.ok(Array.isArray(r.json.spins) && r.json.spins.length >= 1);
  const gain = r.json.spins.reduce((a, x) => a + (x.coins || 0), 0); assert.strictEqual(r.json.state.money, 1000 - C.SPIN_PRICE + gain); ok('roue payante : prix de la roue débité, gains crédités, aucun code utilisé');

  // essais ratés : verrou
  db.saves.get('B').data.bad = 0; db.saves.get('B').data.lock = 0; db.saves.get('B').version++;
  for (let i = 0; i < 4; i++) { r = await call('tokB', { action: 'code', code: MC[2].slice(0, -1) + 'ABCD'[i] }); assert.strictEqual(r.status, 400); assert.ok(!/attends/.test(r.json.error)); }
  r = await call('tokB', { action: 'code', code: 'ZZZZ-4999-ZZZZ-99' }); assert.strictEqual(r.status, 400); assert.ok(/attends/.test(r.json.error));
  r = await call('tokB', { action: 'code', code: MC[2] }); assert.strictEqual(r.status, 429); ok('5 mauvais codes : verrou 60 s');
  clock += 61000; r = await call('tokB', { action: 'code', code: MC[2] }); assert.strictEqual(r.status, 200); ok('verrou levé après 60 s');

  // récompenses : simulation de la roue (distribution)
  const { spinForReward, wheelPick } = require('../lib/game'); const CW = require('../lib/config').WH;
  const cnt = CW.map(() => 0); const rnd = () => require('crypto').randomInt(0, 1e9) / 1e9;
  for (let i = 0; i < 100000; i++) cnt[wheelPick(rnd)]++;
  const pct = cnt.map((x) => x / 1000); console.log('    roue sur 100000 :', pct.join(' / '));
  CW.forEach((w, i) => assert.ok(Math.abs(pct[i] - w.p) < 1.0)); ok('probabilités de la roue conformes');
  assert.strictEqual(Math.round(CW.reduce((a, w) => a + w.p, 0)), 100); ok('la roue fait 100 %');
  // effets : carte directe, Coins, packs en attente, relance enchaînée
  const S0 = { wp: {}, money: 0, col: {}, pulled: {}, opened: 0 }; let nCard = 0, nCoins = 0, nRel = 0, maxChain = 0;
  for (let i = 0; i < 4000; i++) {
    const R = spinForReward(S0, rnd, cards); const last = R.spins[R.spins.length - 1];
    assert.ok(R.spins.slice(0, -1).every((x) => CW[x.res].t === 'relance') && CW[last.res].t !== 'relance');
    nRel += R.spins.length - 1; maxChain = Math.max(maxChain, R.spins.length - 1);
    if (CW[last.res].t === 'card' && CW[last.res].g === 6) nCard++;
    if (CW[last.res].t === 'coins') nCoins += last.coins;
  }
  assert.ok(nCard > 0 && nCoins > 0 && maxChain <= 5 && S0.money === nCoins && S0.opened === 0 && S0.wp[6] === nCard && Object.keys(S0.col).length === 0); ok('roue : carte en attente (à récupérer), Coins crédités, relances (max 5), rien d\'ajouté directement à la collection');
  { // stats de tirage Holo : comptées pour les vrais packs, pas pour les outils admin
    const GS = require('../lib/game'); const T = GS.newState(1e12); T.stock = 10;
    for (let q = 0; q < 3; q++) GS.openFree(T, cards, rnd, 1e12);
    const d = T.hs.d.reduce((a, x) => a + x, 0); assert.strictEqual(d, 15); assert.ok(T.hs.h.reduce((a, x) => a + x, 0) <= 15);
    GS.adminAction(T, cards, 'ph', 0, 0, rnd, 1e12); GS.adminAction(T, cards, 'ch', 1, 0, rnd, 1e12);
    assert.strictEqual(T.hs.d.reduce((a, x) => a + x, 0), 15); ok('stats Holo : tirages comptés, outils admin ignorés');
  }
  { // outils : pack 100 % Holo, suppression des Holo
    const GB = require('../lib/game'); const T = GB.newState(1e12); const o = GB.adminAction(T, cards, 'ph', 0, 0, rnd, 1e12);
    assert.ok(o.cards.length === 5 && o.holo.every(Boolean) && Object.keys(T.holo).length > 0);
    GB.adminAction(T, cards, 'c', 1, cards.findIndex((c) => c), rnd, 1e12);
    GB.adminAction(T, cards, 'hreset', 0, 0, rnd, 1e12);
    assert.deepStrictEqual(T.holo, {}); assert.ok(Object.keys(T.col).length <= 1); ok('outils : pack Holo garanti et suppression des Holo');
  }
  { // outils admin : +/- Holo
    const GA = require('../lib/game'); const T = GA.newState(1e12); const i0 = cards.findIndex((c) => c);
    GA.playerAction(T, cards, 'ch', 1, i0, 1e12); GA.playerAction(T, cards, 'ch', 1, i0, 1e12);
    assert.strictEqual(T.col[i0], 2); assert.strictEqual(T.holo[i0], 2);
    GA.playerAction(T, cards, 'c', -1, i0, 1e12); assert.strictEqual(T.col[i0], 1); assert.strictEqual(T.holo[i0], 1);
    GA.playerAction(T, cards, 'ch', -1, i0, 1e12); assert.ok(!T.col[i0] && !T.holo[i0]); ok('admin : +/- Holo garde holo <= collection');
  }
  { // « Holo au hasard » (g = 9) : une carte, toujours Holo, raretés à égalité
    const G9 = require('../lib/game'); const cnt = [0, 0, 0, 0, 0, 0]; let allHolo = true;
    for (let i = 0; i < 3000; i++) { const T = G9.newState(1e12); T.wp[9] = 1; const ids = G9.openWaiting(T, cards, 9, rnd); cnt[cards[ids[0]][2]]++; if (!(ids.length === 1 && ids.holo[0] === true && T.holo[ids[0]] === 1 && T.col[ids[0]] === 1)) allHolo = false; }
    assert.ok(allHolo && cnt.every((x) => x > 380 && x < 620)); ok('roue : Holo au hasard = 1 carte Holo, toutes les raretés à égalité');
  }
  const S1 = { wp: {}, money: 0, col: {}, pulled: {}, opened: 0, wheel: [3, 1, 0, 0, 0] }; spinForReward(S1, rnd, cards);
  assert.strictEqual(S1.wheel.length, CW.length); assert.strictEqual(S1.wheel[0], 3); ok('anciens compteurs de roue conservés');

  // ouverture des packs en attente
  r = await call('tokA', { action: 'admin', a: 'wpa' });
  for (const g of [0, 2, 3]) { r = await call('tokA', { action: 'openwp', g }); assert.strictEqual(r.status, 200); }
  const mids = []; cards.forEach((c, i) => { if (c && !c[5] && c[2] === 5) mids.push(i); });
  const nonM = cards.findIndex((c) => c && c[2] !== 5);
  r = await call('tokA', { action: 'openwp', g: 5 }); assert.strictEqual(r.status, 400); ok('Mythique au choix : refusé sans choix');
  r = await call('tokA', { action: 'openwp', g: 5, card: nonM }); assert.strictEqual(r.status, 400); ok('Mythique au choix : une carte non Mythique est refusée');
  r = await call('tokA', { action: 'openwp', g: 5, card: mids[mids.length - 1] }); assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.cards, [mids[mids.length - 1]]); ok('Mythique au choix : le joueur reçoit exactement la carte choisie');
  r = await call('tokA', { action: 'openwp', g: 4 }); assert.strictEqual(r.status, 400); ok('pack en attente inexistant refusé');

  // préférences : validées
  r = await call('tokB', { action: 'prefs', prefs: { team: [1, 2, 'x', null, 99999, 3, 4, 5, 6, 7, 8], tier: { 1: 'S', 2: '<script>' }, mute: true, money: 999999 } });
  const sb = db.saves.get('B').data; assert.strictEqual(sb.team[2], null); assert.strictEqual(sb.team[4], null); assert.strictEqual(sb.tier[1], 'S'); assert.ok(!sb.tier[2]); assert.strictEqual(sb.mute, true);
  assert.ok(sb.money < 999999); ok('préférences filtrées, argent non modifiable');

  // distribution des raretés sur 200 000 cartes
  const { drawPack } = require('../lib/game'); const t = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 40000; i++) drawPack(cards, 0, rnd).forEach((c) => t[cards[c][2]]++);
  const tot = t.reduce((a, b) => a + b, 0);
  console.log('    raretés :', t.map((x, i) => (x / tot * 100).toFixed(2)).join(' / '));
  [50, 25, 17, 5.5, 2, .5].forEach((p, i) => assert.ok(Math.abs(t[i] / tot * 100 - p) < 0.5)); ok('probabilités des raretés conformes');

  // ----- cartes Holo -----
  {
    const GM = require('../lib/game');
    // taux Holo par rareté : plus la carte est rare, plus sa Holo l'est
    const ids = []; for (let r = 0; r < 6; r++) for (let k = 0; k < 20000; k++) ids.push(cards.findIndex((c) => c && c[2] === r));
    const fl = GM.rollHolo(cards, ids, rnd), rate = [0, 0, 0, 0, 0, 0];
    fl.forEach((f, k) => { if (f) rate[Math.floor(k / 20000)]++; });
    rate.forEach((x, r) => assert.ok(Math.abs(x / 200 - C.HOLO.p[r]) < 1.5, 'taux Holo ' + r));
    for (let r = 0; r < 6; r++) assert.ok(C.RAR[r].p / 100 * C.HOLO.p[r] / 100 < C.RAR[r].p / 100);   // une Holo reste plus rare que la carte normale
    // points : normale seule 1x, Holo seule 1x, les deux 2x
    const i = cards.findIndex((c) => c && c[2] === 3), pt = C.SCORE[3];
    const S1 = GM.normalizeState({}, 0); GM.addCards(S1, [i], [false]); assert.strictEqual(GM.summary(S1, cards).cscore, pt);
    const S2 = GM.normalizeState({}, 0); GM.addCards(S2, [i], [true]); assert.strictEqual(GM.summary(S2, cards).cscore, pt); assert.strictEqual(GM.summary(S2, cards).owned, 1); assert.strictEqual(GM.summary(S2, cards).holo, 1);
    GM.addCards(S2, [i], [false]); assert.strictEqual(GM.summary(S2, cards).cscore, 2 * pt);
    // vente rapide : 1 normale gardée, et les Holo en double vendues au prix x SELL_MULT (une Holo gardée)
    GM.addCards(S2, [i, i, i], [true, false, false]);   // 2 Holo + 3 normales
    assert.strictEqual(GM.sellAll(S2, cards, null), 2 * C.RAR[3].v + C.RAR[3].v * C.HOLO.SELL_MULT); assert.strictEqual(S2.col[i], 1 + 1); assert.strictEqual(S2.holo[i], 1);
    assert.throws(() => GM.sellMany(S2, cards, [[i, 2]]), /normaux/);
    { const S4 = GM.normalizeState({}, 0); GM.addCards(S4, [i, i, i], [true, true, false]);   // 1 normale + 2 Holo -> 2 vendables
      assert.throws(() => GM.sellMany(S4, cards, [[i, 3, 2]]), /Holo/); assert.throws(() => GM.sellMany(S4, cards, [[i, 2]]), /normaux/);
      const r4 = GM.sellMany(S4, cards, [[i, 2, 1]]); assert.strictEqual(r4.gain, C.RAR[3].v + C.RAR[3].v * C.HOLO.SELL_MULT); assert.strictEqual(S4.col[i], 1); assert.strictEqual(S4.holo[i], 1); }
    assert.throws(() => GM.sellOne(S2, cards, i), /doublon/);
    const S3 = GM.normalizeState({}, 0); GM.addCards(S3, [i], [true]);
    assert.throws(() => GM.releaseCard(S3, i), /Holo/);   // une Holo seule ne se met pas au marché / en échange
    GM.releaseCard(S3, i, true); assert.ok(!S3.col[i] && !S3.holo[i]);
  }
  ok('cartes Holo : taux, points x2, vente protégée');

  // suppression du compte
  r = await call('tokB', { action: 'delete' }); assert.strictEqual(r.status, 200); assert.ok(!db.saves.has('B')); ok('suppression du compte');
  assert.strictEqual(db.codes.get(MC[0]).used, true); ok('un code déjà utilisé reste utilisé après suppression');
  console.log('\n' + n + ' vérifications réussies');
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
