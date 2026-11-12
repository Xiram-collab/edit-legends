// Page publique d'une collection partagée : /c/<identifiant>  (réécrite vers /api/c?id=<identifiant> par vercel.json)
const { createDb } = require('../lib/supabaseDb');
const { publicShare } = require('../lib/handler');

const RAR = [['Commun', '#9aa4b2'], ['Atypique', '#3ddc84'], ['Rare', '#3b9cff'], ['Épique', '#b45cff'], ['Légendaire', '#ffb020'], ['Mythique', '#ff3d81']];
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Number(n).toLocaleString('fr-FR');

function imgSrc(f) {
  if (!f) return '';
  return '/img/' + encodeURIComponent(f) + (/-sil$/.test(f) ? '.png' : f.indexOf('.') < 0 ? '.jpg' : '');
}

function page(d, origin, sid) {
  const total = d.cards.filter(Boolean).length;
  const title = 'Collection de ' + d.name + ' - Edit Legends';
  const desc = d.owned + ' / ' + total + ' cartes' + (d.mythics ? ' dont ' + d.mythics + ' Mythique' + (d.mythics > 1 ? 's' : '') : '') + ' · score ' + num(d.score) + '. Ouvre des packs et collectionne les légendes de la scène Fortnite edit.';
  let body = '';
  for (let r = 5; r >= 0; r--) {
    const items = [];
    d.cards.forEach((c, i) => { if (c && c[2] === r && d.col[i] > 0) items.push({ c, n: d.col[i] }); });
    if (!items.length) continue;
    items.sort((x, y) => x.c[0].localeCompare(y.c[0], 'fr', { sensitivity: 'base', numeric: true }));
    const have = items.length, all = d.cards.filter((c) => c && c[2] === r).length;
    body += '<section style="--c:' + RAR[r][1] + '"><h2>' + RAR[r][0] + ' <small>' + have + ' / ' + all + '</small></h2><div class="g">' +
      items.map(({ c, n }) => {
        const src = imgSrc(c[4]);
        return '<div class="k"><div class="im">' + (src ? '<img src="' + src + '" alt="" loading="lazy">' : '<b>' + esc(c[0].charAt(0).toUpperCase()) + '</b>') + (n > 1 ? '<i>x' + n + '</i>' : '') + '</div><span>' + esc(c[0]) + '</span></div>';
      }).join('') + '</div></section>';
  }
  if (!body) body = '<p class="mut">Cette collection est encore vide.</p>';
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">' +
    '<title>' + esc(title) + '</title><meta name="description" content="' + esc(desc) + '"><meta name="theme-color" content="#0c0a1a">' +
    '<meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '"><meta property="og:type" content="website">' +
    '<meta property="og:url" content="' + esc(origin + '/c/' + sid) + '"><meta property="og:image" content="' + esc(origin + '/og.jpg') + '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' +
    '<meta name="twitter:card" content="summary_large_image"><link rel="icon" type="image/png" href="/favicon.png">' +
    '<style>:root{--bg:#0c0a1a;--fg:#f1eefc;--mut:#9a93c4;--line:#2f2866;--panel:#161233}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 "Rajdhani","Segoe UI",system-ui,sans-serif;padding:0 max(16px,env(safe-area-inset-right,0px)) 40px max(16px,env(safe-area-inset-left,0px));background-image:radial-gradient(900px 400px at 80% -10%,#2a1c7a55,transparent),radial-gradient(700px 400px at 0 0,#0b4a6a44,transparent)}' +
    '.w{max-width:1000px;margin:0 auto}header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 0}header a.lg{display:flex;align-items:center;gap:10px;color:var(--fg);text-decoration:none;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:20px}header img{width:44px;height:44px}' +
    '.btn{display:inline-block;background:linear-gradient(135deg,#7c5cff,#4a2fd0);border:1px solid #27e0ff;border-radius:10px;padding:10px 20px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#fff;text-decoration:none}' +
    '.who{display:flex;align-items:center;gap:16px;flex-wrap:wrap;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}.who img{width:64px;height:64px;border-radius:50%;object-fit:cover}.who h1{margin:0;font-size:26px}.st{display:flex;gap:22px;flex-wrap:wrap;margin-left:auto}.st div{display:flex;flex-direction:column}.st b{font-size:1.4em}.st span,.mut{color:var(--mut)}' +
    'section{margin-top:22px}h2{margin:0 0 10px;color:var(--c);text-transform:uppercase;letter-spacing:.05em}h2 small{color:var(--mut);font-size:.6em;margin-left:6px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:12px}.k{text-align:center;font-size:13px;min-width:0}.k span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.im{position:relative;aspect-ratio:1;border-radius:12px;border:3px solid var(--c);background:#1e1946;display:grid;place-items:center;overflow:hidden;box-shadow:0 0 12px color-mix(in srgb,var(--c) 40%,transparent);margin-bottom:4px}.im img{width:100%;height:100%;object-fit:cover}.im b{font-size:28px}.im i{position:absolute;right:3px;bottom:3px;background:#000b;border-radius:8px;padding:0 6px;font-style:normal;font-size:12px}' +
    '.cta{text-align:center;margin-top:34px}.cta p{color:var(--mut)}footer{margin-top:30px;text-align:center;color:var(--mut);font-size:12px}footer a{color:#27e0ff}</style></head><body><div class="w">' +
    '<header><a class="lg" href="/"><img src="/img/logo.png" alt="">Edit Legends</a><a class="btn" href="/">Jouer</a></header>' +
    '<div class="who">' + (d.avatar ? '<img src="' + esc(d.avatar) + '" alt="" referrerpolicy="no-referrer">' : '') + '<div><div class="mut">Collection de</div><h1>' + esc(d.name) + '</h1></div>' +
    '<div class="st"><div><b>' + d.owned + ' / ' + total + '</b><span>cartes</span></div><div><b>' + d.mythics + '</b><span>Mythiques</span></div><div><b>' + num(d.score) + '</b><span>score</span></div><div><b>' + num(d.opened) + '</b><span>packs ouverts</span></div></div></div>' +
    body + '<div class="cta"><p>10 packs offerts à l\'inscription, 1 pack gratuit par heure.</p><a class="btn" href="/">Commencer ma collection</a></div>' +
    '<footer>Projet de fans, non affilié à Epic Games ni à Fortnite. · <a href="/confidentialite.html">Confidentialité</a></footer></div></body></html>';
}

let db = null;
module.exports = async (req, res) => {
  try {
    if (!db) {
      const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
      if (!url || !key) throw new Error('config manquante');
      db = createDb(url, key);
    }
    const sid = String((req.query && req.query.id) || '');
    const d = await publicShare(db, sid);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!d) { res.status(404).send('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Lien introuvable</title><body style="font-family:system-ui;background:#0c0a1a;color:#f1eefc;text-align:center;padding:60px 16px"><h1>Lien introuvable</h1><p><a style="color:#27e0ff" href="/">Retour à Edit Legends</a></p>'); return; }
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).send(page(d, 'https://' + (req.headers.host || 'edit-legends.vercel.app'), sid));
  } catch (e) {
    console.error(e);
    res.status(500).send('Erreur serveur');
  }
};
module.exports.page = page;
