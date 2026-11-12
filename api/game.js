// Point d'entrée Vercel : POST /api/game  { action: 'me' | 'open' | 'sell' | 'code' | 'openwp' | 'prefs' | 'admin' | 'delete', ... }
const { createDb } = require('../lib/supabaseDb');
const { createHandler } = require('../lib/handler');

let handle = null;
function getHandler() {
  if (!handle) {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SECRET_KEY manquant dans Vercel');
    handle = createHandler(createDb(url, key), { adminIds: process.env.ADMIN_DISCORD_IDS || '1413452035344306269' });
  }
  return handle;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST uniquement' }); return; }
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const out = await getHandler()(token, body);
    res.status(out.status).json(out.json);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
