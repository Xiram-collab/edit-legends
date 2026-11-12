// Point d'entrée réservé au bot Discord : POST /api/bot  avec l'en-tête  x-bot-secret
//   { action: 'profile', discordId }  ->  équipe + tier lists du joueur
//   { action: 'announce', text }      ->  ajoute l'annonce dans la cloche du site
const crypto = require('crypto');
const { createDb } = require('../lib/supabaseDb');
const { botProfile } = require('../lib/handler');

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
    if (body.action === 'announce') {
      const text = String(body.text || '').trim().slice(0, 300);
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
