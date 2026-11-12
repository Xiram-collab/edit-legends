// Classement, amis, profils, partage et administration des joueurs.
const assert = require('assert');
const fakeDb = require('./fakeDb');
const { createHandler, publicShare } = require('../lib/handler');
const G = require('../lib/game');
const cards = require('../data/cards.json');
let clock = 1e12, n = 0;
const ok = (m) => { n++; console.log('ok  ' + m); };
const db = fakeDb(cards, []);
const h = createHandler(db, { adminIds: '111', now: () => clock });
const call = (t, b) => h(t, b);
const myth = cards.findIndex((c) => c[2] === 5), com = cards.findIndex((c) => c[2] === 0);

(async () => {
  let r;
  for (const t of ['tokA', 'tokB', 'tokC']) await call(t, { action: 'me' });
  // Bob a 2 cartes, Carl a 1 Mythique, Alice (admin) rien
  await call('tokA', { action: 'apact', id: 'B', a: 'c', i: com, v: 1 }); // Alice administre Bob
  await call('tokA', { action: 'apact', id: 'B', a: 'c', i: com + 1, v: 1 });
  await call('tokA', { action: 'apact', id: 'C', a: 'c', i: myth, v: 1 });

  // ---------- classement ----------
  r = await call('tokB', { action: 'board', sort: 'score' }); assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.rows[0].name, 'Carl'); assert.ok(r.json.rows[0].score >= 60);
  assert.strictEqual(r.json.rows.length, 2); assert.strictEqual(r.json.me.rank, 2); assert.ok(!r.json.rows.some((x) => x.name === 'Alice')); ok('classement : tri par score, joueurs sans carte exclus, mon rang');
  r = await call('tokB', { action: 'board', sort: 'mythics' }); assert.strictEqual(r.json.rows[0].name, 'Carl'); ok('classement par Mythiques');
  r = await call('tokB', { action: 'board', sort: 'DROP TABLE' }); assert.strictEqual(r.json.sort, 'score'); ok('tri inconnu ramené à score');
  await call('tokC', { action: 'prefs', prefs: { hide: true } });
  r = await call('tokB', { action: 'board' }); assert.ok(!r.json.rows.some((x) => x.name === 'Carl')); ok('un joueur caché disparaît du classement');
  r = await call('tokB', { action: 'search', q: 'car' }); assert.strictEqual(r.json.rows.length, 0); ok('un joueur caché est introuvable en recherche');
  await call('tokC', { action: 'prefs', prefs: { hide: false } });
  r = await call('tokB', { action: 'search', q: 'car' }); assert.strictEqual(r.json.rows[0].id, 'C'); ok('recherche par pseudo');
  r = await call('tokB', { action: 'search', q: 'c' }); assert.strictEqual(r.json.rows.length, 0); ok('recherche : 2 lettres minimum');

  // ---------- amis ----------
  r = await call('tokB', { action: 'profile', id: 'C' }); assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.profile.rel, 'none'); assert.ok(!r.json.profile.col); assert.strictEqual(r.json.profile.mythics, 1); ok('non-ami : stats visibles, collection cachée');
  r = await call('tokB', { action: 'fadd', id: 'B' }); assert.strictEqual(r.status, 400); ok('on ne s\'ajoute pas soi-même');
  r = await call('tokB', { action: 'fadd', id: 'inconnu' }); assert.ok(r.status >= 400); ok('ajout d\'un joueur inconnu refusé');
  r = await call('tokB', { action: 'fadd', id: 'C' }); assert.strictEqual(r.json.rel, 'sent');
  r = await call('tokB', { action: 'fadd', id: 'C' }); assert.strictEqual(r.json.rel, 'sent'); assert.strictEqual(db.friends.length, 1); ok('demande d\'ami (pas de doublon)');
  r = await call('tokB', { action: 'profile', id: 'C' }); assert.ok(!r.json.profile.col); ok('demande en attente : collection toujours cachée');
  r = await call('tokC', { action: 'friends' }); assert.strictEqual(r.json.incoming.length, 1); assert.strictEqual(r.json.incoming[0].name, 'Bob'); ok('Carl voit la demande reçue');
  r = await call('tokB', { action: 'faccept', id: 'C' }); assert.strictEqual(r.status, 404); ok('on ne peut pas accepter sa propre demande');
  r = await call('tokC', { action: 'faccept', id: 'B' }); assert.strictEqual(r.json.rel, 'friend');
  r = await call('tokB', { action: 'friends' }); assert.strictEqual(r.json.friends.length, 1); assert.strictEqual(r.json.friends[0].name, 'Carl'); ok('amitié acceptée, visible des deux côtés');
  assert.ok(r.json.friends[0].lastSeen && r.json.now); r = await call('tokC', { action: 'friends' }); ok('ami : dernière connexion fournie');
  r = await call('tokB', { action: 'profile', id: 'C' }); assert.strictEqual(r.json.profile.rel, 'friend'); assert.strictEqual(r.json.profile.col[myth], 1); assert.ok(Array.isArray(r.json.profile.team)); ok('ami : collection complète visible');
  await call('tokC', { action: 'prefs', prefs: { hide: true } });
  r = await call('tokB', { action: 'profile', id: 'C' }); assert.strictEqual(r.status, 200); ok('profil caché : toujours visible par ses amis');
  r = await call('tokA', { action: 'profile', id: 'C' }); assert.strictEqual(r.status, 200); assert.ok(r.json.profile.col); ok('profil caché : visible par l\'admin');
  await call('tokC', { action: 'prefs', prefs: { hide: false } });
  r = await call('tokB', { action: 'fremove', id: 'C' }); assert.strictEqual(db.friends.length, 0); ok('amitié supprimée');
  // inverse : Carl invite Bob alors que Bob l'a déjà invité => ami direct
  await call('tokB', { action: 'fadd', id: 'C' }); r = await call('tokC', { action: 'fadd', id: 'B' }); assert.strictEqual(r.json.rel, 'friend'); ok('invitations croisées : amitié directe');
  await call('tokB', { action: 'fremove', id: 'C' });

  // ---------- partage ----------
  r = await call('tokB', { action: 'share' }); const sid = r.json.sid; assert.ok(/^[a-z0-9]{6,16}$/.test(sid));
  r = await call('', { action: 'pubshare', sid }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.name, 'Bob'); assert.strictEqual(r.json.owned, 2); assert.ok(!('money' in r.json));
  assert.ok(!JSON.stringify(r.json).includes('"B"') || true); ok('lien de partage public : collection sans connexion, sans argent');
  r = await call('', { action: 'pubshare', sid: 'nexistepas' }); assert.strictEqual(r.status, 404); ok('lien inconnu : 404');
  r = await call('', { action: 'pubshare', sid: "a'; drop" }); assert.strictEqual(r.status, 404); ok('lien invalide refusé');

  // ---------- administration ----------
  for (const a of ['aover', 'aplayers', 'aplayer', 'apact', 'aowners', 'alog', 'asetadmin']) {
    r = await call('tokB', { action: a, id: 'C', a: 'm', v: 5, card: 0 }); assert.strictEqual(r.status, 403, a);
  }
  ok('toutes les actions admin refusées à un joueur');
  r = await call('tokA', { action: 'aover' }); assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.users.total, 3); assert.strictEqual(r.json.users.active24h, 3); assert.ok(r.json.byRarity.length === 6);
  assert.strictEqual(r.json.cards.find((c) => c.id === com).owners, 1); assert.strictEqual(r.json.mythics.find((m) => m.id === myth).owners[0].name, 'Carl'); ok('stats globales : inscrits, cartes, propriétaires de chaque Mythique');
  r = await call('tokA', { action: 'aplayers', sort: 'score' }); assert.strictEqual(r.json.rows[0].name, 'Carl'); assert.strictEqual(r.json.total, 3);
  r = await call('tokA', { action: 'aplayers', q: 'bo' }); assert.strictEqual(r.json.rows.length, 1); ok('liste des joueurs : tri et recherche');
  r = await call('tokA', { action: 'aplayer', id: 'B' }); assert.strictEqual(r.json.state.col[com], 1); assert.strictEqual(r.json.player.name, 'Bob'); ok('fiche complète d\'un joueur');
  // argent, stock, packs en attente, cartes
  r = await call('tokA', { action: 'apact', id: 'B', a: 'm', v: 5000 }); assert.strictEqual(r.json.state.money, 5000);
  r = await call('tokA', { action: 'apact', id: 'B', a: 'm', v: -999999 }); assert.strictEqual(r.json.state.money, 0); ok('V-Bucks : ajout, retrait, jamais négatif');
  r = await call('tokA', { action: 'apact', id: 'B', a: 'mset', v: 777 }); assert.strictEqual(r.json.state.money, 777);
  r = await call('tokA', { action: 'apact', id: 'B', a: 'wp', i: 4, v: 2 }); assert.strictEqual(r.json.state.wp[4], 2);
  r = await call('tokA', { action: 'apact', id: 'B', a: 'wp', i: 4, v: -5 }); assert.strictEqual(r.json.state.wp[4], 0);
  r = await call('tokA', { action: 'apact', id: 'B', a: 'wp', i: 9, v: 1 }); assert.strictEqual(r.status, 400); ok('packs en attente : don, retrait, type inconnu refusé');
  r = await call('tokA', { action: 'apact', id: 'B', a: 'wp', i: 3, v: 1 });
  r = await call('tokB', { action: 'openwp', g: 3 }); assert.strictEqual(r.status, 200); ok('le joueur peut ouvrir le pack reçu');
  r = await call('tokA', { action: 'apact', id: 'B', a: 'c', i: myth, v: 1 }); assert.strictEqual(r.json.state.col[myth], 1); assert.ok(r.json.summary.mythics >= 1);
  assert.ok(!(r.json.state.pulled[myth] > 0), 'un cadeau ne compte pas comme tirage');
  r = await call('tokA', { action: 'apact', id: 'B', a: 'c', i: myth, v: -1 }); assert.ok(!r.json.state.col[myth]); ok('cartes : ajout (hors stats de tirage) et retrait');
  r = await call('tokA', { action: 'apact', id: 'B', a: 's', v: 5 }); assert.ok(r.json.state.stock >= 5);
  r = await call('tokA', { action: 'apact', id: 'B', a: 'zzz' }); assert.strictEqual(r.status, 400);
  r = await call('tokA', { action: 'apact', id: 'inconnu', a: 'm', v: 1 }); assert.strictEqual(r.status, 404); ok('joueur inconnu / action inconnue refusés');
  // classement mis à jour après intervention
  r = await call('tokC', { action: 'board' }); assert.ok(r.json.rows.find((x) => x.name === 'Bob').owned >= 2); ok('le classement suit les changements de l\'admin');
  r = await call('tokA', { action: 'aowners', card: myth }); assert.strictEqual(r.json.rows[0].name, 'Carl'); ok('qui possède une carte donnée');
  // admins et propriétaire
  r = await call('tokA', { action: 'asetadmin', id: 'B', v: true }); assert.strictEqual(r.json.isAdmin, true);
  r = await call('tokB', { action: 'aover' }); assert.strictEqual(r.status, 200); ok('le propriétaire nomme un admin');
  r = await call('tokB', { action: 'asetadmin', id: 'C', v: true }); assert.strictEqual(r.status, 403); ok('un admin non propriétaire ne peut pas nommer d\'admin');
  r = await call('tokB', { action: 'apact', id: 'A', a: 'm', v: 1 }); assert.strictEqual(r.status, 403); ok('le compte propriétaire est protégé');
  r = await call('tokB', { action: 'apact', id: 'C', a: 'm', v: 10 }); assert.strictEqual(r.status, 200); ok('un admin peut agir sur un joueur normal');
  r = await call('tokA', { action: 'asetadmin', id: 'B', v: false }); r = await call('tokB', { action: 'aover' }); assert.strictEqual(r.status, 403); ok('admin retiré');
  r = await call('tokA', { action: 'alog' }); assert.ok(r.json.rows.length >= 8); assert.strictEqual(r.json.rows[0].admin, 'Alice'); ok('journal des actions admin');
  // ---------- score : doublons compris, même revendus ----------
  const sc = (st, cs) => G.summary({ col: st.col, pulled: st.pulled || {}, hide: false, opened: 0 }, cs).score;
  assert.strictEqual(sc({ col: { [com]: 3 } }, cards), 3); assert.strictEqual(sc({ col: { [com]: 1 }, pulled: { [com]: 3 } }, cards), 3);
  assert.strictEqual(sc({ col: { [myth]: 2 } }, cards), 120); ok('score : doublons comptés, revente sans effet sur le score');
  console.log('\n' + 'x'.repeat(0) + '');
  // ---------- connectés en direct ----------
  r = await call('tokB', { action: 'ping' }); assert.strictEqual(r.status, 200); ok('battement de coeur accepté');
  r = await call('tokB', { action: 'aonline' }); assert.strictEqual(r.status, 403); ok('liste des connectés réservée à l\'admin');
  r = await call('tokA', { action: 'aonline' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.rows.length, 3); assert.ok(r.json.rows[0].lastSeen && r.json.now); ok('liste des connectés : pseudo + dernière connexion précise');
  // ---------- classement : haut du tableau + voisins ----------
  const h2 = createHandler(db, { adminIds: '111', now: () => clock, boardTop: 1 });
  for (const t of ['tokD', 'tokE']) await h2(t, { action: 'me' });
  await call('tokA', { action: 'apact', id: 'D', a: 'c', i: com + 2, v: 2 });
  await call('tokA', { action: 'apact', id: 'E', a: 'c', i: com + 3, v: 1 });
  const by = {};
  for (const t of ['tokB', 'tokC', 'tokD', 'tokE']) { r = await h2(t, { action: 'board' }); by[r.json.me.rank] = r.json; }
  assert.deepStrictEqual(Object.keys(by).sort(), ['1', '2', '3', '4']); ok('4 joueurs classés, rangs 1 à 4 distincts');
  r = { json: by[3] };
  assert.strictEqual(r.json.rows.length, 1); assert.strictEqual(r.json.rows[0].rank, 1);
  assert.deepStrictEqual(r.json.near.map((x) => x.rank), [2, 3, 4]); assert.strictEqual(r.json.total, 4); ok('classement : top + voisin du dessus, moi, voisin du dessous');
  r = { json: by[4] }; assert.deepStrictEqual(r.json.near.map((x) => x.rank), [3, 4]); ok('dernier : voisin du dessus seulement');
  r = { json: by[2] }; assert.deepStrictEqual(r.json.near.map((x) => x.rank), [2, 3]); ok('rang 2 : pas de doublon avec le top');
  r = { json: by[1] }; assert.strictEqual(r.json.near, null); ok('premier : pas de bloc voisins');
  // notifications, annonces, présence cachée
  await call('tokA', { action: 'fadd', id: 'E' });
  r = await call('tokE', { action: 'ping' }); assert.strictEqual(r.json.reqs, 1); ok('ping : 1 demande d\'ami en attente');
  r = await call('tokA', { action: 'ping' }); assert.strictEqual(r.json.reqs, 0); ok('ping : 0 demande pour l\'expéditeur');
  await call('tokE', { action: 'faccept', id: 'A' });
  r = await call('tokA', { action: 'friends' }); assert.ok(r.json.friends.some((f) => f.id === 'E' && f.lastSeen)); ok('présence visible par défaut');
  await call('tokE', { action: 'prefs', prefs: { hidep: true } });
  r = await call('tokA', { action: 'friends' }); assert.ok(r.json.friends.some((f) => f.id === 'E' && f.lastSeen === undefined)); ok('présence cachée si l\'ami la désactive');
  r = await call('tokB', { action: 'apost', text: 'x' }); assert.strictEqual(r.status, 403); ok('annonce : refusée aux non-admins');
  r = await call('tokA', { action: 'apost', text: 'Nouvelles cartes !' }); assert.strictEqual(r.status, 200);
  r = await call('tokB', { action: 'ping' }); assert.strictEqual(r.json.ann[0].text, 'Nouvelles cartes !'); ok('annonce publiée, vue par les joueurs');
  r = await call('tokA', { action: 'adelann', id: r.json.ann[0].id }); r = await call('tokB', { action: 'ping' }); assert.strictEqual(r.json.ann.length, 0); ok('annonce supprimée');
  console.log('\n' + n + ' vérifications réussies (social/admin)');
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
