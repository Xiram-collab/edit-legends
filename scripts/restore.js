// Restaure une sauvegarde : node scripts/restore.js dossier_de_sauvegarde
// (nécessite SUPABASE_URL et SUPABASE_SECRET_KEY). Réécrit les lignes avec upsert : rien n'est supprimé.
const fs = require('fs'), path = require('path');
const KEYS = { profiles: 'user_id', saves: 'user_id', cards: 'id', codes: 'code' };

async function restore(sb, dir) {
  for (const t of ['cards', 'codes', 'profiles', 'saves']) {
    const rows = JSON.parse(fs.readFileSync(path.join(dir, t + '.json'), 'utf8'));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from(t).upsert(rows.slice(i, i + 500), { onConflict: KEYS[t] });
      if (error) throw new Error(t + ' : ' + error.message);
    }
    console.log(t, ':', rows.length, 'lignes restaurées');
  }
}
module.exports = { restore };

if (require.main === module) {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY, dir = process.argv[2];
  if (!url || !key || !dir) { console.error('Usage : SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/restore.js <dossier>'); process.exit(1); }
  restore(createClient(url, key, { auth: { persistSession: false } }), dir).catch((e) => { console.error(e.message); process.exit(1); });
}
