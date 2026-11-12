// Serveur local de test : sert public/ et l'API avec une base en mémoire (aucun compte nécessaire).
const http = require('http'), fs = require('fs'), path = require('path');
const fakeDb = require('./fakeDb');
const { createHandler } = require('../lib/handler');
const cards = require('../data/cards.json');
const codes = []; for (let i = 0; i < 30; i++) codes.push('TEST' + String(2222 + i));
const db = fakeDb(cards, codes);
const handle = createHandler(db, { adminIds: '111' });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css' };
http.createServer(async (req, res) => {
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
}).listen(+process.env.PORT || 3111, () => console.log('http://localhost:' + (process.env.PORT || 3111)));
