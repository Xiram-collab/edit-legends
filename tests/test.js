const assert = require('assert');
const fakeDb = require('./fakeDb');
const { createHandler } = require('../lib/handler');
const C = require('../lib/config');
const cards = require('../data/cards.json');
assert.strictEqual(C.START_STOCK, 10, 'un nouveau joueur commence avec 10 packs');
C.START_STOCK = 3; // les scénarios ci-dessous partent de 3 packs

let clock = 1e12;
const db = fakeDb(cards, ['AAAA2222', 'BBBB3333', 'CCCC4444', 'DDDD5555', 'EEEE6666']);
const h = createHandler(db, { adminIds: '111', now: () => clock });
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
  for (let i = 0; i < 3; i++) { r = await call('tokB', { action: 'open', kind: 'free' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.cards.length, 5); }
  assert.strictEqual(r.json.state.stock, 0); assert.strictEqual(r.json.state.opened, 3);
  r = await call('tokB', { action: 'open', kind: 'free' }); assert.strictEqual(r.status, 400); ok('stock gratuit épuisé refusé');
  clock += 3600000; r = await call('tokB', { action: 'me' }); assert.strictEqual(r.json.state.stock, 1); ok('+1 pack gratuit après 1 h');

  // achat sans argent
  r = await call('tokB', { action: 'open', kind: 'buy', g: 2 }); assert.strictEqual(r.status, 400); ok('achat sans V-Bucks refusé');
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
  r = await call('tokB', { action: 'code', code: 'aaaa-2222' }); assert.strictEqual(r.status, 200); assert.ok(r.json.res >= 0 && r.json.res < 5); ok('code valide accepté (casse et tiret ignorés)');
  r = await call('tokA', { action: 'code', code: 'AAAA2222' }); assert.strictEqual(r.status, 400); ok('même code refusé à un autre joueur');
  r = await call('tokB', { action: 'code', code: 'AAAA2222' }); assert.strictEqual(r.status, 400); ok('même code refusé au même joueur');
  const par = await Promise.all([call('tokA', { action: 'code', code: 'BBBB3333' }), call('tokB', { action: 'code', code: 'BBBB3333' })]);
  assert.strictEqual(par.filter((x) => x.status === 200).length, 1); ok('même code envoyé par 2 joueurs en même temps : un seul gagne');

  // essais ratés : verrou
  db.saves.get('B').data.bad = 0; db.saves.get('B').data.lock = 0; db.saves.get('B').version++;
  for (let i = 0; i < 4; i++) { r = await call('tokB', { action: 'code', code: 'ZZZZ' + i + '999' }); assert.strictEqual(r.status, 400); assert.ok(!/attends/.test(r.json.error)); }
  r = await call('tokB', { action: 'code', code: 'ZZZZ4999' }); assert.strictEqual(r.status, 400); assert.ok(/attends/.test(r.json.error));
  r = await call('tokB', { action: 'code', code: 'CCCC4444' }); assert.strictEqual(r.status, 429); ok('5 mauvais codes : verrou 60 s');
  clock += 61000; r = await call('tokB', { action: 'code', code: 'CCCC4444' }); assert.strictEqual(r.status, 200); ok('verrou levé après 60 s');

  // récompenses : simulation de la roue (distribution)
  const { spinForReward } = require('../lib/game');
  const cnt = [0, 0, 0, 0, 0]; const rnd = () => require('crypto').randomInt(0, 1e9) / 1e9;
  for (let i = 0; i < 100000; i++) cnt[spinForReward({ wp: {} }, rnd)]++;
  const pct = cnt.map((x) => x / 1000); console.log('    roue sur 100000 :', pct.join(' / '));
  [75, 15, 5, 4, 1].forEach((p, i) => assert.ok(Math.abs(pct[i] - p) < 1.0)); ok('probabilités de la roue conformes');

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

  // suppression du compte
  r = await call('tokB', { action: 'delete' }); assert.strictEqual(r.status, 200); assert.ok(!db.saves.has('B')); ok('suppression du compte');
  assert.strictEqual(db.codes.get('AAAA2222').used, true); ok('un code déjà utilisé reste utilisé après suppression');
  console.log('\n' + n + ' vérifications réussies');
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
