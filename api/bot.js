// Point d'entrée réservé au bot Discord : POST /api/bot  avec l'en-tête  x-bot-secret
//   { action: 'profile', discordId }  ->  équipe + tier lists du joueur
//   { action: 'board', sort }          ->  top 20 du classement
//   { action: 'boards' }               ->  classements collection + runs (top 20 chacun)
//   { action: 'announce', text }      ->  ajoute l'annonce dans la cloche du site
const crypto = require('crypto');
const { createDb } = require('../lib/supabaseDb');
const { botProfile } = require('../lib/handler');
const G = require('../lib/game');

let db = null;
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST uniquement' }); return; }
  const secret = process.env.BOT_SECRET || '';
  if (secret.length < 16 || !same(req.headers['x-bot-secret'] || '', secret)) { res.status(401).json({ error: 'Non autorisé' }); return; }
  try {
    if (!db) db = createDb(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (body.action === 'profile') {
      const out = await botProfile(db, body.discordId);
      if (!out) { res.status(404).json({ error: 'no_account' }); return; }
      res.status(200).json(out); return;
    }
    if (body.action === 'board') {
      const sort = ['score', 'owned', 'mythics', 'opened'].includes(body.sort) ? body.sort : 'score';
      const rows = await db.leaderboard(sort, 20, 0);
      res.status(200).json({ sort, total: await db.rankedCount(), rows: rows.map((r, i) => ({ rank: i + 1, name: r.name, owned: r.owned, mythics: r.mythics, score: r.score, opened: r.opened })) }); return;
    }
    if (body.action === 'boards') {
      // /classement : collection (points de rareté des cartes différentes, puis cartes, puis mythiques, puis ancienneté) et runs de la semaine, 20 premiers de chaque
      const catalog = (await db.getCards()).filter((c) => c && !c[5]).length;
      const coll = (await db.leaderboard('coll', 20, 0))
        .map((r, i) => ({ rank: i + 1, name: r.name, owned: r.owned, mythics: r.mythics, cscore: r.cscore || 0, score: r.score, opened: r.opened }));
      // runs de la SEMAINE en cours (remis à zéro chaque lundi minuit, comme sur le site) ; cartes et score = totaux du joueur
      const wkRows = (await db.periodBoard('week', G.parisKeys(Date.now()).wk)).filter((r) => r.runs > 0).sort((a, b) => b.runs - a.runs || (a.id < b.id ? -1 : 1)).slice(0, 20);
      const tot = {}; if (wkRows.length) (await db.runsBoard()).forEach((r) => { tot[r.id] = r; });
      const pr = wkRows.length ? await db.getProfiles(wkRows.map((r) => r.id)) : {};
      const runs = wkRows.map((r, i) => { const t = tot[r.id] || r; return { rank: i + 1, name: (pr[r.id] || {}).name || 'Joueur', owned: t.owned, mythics: t.mythics, score: t.score, runs: r.runs }; });
      res.status(200).json({ catalog, total: await db.rankedCount(), coll, runs }); return;
    }
    if (body.action === 'announce') {
      const text = String(body.text || '').trim().slice(0, 2000);
      if (!text) { res.status(400).json({ error: 'Annonce vide' }); return; }
      await db.addAnnouncement(text);
      res.status(200).json({ ok: true }); return;
    }
    res.status(400).json({ error: 'Action inconnue' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
