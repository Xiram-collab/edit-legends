// Classement des temps de la map, classement entre amis, récompenses hebdomadaires.
const assert = require('assert');
const fakeDb = require('./fakeDb');
const { createHandler } = require('../lib/handler');
const T = require('../lib/times');
const G = require('../lib/game');
const C = require('../lib/config');
const cards = require('../data/cards.json');
let clock = Date.parse('2026-11-18T12:00:00Z'), n = 0;   // un mercredi
const ok = (m) => { n++; console.log('ok  ' + m); };
const db = fakeDb(cards, []);
const h = createHandler(db, { adminIds: '111', now: () => clock, periodAll: {} });
const call = (t, b) => h(t, b);
// Le chrono descend depuis 10:00 : le temps RESTANT le plus grand gagne. Les scénarios ci-dessous sont écrits en « temps de course » (plus petit = meilleur) ; on les convertit en temps restant.
const rest = (v) => { const ms = T.parseTime(v); return ms == null ? v : T.fmtTime(600000 - ms); };
const sub = (t, o) => { const b = Object.assign({ action: 'timesubmit', time: '1:30.000', link: 'https://youtu.be/abc', device: 'Manette', platform: 'PC', note: 'ok' }, o); b.time = rest(b.time); return call(t, b); };

(async () => {
  let r;
  // ----- utilitaires -----
  assert.strictEqual(T.parseTime('1:23.456'), 83456); assert.strictEqual(T.parseTime('83,5'), 83500); assert.strictEqual(T.parseTime('1m23s'), 83000);
  assert.strictEqual(T.parseTime('0:00.500'), null); assert.strictEqual(T.parseTime('abc'), null); assert.strictEqual(T.parseTime('2:00:00'), null);
  assert.strictEqual(T.fmtTime(83456), '1:23.456'); ok('lecture et affichage des temps');
  assert.strictEqual(G.parisKeys(G.nextWeekStart(clock)).dk, '2026-11-23'); assert.strictEqual(G.parisKeys(G.nextWeekStart(clock) - 1).dk, '2026-11-22'); ok('reset : prochain lundi minuit (Paris)');

  for (const t of ['tokA', 'tokB', 'tokC', 'tokD']) await call(t, { action: 'me' });   // Alice (111) = admin
  // ----- envoi -----
  r = await sub('tokB', { time: 'xx' }); assert.strictEqual(r.status, 400);
  r = await sub('tokB', { link: 'javascript:alert(1)' }); assert.strictEqual(r.status, 400);
  r = await sub('tokB', { device: 'Pigeon' }); assert.strictEqual(r.status, 400);
  r = await sub('tokB', { platform: '' }); assert.strictEqual(r.status, 400); ok('formulaire : temps, lien http(s), périphérique et plateforme validés');
  r = await sub('tokB'); assert.strictEqual(r.status, 200);
  r = await call('tokB', { action: 'times', device: 'Manette' }); assert.strictEqual(r.json.rows.length, 0); assert.strictEqual(r.json.me.list.length, 1); assert.strictEqual(r.json.me.list[0].status, 'pending'); ok('un temps envoyé reste invisible tant que non validé');
  for (let i = 0; i < 2; i++) await sub('tokB', { time: '1:2' + i + '.000' });
  r = await sub('tokB', { time: '1:10.000' }); assert.strictEqual(r.status, 400); ok('3 envois en attente maximum');

  // ----- admin -----
  r = await call('tokB', { action: 'atimes' }); assert.strictEqual(r.status, 403);
  r = await call('tokB', { action: 'atimedecide', id: 1, status: 'accepted' }); assert.strictEqual(r.status, 403); ok('file de validation réservée à l\'admin');
  r = await call('tokA', { action: 'atimes' }); assert.strictEqual(r.json.pending.length, 3); assert.ok(r.json.pending[0].link);
  r = await call('tokA', { action: 'ping' }); assert.strictEqual(r.json.tp, 3); r = await call('tokB', { action: 'ping' }); assert.strictEqual(r.json.tp, 0); ok('admin voit les envois et le compteur');
  await call('tokA', { action: 'atimedecide', id: 1, status: 'rejected' });   // 1:30 refusé
  await call('tokA', { action: 'atimedecide', id: 2, status: 'accepted' });   // 1:20 accepté
  await call('tokA', { action: 'atimedecide', id: 3, status: 'accepted' });   // 1:21 accepté (moins bon)
  r = await call('tokB', { action: 'times', device: 'Manette' }); assert.strictEqual(r.json.rows.length, 1); assert.strictEqual(r.json.rows[0].ms, 520000); assert.strictEqual(r.json.rows[0].rank, 1); assert.deepStrictEqual(r.json.rows[0].reward, C.TIME_REWARDS[0]); ok('validé : dans le classement avec son meilleur temps et sa récompense');
  assert.strictEqual(r.json.record.ms, 520000); ok('record de la map');
  r = await call('tokB', { action: 'ping' }); assert.ok(r.json.notes.some((x) => /validé/.test(x.text)) && r.json.notes.some((x) => /refusé/.test(x.text))); ok('le joueur est notifié');
  r = await sub('tokB', { time: '1:25.000' }); assert.strictEqual(r.status, 400); ok('un temps moins bon que le meilleur validé est refusé');

  // ----- masquer son run -----
  r = await sub('tokC', { time: '1:15.000', link: 'https://youtu.be/secret', hide: true }); assert.strictEqual(r.status, 200);
  r = await sub('tokD', { time: '1:40.000', link: 'https://youtu.be/dana' }); assert.strictEqual(r.status, 200);
  await call('tokA', { action: 'atimedecide', id: 4, status: 'accepted' }); await call('tokA', { action: 'atimedecide', id: 5, status: 'accepted' });
  r = await call('tokD', { action: 'times', device: 'Manette' });
  assert.deepStrictEqual(r.json.rows.map((x) => x.name), ['Carl', 'Bob', 'Dana']);
  const carl = r.json.rows[0], bob = r.json.rows[1];
  assert.strictEqual(carl.hidden, true); assert.strictEqual(carl.link, ''); assert.strictEqual(bob.link, 'https://youtu.be/abc'); assert.strictEqual(bob.platform, 'PC'); assert.strictEqual(r.json.record.link, ''); assert.ok(!JSON.stringify(r.json).includes('secret'));
  ok('run masqué : jamais de lien pour les autres ; run public : lien cliquable');
  r = await call('tokC', { action: 'times', device: 'Manette' }); assert.strictEqual(r.json.rows[0].link, 'https://youtu.be/secret'); ok('le joueur voit son propre lien');
  r = await call('tokA', { action: 'atimes' }); assert.ok(r.json.accepted.every((x) => x.link)); ok('l\'admin voit tous les liens');
  r = await call('tokD', { action: 'timedel', id: 4 }); assert.strictEqual(r.status, 404); ok('on ne supprime pas l\'envoi d\'un autre');

  // ----- fin de semaine : récompenses et reset -----
  const before = {}; for (const u of ['B', 'C', 'D']) before[u] = (await call('tok' + u, { action: 'me' })).json.state;
  r = await call('tokD', { action: 'times', device: 'Manette' }); assert.strictEqual(r.json.rows.length, 3); ok('avant le lundi : rien n\'est versé');
  const pendingRow = await sub('tokB', { time: '1:00.000' }); assert.strictEqual(pendingRow.status, 200);   // en attente jusqu'à la fin de semaine
  clock = G.nextWeekStart(clock) + 3600000;   // lundi 01:00
  r = await call('tokD', { action: 'times', device: 'Manette' });
  assert.strictEqual(r.json.rows.length, 0); assert.strictEqual(r.json.lastWeek.rows.length, 3); ok('lundi : liste remise à zéro, semaine dernière affichée');
  let me = (await call('tokC', { action: 'me' })).json.state; assert.strictEqual(me.money, before.C.money); ok('envois non traités : récompenses retenues pendant le délai');
  await call('tokA', { action: 'atimedecide', id: 6, status: 'rejected' });
  clock += 60000; await call('tokD', { action: 'times', device: 'Manette' });
  clock += 40000; r = await call('tokD', { action: 'times', device: 'Manette' });
  me = (await call('tokC', { action: 'me' })).json.state; assert.strictEqual(me.money, before.C.money + C.TIME_REWARDS[0].c); assert.strictEqual(me.wp[3], (before.C.wp[3] || 0) + 1);
  const b2 = (await call('tokB', { action: 'me' })).json.state; assert.strictEqual(b2.money, before.B.money + C.TIME_REWARDS[1].c); assert.strictEqual(b2.wp[2], (before.B.wp[2] || 0) + 1);
  const d2 = (await call('tokD', { action: 'me' })).json.state; assert.strictEqual(d2.money, before.D.money + C.TIME_REWARDS[2].c); assert.strictEqual(d2.wp[2], (before.D.wp[2] || 0) + 1); ok('récompenses versées : Coins + pack selon la place');
  for (let i = 0; i < 3; i++) { clock += 60000; await call('tokD', { action: 'times', device: 'Manette' }); }
  assert.strictEqual((await call('tokC', { action: 'me' })).json.state.money, before.C.money + C.TIME_REWARDS[0].c); ok('récompenses versées une seule fois');
  r = await call('tokB', { action: 'ping' }); assert.ok(r.json.notes.some((x) => /#2/.test(x.text))); ok('notification de récompense');
  r = await call('tokA', { action: 'atimedecide', id: 4, status: 'rejected' }); assert.strictEqual(r.status, 400); ok('semaine soldée : plus modifiable');
  // paiement concurrent : une seule exécution par gagnant
  clock += 7 * 86400000; await sub('tokB', { time: '0:59.000' }); await call('tokA', { action: 'atimedecide', id: 7, status: 'accepted' });
  clock = G.nextWeekStart(clock) + 3600000; const m0 = (await call('tokB', { action: 'me' })).json.state.money;
  const h2 = createHandler(db, { adminIds: '111', now: () => clock, periodAll: {} });
  await Promise.all([call('tokD', { action: 'times', device: 'Manette' }), h2('tokD', { action: 'times', device: 'Manette' }), call('tokA', { action: 'ping' }), h2('tokB', { action: 'ping' })]);
  assert.strictEqual((await call('tokB', { action: 'me' })).json.state.money, m0 + C.TIME_REWARDS[0].c); ok('requêtes simultanées : pas de double paiement');

  // ----- deux classements : Manette et Clavier / souris, top 10 chacun -----
  assert.strictEqual(C.TIME_REWARDS.length, 10); ok('récompenses : top 10');
  clock = G.nextWeekStart(clock) + 7200000;
  await sub('tokB', { time: '1:30.000' }); await sub('tokC', { time: '1:40.000', device: 'Clavier / souris' }); await sub('tokD', { time: '1:35.000', device: 'Clavier / souris' });
  await sub('tokB', { time: '1:45.000', device: 'Clavier / souris' });
  const ids = (await call('tokA', { action: 'atimes' })).json.pending.map((x) => x.id);
  for (const id of ids) await call('tokA', { action: 'atimedecide', id, status: 'accepted' });
  r = await call('tokD', { action: 'times', device: 'Manette' }); assert.deepStrictEqual(r.json.rows.map((x) => x.name), ['Bob']); assert.strictEqual(r.json.device, 'Manette');
  r = await call('tokD', { action: 'times', device: 'Clavier / souris' }); assert.deepStrictEqual(r.json.rows.map((x) => x.name), ['Dana', 'Carl', 'Bob']); assert.strictEqual(r.json.me.rank, 1); assert.strictEqual(r.json.record.ms, 505000); ok('un classement par périphérique, record séparé');
  r = await call('tokD', { action: 'times', device: 'nimporte' }); assert.strictEqual(r.json.device, 'Clavier / souris'); ok('périphérique inconnu ramené au premier classement (Clavier / souris)');
  r = await sub('tokB', { time: '1:50.000', device: 'Clavier / souris' }); assert.strictEqual(r.status, 400); r = await sub('tokB', { time: '1:20.000', device: 'Manette' }); assert.strictEqual(r.status, 200); ok('le meilleur temps à battre est propre à chaque périphérique');
  await call('tokA', { action: 'atimedecide', id: (await call('tokA', { action: 'atimes' })).json.pending[0].id, status: 'rejected' });
  const w0 = {}; for (const u of ['B', 'C', 'D']) w0[u] = (await call('tok' + u, { action: 'me' })).json.state.money;
  clock = G.nextWeekStart(clock) + 3600000; await call('tokD', { action: 'times', device: 'Manette' }); await call('tokD', { action: 'times', device: 'Manette' });
  const w1 = {}; for (const u of ['B', 'C', 'D']) w1[u] = (await call('tok' + u, { action: 'me' })).json.state.money;
  assert.strictEqual(w1.B - w0.B, C.TIME_REWARDS[0].c + C.TIME_REWARDS[2].c); assert.strictEqual(w1.D - w0.D, C.TIME_REWARDS[0].c); assert.strictEqual(w1.C - w0.C, C.TIME_REWARDS[1].c); ok('récompenses versées séparément pour chaque classement (B : 1er Manette + 3e Clavier)');

  // ----- classement entre amis -----
  await call('tokB', { action: 'fadd', id: 'C' }); await call('tokC', { action: 'faccept', id: 'B' });
  await call('tokA', { action: 'apact', id: 'B', a: 'c', i: 0, v: 1 }); await call('tokA', { action: 'apact', id: 'C', a: 'c', i: 1, v: 3 });
  await call('tokA', { action: 'apact', id: 'D', a: 'c', i: 2, v: 5 });
  r = await call('tokB', { action: 'board', scope: 'friends', sort: 'score' });
  assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.json.rows.map((x) => x.id).sort(), ['B', 'C']); assert.ok(!r.json.rows.some((x) => x.id === 'D')); assert.strictEqual(r.json.me.rank, r.json.rows.findIndex((x) => x.id === 'B') + 1); ok('classement entre amis : moi + mes amis seulement');
  r = await call('tokB', { action: 'board', scope: 'friends', sort: 'runs', period: 'week' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.rows.length, 2); ok('amis : tri par runs / période hebdo');
  r = await call('tokD', { action: 'board', scope: 'friends' }); assert.strictEqual(r.json.rows.length, 1); assert.strictEqual(r.json.me.rank, 1); ok('sans ami : seulement moi');
  // ----- chrono à rebours depuis 10:00 + classements Switch et Mobile -----
  assert.deepStrictEqual(T.DEVICES, ['Clavier / souris', 'Manette', 'Switch', 'Mobile']);
  clock = G.nextWeekStart(clock) + 3 * 86400000;
  const raw = (t, o) => call(t, Object.assign({ action: 'timesubmit', link: 'https://youtu.be/x', platform: 'PC' }, o));
  r = await raw('tokB', { time: '10:00.000', device: 'Switch' }); assert.strictEqual(r.status, 400); ok('le chrono part de 10:00 : un temps restant de 10:00 ou plus est refusé');
  await raw('tokB', { time: '7:19.000', device: 'Switch' }); await raw('tokC', { time: '7:52.000', device: 'Switch', platform: 'PC' }); await raw('tokD', { time: '7:12.000', device: 'Mobile' });
  for (const x of (await call('tokA', { action: 'atimes' })).json.pending) await call('tokA', { action: 'atimedecide', id: x.id, status: 'accepted' });
  r = await call('tokD', { action: 'times', device: 'Switch' }); assert.deepStrictEqual(r.json.rows.map((x) => x.name), ['Carl', 'Bob']); assert.strictEqual(r.json.rows[0].ms, 472000); assert.strictEqual(r.json.rows[0].platform, 'Switch'); ok('7:52 bat 7:19 (plus de temps restant = meilleur) ; Switch : plateforme automatique');
  r = await call('tokD', { action: 'times', device: 'Mobile' }); assert.deepStrictEqual(r.json.rows.map((x) => x.name), ['Dana']); assert.deepStrictEqual(r.json.rows[0].reward, C.TIME_REWARDS[0]); ok('classement Mobile avec les mêmes récompenses');
  r = await raw('tokC', { time: '7:30.000', device: 'Switch' }); assert.strictEqual(r.status, 400); r = await raw('tokC', { time: '7:55.000', device: 'Switch' }); assert.strictEqual(r.status, 200); ok('il faut faire mieux (plus de temps restant) que son meilleur temps');
  console.log('\n' + n + ' vérifications réussies (temps/amis)');
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
