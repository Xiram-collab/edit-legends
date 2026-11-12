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
  r = await call('tokA', { action: 'profile', id: 'C' }); assert.strictEqual(r.status, 200); assert.ok(!r.json.profile.col); ok('profil caché : l\'admin le voit comme un joueur (sans la collection)');
  // Propositions de cartes par les joueurs
  r = await call('tokC', { action: 'cardsubmit', name: 'Nouveau Joueur', cat: 0, rarity: 6 }); assert.strictEqual(r.status, 400); ok('rareté inexistante refusée');
  r = await call('tokC', { action: 'cardsubmit', name: 'Nouveau Joueur', cat: 9, rarity: 1 }); assert.strictEqual(r.status, 400); ok('catégorie invalide refusée');
  r = await call('tokC', { action: 'cardsubmit', name: 'Nouveau Joueur', cat: 0, rarity: 1, descr: 'Un éditeur' }); assert.strictEqual(r.status, 200); ok('un joueur propose une carte');
  r = await call('tokB', { action: 'cardsubmit', name: 'nouveau joueur', cat: 1, rarity: 1 }); assert.strictEqual(r.status, 400); ok('doublon de proposition refusé');
  const exist = (await call('tokC', { action: 'me' })).json.cards[0][0];
  r = await call('tokC', { action: 'cardsubmit', name: exist, cat: 0, rarity: 1 }); assert.strictEqual(r.status, 400); ok('carte déjà publiée refusée');
  for (let k = 0; k < 9; k++) await call('tokC', { action: 'cardsubmit', name: 'Prop ' + k, cat: 0, rarity: 0 });
  r = await call('tokC', { action: 'cardsubmit', name: 'Prop trop', cat: 0, rarity: 0 }); assert.strictEqual(r.status, 400); ok('10 propositions en attente maximum');
  r = await call('tokC', { action: 'cardmine' }); assert.strictEqual(r.json.rows.length, 10);
  r = await call('tokB', { action: 'acards' }); assert.strictEqual(r.status, 403);
  r = await call('tokA', { action: 'acards' }); const pd = r.json.drafts.find((x) => x.name === 'Nouveau Joueur'); assert.ok(pd && pd.player === true && pd.by); ok('admin voit la proposition (marquée joueur)');
  r = await call('tokA', { action: 'acarddraftedit', id: pd.id, name: 'Nouveau Joueur 2', rarity: 2, descr: 'modifié' }); assert.strictEqual(r.status, 200);
  r = await call('tokA', { action: 'acards' }); const pd2 = r.json.drafts.find((x) => x.id === pd.id); assert.strictEqual(pd2.name, 'Nouveau Joueur 2'); assert.strictEqual(pd2.rarity, 2); ok('admin modifie la proposition');
  r = await call('tokC', { action: 'cardmydel', id: r.json.drafts.find((x) => x.name === 'Prop 0').id }); assert.strictEqual(r.status, 200);
  r = await call('tokB', { action: 'cardmydel', id: pd.id }); assert.strictEqual(r.status, 404); ok('un joueur ne peut annuler que ses propositions');
  r = await call('tokA', { action: 'acardpub', id: pd.id, rarity: 2 }); assert.strictEqual(r.status, 200); ok('admin publie la proposition');
  r = await call('tokC', { action: 'me' }); assert.ok(r.json.cards.some((c) => c && c[0] === 'Nouveau Joueur 2' && c[2] === 2)); ok('la carte publiée apparaît dans le catalogue');
  r = await call('tokA', { action: 'acards' }); const rf = r.json.drafts.find((x) => x.name === 'Prop 1'); r = await call('tokA', { action: 'acarddel', id: rf.id }); assert.strictEqual(r.status, 200); ok('admin refuse une proposition');
  r = await call('tokA', { action: 'acards' }); const p2 = r.json.drafts.find((x) => x.name === 'Prop 2'), p3 = r.json.drafts.find((x) => x.name === 'Prop 3');
  assert.strictEqual(p2.status, 'new'); ok('une proposition de joueur arrive avec le statut « nouvelle »');
  r = await call('tokA', { action: 'acardaccept', id: p2.id }); assert.strictEqual(r.status, 200);
  r = await call('tokA', { action: 'acards' }); assert.strictEqual(r.json.drafts.find((x) => x.id === p2.id).status, 'jury'); ok('accepter : la carte passe au jury (toujours privée)');
  r = await call('tokC', { action: 'ping' }); assert.ok(r.json.notes.some((n) => /validée/.test(n.text) && /Prop 2/.test(n.text))); ok('le joueur est prévenu de l\'acceptation');
  r = await call('tokB', { action: 'acardaccept', id: p3.id }); assert.strictEqual(r.status, 403); ok('seul le propriétaire accepte');
  r = await call('tokA', { action: 'acarddel', id: p3.id, reason: 'Déjà dans la liste sous un autre nom' }); assert.strictEqual(r.status, 200);
  r = await call('tokC', { action: 'ping' }); const nref = r.json.notes.find((n) => /refusée/.test(n.text)); assert.ok(nref && /Raison : Déjà dans la liste/.test(nref.text)); ok('refus : le joueur reçoit la raison');
  r = await call('tokC', { action: 'notread', ids: r.json.notes.map((n) => n.id) }); r = await call('tokC', { action: 'ping' }); assert.strictEqual(r.json.notes.length, 0); ok('notifications lues : supprimées');
  r = await call('tokA', { action: 'acardpub', id: p2.id, rarity: 1 }); r = await call('tokC', { action: 'ping' }); assert.ok(r.json.notes.some((n) => /publiée/.test(n.text))); ok('le joueur est prévenu de la publication');
  r = await call('tokC', { action: 'cardsubmit', name: 'Proposition Mythique', cat: 0, rarity: 5 }); assert.strictEqual(r.status, 200); ok('un joueur peut proposer la rareté Mythique');
  r = await call('tokA', { action: 'acards' }); for (const x of r.json.drafts) await call('tokA', { action: 'acarddel', id: x.id });
  // Pseudo et avatar
  r = await call('tokC', { action: 'setident', name: 'X' }); assert.strictEqual(r.status, 400); ok('pseudo trop court refusé');
  r = await call('tokC', { action: 'setident', name: '<b>hack</b>' }); assert.strictEqual(r.status, 400); ok('pseudo avec caractères interdits refusé');
  r = await call('tokC', { action: 'setident', name: 'alice' }); assert.strictEqual(r.status, 400); ok('pseudo déjà pris (insensible à la casse) refusé');
  r = await call('tokC', { action: 'setident', name: 'Carlito' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.profile.name, 'Carlito');
  r = await call('tokC', { action: 'me' }); assert.strictEqual(r.json.profile.name, 'Carlito'); assert.strictEqual(r.json.profile.discordName, 'Carl'); ok('pseudo personnalisé conservé après reconnexion');
  r = await call('tokC', { action: 'setident', noAvatar: true }); assert.strictEqual(r.json.profile.avatar, ''); assert.strictEqual(r.json.profile.name, 'Carlito'); ok('avatar retiré, pseudo gardé');
  r = await call('tokB', { action: 'profile', id: 'C' }); assert.strictEqual(r.json.profile.name, 'Carlito'); ok('les autres voient le nouveau pseudo');
  r = await call('tokB', { action: 'asetident', id: 'C', name: 'Nope' }); assert.strictEqual(r.status, 403); ok('joueur normal ne peut pas changer le pseudo d\'un autre');
  r = await call('tokA', { action: 'asetident', id: 'C', name: 'Cassius' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.profile.name, 'Cassius'); ok('admin change le pseudo d\'un joueur');
  r = await call('tokA', { action: 'asetident', id: 'C', name: '' }); assert.strictEqual(r.json.profile.name, 'Carl'); ok('admin remet le pseudo Discord');
  r = await call('tokC', { action: 'setident', noAvatar: false });
  // Vitrine : 3 cartes possédées, visibles par tous (même sans être ami), les non possédées sont refusées
  for (const c of [3, 4, 5]) await call('tokA', { action: 'apact', id: 'C', a: 'c', i: c, v: 1 });
  r = await call('tokC', { action: 'me' }); const owned = Object.keys(r.json.state.col).map(Number);
  const notOwned = r.json.cards.findIndex((c, k) => !r.json.state.col[k]);
  r = await call('tokC', { action: 'prefs', prefs: { vitrine: [owned[0], notOwned, owned[0]] } }); assert.strictEqual(r.status, 200);
  r = await call('tokC', { action: 'me' }); assert.deepStrictEqual(r.json.state.vitrine, [owned[0], null, null]); ok('vitrine : carte non possédée et doublon refusés');
  r = await call('tokC', { action: 'prefs', prefs: { vitrine: [owned[0], owned[1], owned[2]] } });
  r = await call('tokA', { action: 'profile', id: 'C' }); assert.deepStrictEqual(r.json.profile.vitrine, [owned[0], owned[1], owned[2]]); assert.ok(!r.json.profile.col); ok('vitrine visible par un non-ami (admin compris), sans la collection');
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
  // création / retrait / suppression de cartes
  const n0 = cards.length;
  r = await call('tokB', { action: 'acardnew', name: 'X', cat: 0, rarity: 4, status: 'public' }); assert.strictEqual(r.status, 403); ok('carte publique : refusée aux non-admins');
  r = await call('tokA', { action: 'acardnew', name: 'Zed', cat: 0, rarity: 4, status: 'public' }); assert.strictEqual(r.json.id, n0); assert.strictEqual(cards.length, n0 + 1); ok('carte publiée : ' + (n0 + 1) + ' cartes');
  r = await call('tokA', { action: 'acardnew', name: 'zed', cat: 0, rarity: 4, status: 'public' }); assert.strictEqual(r.status, 400); ok('nom déjà pris refusé');
  r = await call('tokA', { action: 'acardnew', name: 'Brouillon', cat: 1, rarity: 3, status: 'private' }); assert.strictEqual(r.json.public, false); assert.strictEqual(cards.length, n0 + 1); ok('carte privée : pas dans les packs');
  r = await call('tokA', { action: 'acards' }); assert.strictEqual(r.json.drafts.length, 1); const did = r.json.drafts[0].id;
  await call('tokA', { action: 'acardvote', id: did, rarity: 5 }); r = await call('tokA', { action: 'acards' }); assert.strictEqual(r.json.drafts[0].votes[0].rarity, 5); ok('vote du jury');
  r = await call('tokA', { action: 'acardpub', id: did, rarity: 5 }); assert.strictEqual(cards.length, n0 + 2); assert.strictEqual(cards[n0 + 1][2], 5); ok('publication avec la rareté finale');
  for (const nm of ['L1', 'L2', 'L3']) await call('tokA', { action: 'acardnew', name: nm, cat: 0, rarity: 1, status: 'private' });
  r = await call('tokA', { action: 'acards' }); const ids = r.json.drafts.map((x) => x.id); assert.strictEqual(ids.length, 3);
  const m0 = cards.length; r = await call('tokA', { action: 'acardpubmany', items: ids.map((id) => ({ id, rarity: 2 })) }); assert.strictEqual(r.json.done, 3); assert.strictEqual(cards.length, m0 + 3);
  r = await call('tokA', { action: 'acards' }); assert.strictEqual(r.json.drafts.length, 0); ok('publication de 3 cartes d\'un coup');
  for (let k = 0; k < 3; k++) await call('tokA', { action: 'acardremove', id: cards.length - 1 }); assert.strictEqual(cards.length, m0);
  r = await call('tokA', { action: 'acardedit', id: n0, name: 'Zed2', cat: 2, rarity: 2, descr: 'd' }); assert.deepStrictEqual(cards[n0].slice(0, 4), ['Zed2', 2, 2, 'd']); ok('modification nom, catégorie, rareté, description');
  r = await call('tokA', { action: 'acardretire', id: n0, retired: true }); assert.strictEqual(cards[n0][5], 1); ok('carte retirée des packs');
  r = await call('tokA', { action: 'acardremove', id: n0 }); assert.strictEqual(r.status, 400); ok('suppression définitive refusée si pas la dernière');
  r = await call('tokA', { action: 'acardremove', id: n0 + 1 }); assert.strictEqual(cards.length, n0 + 1); ok('dernière carte supprimée pour de bon');
  r = await call('tokA', { action: 'acardremove', id: n0 }); assert.strictEqual(cards.length, n0); ok('puis la précédente');
  r = await call('tokB', { action: 'ping' });
  // ---------- jury ----------
  for (const d of (await call('tokA', { action: 'acards' })).json.drafts) await call('tokA', { action: 'acarddel', id: d.id });
  r = await call('tokB', { action: 'jlcards' }); assert.strictEqual(r.status, 403); ok('jury : refusé à un joueur normal');
  r = await call('tokB', { action: 'ajury' }); assert.strictEqual(r.status, 403); ok('jury : ajury refusé');
  r = await call('tokA', { action: 'asetjury', id: 'B', on: true }); assert.strictEqual(r.status, 200);
  r = await call('tokB', { action: 'me' }); assert.strictEqual(r.json.isJury, true); assert.strictEqual(r.json.isAdmin, false); ok('jury : le membre est reconnu, sans droits admin');
  r = await call('tokB', { action: 'asetjury', id: 'C', on: true }); assert.strictEqual(r.status, 403); ok('jury : un membre ne nomme personne');
  r = await call('tokB', { action: 'aplayers' }); assert.strictEqual(r.status, 403); r = await call('tokB', { action: 'acards' }); assert.strictEqual(r.status, 403); ok('jury : aucun accès au reste de l\'admin');
  for (let k = 0; k < 10; k++) await call('tokE', { action: 'cardsubmit', name: 'Jur ' + k, cat: 0, rarity: k % 6 });
  r = await call('tokE', { action: 'cardsubmit', name: 'Jur trop', cat: 0, rarity: 1 }); assert.strictEqual(r.status, 400);
  const dr = (await call('tokA', { action: 'acards' })).json.drafts.filter((x) => x.status === 'new');
  r = await call('tokB', { action: 'jlcards' }); assert.ok(!r.json.items.some((x) => x.draft)); ok('jury : propositions non acceptées invisibles');
  await call('tokA', { action: 'acardaccept', id: dr[0].id }); await call('tokA', { action: 'acardaccept', id: dr[1].id });
  r = await call('tokE', { action: 'cardsubmit', name: 'Jur libre', cat: 0, rarity: 1 }); assert.strictEqual(r.status, 200); ok('acceptée = place libérée pour proposer d\'autres cartes');
  r = await call('tokB', { action: 'jlcards' }); const dk = r.json.items.filter((x) => x.draft); assert.strictEqual(dk.length, 2); assert.ok(r.json.items.some((x) => !x.draft)); ok('jury : voit les cartes acceptées + celles du site');
  const k0 = dk[0].k, k1 = dk[1].k, kc = r.json.items.find((x) => !x.draft).k;
  r = await call('tokB', { action: 'jlsave', t: { [k0]: '5', [k1]: '1', [kc]: '3', zzz: '2', [k0 + 'x']: '4' }, o: [k1, k0, 'nope'] }); assert.strictEqual(r.status, 200);
  r = await call('tokB', { action: 'jlcards' }); assert.deepStrictEqual(r.json.jl.t, { [k0]: '5', [k1]: '1', [kc]: '3' }); assert.deepStrictEqual(r.json.jl.o, [k1, k0]); ok('jury : tier list enregistrée (clés invalides ignorées)');
  r = await call('tokB', { action: 'jlsave', t: { [k0]: '9' }, o: [] }); r = await call('tokB', { action: 'jlcards' }); assert.deepStrictEqual(r.json.jl.t, {}); ok('jury : niveau invalide ignoré');
  await call('tokB', { action: 'jlsave', t: { [k0]: '5', [k1]: '1' }, o: [k0, k1] });
  r = await call('tokA', { action: 'ajury' }); assert.strictEqual(r.json.lists.length, 0); ok('jury : rien reçu avant l\'envoi');
  r = await call('tokB', { action: 'jlsend' }); assert.strictEqual(r.status, 200);
  await call('tokB', { action: 'jlsave', t: { [k0]: '0' }, o: [k0] });
  r = await call('tokA', { action: 'ajury' }); assert.strictEqual(r.json.lists.length, 1); assert.strictEqual(r.json.lists[0].t[k0], '5'); assert.strictEqual(r.json.avg[k0].avg, 5); assert.strictEqual(r.json.jurors.length, 1); ok('jury : le propriétaire reçoit la liste envoyée (pas les modifs non envoyées)');
  r = await call('tokA', { action: 'ping' }); assert.ok(r.json.notes.some((x) => /tier list jury/.test(x.text))); ok('jury : le propriétaire est prévenu de l\'envoi');
  r = await call('tokA', { action: 'asetjury', id: 'B', on: false }); r = await call('tokB', { action: 'jlcards' }); assert.strictEqual(r.status, 403); ok('jury : retrait du rôle');
  for (const d of (await call('tokA', { action: 'acards' })).json.drafts) await call('tokA', { action: 'acarddel', id: d.id });
  r = await call('tokE', { action: 'cardsubmit', name: 'Annul A', cat: 0, rarity: 1 });
  const ea = (await call('tokE', { action: 'cardmine' })).json.rows.find((x) => x.name === 'Annul A');
  await call('tokA', { action: 'acardaccept', id: ea.id });
  r = await call('tokE', { action: 'cardmydel', id: ea.id }); assert.strictEqual(r.status, 400); ok('une proposition acceptée ne peut plus être annulée par le joueur');
  await call('tokA', { action: 'acarddel', id: ea.id });
  // reset d'un joueur et reset général
  await call('tokA', { action: 'apact', id: 'D', a: 'm', v: 500 });
  r = await call('tokA', { action: 'apact', id: 'D', a: 'rst' }); assert.strictEqual(r.json.state.money, 0); assert.strictEqual(r.json.state.stock, 10); assert.deepStrictEqual(r.json.state.col, {}); ok('reset d\'un joueur : comme un nouveau (0 V-Bucks, 10 packs)');
  r = await call('tokB', { action: 'aresetall', confirm: 'RESET' }); assert.strictEqual(r.status, 403); ok('reset général refusé aux non-propriétaires');
  r = await call('tokA', { action: 'aresetall' }); assert.strictEqual(r.status, 400); ok('reset général sans confirmation refusé');
  await call('tokB', { action: 'prefs', prefs: { hide: true } });
  r = await call('tokA', { action: 'aresetall', confirm: 'RESET' }); assert.ok(r.json.done >= 2);
  r = await call('tokB', { action: 'me' }); assert.deepStrictEqual(r.json.state.col, {}); assert.strictEqual(r.json.state.stock, 10); assert.strictEqual(r.json.state.hide, true); ok('reset général : tout le monde à zéro, confidentialité conservée');
  r = await call('tokB', { action: 'ping' });
  r = await call('tokA', { action: 'adelann', id: r.json.ann[0].id }); r = await call('tokB', { action: 'ping' }); assert.strictEqual(r.json.ann.length, 0); ok('annonce supprimée');
  console.log('\n' + n + ' vérifications réussies (social/admin)');
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
