// Point d'entrée réservé au bot Discord : POST /api/bot  avec l'en-tête  x-bot-secret
//   { action: 'profile', discordId }  ->  équipe + tier lists du joueur
//   { action: 'board', sort }          ->  top 20 du classement
//   { action: 'boards' }               ->  classements collection + runs (top 20 chacun)
//   { action: 'cardsubmit', discordId, name, cat, rarity, descr, image } ->  propose une carte (comme sur le site)
//   { action: 'announce', text }      ->  ajoute l'annonce dans la cloche du site
const crypto = require('crypto');
const { createDb } = require('../lib/supabaseDb');
const { botProfile, createHandler } = require('../lib/handler');
const G = require('../lib/game');

let db = null, handler = null;
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
      // /classement : classement aux points (points de rareté des cartes différentes, puis cartes, puis mythiques, puis ancienneté), 20 premiers.
      // Les runs ne sont plus classés : « runs » reste vide pour les anciennes versions du bot.
      const catalog = (await db.getCards()).filter((c) => c && !c[5]).length;
      const top = await db.leaderboard('coll', 20, 0);
      const ho = db.getHolo ? await db.getHolo(top.map((r) => r.id)).catch(() => ({})) : {};
      const nHolo = (h) => (h && typeof h === 'object' ? Object.keys(h).filter((k) => (h[k] | 0) > 0).length : 0);
      const coll = top.map((r, i) => ({ rank: i + 1, name: r.name, owned: r.owned, mythics: r.mythics, holo: nHolo(ho[r.id]), cscore: r.cscore || 0, score: r.score, opened: r.opened }));
      res.status(200).json({ catalog, total: await db.rankedCount(), coll, runs: [] }); return;
    }
    if (body.action === 'cardsubmit') {
      // /carte sur Discord : même proposition que sur le site (catégorie, rareté, logo, bio / records / passé)
      const p = /^\d{5,25}$/.test(String(body.discordId || '')) ? await db.getProfileByDiscord(String(body.discordId)) : null;
      if (!p) { res.status(404).json({ error: 'no_account' }); return; }
      if (!handler) handler = createHandler(db, { adminIds: process.env.ADMIN_DISCORD_IDS || '1413452035344306269' });
      try {
        await handler.submitCard(p.user_id, { name: body.name, cat: body.cat, rarity: body.rarity, descr: body.descr, image: body.image });
      } catch (e) { res.status(e && e.code && e.code < 500 ? e.code : 500).json({ error: e && e.code && e.code < 500 ? e.message : 'Erreur serveur' }); return; }
      res.status(200).json({ ok: true, name: p.name }); return;
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
