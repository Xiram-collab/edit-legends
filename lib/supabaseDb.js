// Accès Supabase (clé secrète : uniquement côté serveur, jamais dans le navigateur).
const { createClient } = require('@supabase/supabase-js');

function createDb(url, secretKey) {
  const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let cardsCache = null, cardsAt = 0;

  return {
    async getUser(token) {
      if (!token) return null;
      const { data, error } = await sb.auth.getUser(token);
      if (error || !data || !data.user) return null;
      const u = data.user;
      const meta = u.user_metadata || {};
      const ident = (u.identities || []).find((i) => i.provider === 'discord');
      return {
        id: u.id,
        discordId: (ident && ident.id) || meta.provider_id || meta.sub || '',
        name: meta.custom_claims && meta.custom_claims.global_name || meta.full_name || meta.name || 'Joueur',
        avatar: meta.avatar_url || '',
      };
    },
    async upsertProfile(user, isAdmin) {
      const row = { user_id: user.id, discord_id: user.discordId || null, name: user.name, avatar: user.avatar };
      if (isAdmin) row.is_admin = true; // on ne retire jamais un droit ici
      await sb.from('profiles').upsert(row, { onConflict: 'user_id' });
    },
    async isAdmin(uid) {
      const { data } = await sb.from('profiles').select('is_admin').eq('user_id', uid).maybeSingle();
      return !!(data && data.is_admin);
    },
    async loadSave(uid) {
      const { data, error } = await sb.from('saves').select('data,version').eq('user_id', uid).maybeSingle();
      if (error) throw error;
      return data ? { data: data.data || {}, version: data.version } : null;
    },
    // true si enregistré ; false si quelqu'un a modifié l'état entre-temps
    async saveSave(uid, S, version) {
      if (version < 0) {
        const { error } = await sb.from('saves').insert({ user_id: uid, data: S, version: 0 });
        return !error;
      }
      const { data, error } = await sb.from('saves')
        .update({ data: S, version: version + 1, updated_at: new Date().toISOString() })
        .eq('user_id', uid).eq('version', version).select('user_id');
      if (error) throw error;
      return !!(data && data.length);
    },
    async getCards() {
      if (cardsCache && Date.now() - cardsAt < 30000) return cardsCache;
      const { data, error } = await sb.from('cards').select('id,name,cat,rarity,descr,img').order('id');
      if (error) throw error;
      const arr = [];
      (data || []).forEach((r) => { arr[r.id] = [r.name, r.cat, r.rarity, r.descr || '', r.img || '']; });
      cardsCache = arr; cardsAt = Date.now();
      return arr;
    },
    // Marque le code comme utilisé, une seule fois, pour tout le site.
    async useCode(code, uid) {
      const { data, error } = await sb.from('codes')
        .update({ used: true, used_by: uid, used_at: new Date().toISOString() })
        .eq('code', code).eq('used', false).select('code');
      if (error) throw error;
      return !!(data && data.length);
    },
    async unuseCode(code) {
      await sb.from('codes').update({ used: false, used_by: null, used_at: null }).eq('code', code);
    },
    async deleteUser(uid) {
      const { error } = await sb.auth.admin.deleteUser(uid);
      if (error) throw error;
    },
  };
}

module.exports = { createDb };
