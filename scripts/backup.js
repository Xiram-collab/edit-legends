// Sauvegarde complète des tables Supabase en fichiers JSON (utilisé par la sauvegarde quotidienne GitHub).
const fs = require('fs'), path = require('path');
const TABLES = ['profiles', 'saves', 'cards', 'codes'];

async function dump(sb, table) {
  const rows = []; const step = 1000;
  for (let from = 0; ; from += step) {
    const { data, error } = await sb.from(table).select('*').range(from, from + step - 1);
    if (error) throw new Error(table + ' : ' + error.message);
    rows.push(...data);
    if (data.length < step) break;
  }
  return rows;
}

async function backup(sb, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const counts = {};
  for (const t of TABLES) {
    const rows = await dump(sb, t);
    fs.writeFileSync(path.join(dir, t + '.json'), JSON.stringify(rows));
    counts[t] = rows.length;
  }
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify({ date: new Date().toISOString(), counts }, null, 2));
  return counts;
}

module.exports = { backup, TABLES };

if (require.main === module) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) { console.error('SUPABASE_URL ou SUPABASE_SECRET_KEY manquant'); process.exit(1); }
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  backup(sb, process.argv[2] || 'backup').then((c) => { console.log('Sauvegarde terminée :', JSON.stringify(c)); if (!c.cards) { console.error('Aucune carte lue : sauvegarde suspecte'); process.exit(1); } })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
