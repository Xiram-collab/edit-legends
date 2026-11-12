// Base de données en mémoire pour tester l'API sans Supabase (mêmes méthodes que lib/supabaseDb.js).
module.exports = function fakeDb(cards, validCodes) {
  const saves = new Map(), profiles = new Map(), codes = new Map(validCodes.map((c) => [c, { used: false }]));
  const friends = [], logs = [];
  const users = {
    tokA: { id: 'A', discordId: '111', name: 'Alice', avatar: '' },
    tokB: { id: 'B', discordId: '222', name: 'Bob', avatar: '' },
    tokC: { id: 'C', discordId: '333', name: 'Carl', avatar: '' },
    tokD: { id: 'D', discordId: '444', name: 'Dana', avatar: '' },
    tokE: { id: 'E', discordId: '555', name: 'Eli', avatar: '' },
  };
  const sumOf = (uid) => { const r = saves.get(uid); return r && r.sum ? r.sum : null; };
  const frow = (x, y) => friends.find((f) => (f.a === x && f.b === y) || (f.a === y && f.b === x)) || null;
  return {
    saves, codes, profiles, friends, logs,
    async getUser(t) { return users[t] || null; },
    async upsertProfile(u, isAdmin) {
      const p = profiles.get(u.id) || { user_id: u.id, created_at: new Date(1e12).toISOString() };
      profiles.set(u.id, Object.assign(p, { name: u.name, avatar: u.avatar, discord_id: u.discordId, last_seen: new Date().toISOString() }, isAdmin ? { is_admin: true } : {}));
    },
    async isAdmin(uid) { return !!(profiles.get(uid) || {}).is_admin; },
    async loadSave(uid) { await Promise.resolve(); const r = saves.get(uid); return r ? { data: JSON.parse(JSON.stringify(r.data)), version: r.version } : null; },
    async saveSave(uid, S, version, sum) {
      await new Promise((r) => setImmediate(r)); // laisse d'autres requêtes s'intercaler, comme en vrai
      const r = saves.get(uid);
      if (version < 0) { if (r) return false; saves.set(uid, { data: JSON.parse(JSON.stringify(S)), version: 0, sum }); return true; }
      if (!r || r.version !== version) return false;
      saves.set(uid, { data: JSON.parse(JSON.stringify(S)), version: version + 1, sum }); return true;
    },
    async getCards() { return cards; },
    async useCode(code, uid) { const c = codes.get(code); if (!c || c.used) return false; c.used = true; c.by = uid; return true; },
    async unuseCode(code) { const c = codes.get(code); if (c) c.used = false; },
    async deleteUser(uid) { saves.delete(uid); profiles.delete(uid); for (let i = friends.length - 1; i >= 0; i--) if (friends[i].a === uid || friends[i].b === uid) friends.splice(i, 1); },

    async getProfile(id) { return profiles.get(id) || null; },
    async getProfiles(ids) { const m = {}; ids.forEach((i) => { if (profiles.has(i)) m[i] = profiles.get(i); }); return m; },
    async getSummaries(ids) { const m = {}; ids.forEach((i) => { const s = sumOf(i); if (s) m[i] = s; }); return m; },
    _ranked(sort) {
      return [...saves.keys()].filter((id) => { const s = sumOf(id); return s && !s.hidden && s.owned > 0 && profiles.has(id); })
        .sort((x, y) => sumOf(y)[sort] - sumOf(x)[sort] || (x < y ? -1 : 1));
    },
    async leaderboard(sort, limit, offset = 0) {
      return this._ranked(sort).slice(offset, offset + limit).map((id) => Object.assign({ id, name: profiles.get(id).name, avatar: '' }, sumOf(id)));
    },
    async rankOf(sort, v, uid) { return this._ranked(sort).indexOf(uid) + 1 || null; },
    async rankedCount() { return this._ranked('score').length; },
    async searchProfiles(q, uid) {
      return [...profiles.values()].filter((p) => p.user_id !== uid && p.name.toLowerCase().includes(q.toLowerCase()) && !(sumOf(p.user_id) || {}).hidden)
        .map((p) => ({ id: p.user_id, name: p.name, avatar: '', owned: (sumOf(p.user_id) || {}).owned || 0, score: (sumOf(p.user_id) || {}).score || 0 }));
    },
    async listFriends(uid) { return friends.filter((f) => f.a === uid || f.b === uid).map((f) => ({ a: f.a, b: f.b, status: f.status })); },
    async getFriendRow(x, y) { const f = frow(x, y); return f ? { a: f.a, b: f.b, status: f.status } : null; },
    async addFriendRow(a, b) { friends.push({ a, b, status: 'pending' }); },
    async setFriendStatus(a, b, status) { const f = friends.find((r) => r.a === a && r.b === b); if (f) f.status = status; },
    async deleteFriend(x, y) { const f = frow(x, y); if (f) friends.splice(friends.indexOf(f), 1); },
    async ensureShareId(uid) { const p = profiles.get(uid); if (!p.share_id) p.share_id = 'share' + uid.toLowerCase() + 'xyz'; return p.share_id; },
    async getProfileByShare(sid) { const p = [...profiles.values()].find((q) => q.share_id === sid); return p ? { user_id: p.user_id, name: p.name, avatar: '' } : null; },

    async recentSeen(n) { return [...profiles.values()].filter((p) => p.last_seen).sort((x, y) => Date.parse(y.last_seen) - Date.parse(x.last_seen)).slice(0, n); },
    async allProfiles() { return [...profiles.values()]; },
    async allSaves() { return [...saves.entries()].map(([user_id, r]) => ({ user_id, data: JSON.parse(JSON.stringify(r.data)) })); },
    async listPlayers() {
      return [...profiles.values()].map((p) => { const s = sumOf(p.user_id) || {}; return { id: p.user_id, name: p.name, avatar: '', discordId: p.discord_id || '', createdAt: p.created_at, lastSeen: p.last_seen, isAdmin: !!p.is_admin, owned: s.owned || 0, mythics: s.mythics || 0, score: s.score || 0, opened: s.opened || 0 }; });
    },
    async codeStats() { return { total: codes.size, used: [...codes.values()].filter((c) => c.used).length }; },
    async setAdminFlag(uid, v) { const p = profiles.get(uid); if (p) p.is_admin = !!v; },
    async logAdmin(e) { logs.push(Object.assign({ at: new Date(1e12).toISOString() }, e)); },
    async recentLogs(n) { return logs.slice().reverse().slice(0, n); },
  };
};
