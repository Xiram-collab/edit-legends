// Parrainage : code dans le compte, demandé une seule fois à l'inscription, anti double compte.
const assert = require('assert');
const fakeDb = require('./fakeDb');
const { createHandler } = require('../lib/handler');
const cards = require('../data/cards.json').map((c) => c.slice());
let clock = Date.parse('2026-11-28T10:00:00Z');
const db = fakeDb(cards, []);
const h = createHandler(db, { adminIds: '111', now: () => clock });
let n = 0; const ok = (name) => { n++; console.log('ok  ' + name); };
const call = (t, b, ip) => h(t, b, { ip: ip || '' });

(async () => {
  // un ancien joueur (sauvegarde déjà là) n'est pas concerné
  await db.saveSave('C', require('../lib/game').newState(clock), -1, null);
  let C = (await call('tokC', { action: 'me' }, '9.9.9.9')).json;
  assert.ok(!C.state.refAsk); ok('un joueur déjà inscrit ne voit pas la question');
  const A = (await call('tokA', { action: 'me', dv: 'devA' }, '1.1.1.1')).json;
  assert.ok(A.state.refAsk && /^[A-Z2-9]{6}$/.test(A.ref.code) && A.ref.n === 0); ok('nouveau compte : question posée, code de parrainage dans le compte');
  await call('tokA', { action: 'refskip' });
  assert.ok(!(await call('tokA', { action: 'me' }, '1.1.1.1')).json.state.refAsk); ok('« je n\'ai pas de code » : la question ne revient plus');
  const code = A.ref.code;

  // même connexion (frères, même box) mais autre appareil : accepté
  await call('tokB', { action: 'me', dv: 'devB' }, '1.1.1.1');
  let r = await call('tokB', { action: 'refcode', code, dv: 'devB' }, '1.1.1.1');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual((await call('tokA', { action: 'me' }, '1.1.1.1')).json.state.wp[3], 1); ok('même connexion internet (frères) : accepté');

  // même appareil, autre connexion : refusé
  await call('tokD', { action: 'me', dv: 'devA' }, '4.4.4.4');
  r = await call('tokD', { action: 'refcode', code, dv: 'devA' }, '4.4.4.4');
  assert.ok(r.status === 400 && /même/.test(r.json.error)); ok('double compte (même appareil) : refusé');

  // vrai filleul
  await call('tokE', { action: 'me', dv: 'devE' }, '5.5.5.5');
  r = await call('tokE', { action: 'refcode', code: 'zzzzzz' }, '5.5.5.5'); assert.ok(r.status === 400 && !r.json.done); ok('code inconnu : on peut réessayer');
  r = await call('tokE', { action: 'refcode', code: code.toLowerCase(), dv: 'devE' }, '5.5.5.5');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const A2 = (await call('tokA', { action: 'me' }, '1.1.1.1')).json;
  assert.strictEqual(A2.state.wp[3], 2); assert.strictEqual(A2.ref.n, 2);
  assert.ok(db.logs.some((l) => l.action === 'parrainage'));
  ok('vrai filleul : le parrain reçoit 1 Pack Épique+ et une notification');
  r = await call('tokE', { action: 'refcode', code }, '5.5.5.5'); assert.strictEqual(r.status, 400); ok('un seul code par compte');
  r = await call('tokA', { action: 'refcode', code }, '1.1.1.1'); assert.strictEqual(r.status, 400); ok('on ne peut pas se parrainer soi-même');

  // compte supprimé puis recréé avec le même Discord : pas de 2e pack
  db.saves.delete('E');
  await call('tokE', { action: 'me', dv: 'devE2' }, '6.6.6.6');
  r = await call('tokE', { action: 'refcode', code, dv: 'devE2' }, '6.6.6.6');
  assert.ok(r.status === 400 && /déjà été parrainé/.test(r.json.error)); ok('compte recréé avec le même Discord : refusé');

  // compte Discord trop récent
  const recent = String((BigInt(clock - 1420070400000 - 2 * 86400000) << 22n));
  const u = { id: 'N', discordId: recent, name: 'Neuf', avatar: '' };
  const dbx = Object.assign({}, db, { getUser: async (t) => (t === 'tokN' ? u : null) });
  const hx = createHandler(dbx, { adminIds: '111', now: () => clock });
  await hx('tokN', { action: 'me', dv: 'devN' }, { ip: '7.7.7.7' });
  r = await hx('tokN', { action: 'refcode', code, dv: 'devN' }, { ip: '7.7.7.7' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json)); ok('compte Discord tout neuf : accepté (noté dans le journal admin)');
  const ua = { id: 'Z', discordId: '999', name: 'alice_2', avatar: '' };
  const hz = createHandler(Object.assign({}, db, { getUser: async () => ua }), { adminIds: '111', now: () => clock });
  await hz('t', { action: 'me', dv: 'devZ' }, {});
  r = await hz('t', { action: 'refcode', code, dv: 'devZ' }, {});
  assert.ok(r.status === 400 && /pseudo/.test(r.json.error), JSON.stringify(r.json)); ok('pseudo proche du parrain (Alice / alice_2) : refusé');

  console.log(n + ' tests parrainage OK');
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
