// Casino (machine à sous, plus ou moins, pubs), demandes « c'est ma carte » et réglages admin.
const assert = require('assert');
const fakeDb = require('./fakeDb');
const { createHandler } = require('../lib/handler');
const K = require('../lib/casino');
const cards = require('../data/cards.json').map((c) => c.slice());
let clock = 1e12;
const db = fakeDb(cards, []);
const h = createHandler(db, { adminIds: '111', now: () => clock });
const call = (t, b) => h(t, b);
let n = 0; const ok = (name) => { n++; console.log('ok  ' + name); };
const coins = (u, v) => call('tokA', { action: 'apact', id: u, a: 'm', v });
const me = async (tok) => (await call(tok, { action: 'me' })).json;

(async () => {
  for (const t of ['tokA', 'tokB', 'tokC']) await call(t, { action: 'me' });
  await coins('B', -1e9).catch(() => {}); await coins('B', 5000);
  let S = (await me('tokB')).state; const m0 = S.money;
  assert.ok((await me('tokB')).config.CASINO.T3.length === 6); ok('la page reçoit les gains et les chances du casino');

  // ---------- économie : retour au joueur ----------
  const cf = K.cfgOf(null);
  const lo = K.rtp(cf, 10).rtp, hi = K.rtp(cf, 1000).rtp;
  assert.ok(Math.abs(lo - hi) < 1e-9, 'mêmes chances ' + lo + ' ' + hi); assert.ok(lo > 0.93 && lo < 0.96, 'rendu ' + lo);
  ok('machine à sous : ~' + Math.round(lo * 1000) / 10 + ' % rendu, le même pour toutes les mises');
  assert.strictEqual(K.mult(cf, [6, 6, 2]), 1.7); assert.strictEqual(K.mult(cf, [5, 5, 5]), 250); assert.strictEqual(K.mult(cf, [1, 1, 4]), 0.8); assert.strictEqual(K.mult(cf, [0, 3, 5]), 0); ok('combinaisons : 2 trèfles ×1,7, 3 Mythiques ×250, paire, rien');

  // ---------- machine à sous ----------
  let r = await call('tokB', { action: 'casspin', b: 10 }); assert.strictEqual(r.status, 400); ok('pas de tour sans crédits');
  r = await call('tokB', { action: 'casins', v: 999999 }); assert.strictEqual(r.status, 400); ok('on ne peut pas insérer plus que son solde');
  r = await call('tokB', { action: 'casins', v: 500 }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.state.money, m0 - 500); assert.strictEqual(r.json.cred, 500); ok('insertion : les Coins passent dans la machine');
  r = await call('tokB', { action: 'casspin', b: 7 }); assert.strictEqual(r.status, 400); ok('mise inconnue refusée');
  r = await call('tokB', { action: 'casspin', b: 1000 }); assert.strictEqual(r.status, 400); ok('mise plus grande que les crédits refusée');
  let spins = 0, wins = 0;
  for (let k = 0; k < 40; k++) {
    r = await call('tokB', { action: 'casspin', b: 10 });
    if (r.status !== 200) break;
    spins++; assert.strictEqual(r.json.res.length, 3); if (r.json.gain) wins++;
    assert.strictEqual(r.json.state.cas.cred, r.json.cred);
  }
  assert.ok(spins >= 30); ok(spins + ' tours joués côté serveur, ' + wins + ' gagnants');
  // tours gratuits forcés
  db.saves.get('B').data.cas.free = 2; db.saves.get('B').data.cas.fbet = 50;
  const c0 = (await me('tokB')).state.cas.cred;
  r = await call('tokB', { action: 'cascash' }); assert.strictEqual(r.status, 400); ok('pas d\'encaissement pendant les tours gratuits');
  r = await call('tokB', { action: 'casspin', b: 10 }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.bet, 50); assert.ok(r.json.wasFree); assert.ok(r.json.cred >= c0); ok('tour gratuit : joué à la mise gagnée, ne coûte rien');
  await call('tokB', { action: 'casspin', b: 10 });
  const cr = (await me('tokB')).state.cas.cred, mb = (await me('tokB')).state.money;
  r = await call('tokB', { action: 'cascash' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.state.money, mb + cr); assert.strictEqual(r.json.state.cas.cred, 0); ok('encaisser : les crédits reviennent dans le porte-monnaie');
  // tricher en envoyant un faux résultat ne sert à rien
  r = await call('tokB', { action: 'casspin', b: 10, res: [5, 5, 5], gain: 99999 }); assert.strictEqual(r.status, 400); ok('un faux résultat envoyé par la page est ignoré');

  // ---------- plus ou moins ----------
  await coins('B', 2000);
  r = await call('tokB', { action: 'hlguess', d: 1 }); assert.strictEqual(r.status, 400); ok('pas de pari sans partie');
  const mh = (await me('tokB')).state.money;
  r = await call('tokB', { action: 'hlstart', b: 100 }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.state.money, mh - 100); assert.ok(cards[r.json.hl.cur]); ok('plus ou moins : mise prélevée, une carte tirée');
  r = await call('tokB', { action: 'hlstart', b: 100 }); assert.strictEqual(r.status, 400); ok('une seule partie à la fois');
  const o = K.odds(cf, require('../lib/config').RAR, 0); assert.strictEqual(o.cL, 0); assert.ok(o.cH > 1 && o.cH < 2); ok('cotes : Commun → « moins rare » impossible, « plus rare » ×' + o.cH);
  let played = 0, cashed = false;
  for (let k = 0; k < 30 && !cashed; k++) {
    const st = (await me('tokB')).state.cas;
    if (!st.hl) { r = await call('tokB', { action: 'hlstart', b: 10 }); assert.strictEqual(r.status, 200); continue; }
    const rr = cards[st.hl.cur][2];
    r = await call('tokB', { action: 'hlguess', d: rr >= 4 ? 0 : 1 }); assert.strictEqual(r.status, 200); played++;
    if (r.json.ok) { const pot = r.json.hl.pot, mm = r.json.state.money; r = await call('tokB', { action: 'hlcash' }); assert.strictEqual(r.json.state.money, mm + pot); cashed = true; }
  }
  assert.ok(played > 0); ok('plus ou moins : ' + played + ' paris joués' + (cashed ? ', gain encaissé' : ''));

  // ---------- pubs ----------
  r = await call('tokB', { action: 'adclaim' }); assert.strictEqual(r.status, 400); ok('pas de Coins sans lancer les pubs');
  r = await call('tokB', { action: 'adstart' }); assert.strictEqual(r.status, 200);
  clock += 3000; r = await call('tokB', { action: 'adclaim' }); assert.strictEqual(r.status, 400); ok('pubs pas regardées jusqu\'au bout : refusé');
  for (let k = 0; k < 5; k++) { if (k) await call('tokB', { action: 'adstart' }); clock += 15000; const ma = (await me('tokB')).state.money; r = await call('tokB', { action: 'adclaim' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.state.money, ma + 100); }
  r = await call('tokB', { action: 'adstart' }); assert.strictEqual(r.status, 400); ok('pubs : +100 Coins, 5 fois par jour maximum');
  clock += 86400000; r = await call('tokB', { action: 'adstart' }); assert.strictEqual(r.status, 200); ok('pubs : nouveau jour, compteur remis à zéro');

  r = await call('tokB', { action: 'acasino' }); assert.strictEqual(r.status, 403);
  r = await call('tokA', { action: 'acasino' }); assert.strictEqual(r.status, 200);
  assert.ok(r.json.totals.n >= 30 && r.json.totals.players >= 1 && r.json.totals.bet > 0); assert.ok(r.json.recent.length > 0 && r.json.recent[0].name === 'Bob' && r.json.recent[0].t);
  assert.ok(r.json.recent.some((x) => x.g === 'h')); assert.strictEqual(r.json.top[0].name, 'Bob'); ok('admin casino : totaux, derniers tirages avec le joueur et l\'heure, joueurs qui ont le plus lancé');
  console.log('\n' + n + ' tests casino OK');
})().catch((e) => { console.error(e); console.log('ECHEC'); process.exit(1); });
