// Accès Supabase (clé secrète : uniquement côté serveur, jamais dans le navigateur).
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (x) => typeof x === 'string' && UUID.test(x);
const missingCol = (e) => !!e && /column|schema cache/i.test(e.message || '');
const mapBy = (rows, key) => { const m = {}; (rows || []).forEach((r) => { m[r[key]] = r; }); return m; };


function createDb(url, secretKey) {
  const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let cardsCache = null, cardsAt = 0, extraCols = true, sumCols = true;
  const cache = {};
  const cached = async (k, ms, fn) => { const c = cache[k]; if (c && Date.now() - c.t < ms) return c.v; const v = await fn(); cache[k] = { t: Date.now(), v }; return v; };
  const paged = async (q) => { const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await q(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; } return out; };

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
      if (extraCols) {
        const { error } = await sb.from('profiles').upsert(Object.assign({ last_seen: new Date().toISOString() }, row), { onConflict: 'user_id' });
        if (!error) return;
        if (!missingCol(error)) return;
        extraCols = false; // migration pas encore lancée : on continue comme avant
      }
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
    // true si enregistré ; false si quelqu'un a modifié l'état entre-temps. sum = résumé du classement.
    async saveSave(uid, S, version, sum) {
      const attempt = async () => {
        const cols = sum && sumCols ? { owned: sum.owned, mythics: sum.mythics, score: sum.score, opened: sum.opened, hidden: sum.hidden } : {};
        if (version < 0) return sb.from('saves').insert(Object.assign({ user_id: uid, data: S, version: 0 }, cols));
        return sb.from('saves').update(Object.assign({ data: S, version: version + 1, updated_at: new Date().toISOString() }, cols))
          .eq('user_id', uid).eq('version', version).select('user_id');
      };
      let r = await attempt();
      if (r.error && sumCols && missingCol(r.error)) { sumCols = false; r = await attempt(); }
      if (version < 0) return !r.error;
      if (r.error) throw r.error;
      return !!(r.data && r.data.length);
    },
    async getCards() {
      if (cardsCache && Date.now() - cardsAt < 30000) return cardsCache;
      let q = await sb.from('cards').select('id,name,cat,rarity,descr,img,retired').order('id');
      if (q.error && missingCol(q.error)) q = await sb.from('cards').select('id,name,cat,rarity,descr,img').order('id');
      if (q.error) throw q.error;
      const arr = [];
      (q.data || []).forEach((r) => { arr[r.id] = [r.name, r.cat, r.rarity, r.descr || '', r.img || '', r.retired ? 1 : 0]; });
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

    // ---------- communauté ----------
    async getProfile(id) {
      if (!isId(id)) return null;
      const { data } = await sb.from('profiles').select('*').eq('user_id', id).maybeSingle();
      return data || null;
    },
    async getProfiles(ids) {
      ids = ids.filter(isId); if (!ids.length) return {};
      const { data, error } = await sb.from('profiles').select('user_id,name,avatar,last_seen').in('user_id', ids);
      if (error) throw error;
      return mapBy(data, 'user_id');
    },
    async getSummaries(ids) {
      ids = ids.filter(isId); if (!ids.length) return {};
      const { data, error } = await sb.from('saves').select('user_id,owned,mythics,score,opened,hidden').in('user_id', ids);
      if (error) { if (missingCol(error)) return {}; throw error; }
      return mapBy(data, 'user_id');
    },
    // Classement trié par `sort` (égalités départagées par identifiant), `limit` lignes à partir de `offset`.
    async leaderboard(sort, limit, offset = 0) {
      const { data, error } = await sb.from('saves').select('user_id,owned,mythics,score,opened')
        .eq('hidden', false).gt('owned', 0).order(sort, { ascending: false }).order('user_id').range(offset, offset + limit - 1);
      if (error) { if (missingCol(error)) return []; throw error; }
      const profs = await this.getProfiles(data.map((r) => r.user_id));
      return data.map((r) => ({ id: r.user_id, name: (profs[r.user_id] || {}).name || 'Joueur', avatar: (profs[r.user_id] || {}).avatar || '', owned: r.owned, mythics: r.mythics, score: r.score, opened: r.opened }));
    },
    // Position exacte : ceux qui ont mieux + ceux à égalité avec un identifiant plus petit + 1
    async rankOf(sort, value, uid) {
      const base = () => sb.from('saves').select('user_id', { count: 'exact', head: true }).eq('hidden', false).gt('owned', 0);
      const better = await base().gt(sort, value);
      if (better.error) return null;
      const tie = isId(uid) ? await base().eq(sort, value).lt('user_id', uid) : { count: 0 };
      return (better.count || 0) + (tie.count || 0) + 1;
    },
    async rankedCount() {
      const { count, error } = await sb.from('saves').select('user_id', { count: 'exact', head: true }).eq('hidden', false).gt('owned', 0);
      return error ? 0 : count || 0;
    },
    async searchProfiles(q, uid) {
      const pat = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
      const { data, error } = await sb.from('profiles').select('user_id,name,avatar').ilike('name', pat).limit(25);
      if (error) throw error;
      const list = data.filter((r) => r.user_id !== uid);
      const sums = await this.getSummaries(list.map((r) => r.user_id));
      return list.filter((r) => !(sums[r.user_id] && sums[r.user_id].hidden)).slice(0, 10)
        .map((r) => ({ id: r.user_id, name: r.name, avatar: r.avatar || '', owned: (sums[r.user_id] || {}).owned || 0, score: (sums[r.user_id] || {}).score || 0 }));
    },
    async listFriends(uid) {
      if (!isId(uid)) return [];
      const { data, error } = await sb.from('friends').select('a,b,status').or('a.eq.' + uid + ',b.eq.' + uid);
      if (error) throw error;
      return data || [];
    },
    async getFriendRow(x, y) {
      if (!isId(x) || !isId(y)) return null;
      const { data, error } = await sb.from('friends').select('a,b,status').or('and(a.eq.' + x + ',b.eq.' + y + '),and(a.eq.' + y + ',b.eq.' + x + ')').limit(1);
      if (error) throw error;
      return (data && data[0]) || null;
    },
    async addFriendRow(a, b) {
      if (!isId(a) || !isId(b)) return;
      const { error } = await sb.from('friends').insert({ a, b, status: 'pending' });
      if (error) throw error;
    },
    async setFriendStatus(a, b, status) {
      if (!isId(a) || !isId(b)) return;
      const { error } = await sb.from('friends').update({ status }).eq('a', a).eq('b', b);
      if (error) throw error;
    },
    async deleteFriend(x, y) {
      if (!isId(x) || !isId(y)) return;
      const { error } = await sb.from('friends').delete().or('and(a.eq.' + x + ',b.eq.' + y + '),and(a.eq.' + y + ',b.eq.' + x + ')');
      if (error) throw error;
    },
    async ensureShareId(uid) {
      const p = await this.getProfile(uid);
      if (p && p.share_id) return p.share_id;
      for (let t = 0; t < 5; t++) {
        const sid = Array.from(crypto.randomBytes(10), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
        const { error } = await sb.from('profiles').update({ share_id: sid }).eq('user_id', uid);
        if (!error) return sid;
      }
      throw new Error('partage indisponible');
    },
    async getProfileByDiscord(did) {
      const { data } = await sb.from('profiles').select('user_id,name,avatar').eq('discord_id', String(did)).maybeSingle();
      return data || null;
    },
    async getProfileByShare(sid) {
      const { data } = await sb.from('profiles').select('user_id,name,avatar').eq('share_id', sid).maybeSingle();
      return data || null;
    },

    // ---------- administration ----------
    async recentSeen(n) {
      const { data, error } = await sb.from('profiles').select('user_id,name,avatar,last_seen,is_admin').not('last_seen', 'is', null).order('last_seen', { ascending: false }).limit(n);
      if (error) { if (missingCol(error)) return []; throw error; }
      return data || [];
    },
    async allProfiles() {
      return cached('profiles', 8000, () => paged((f, t) => sb.from('profiles').select('user_id,name,avatar,discord_id,created_at,last_seen,is_admin').order('user_id').range(f, t)));
    },
    async allSaves() {
      return cached('saves', 8000, () => paged((f, t) => sb.from('saves').select('user_id,data').order('user_id').range(f, t)));
    },
    async listPlayers() {
      const [profs, sums] = await Promise.all([this.allProfiles(),
        cached('sums', 8000, () => paged((f, t) => sb.from('saves').select('user_id,owned,mythics,score,opened').order('user_id').range(f, t)).catch(() => []))]);
      const sm = mapBy(sums, 'user_id');
      return profs.map((p) => { const s = sm[p.user_id] || {}; return { id: p.user_id, name: p.name, avatar: p.avatar || '', discordId: p.discord_id || '', createdAt: p.created_at || null, lastSeen: p.last_seen || null, isAdmin: !!p.is_admin, owned: s.owned || 0, mythics: s.mythics || 0, score: s.score || 0, opened: s.opened || 0 }; });
    },
    async codeStats() {
      const total = await sb.from('codes').select('code', { count: 'exact', head: true });
      const used = await sb.from('codes').select('code', { count: 'exact', head: true }).eq('used', true);
      return { total: total.count || 0, used: used.count || 0 };
    },
    async setAdminFlag(uid, v) {
      if (!isId(uid)) return;
      const { error } = await sb.from('profiles').update({ is_admin: !!v }).eq('user_id', uid);
      if (error) throw error;
      delete cache.profiles;
    },
    // ----- création de cartes (panel Admin) -----
    async listDrafts() {
      const { data, error } = await sb.from('card_drafts').select('id,name,cat,rarity,descr,img,votes,created_by,created_at').order('created_at', { ascending: false });
      if (error) throw new Error('Table des brouillons absente : lance sql/migration_cartes.sql dans Supabase');
      return data || [];
    },
    async getDraft(id) { const { data } = await sb.from('card_drafts').select('*').eq('id', id).maybeSingle(); return data || null; },
    async addDraft(row) {
      const { error } = await sb.from('card_drafts').insert(Object.assign({ votes: {} }, row));
      if (error) throw new Error('Table des brouillons absente : lance sql/migration_cartes.sql dans Supabase');
    },
    async deleteDraft(id) { await sb.from('card_drafts').delete().eq('id', id); },
    async setDraftVotes(id, votes) { const { error } = await sb.from('card_drafts').update({ votes }).eq('id', id); if (error) throw error; },
    async addCard(row) {
      for (let k = 0; k < 5; k++) {
        const { data: last } = await sb.from('cards').select('id').order('id', { ascending: false }).limit(1);
        const id = (last && last.length ? last[0].id : -1) + 1;
        const { error } = await sb.from('cards').insert(Object.assign({ id }, row));
        if (!error) { cardsCache = null; return id; }
        if (!/duplicate|unique/i.test(error.message || '')) throw error;
      }
      throw new Error('Impossible de créer la carte, réessaie');
    },
    async deleteCard(id) { const { error } = await sb.from('cards').delete().eq('id', id); if (error) throw error; cardsCache = null; },
    async updateCard(id, fields) { const { error } = await sb.from('cards').update(fields).eq('id', id); if (error) throw error; cardsCache = null; },
    async uploadImage(buf, type) {
      const ext = type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : 'webp';
      const path = 'c' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex') + '.' + ext;
      const { error } = await sb.storage.from('cards').upload(path, buf, { contentType: type, upsert: false, cacheControl: '31536000' });
      if (error) throw new Error('Envoi de l\'image impossible : lance sql/migration_cartes.sql dans Supabase (' + error.message + ')');
      return url.replace(/\/+$/, '') + '/storage/v1/object/public/cards/' + path;
    },
    async listAnnouncements(n) {
      return cached('ann', 10000, async () => {
        const { data, error } = await sb.from('announcements').select('id,text,created_at').order('created_at', { ascending: false }).limit(n);
        return error ? [] : (data || []);
      });
    },
    async addAnnouncement(text) {
      const { error } = await sb.from('announcements').insert({ text });
      if (error) throw new Error('Table des annonces absente : lance sql/migration_annonces.sql dans Supabase');
      delete cache.ann;
    },
    async deleteAnnouncement(id) { await sb.from('announcements').delete().eq('id', id); delete cache.ann; },
    async logAdmin(entry) { await sb.from('admin_log').insert(entry); },
    async recentLogs(n) {
      const { data, error } = await sb.from('admin_log').select('admin_id,target_id,action,detail,at').order('at', { ascending: false }).limit(n);
      if (error) throw error;
      return data || [];
    },
    async deleteUser(uid) {
      const { error } = await sb.auth.admin.deleteUser(uid);
      if (error) throw error;
    },
  };
}

module.exports = { createDb };
