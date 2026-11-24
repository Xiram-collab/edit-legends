const C = require('./config');
// Accès Supabase (clé secrète : uniquement côté serveur, jamais dans le navigateur).
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (x) => typeof x === 'string' && UUID.test(x);
const missingCol = (e) => !!e && /column|schema cache/i.test(e.message || '');
const mapBy = (rows, key) => { const m = {}; (rows || []).forEach((r) => { m[r[key]] = r; }); return m; };


function createDb(url, secretKey) {
  const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let cardsCache = null, cardsAt = 0, extraCols = true, sumCols = true, identCols = true, catCol = true, cscCol = true, cscDone = false;
  const csel = () => (catCol ? ',cat' : '') + (cscCol ? ',cscore' : '');
  // colonnes cat / cscore pas encore créées (sql/migration_v2.sql) : on les retire et on réessaie
  const dropCol = (e) => { colsLostAt = Date.now(); const m = String((e && e.message) || ''); if (cscCol && (/cscore/i.test(m) || !(catCol && /\bcat\b/i.test(m)))) { cscCol = false; return true; } if (catCol) { catCol = false; return true; } return false; };
  let colsLostAt = 0;
  // La colonne a peut-être été créée depuis : on retente de temps en temps (sinon l'instance garde « absente » en mémoire)
  const retryCols = () => { if ((!cscCol || !catCol) && Date.now() - colsLostAt > 20000) { cscCol = true; catCol = true; cscDone = false; colsLostAt = Date.now(); } };
  const withCols = async (run) => { retryCols(); for (;;) { const r = await run(); if (!r.error || !missingCol(r.error) || !dropCol(r.error)) return r; } };
  const cache = {};
  const cached = async (k, ms, fn) => { const c = cache[k]; if (c && Date.now() - c.t < ms) return c.v; const v = await fn(); cache[k] = { t: Date.now(), v }; return v; };
  let actTable = true; const actSeen = new Set();
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
      if (identCols) {
        // pseudo / avatar personnalisés : ils gagnent sur ceux de Discord
        const { data, error } = await sb.from('profiles').select('custom_name,no_avatar').eq('user_id', user.id).maybeSingle();
        if (error) { if (missingCol(error)) identCols = false; }
        else {
          if (data && data.custom_name) row.name = data.custom_name;
          if (data && data.no_avatar) row.avatar = '';
          row.d_name = user.name; row.d_avatar = user.avatar || '';
        }
      }
      if (extraCols) row.last_seen = new Date().toISOString();
      let { error } = await sb.from('profiles').upsert(row, { onConflict: 'user_id' });
      if (error && missingCol(error)) { // migration pas encore lancée : on continue comme avant
        identCols = false; delete row.d_name; delete row.d_avatar;
        ({ error } = await sb.from('profiles').upsert(row, { onConflict: 'user_id' }));
        if (error && missingCol(error)) { extraCols = false; delete row.last_seen; await sb.from('profiles').upsert(row, { onConflict: 'user_id' }); }
      }
    },
    // Jours d'activité : une ligne par joueur et par jour (table activity_days). Sans la migration, on ignore sans erreur.
    async markActive(uid, day) {
      if (!actTable) return;
      const k = uid + '|' + day; if (actSeen.has(k)) return;
      const { error } = await sb.from('activity_days').upsert({ user_id: uid, day }, { onConflict: 'user_id,day', ignoreDuplicates: true });
      if (error) { if (/relation|does not exist|schema cache|activity_days/i.test(error.message || '')) actTable = false; return; }
      if (actSeen.size > 20000) actSeen.clear();
      actSeen.add(k);
    },
    async activeByDay(fromDay) {
      if (!actTable) return null;
      try {
        const rows = await paged((f, t) => sb.from('activity_days').select('day').gte('day', fromDay).order('day').range(f, t));
        const out = {}; rows.forEach((r) => { out[r.day] = (out[r.day] || 0) + 1; }); return out;
      } catch (e) { if (/relation|does not exist|schema cache|activity_days/i.test(e.message || '')) actTable = false; return null; }
    },
    // Change le pseudo / l'avatar affichés (customName vide = pseudo Discord)
    async setIdentity(uid, customName, noAvatar) {
      const p = await this.getProfile(uid);
      if (!p) return null;
      const dn = p.d_name || p.name, da = p.d_avatar != null ? p.d_avatar : (p.avatar || '');
      const patch = { custom_name: customName || null, no_avatar: !!noAvatar, name: customName || dn, avatar: noAvatar ? '' : da };
      const { error } = await sb.from('profiles').update(patch).eq('user_id', uid);
      if (error) throw new Error(missingCol(error) ? 'Lance sql/migration_pseudo.sql dans Supabase' : 'Enregistrement impossible');
      delete cache.profiles;
      return { id: uid, name: patch.name, avatar: patch.avatar, custom: patch.custom_name || '', noAvatar: patch.no_avatar };
    },
    async nameTaken(name, uid) {
      const { data } = await sb.from('profiles').select('user_id').ilike('name', name.replace(/[\\%_]/g, '\\$&')).neq('user_id', uid).limit(1);
      return !!(data && data.length);
    },
    async isAdmin(uid) {
      const { data } = await sb.from('profiles').select('is_admin').eq('user_id', uid).maybeSingle();
      return !!(data && data.is_admin);
    },
    // ---------- jury ----------
    async isJury(uid) {
      const { data, error } = await sb.from('profiles').select('is_jury').eq('user_id', uid).maybeSingle();
      return !error && !!(data && data.is_jury);
    },
    async setJury(uid, on) {
      const { error } = await sb.from('profiles').update({ is_jury: !!on }).eq('user_id', uid);
      if (error) throw new Error(missingCol(error) ? 'Lance sql/migration_propositions.sql dans Supabase (colonne is_jury manquante)' : error.message);
    },
    async listJurors() {
      const { data, error } = await sb.from('profiles').select('user_id,name,avatar').eq('is_jury', true);
      return error ? [] : (data || []).map((p) => ({ id: p.user_id, name: p.name, avatar: p.avatar || '' }));
    },
    async loadSave(uid) {
      const { data, error } = await sb.from('saves').select('data,version').eq('user_id', uid).maybeSingle();
      if (error) throw error;
      return data ? { data: data.data || {}, version: data.version } : null;
    },
    // true si enregistré ; false si quelqu'un a modifié l'état entre-temps. sum = résumé du classement.
    async saveSave(uid, S, version, sum) {
      retryCols();
      const attempt = async () => {
        const cols = sum && sumCols ? Object.assign({ owned: sum.owned, mythics: sum.mythics, score: sum.score, opened: sum.opened, hidden: sum.hidden }, catCol ? { cat: sum.cat || null } : {}, cscCol ? { cscore: sum.cscore || 0 } : {}) : {};
        if (version < 0) return sb.from('saves').insert(Object.assign({ user_id: uid, data: S, version: 0 }, cols));
        return sb.from('saves').update(Object.assign({ data: S, version: version + 1, updated_at: new Date().toISOString() }, cols))
          .eq('user_id', uid).eq('version', version).select('user_id');
      };
      let r = await attempt();
      while (r.error && sumCols && missingCol(r.error) && /cat|cscore/i.test(r.error.message || '') && dropCol(r.error)) r = await attempt();
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
    // Codes de la map : vérifiés par calcul (lib/codes.js). La table ne garde que les codes utilisés ;
    // la clé primaire sur « code » empêche deux échanges simultanés du même code.
    async useCode(code, uid) {
      const { error } = await sb.from('codes').insert({ code, used: true, used_by: uid, used_at: new Date().toISOString() });
      if (!error) return true;
      if (error.code === '23505') return false;   // déjà utilisé
      throw error;
    },
    async unuseCode(code) {
      await sb.from('codes').delete().eq('code', code);
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
      let { data, error } = await withCols(() => sb.from('saves').select('user_id,owned,mythics,score,opened,hidden' + csel()).in('user_id', ids));
      if (error) { if (missingCol(error)) return {}; throw error; }
      return mapBy(data, 'user_id');
    },
    // Classement trié par `sort` (égalités départagées par identifiant), `limit` lignes à partir de `offset`.
    async leaderboard(sort, limit, offset = 0) {
      const run = () => {
        let q = sb.from('saves').select('user_id,owned,mythics,score,opened' + csel()).eq('hidden', false).gt('owned', 0);
        // « coll » : plus de points de rareté (cartes différentes), puis plus de cartes, puis plus de mythiques, puis celui qui a atteint ce niveau en premier (cat croissante, inconnue en dernier)
        if (sort === 'coll') { if (cscCol) q = q.order('cscore', { ascending: false, nullsFirst: false }); q = q.order('owned', { ascending: false }).order('mythics', { ascending: false }); if (catCol) q = q.order('cat', { ascending: true, nullsFirst: false }); }
        else q = q.order(sort, { ascending: false });
        return q.order('user_id').range(offset, offset + limit - 1);
      };
      let { data, error } = await withCols(run);
      if (error) { if (missingCol(error)) return []; throw error; }
      const profs = await this.getProfiles(data.map((r) => r.user_id));
      return data.map((r) => ({ id: r.user_id, name: (profs[r.user_id] || {}).name || 'Joueur', avatar: (profs[r.user_id] || {}).avatar || '', owned: r.owned, mythics: r.mythics, score: r.score, cscore: r.cscore || 0, opened: r.opened, cat: r.cat || 0 }));
    },
    // Position exacte : ceux qui ont mieux + ceux à égalité avec un identifiant plus petit + 1
    async rankOf(sort, value, uid) {
      if (sort === 'coll') {
        const me = await withCols(() => sb.from('saves').select('owned,mythics' + csel()).eq('user_id', uid).maybeSingle());
        if (me.error || !me.data) return null;
        const o = me.data.owned, my = me.data.mythics, c = me.data.cat || null, cs = cscCol && me.data.cscore != null ? me.data.cscore : null;
        const bs = () => sb.from('saves').select('user_id', { count: 'exact', head: true }).eq('hidden', false).gt('owned', 0);
        const a1 = await bs().or(cs != null
          ? 'cscore.gt.' + cs + ',and(cscore.eq.' + cs + ',owned.gt.' + o + '),and(cscore.eq.' + cs + ',owned.eq.' + o + ',mythics.gt.' + my + ')'
          : 'owned.gt.' + o + ',and(owned.eq.' + o + ',mythics.gt.' + my + ')');
        if (a1.error) return null;
        const tie = () => { let q = bs().eq('owned', o).eq('mythics', my); if (cs != null) q = q.eq('cscore', cs); return q; };
        let b1 = catCol ? await (c ? tie().or('cat.lt.' + c + ',and(cat.eq.' + c + ',user_id.lt.' + uid + ')') : tie().or('cat.not.is.null,and(cat.is.null,user_id.lt.' + uid + ')')) : { error: true };
        if (b1.error) b1 = await tie().lt('user_id', uid);
        return (a1.count || 0) + (b1.count || 0) + 1;
      }
      const base = () => sb.from('saves').select('user_id', { count: 'exact', head: true }).eq('hidden', false).gt('owned', 0);
      const better = await base().gt(sort, value);
      if (better.error) return null;
      const tie = isId(uid) ? await base().eq(sort, value).lt('user_id', uid) : { count: 0 };
      return (better.count || 0) + (tie.count || 0) + 1;
    },
    // Calcule les points de collection des sauvegardes qui n'en ont pas encore (une fois par démarrage, par paquets)
    async backfillCscore(compute) {
      retryCols();
      if (cscDone || !cscCol) return;
      for (let guard = 0; guard < 30; guard++) {
        const { data, error } = await sb.from('saves').select('user_id,data').is('cscore', null).limit(100);
        if (error) { if (missingCol(error)) cscCol = false; return; }
        if (!data || !data.length) { cscDone = true; return; }
        for (const r of data) { let v = 0; try { v = compute(r.data || {}) || 0; } catch (e) { v = 0; } await sb.from('saves').update({ cscore: v }).eq('user_id', r.user_id); }
      }
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
      const { data, error } = await sb.from('profiles').select('user_id,name,avatar,last_seen,created_at,is_admin').not('last_seen', 'is', null).order('last_seen', { ascending: false }).limit(n);
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
    // nombre de codes utilisés par joueur
    async codesByUser() {
      const rows = await paged((f, t) => sb.from('codes').select('code,used_by').eq('used', true).order('code').range(f, t)).catch(() => []);
      const m = {}; rows.forEach((r) => { if (r.used_by) m[r.used_by] = (m[r.used_by] || 0) + 1; });
      return m;
    },
    // Classement des runs (= codes de fin utilisés), joueurs non cachés, trié par runs puis identifiant
    async runsBoard() {
      return cached('runsb', 10000, async () => {
        const m = await this.codesByUser();
        const sums = await paged((f, t) => sb.from('saves').select('user_id,owned,mythics,score,opened,hidden').order('user_id').range(f, t)).catch(() => []);
        const sm = mapBy(sums, 'user_id');
        return Object.keys(m).filter((id) => sm[id] && !sm[id].hidden)
          .map((id) => ({ id, runs: m[id], owned: sm[id].owned || 0, mythics: sm[id].mythics || 0, score: sm[id].score || 0, opened: sm[id].opened || 0 }))
          .sort((a, b) => b.runs - a.runs || (a.id < b.id ? -1 : 1));
      });
    },
    // Classement d'une période : points et runs gagnés depuis le début du jour ou de la semaine (clés heure de Paris)
    async periodBoard(period, key) {
      return cached('per' + period + key, 10000, async () => {
        const rows = await paged((f, t) => sb.from('saves').select('user_id,hidden,owned,mythics,opened,per:data->per').order('user_id').range(f, t)).catch(() => []);
        const kf = period === 'day' ? ['dk', 'd', 'dr'] : ['wk', 'w', 'wr'];
        return rows.filter((r) => !r.hidden && r.per && r.per[kf[0]] === key)
          .map((r) => ({ id: r.user_id, score: r.per[kf[1]] || 0, runs: r.per[kf[2]] || 0, owned: r.owned || 0, mythics: r.mythics || 0, opened: r.opened || 0 }));
      });
    },
    // Titre équipé de chaque joueur (sans migration : lu dans le JSON de la sauvegarde)
    async getEquipped(ids) {
      const list = ids.filter(isId);
      if (!list.length) return {};
      const { data, error } = await sb.from('saves').select('user_id,t:data->title').in('user_id', list);
      if (error) return {};
      const m = {}; data.forEach((r) => { if (typeof r.t === 'string') m[r.user_id] = r.t; });
      return m;
    },
    // Cartes Holo de chaque joueur (objet carte -> nombre de Holo), pour l'affichage du classement
    async getHolo(ids) {
      const list = ids.filter(isId);
      if (!list.length) return {};
      const { data, error } = await sb.from('saves').select('user_id,h:data->holo').in('user_id', list);
      if (error) return {};
      const m = {}; data.forEach((r) => { if (r.h && typeof r.h === 'object') m[r.user_id] = r.h; });
      return m;
    },
    // Nombre de joueurs possédant chaque titre, sur les joueurs ayant ouvert au moins un pack
    async titleStats() {
      return cached('titlestats', 60000, async () => {
        const rows = await paged((f, t) => sb.from('saves').select('user_id,opened,titles:data->titles').order('user_id').range(f, t)).catch(() => []);
        const counts = {}; let total = 0;
        rows.forEach((r) => { if (!(r.opened > 0)) return; total++; Object.keys(r.titles || {}).forEach((k) => { counts[k] = (counts[k] || 0) + 1; }); });
        return { counts, total };
      });
    },
    async userRuns(uid) {
      if (!isId(uid)) return 0;
      const { count, error } = await sb.from('codes').select('code', { count: 'exact', head: true }).eq('used_by', uid);
      return error ? 0 : count || 0;
    },
    async codeStats() {
      const used = await sb.from('codes').select('code', { count: 'exact', head: true }).eq('used', true);
      return { total: C.CODE_LIMIT, used: used.count || 0 };
    },
    // Droits d'un admin : liste de clés, ou null = anciens droits (tout sauf ce qui est réservé au propriétaire). Colonne profiles.perms (sql/migration_v3.sql)
    async getPerms(uid) {
      if (!isId(uid)) return null;
      const { data, error } = await sb.from('profiles').select('perms').eq('user_id', uid).maybeSingle();
      if (error || !data || data.perms == null) return null;
      try { const a = JSON.parse(data.perms); return Array.isArray(a) ? a : null; } catch (e) { return null; }
    },
    async setPerms(uid, perms) {
      if (!isId(uid)) return;
      const { error } = await sb.from('profiles').update({ perms: perms == null ? null : JSON.stringify(perms) }).eq('user_id', uid);
      if (error) { if (missingCol(error)) throw new Error('perms_col'); throw error; }
      delete cache.profiles;
    },
    async listAdmins() {
      const { data, error } = await sb.from('profiles').select('user_id,name,avatar,discord_id,last_seen,perms').eq('is_admin', true).order('name');
      if (error) { const r = await sb.from('profiles').select('user_id,name,avatar,discord_id,last_seen').eq('is_admin', true).order('name'); return (r.data || []).map((p) => Object.assign({}, p, { perms: null })); }
      return data || [];
    },
    async setAdminFlag(uid, v) {
      if (!isId(uid)) return;
      const { error } = await sb.from('profiles').update({ is_admin: !!v }).eq('user_id', uid);
      if (error) throw error;
      delete cache.profiles;
    },
    // ----- création de cartes (panel Admin) -----
    async listDrafts() {
      const cols = 'id,name,cat,rarity,descr,img,votes,created_by,created_at';
      let { data, error } = await sb.from('card_drafts').select(cols + ',status').order('created_at', { ascending: false });
      if (error && missingCol(error)) ({ data, error } = await sb.from('card_drafts').select(cols).order('created_at', { ascending: false }));
      if (error) throw new Error('Table des brouillons absente : lance sql/migration_cartes.sql dans Supabase');
      return data || [];
    },
    async getDraft(id) { const { data } = await sb.from('card_drafts').select('*').eq('id', id).maybeSingle(); return data || null; },
    async addDraft(row) {
      let { error } = await sb.from('card_drafts').insert(Object.assign({ votes: {} }, row));
      if (error && missingCol(error) && 'status' in row) { const r = Object.assign({}, row); delete r.status; ({ error } = await sb.from('card_drafts').insert(Object.assign({ votes: {} }, r))); }
      if (error) throw new Error('Table des brouillons absente : lance sql/migration_cartes.sql dans Supabase');
    },
    async updateDraft(id, f) { const { error } = await sb.from('card_drafts').update(f).eq('id', id); if (error) throw new Error(missingCol(error) ? 'Lance sql/migration_propositions.sql dans Supabase' : error.message); },
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
    // ----- Ma carte : association joueur <-> carte (réservée au propriétaire) -----
    async cardOwners() {
      const { data, error } = await sb.from('card_owner').select('card_id,user_id,img_at');
      if (error) throw new Error('Table card_owner absente : lance sql/migration_marche.sql dans Supabase');
      return data || [];
    },
    async cardOwnerOf(uid) {
      if (!isId(uid)) return null;
      const { data, error } = await sb.from('card_owner').select('card_id,user_id,img_at').eq('user_id', uid).maybeSingle();
      return error ? null : (data || null);
    },
    async cardOwnerSet(cardId, uid) {
      await sb.from('card_owner').delete().eq('user_id', uid);
      const { error } = await sb.from('card_owner').upsert({ card_id: cardId, user_id: uid, img_at: null }, { onConflict: 'card_id' });
      if (error) throw new Error('Table card_owner absente : lance sql/migration_marche.sql dans Supabase');
    },
    async cardOwnerDel(cardId) { await sb.from('card_owner').delete().eq('card_id', cardId); },
    async cardOwnerTouch(cardId, iso) { await sb.from('card_owner').update({ img_at: iso }).eq('card_id', cardId); },
    // ----- Marché (enchères) -----
    async marketInsert(row) {
      const { data, error } = await sb.from('market').insert(row).select('id').single();
      if (error) throw new Error('Table market absente : lance sql/migration_marche.sql dans Supabase');
      return data.id;
    },
    async marketGet(id) { const { data } = await sb.from('market').select('*').eq('id', id).maybeSingle(); return data || null; },
    async marketOpen() { const { data, error } = await sb.from('market').select('*').eq('status', 'open').order('ends_at', { ascending: true }); if (error) throw error; return data || []; },
    async marketSold(n, sinceIso, withTrades) { const { data } = await sb.from('market').select('*').in('status', withTrades ? ['sold', 'swapped'] : ['sold']).gte('closed_at', sinceIso).order('closed_at', { ascending: false }).limit(n); return data || []; },
    async marketCountOpen(uid) { const { count } = await sb.from('market').select('id', { count: 'exact', head: true }).eq('status', 'open').eq('seller', uid); return count || 0; },
    // Modifie la ligne seulement si elle est encore dans l'état attendu (statut, mise, enchérisseur) : évite les doubles ventes
    async marketUpdateIf(id, cond, fields) {
      let q = sb.from('market').update(fields).eq('id', id);
      Object.keys(cond).forEach((k) => { q = cond[k] === null ? q.is(k, null) : q.eq(k, cond[k]); });
      const { data, error } = await q.select('id');
      if (error) throw error;
      return !!(data && data.length);
    },
    // Offres terminées à traiter : encore ouvertes mais échues, ou fermées dont la carte / le paiement n'est pas encore livré
    async marketDue(nowIso) {
      const [a, b] = await Promise.all([
        sb.from('market').select('*').eq('status', 'open').lte('ends_at', nowIso),
        sb.from('market').select('*').in('status', ['sold', 'expired']).or('card_done.eq.false,pay_done.eq.false'),
      ]);
      if (a.error) throw a.error;
      return (a.data || []).concat(b.data || []);
    },
    async marketClaim(id, flag) {
      const { data, error } = await sb.from('market').update({ [flag]: true }).eq('id', id).eq(flag, false).select('id');
      if (error) throw error;
      return !!(data && data.length);
    },
    async marketUnclaim(id, flag) { await sb.from('market').update({ [flag]: false }).eq('id', id); },
    // Notifications personnelles (refus / acceptation / publication d'une carte proposée)
    async notify(uid, text) { if (isId(uid)) await sb.from('notifications').insert({ user_id: uid, text: String(text).slice(0, 5000) }); },
    async listNotes(uid) {
      if (!isId(uid)) return [];
      const { data, error } = await sb.from('notifications').select('id,text,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(10);
      return error ? [] : (data || []);
    },
    async readNotes(uid, ids) { if (isId(uid) && ids.length) await sb.from('notifications').delete().eq('user_id', uid).in('id', ids); },
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
    // ----- classement des temps de la map -----
    async addTime(row) {
      const { data, error } = await sb.from('time_runs').insert(row).select('id').single();
      if (error) throw new Error(missingCol(error) || /relation|does not exist|schema cache/i.test(error.message || '') ? 'Lance sql/migration_temps.sql dans Supabase' : error.message);
      return data.id;
    },
    async listTimes(f) {
      let q = sb.from('time_runs').select('id,user_id,week,ms,link,note,device,platform,hide_run,status,paid,created_at');
      if (f.week) q = q.eq('week', f.week);
      if (f.status) q = q.eq('status', f.status);
      if (f.user) q = q.eq('user_id', f.user);
      const { data, error } = await q.order('created_at', { ascending: false }).limit(f.limit || 2000);
      if (error) { if (/relation|does not exist|schema cache/i.test(error.message || '')) throw new Error('Lance sql/migration_temps.sql dans Supabase'); throw error; }
      return data || [];
    },
    async timesToSettle(curWeek) {
      const { data, error } = await sb.from('time_runs').select('id,user_id,week,ms,link,note,device,platform,hide_run,status,paid,created_at').lt('week', curWeek).or('status.eq.pending,and(status.eq.accepted,paid.eq.false)').limit(5000);
      return error ? [] : (data || []);
    },
    async getTime(id) { const { data } = await sb.from('time_runs').select('*').eq('id', id).maybeSingle(); return data || null; },
    async updateTime(id, f) { const { error } = await sb.from('time_runs').update(f).eq('id', id); if (error) throw error; },
    async deleteTime(id) { await sb.from('time_runs').delete().eq('id', id); },
    // true si ce temps vient d'être marqué « payé » par cet appel (un seul appel simultané gagne)
    // Propositions de biographie pour « Ma carte » (table card_bios, sql/migration_v2.sql)
    async listBios() { const { data, error } = await sb.from('card_bios').select('*').order('id'); if (error) throw new Error('Lance sql/migration_v2.sql dans Supabase'); return data || []; },
    async getBio(id) { const { data } = await sb.from('card_bios').select('*').eq('id', id).maybeSingle(); return data || null; },
    async addBio(row) { const { error } = await sb.from('card_bios').insert({ card: row.card, user_id: row.user_id, descr: row.descr }); if (error) throw new Error('Lance sql/migration_v2.sql dans Supabase'); },
    async updateBio(id, f) { const { error } = await sb.from('card_bios').update(f).eq('id', id); if (error) throw error; },
    // Récompenses hebdomadaires des classements : 'first' (premier passage, rien à verser), true (nouvelle semaine à régler), false (déjà fait) ; atomique
    async claimBoard(kind, wk) {
      const cur = await sb.from('board_claims').select('wk').eq('kind', kind).maybeSingle();
      if (cur.error) throw new Error('Lance sql/migration_v2.sql dans Supabase');
      if (!cur.data) { const ins = await sb.from('board_claims').insert({ kind, wk }); return ins.error ? false : 'first'; }
      if (String(cur.data.wk) >= String(wk)) return false;   // clés de semaine « AAAA-MM-JJ » : l'ordre alphabétique suit l'ordre des dates
      const up = await sb.from('board_claims').update({ wk }).eq('kind', kind).eq('wk', cur.data.wk).select('kind');
      return !up.error && !!(up.data && up.data.length);
    },
    async claimTimePaid(id) {
      const { data, error } = await sb.from('time_runs').update({ paid: true }).eq('id', id).eq('paid', false).select('id');
      return !error && !!(data && data.length);
    },
    async unclaimTimePaid(id) { await sb.from('time_runs').update({ paid: false }).eq('id', id); },
    async settleWeek(week) { await sb.from('time_runs').update({ paid: true }).eq('week', week).eq('status', 'accepted'); },
    async recordTime(device) {
      const { data, error } = await sb.from('time_runs').select('id,user_id,week,ms,link,hide_run,platform,device,created_at').eq('status', 'accepted').eq('device', device).order('ms', { ascending: false }).order('created_at', { ascending: true }).limit(1);
      return error || !data || !data.length ? null : data[0];
    },
    async countPendingTimes() {
      const { count, error } = await sb.from('time_runs').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      return error ? 0 : count || 0;
    },
    async logAct(entry) { try { await sb.from('player_log').insert(entry); } catch (e) { /* table absente : sql/migration_v2.sql */ } },
    async recentActs(uid, n) { let q = sb.from('player_log').select('*').order('id', { ascending: false }).limit(n); if (uid) q = q.eq('user_id', uid); const { data } = await q; return data || []; },
    async logAdmin(entry) { await sb.from('admin_log').insert(entry); },
    async recentLogs(n) {
      const { data, error } = await sb.from('admin_log').select('id,admin_id,target_id,action,detail,at').order('at', { ascending: false }).limit(n);
      if (error) throw error;
      return data || [];
    },
    async deleteActs(f) {
      let q = sb.from('player_log').delete();
      if (Array.isArray(f.ids)) q = q.in('id', f.ids); else if (f.uid) q = q.eq('user_id', f.uid); else if (f.before) q = q.lt('at', f.before); else q = q.gt('id', 0);
      const { error } = await q; if (error) throw error;
    },
    async deleteLogs(f) {
      let q = sb.from('admin_log').delete();
      if (Array.isArray(f.ids)) q = q.in('id', f.ids); else if (f.before) q = q.lt('at', f.before); else q = q.gt('id', 0);
      const { error } = await q; if (error) throw error;
    },
    async deleteUser(uid) {
      const { error } = await sb.auth.admin.deleteUser(uid);
      if (error) throw error;
    },
  };
}

module.exports = { createDb };
