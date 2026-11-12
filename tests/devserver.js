// Serveur local de test : sert public/ et l'API avec une base en mémoire (aucun compte nécessaire).
const http = require('http'), fs = require('fs'), path = require('path');
const fakeDb = require('./fakeDb');
const { createHandler } = require('../lib/handler');
const cards = require('../data/cards.json');
const codes = []; for (let i = 0; i < 30; i++) codes.push('TEST' + String(2222 + i));
const db = fakeDb(cards, codes);
const { publicShare } = require('../lib/handler');
const handle = createHandler(db, { adminIds: '111' });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css' };
// Données de démonstration : Bob et Carl ont des cartes, Alice (admin) a une demande d'ami de Bob.
async function seed() {
  for (const t of ['tokA', 'tokB', 'tokC']) await handle(t, { action: 'me' });
  const ids = [[0, 1], [2, 3, 4, 7, 9, 13], [1, 5, 6, 8, 10, 11, 12, 14, 15, 16, 20]];
  for (const [t, uid, list] of [['tokA', 'B', ids[1]], ['tokA', 'C', ids[2]]]) for (const c of list) await handle(t, { action: 'apact', id: uid, a: 'c', i: c, v: 1 });
  await handle('tokA', { action: 'apact', id: 'C', a: 'm', v: 4200 });
  await handle('tokB', { action: 'fadd', id: 'A' });
  await handle('tokC', { action: 'fadd', id: 'B' }); await handle('tokB', { action: 'faccept', id: 'C' });
  await handle('tokB', { action: 'prefs', prefs: { team: [2, 3, 4, 7, null, null, null, null, null, null, null] } });
  for (let i = 0; i < 5; i++) await handle('tokB', { action: 'open', kind: 'free' });
}
http.createServer(async (req, res) => {
  const m = req.url.match(/^\/c\/([a-z0-9]+)/);
  if (m) {
    const d = await publicShare(db, m[1]);
    const { page } = require('../api/c.js');
    res.writeHead(d ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d ? page(d, 'http://localhost:' + (process.env.PORT || 3111), m[1]) : 'introuvable'); return;
  }
  if (req.url.startsWith('/api/game')) {
    let b = ''; for await (const c of req) b += c;
    const tok = (req.headers.authorization || '').replace('Bearer ', '');
    const out = await handle(tok, JSON.parse(b || '{}'));
    res.writeHead(out.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out.json)); return;
  }
  let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
  const f = path.join(__dirname, '../public', p);
  if (!f.startsWith(path.join(__dirname, '../public')) || !fs.existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  const csp = require('../vercel.json').headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Content-Security-Policy': csp }); res.end(fs.readFileSync(f));
}).listen(+process.env.PORT || 3111, () => seed().then(() => console.log('http://localhost:' + (process.env.PORT || 3111))));
