// Classement Collection par points de rareté : cartes différentes uniquement, les doublons ne comptent pas, les ventes baissent le total.
const assert = require('assert');
const G = require('../lib/game');
const C = require('../lib/config');
const cards = [['C0', 0, 0, ''], ['C1', 0, 0, ''], ['C2', 0, 0, ''], ['C3', 0, 1, ''], ['R', 0, 2, ''], ['E', 0, 3, ''], ['L', 0, 4, ''], ['M1', 0, 5, ''], ['M2', 0, 5, '']];
const st = (col) => ({ col, pulled: Object.assign({}, col), opened: 1 });
const ok = (m) => console.log('ok  ' + m);

const many = st({ 0: 9, 1: 1, 2: 1, 3: 1, 4: 1 });                 // 5 cartes dont un commun en 9 exemplaires
assert.strictEqual(G.summary(many, cards).cscore, 1 + 1 + 1 + 2 + 4);
ok('les doublons comptent une seule fois');

const myth = st({ 7: 1, 8: 1 });                                  // 2 Mythiques seulement
assert.strictEqual(G.summary(myth, cards).cscore, 2 * C.SCORE[5]);
assert.ok(G.summary(myth, cards).cscore > G.summary(many, cards).cscore);
ok('2 Mythiques valent plus que 5 petites cartes');

const before = G.summary(myth, cards).cscore;
myth.col[8] = 0;                                                  // vente d'un Mythique
assert.strictEqual(G.summary(myth, cards).cscore, before - C.SCORE[5]);
ok('une carte vendue fait baisser les points (le score d\'activité, lui, ne baisse pas)');
assert.strictEqual(G.summary(myth, cards).score, 2 * C.SCORE[5]);

const fake = require('./fakeDb')(cards.map((c) => c), []);
(async () => {
  await fake.upsertProfile({ id: 'A', discordId: '111', name: 'Alice', avatar: '' }, false);
  await fake.upsertProfile({ id: 'B', discordId: '222', name: 'Bob', avatar: '' }, false);
  await fake.saveSave('A', many, -1, G.summary(many, cards));
  await fake.saveSave('B', st({ 7: 1, 8: 1 }), -1, G.summary(st({ 7: 1, 8: 1 }), cards));
  const lb = await fake.leaderboard('coll', 10, 0);
  assert.deepStrictEqual(lb.map((r) => r.id), ['B', 'A']);
  assert.strictEqual(await fake.rankOf('coll', 0, 'B'), 1);
  ok('le classement suit les points : 2 Mythiques passent devant 5 cartes');
  console.log('\n4 vérifications réussies (points de collection)');
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
