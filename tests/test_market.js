// Marché (enchères), « Ma carte » et limite de propositions : scénarios sur la base simulée.
const assert = require('assert');
const fakeDb = require('./fakeDb');
const { createHandler } = require('../lib/handler');
const C = require('../lib/config');
const cards = require('../data/cards.json').map((c) => c.slice());
let clock = 1e12;
const db = fakeDb(cards, []);
const h = createHandler(db, { adminIds: '111', now: () => clock });
const call = (t, b) => h(t, b);
let n = 0; const ok = (name) => { n++; console.log('ok  ' + name); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const idOf = (r) => cards.findIndex((c, i) => c && c[2] === r && !c[5]);
const give = (u, i, v) => call('tokA', { action: 'apact', id: u, a: 'c', i, v: v || 1 });
const coins = (u, v) => call('tokA', { action: 'apact', id: u, a: 'm', v });
const bank = async (tok) => (await call(tok, { action: 'me' })).json.state.money;
const count = async (tok, i) => ((await call(tok, { action: 'me' })).json.state.col[i]) || 0;

(async () => {
  for (const t of ['tokA', 'tokB', 'tokC', 'tokD']) await call(t, { action: 'me' });
  for (const u of ['B', 'C', 'D']) await coins(u, -1e9).catch(() => {});
  for (const u of ['B', 'C', 'D']) await coins(u, 10000);
  const base = { B: await bank('tokB'), C: await bank('tokC'), D: await bank('tokD') };

  // ---------- Ma carte ----------
  const mine = idOf(1);
  let r = await call('tokB', { action: 'aownset', card: mine, user: 'B' }); assert.strictEqual(r.status, 403); ok('seul le propriétaire associe une carte');
  r = await call('tokB', { action: 'mycardsave', descr: 'x' }); assert.strictEqual(r.status, 403); ok('Ma carte : refus sans association');
  r = await call('tokA', { action: 'aownset', card: mine, user: 'B' }); assert.strictEqual(r.status, 200);
  r = await call('tokA', { action: 'aownset', card: mine, user: 'C' }); assert.strictEqual(r.status, 400); ok('une carte ne s\'associe qu\'à un seul joueur');
  r = await call('tokB', { action: 'me' }); assert.strictEqual(r.json.mycard.id, mine); ok('Bob voit sa carte dans « me »');
  r = await call('tokB', { action: 'mycardsave', descr: 'Champion, WR 1:23, depuis 2020' }); assert.strictEqual(r.status, 200); assert.strictEqual(cards[mine][3], 'Champion, WR 1:23, depuis 2020'); ok('description modifiée pour tout le monde');
  r = await call('tokB', { action: 'mycardsave', descr: 'quel connard' }); assert.strictEqual(r.status, 400); assert.strictEqual(cards[mine][3], 'Champion, WR 1:23, depuis 2020'); ok('description obscène refusée');
  r = await call('tokB', { action: 'mycardsave', descr: 'p.u.t.e' }); assert.strictEqual(r.status, 400); ok('contournement simple refusé');
  r = await call('tokB', { action: 'mycardsave', image: PNG }); assert.strictEqual(r.status, 200); assert.ok(cards[mine][4].startsWith('https://')); ok('logo changé');
  const logo1 = cards[mine][4];
  r = await call('tokB', { action: 'mycardsave', image: PNG }); assert.strictEqual(r.status, 400); assert.strictEqual(cards[mine][4], logo1); ok('2e logo dans le mois refusé');
  r = await call('tokB', { action: 'mycardsave', descr: 'Nouvelle description' }); assert.strictEqual(r.status, 200); ok('la description reste modifiable librement');
  clock += 31 * 86400000;
  r = await call('tokB', { action: 'mycardsave', image: PNG }); assert.strictEqual(r.status, 200); ok('logo à nouveau modifiable après 30 jours');
  r = await call('tokA', { action: 'aown' }); assert.strictEqual(r.json.rows.length, 1); assert.strictEqual(r.json.rows[0].user, 'B'); ok('liste des associations');
  r = await call('tokA', { action: 'aowndel', card: mine }); r = await call('tokB', { action: 'mycardsave', descr: 'x' }); assert.strictEqual(r.status, 403); ok('association retirée');

  // ---------- Marché ----------
  const [cm, cr, cmy] = [idOf(0), idOf(2), idOf(5)];
  await give('B', cr, 2); await give('B', cmy, 1); await give('B', cm, 1);
  r = await call('tokB', { action: 'msell', i: cmy, buynow: 2999 }); assert.strictEqual(r.status, 400); ok('mise de départ sous le minimum (Mythique 3000) refusée');
  r = await call('tokB', { action: 'msell', i: cr, buynow: 199 }); assert.strictEqual(r.status, 400); ok('Rare sous 200 refusée');
  r = await call('tokB', { action: 'msell', i: cr }); assert.strictEqual(r.status, 400); ok('un prix est obligatoire');
  r = await call('tokC', { action: 'msell', i: cr, buynow: 300 }); assert.strictEqual(r.status, 400); ok('vente d\'une carte qu\'on ne possède pas refusée');
  const before = await count('tokB', cr);
  r = await call('tokB', { action: 'msell', i: cr, buynow: 900 }); assert.strictEqual(r.status, 200);
  assert.strictEqual(await count('tokB', cr), before - 1); ok('vendre : la carte quitte la collection');
  r = await call('tokC', { action: 'mlist' }); assert.strictEqual(r.json.open.length, 1);
  const L = r.json.open[0]; assert.strictEqual(L.seller.name, 'Bob'); assert.strictEqual(L.minNext, 200); ok('l\'offre apparaît avec le nom du vendeur');
  r = await call('tokB', { action: 'mbid', id: L.id, v: 300 }); assert.strictEqual(r.status, 400); ok('pas de mise sur sa propre carte');
  r = await call('tokC', { action: 'mbid', id: L.id, v: 199 }); assert.strictEqual(r.status, 400); ok('mise sous le minimum de la rareté refusée');
  // une mise au-dessus du prix d'achat immédiat achète tout de suite, au prix demandé (pas au-delà)
  const L2 = (await call('tokD', { action: 'mlist' })).json.open; assert.strictEqual(L2.length, 1);
  await give('B', cr, 1); await call('tokB', { action: 'msell', i: cr, buynow: 1000 });
  const idx = (await call('tokD', { action: 'mlist' })).json.open.find((x) => x.buynow === 1000);
  const dm0 = await bank('tokD'); r = await call('tokD', { action: 'mbid', id: idx.id, v: 5000 });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.bought, true); assert.strictEqual(r.json.state.money, dm0 - 1000); assert.strictEqual((await call('tokD', { action: 'mlist' })).json.open.find((x) => x.id === idx.id), undefined);
  base.D -= 1000; ok('mise au-dessus du seuil = achat immédiat au prix d\'achat immédiat');
  r = await call('tokC', { action: 'mbid', id: L.id, v: 300 }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.state.money, base.C - 300); ok('mise acceptée : Coins bloqués');
  r = await call('tokD', { action: 'mbid', id: L.id, v: 305 }); assert.strictEqual(r.status, 400); ok('surenchère minimale de 5 % exigée');
  r = await call('tokD', { action: 'mbid', id: L.id, v: 400 }); assert.strictEqual(r.status, 200);
  assert.strictEqual(await bank('tokC'), base.C); assert.strictEqual(await bank('tokD'), base.D - 400); ok('surenchère : le précédent enchérisseur est remboursé');
  r = await call('tokC', { action: 'mlist' }); assert.strictEqual(r.json.open[0].bidder.name, 'Dana'); assert.strictEqual(r.json.open[0].bid, 400); ok('la meilleure mise est visible');
  r = await call('tokB', { action: 'mcancel', id: L.id }); assert.strictEqual(r.status, 400); ok('annulation refusée une fois misée');
  const bBefore = await bank('tokB');
  clock += 11 * 3600000; r = await call('tokC', { action: 'mlist' }); assert.strictEqual(r.json.open.length, 1); ok('toujours ouverte avant 12 h');
  clock += 2 * 3600000; r = await call('tokC', { action: 'mlist' });
  assert.strictEqual(r.json.open.length, 0); assert.strictEqual(r.json.sold.length, 2); assert.strictEqual(r.json.sold[0].buyer.name, 'Dana'); assert.strictEqual(r.json.sold[0].seller.name, 'Bob'); assert.strictEqual(r.json.sold[0].price, 400); ok('fin à 12 h : « achetée par Dana » visible de tous');
  assert.strictEqual(await count('tokD', cr), 2); assert.strictEqual(await bank('tokB'), bBefore + 400); ok('la carte va au gagnant, les Coins au vendeur');
  r = await call('tokD', { action: 'mbid', id: L.id, v: 999 }); assert.strictEqual(r.status, 400); ok('offre terminée : plus de mise');

  // sans mise : la carte revient au vendeur
  const c0 = await count('tokB', cm);
  r = await call('tokB', { action: 'msell', i: cm, buynow: 50 }); assert.strictEqual(r.status, 200); assert.strictEqual(await count('tokB', cm), c0 - 1);
  clock += 13 * 3600000; await call('tokC', { action: 'mlist' });
  assert.strictEqual(await count('tokB', cm), c0); r = await call('tokC', { action: 'mlist' }); assert.strictEqual(r.json.open.length, 0); assert.strictEqual(r.json.sold.length, 2); ok('sans mise : la carte revient au vendeur, pas de vente affichée');

  // annulation sans mise
  r = await call('tokB', { action: 'msell', i: cm, buynow: 50 }); const id2 = (await call('tokC', { action: 'mlist' })).json.open[0].id;
  r = await call('tokB', { action: 'mcancel', id: id2 }); assert.strictEqual(r.status, 200); assert.strictEqual(await count('tokB', cm), c0); ok('annulation sans mise : carte rendue');

  // achat immédiat, avec remboursement d'un enchérisseur
  await give('B', cmy, 0).catch(() => {});
  const my0 = await count('tokB', cmy);
  r = await call('tokB', { action: 'msell', i: cmy, buynow: 4500 }); assert.strictEqual(r.status, 200);
  const id3 = (await call('tokC', { action: 'mlist' })).json.open[0].id;
  await call('tokC', { action: 'mbid', id: id3, v: 3000 });
  const dBefore = await bank('tokD'), cBefore = await bank('tokC'), bb = await bank('tokB');
  r = await call('tokD', { action: 'mbuy', id: id3 }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.state.money, dBefore - 4500);
  assert.strictEqual(await bank('tokC'), cBefore + 3000); assert.strictEqual(await bank('tokB'), bb + 4500); assert.strictEqual(await count('tokD', cmy), 1); ok('achat immédiat : carte livrée, vendeur payé, enchérisseur remboursé');
  r = await call('tokC', { action: 'mlist' }); assert.strictEqual(r.json.sold[0].buyer.name, 'Dana'); assert.strictEqual(r.json.sold[0].price, 4500); ok('achat immédiat visible dans les ventes');

  // deux acheteurs en même temps : un seul gagne, l'autre est remboursé
  await give('B', cm, 1);
  r = await call('tokB', { action: 'msell', i: cm, buynow: 100 }); const id4 = (await call('tokC', { action: 'mlist' })).json.open[0].id;
  const [c1, d1] = [await bank('tokC'), await bank('tokD')];
  const rs = await Promise.all([call('tokC', { action: 'mbuy', id: id4 }), call('tokD', { action: 'mbuy', id: id4 })]);
  assert.strictEqual(rs.filter((x) => x.status === 200).length, 1);
  assert.strictEqual((await bank('tokC')) + (await bank('tokD')), c1 + d1 - 100); ok('achats simultanés : un seul gagnant, l\'autre remboursé');

  // trop de Coins demandés
  r = await call('tokC', { action: 'mbid', id: 99999, v: 500 }); assert.strictEqual(r.status, 400); ok('offre inconnue refusée');
  await coins('C', -1e9).catch(() => {});
  r = await call('tokB', { action: 'msell', i: cr, buynow: 400 }); // Bob n'a plus de Rare ? (il en avait 2)
  const id5 = r.status === 200 ? (await call('tokC', { action: 'mlist' })).json.open[0].id : null;
  if (id5) { const rr = await call('tokC', { action: 'mbid', id: id5, v: 5000000 }); assert.ok([400].includes(rr.status)); ok('mise supérieure aux Coins disponibles refusée'); }

  // missions et titres liés au marché
  const M = require('../lib/missions');
  let mv = (await call('tokB', { action: 'missions' })); assert.strictEqual(mv.status, 200);
  const mk = (v, id) => v.json.packs.find((m) => m.id === id);
  assert.ok(db.saves.get('B').data.mkSold >= 4, 'ventes comptées : ' + db.saves.get('B').data.mkSold);
  assert.ok(mk(mv, 'm_mkvente').ready, 'palier « vendre 1 carte » prêt');
  assert.ok(db.saves.get('D').data.mkBought >= 3, 'achats comptés : ' + db.saves.get('D').data.mkBought);
  assert.ok(M.TITLES.some((x) => x.id === 'negociant') && M.MISSIONS.some((x) => x.id === 'm_mkachat'));
  r = await call('tokB', { action: 'claim', ids: ['m_mkvente'] }); assert.strictEqual(r.status, 200); assert.ok(r.json.got.packs.length >= 1); ok('missions du marché : vendeur et acheteur comptés et récupérables');

  // limite de propositions de cartes : 30
  assert.strictEqual(C.CARD_PROPOSALS_MAX, 30);
  for (let i = 0; i < 30; i++) { r = await call('tokC', { action: 'cardsubmit', name: 'Test carte ' + i, cat: 0, rarity: 0 }); assert.strictEqual(r.status, 200, 'proposition ' + i); }
  r = await call('tokC', { action: 'cardsubmit', name: 'Test carte 31', cat: 0, rarity: 0 }); assert.strictEqual(r.status, 400); ok('30 propositions en attente autorisées, la 31e refusée');

  console.log(n + ' vérifications réussies (marché / Ma carte)');
})().catch((e) => { console.error(e); process.exit(1); });
