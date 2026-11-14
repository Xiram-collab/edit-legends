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
  r = await call('tokB', { action: 'mycardsave', descr: 'Ligne 1  \n\n\n\nLigne   2\r\n- record' }); assert.strictEqual(cards[mine][3], 'Ligne 1\n\nLigne 2\n- record'); ok('les retours à la ligne de la description sont conservés');
  await call('tokB', { action: 'mycardsave', descr: 'Champion, WR 1:23, depuis 2020' });
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

  // ---------- Marché (prix fixe) ----------
  const [cm, cr, cmy] = [idOf(0), idOf(2), idOf(5)];
  await give('B', cr, 2); await give('B', cmy, 1); await give('B', cm, 1);
  r = await call('tokB', { action: 'msell', i: cmy, buynow: 2999 }); assert.strictEqual(r.status, 400); ok('prix sous le minimum (Mythique 3000) refusé');
  r = await call('tokB', { action: 'msell', i: cr, buynow: 69 }); assert.strictEqual(r.status, 400); ok('Rare sous 70 refusée');
  r = await call('tokB', { action: 'msell', i: cr }); assert.strictEqual(r.status, 400); ok('un prix est obligatoire');
  r = await call('tokC', { action: 'msell', i: cr, buynow: 300 }); assert.strictEqual(r.status, 400); ok('vente d\'une carte qu\'on ne possède pas refusée');
  const before = await count('tokB', cr);
  r = await call('tokB', { action: 'msell', i: cr, buynow: 900 }); assert.strictEqual(r.status, 200);
  assert.strictEqual(await count('tokB', cr), before); ok('mise en vente : la carte reste dans la collection');
  r = await call('tokC', { action: 'mlist' }); assert.strictEqual(r.json.open.length, 1);
  const L = r.json.open[0]; assert.strictEqual(L.seller.name, 'Bob'); assert.strictEqual(L.buynow, 900); ok('l\'offre apparaît avec le nom du vendeur et son prix');
  r = await call('tokC', { action: 'mbid', id: L.id, v: 950 }); assert.strictEqual(r.status, 400); assert.strictEqual(await bank('tokC'), base.C); ok('pas d\'enchères : miser est refusé');
  r = await call('tokB', { action: 'mbuy', id: L.id }); assert.strictEqual(r.status, 400); ok('pas d\'achat de sa propre carte');
  await coins('D', -(await bank('tokD')) + 100);
  r = await call('tokD', { action: 'mbuy', id: L.id }); assert.strictEqual(r.status, 400); assert.strictEqual(await bank('tokD'), 100); ok('achat sans assez de Coins refusé');
  await coins('D', 9900);
  const bBefore = await bank('tokB'), cBefore = await bank('tokC');
  r = await call('tokC', { action: 'mbuy', id: L.id }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.bought, true); assert.strictEqual(r.json.state.money, cBefore - 900);
  { const st = (await call('tokC', { action: 'me' })).json.state; assert.strictEqual(st.col[cr] || 0, 0); assert.deepStrictEqual(st.wc, [cr]); r = await call('tokC', { action: 'openwp', g: 7 }); assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.json.cards, [cr]); assert.strictEqual(await count('tokC', cr), 1); r = await call('tokC', { action: 'openwp', g: 7 }); assert.strictEqual(r.status, 400); } assert.strictEqual(await bank('tokB'), bBefore + 900); assert.strictEqual(await count('tokB', cr), before - 1); ok('achat : carte livrée dans les packs en attente puis ouverte, retirée au vendeur seulement maintenant, vendeur payé');
  r = await call('tokD', { action: 'mlist' }); assert.strictEqual(r.json.open.length, 0); assert.strictEqual(r.json.sold.length, 1);
  assert.strictEqual(r.json.sold[0].buyer.name, 'Carl'); assert.strictEqual(r.json.sold[0].seller.name, 'Bob'); assert.strictEqual(r.json.sold[0].price, 900); ok('« achetée par Carl » visible de tous');
  r = await call('tokD', { action: 'mbuy', id: L.id }); assert.strictEqual(r.status, 400); ok('offre déjà vendue : plus d\'achat');

  // deux acheteurs en même temps : un seul gagne, l'autre est remboursé
  r = await call('tokB', { action: 'msell', i: cm, buynow: 100 }); const id4 = (await call('tokD', { action: 'mlist' })).json.open[0].id;
  const [c1, d1] = [await bank('tokC'), await bank('tokD')];
  const rs = await Promise.all([call('tokC', { action: 'mbuy', id: id4 }), call('tokD', { action: 'mbuy', id: id4 })]);
  assert.strictEqual(rs.filter((x) => x.status === 200).length, 1);
  assert.strictEqual((await bank('tokC')) + (await bank('tokD')), c1 + d1 - 100); ok('achats simultanés : un seul gagnant, l\'autre remboursé');

  // sans acheteur après 12 h : la carte revient au vendeur
  const m0 = await count('tokB', cmy);
  r = await call('tokB', { action: 'msell', i: cmy, buynow: 5000 }); assert.strictEqual(r.status, 200); assert.strictEqual(await count('tokB', cmy), m0);
  clock += 11 * 3600000; r = await call('tokD', { action: 'mlist' }); assert.strictEqual(r.json.open.length, 1); ok('toujours ouverte avant 12 h');
  clock += 2 * 3600000; r = await call('tokD', { action: 'mlist' });
  assert.strictEqual(r.json.open.length, 0); assert.strictEqual(await count('tokB', cmy), m0); ok('après 12 h sans acheteur : la carte est toujours chez le vendeur');
  r = await call('tokD', { action: 'mbuy', id: 99999 }); assert.strictEqual(r.status, 400); ok('offre inconnue refusée');

  // annulation par le vendeur
  const c0 = await count('tokB', cr);
  r = await call('tokB', { action: 'msell', i: cr, buynow: 400 }); const id2 = (await call('tokD', { action: 'mlist' })).json.open[0].id;
  r = await call('tokC', { action: 'mcancel', id: id2 }); assert.strictEqual(r.status, 404); ok('seul le vendeur peut annuler');
  r = await call('tokB', { action: 'mcancel', id: id2 }); assert.strictEqual(r.status, 200); assert.strictEqual(await count('tokB', cr), c0); ok('annulation : la carte reste au vendeur');

  // un seul exemplaire : impossible de le proposer deux fois
  const cmy2 = idOf(4); await give('B', cmy2, 1);
  r = await call('tokB', { action: 'msell', i: cmy2, buynow: 3000 }); assert.strictEqual(r.status, 200);
  r = await call('tokB', { action: 'msell', i: cmy2, buynow: 3000 }); assert.strictEqual(r.status, 400); ok('un seul exemplaire ne peut être proposé qu\'une fois');
  // le vendeur n'a plus la carte au moment de l'achat : vente annulée, acheteur remboursé
  const bk = await bank('tokC'); const idv = (await call('tokD', { action: 'mlist' })).json.open.find((x) => x.card === cmy2).id;
  db.saves.get('B').data.col[cmy2] = 0; delete db.saves.get('B').data.col[cmy2];
  r = await call('tokC', { action: 'mbuy', id: idv }); assert.strictEqual(r.status, 400); assert.strictEqual(await bank('tokC'), bk); assert.strictEqual(await count('tokC', cmy2), 0); ok('vendeur sans la carte : vente annulée, acheteur remboursé');

  // ancienne offre (carte consignée à la pose) : annulation = carte rendue
  const lc = await count('tokB', cm);
  const lg = await db.marketInsert({ seller: 'B', card: cm, start: 10, buynow: 10, ends_at: new Date(clock + 3600000).toISOString(), created_at: '2026-11-14T00:00:00Z' });
    r = await call('tokB', { action: 'mcancel', id: lg }); assert.strictEqual(r.status, 200); assert.strictEqual(await count('tokB', cm), lc + 1); ok('ancienne offre consignée : annulation rend la carte');

  // fin de consigne : la carte d'une ancienne offre retourne chez le vendeur, qui la possède de nouveau
  const lc2 = await count('tokB', cm);
  const lg2 = await db.marketInsert({ seller: 'B', card: cm, start: 10, buynow: 10, ends_at: new Date(clock + 3600000).toISOString(), created_at: '2026-11-14T00:00:00Z' });
  clock += 20000; await call('tokD', { action: 'mlist' });
  assert.strictEqual(await count('tokB', cm), lc2 + 1);
  r = await call('tokB', { action: 'mcancel', id: lg2 }); assert.strictEqual(r.status, 200); assert.strictEqual(await count('tokB', cm), lc2 + 1); ok('ancienne offre : carte rendue au vendeur dès l\'ouverture du marché, annulation sans doublon');

  // missions et titres liés au marché
  const M = require('../lib/missions');
  let mv = (await call('tokB', { action: 'missions' })); assert.strictEqual(mv.status, 200);
  const mk = (v, id) => v.json.packs.find((m) => m.id === id);
  assert.ok(db.saves.get('B').data.mkSold >= 1, 'ventes comptées : ' + db.saves.get('B').data.mkSold);
  assert.ok(mk(mv, 'm_mkvente').ready, 'palier « vendre 1 carte » prêt');
  assert.ok(db.saves.get('C').data.mkBought >= 1, 'achats comptés : ' + db.saves.get('C').data.mkBought);
  assert.ok(M.TITLES.some((x) => x.id === 'negociant') && M.MISSIONS.some((x) => x.id === 'm_mkachat'));
  r = await call('tokB', { action: 'claim', ids: ['m_mkvente'] }); assert.strictEqual(r.status, 200); assert.ok(r.json.got.packs.length >= 1); ok('missions du marché : vendeur et acheteur comptés et récupérables');

  // baisse des seuils : anciennes offres posées pile à l'ancien minimum recalées
  const oldA = await db.marketInsert({ seller: 'B', card: cr, start: 100, buynow: 100, ends_at: new Date(clock + 3600000).toISOString(), created_at: '2026-11-14T00:00:00Z' });
  const oldC = await db.marketInsert({ seller: 'B', card: cr, start: 50, buynow: 50, ends_at: new Date(clock + 3600000).toISOString(), created_at: '2026-11-14T00:00:00Z' });
  const oldB = await db.marketInsert({ seller: 'x', card: cr, start: 300, buynow: 300, ends_at: new Date(clock + 3600000).toISOString(), created_at: '2026-11-14T00:00:00Z' });
  clock += 20000; await call('tokD', { action: 'mlist' });
  assert.strictEqual((await db.marketGet(oldA)).buynow, 70); assert.strictEqual((await db.marketGet(oldC)).buynow, 70); assert.strictEqual((await db.marketGet(oldB)).buynow, 300); ok('anciennes offres au minimum recalées au nouveau seuil, les autres inchangées');

  // doublon : une copie en vente, la collection garde x2, et le doublon reste vendable contre des Coins
  const dd = idOf(2); await give('B', dd, 2 - await count('tokB', dd) > 0 ? 2 - await count('tokB', dd) : 0);
  const dc = await count('tokB', dd);
  r = await call('tokB', { action: 'msell', i: dd, buynow: 300 }); assert.strictEqual(r.status, 200);
  assert.strictEqual(await count('tokB', dd), dc); ok('doublon mis en vente : la collection garde le même nombre d\'exemplaires');
  const b0 = await bank('tokB'); r = await call('tokB', { action: 'sell', i: dd }); assert.strictEqual(r.status, 200); assert.ok((await bank('tokB')) > b0); assert.strictEqual(await count('tokB', dd), dc - 1); ok('le doublon reste vendable en Coins pendant qu\'une copie est sur le marché');
  const offer = (await call('tokD', { action: 'mlist' })).json.open.find((x) => x.card === dd && x.mine !== true); assert.ok(offer); r = await call('tokC', { action: 'mbuy', id: offer.id }); assert.strictEqual(r.status, 200); ok('la copie en vente reste achetable');

  // vente rapide : doublons ou dernière copie, tout ou rien
  const q1 = idOf(0), q2 = idOf(1); await give('B', q1, 3); await give('B', q2, 2);
  const qc1 = await count('tokB', q1), qc2 = await count('tokB', q2), bq = await bank('tokB');
  r = await call('tokB', { action: 'sellmany', items: [[q1, qc1 + 1]] }); assert.strictEqual(r.status, 400); assert.strictEqual(await count('tokB', q1), qc1); assert.strictEqual(await bank('tokB'), bq); ok('vente rapide : plus que ce qu\'on a, rien n\'est vendu');
  r = await call('tokB', { action: 'sellmany', items: [[q1, qc1 - 1], [q2, qc2]] }); assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.gain, (qc1 - 1) * C.RAR[0].v + qc2 * C.RAR[1].v); assert.strictEqual(await count('tokB', q1), 1); assert.strictEqual(await count('tokB', q2), 0); assert.strictEqual(await bank('tokB'), bq + r.json.gain); ok('vente rapide : doublons et dernière copie vendus d\'un coup, Coins crédités');
  r = await call('tokB', { action: 'sellmany', items: [] }); assert.strictEqual(r.status, 400); r = await call('tokB', { action: 'sellmany', items: [[q1, -2]] }); assert.strictEqual(r.status, 400); ok('vente rapide : sélection vide ou invalide refusée');

  // pastille admin : propositions de cartes de joueurs en attente
  const cp0 = (await call('tokA', { action: 'ping' })).json.cp;
  await db.addDraft({ name: 'PropoTest', cat: 0, rarity: 1, descr: '', img: '', created_by: 'B', status: 'new' });
  clock += 20000; assert.strictEqual((await call('tokA', { action: 'ping' })).json.cp, cp0 + 1); assert.strictEqual((await call('tokB', { action: 'ping' })).json.cp, 0); ok('pastille admin : une proposition de carte de joueur est comptée (admin seulement)');

  // association automatique : pseudo identique à une carte Éditeur
  const edc = cards.findIndex((c, i) => c && !c[5] && c[1] === 0 && !(i === mine)); const edn = cards[edc][0];
  const strc = cards.findIndex((c) => c && !c[5] && c[1] === 3);
  await db.setIdentity('D', edn, false);
  r = await call('tokB', { action: 'aownauto', apply: true }); assert.strictEqual(r.status, 403);
  r = await call('tokA', { action: 'aownauto' }); assert.strictEqual(r.status, 200); assert.ok(r.json.found.some((x) => x.card === edc && x.user === 'D')); assert.strictEqual(r.json.applied.length, 0);
  r = await call('tokA', { action: 'aownauto', apply: true }); assert.ok(r.json.applied.some((x) => x.card === edc && x.user === 'D'));
  assert.ok((await db.cardOwners()).some((o) => o.card_id === edc && o.user_id === 'D')); assert.ok(!(await db.cardOwners()).some((o) => o.card_id === strc));
  r = await call('tokA', { action: 'aownauto', apply: true }); assert.strictEqual(r.json.applied.length, 0); ok('association automatique : pseudo identique, propriétaire seul, pas de doublon, pas de structure');

  // limite de propositions de cartes : 30
  assert.strictEqual(C.CARD_PROPOSALS_MAX, 30);
  for (let i = 0; i < 30; i++) { r = await call('tokC', { action: 'cardsubmit', name: 'Test carte ' + i, cat: 0, rarity: 0 }); assert.strictEqual(r.status, 200, 'proposition ' + i); }
  r = await call('tokC', { action: 'cardsubmit', name: 'Test carte 31', cat: 0, rarity: 0 }); assert.strictEqual(r.status, 400); ok('30 propositions en attente autorisées, la 31e refusée');


  // ---------- Échanges ----------
  const idsOf = (r, k) => cards.map((c, i) => (c && c[2] === r && !c[5] ? i : -1)).filter((i) => i >= 0).slice(-k);
  const [e1, e2, oth] = idsOf(2, 3), [u1, u2, u3] = idsOf(1, 3), [ep] = idsOf(2, 4);
  for (const x of [e1, u1, u2, u3, ep]) { await call('tokB', { action: 'sellmany', items: [[x, await count('tokB', x)]].filter((y) => y[1] > 0) }).catch(() => {}); }
  await give('B', e1, 1); await give('C', e2, 1); await give('B', u1, 2); await give('B', u2, 1);
  r = await call('tokB', { action: 'tsell', give: [e1], want: u1 }); assert.strictEqual(r.status, 400); ok('échange : raretés différentes en 1 contre 1 refusé');
  r = await call('tokB', { action: 'tsell', give: [e1], want: e1 }); assert.strictEqual(r.status, 400); ok('échange : carte contre elle-même refusée');
  r = await call('tokB', { action: 'tsell', give: [u1, u2, u3], want: ep }); assert.strictEqual(r.status, 400); ok('échange : 3 cartes que je n\'ai pas refusé');
  r = await call('tokB', { action: 'tsell', give: [u1, u2], want: e1 }); assert.strictEqual(r.status, 400); ok('échange : 2 cartes refusé (1 ou 3 seulement)');
  r = await call('tokB', { action: 'tsell', give: [e1], want: e2 }); assert.strictEqual(r.status, 200, JSON.stringify(r.json)); ok('échange 1 contre 1 de même rareté publié');
  r = await call('tokB', { action: 'tsell', give: [e1], want: oth }); assert.strictEqual(r.status, 400); ok('échange : la carte déjà proposée n\'est plus libre');
  r = await call('tokB', { action: 'mlist' }); assert.strictEqual(r.json.trades.length, 1); assert.strictEqual(r.json.open.filter((l) => l.card === e1).length, 0); ok('l\'échange est dans « trades », pas dans les offres du marché');
  const tid = r.json.trades[0].id;
  r = await call('tokB', { action: 'taccept', id: tid }); assert.strictEqual(r.status, 400); ok('on n\'accepte pas son propre échange');
  r = await call('tokD', { action: 'taccept', id: tid }); assert.strictEqual(r.status, 400); assert.strictEqual(await count('tokB', e1), 1); ok('preneur sans la carte demandée : refus, rien ne bouge');
  r = await call('tokC', { action: 'taccept', id: tid }); assert.strictEqual(r.status, 200);
  assert.strictEqual(await count('tokB', e1), 0); assert.strictEqual(await count('tokB', e2), 1); assert.strictEqual(await count('tokC', e1), 1); assert.strictEqual(await count('tokC', e2), 0); ok('échange 1 contre 1 accepté : les cartes ont changé de main');
  r = await call('tokD', { action: 'taccept', id: tid }); assert.strictEqual(r.status, 400); ok('un échange déjà accepté ne se prend qu\'une fois');
  // 3 contre 1
  await give('C', ep, 1);
  r = await call('tokB', { action: 'tsell', give: [u1, u1, u2], want: ep }); assert.strictEqual(r.status, 200, JSON.stringify(r.json)); ok('échange 3 contre 1 (rareté juste en dessous) publié');
  const t3 = (await call('tokB', { action: 'mlist' })).json.trades[0].id;
  r = await call('tokC', { action: 'taccept', id: t3 }); assert.strictEqual(r.status, 200);
  assert.strictEqual(await count('tokB', u1), 0); assert.strictEqual(await count('tokB', u2), 0); assert.strictEqual(await count('tokB', ep), 1); assert.strictEqual(await count('tokC', u1), 2); assert.strictEqual(await count('tokC', u2), 1); assert.strictEqual(await count('tokC', ep), 0); ok('échange 3 contre 1 accepté');
  // même carte au marché ET en échange : quand l'un aboutit, l'autre disparaît
  await give('C', oth, 1); await give('B', e1, 1);
  r = await call('tokB', { action: 'msell', i: e1, buynow: 5000 }); assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  r = await call('tokB', { action: 'tsell', give: [e1], want: oth }); assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const tx = (await call('tokB', { action: 'mlist' })).json.trades[0].id;
  r = await call('tokC', { action: 'taccept', id: tx }); assert.strictEqual(r.status, 200);
  r = await call('tokB', { action: 'mlist' }); assert.strictEqual(r.json.open.filter((l) => l.card === e1 && l.mine).length, 0); assert.strictEqual(await count('tokB', e1), 0); ok('carte au marché et en échange : l\'échange fait disparaître l\'offre du marché');
  // annulation et expiration
  await give('B', e1, 1);
  await call('tokB', { action: 'tsell', give: [e1], want: oth });
  let tl = (await call('tokB', { action: 'mlist' })).json.trades; assert.strictEqual(tl.length, 1);
  r = await call('tokD', { action: 'tcancel', id: tl[0].id }); assert.strictEqual(r.status, 404);
  r = await call('tokB', { action: 'tcancel', id: tl[0].id }); assert.strictEqual(r.status, 200); assert.strictEqual((await call('tokB', { action: 'mlist' })).json.trades.length, 0); ok('annulation par l\'auteur seulement');
  await call('tokB', { action: 'tsell', give: [e1], want: oth });
  clock += (C.TRADE.HOURS + 1) * 3600000;
  assert.strictEqual((await call('tokB', { action: 'mlist' })).json.trades.length, 0); assert.strictEqual(await count('tokB', e1), 1); ok('échange expiré après ' + C.TRADE.HOURS + ' h, cartes intactes');

  console.log(n + ' vérifications réussies (marché / Ma carte)');
})().catch((e) => { console.error(e); process.exit(1); });
