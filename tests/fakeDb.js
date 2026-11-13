// Base de données en mémoire pour tester l'API sans Supabase (mêmes méthodes que lib/supabaseDb.js).
module.exports = function fakeDb(cards, validCodes) {
  const saves = new Map(), profiles = new Map(), codes = new Map(validCodes.map((c) => [c, { used: false }]));
  const friends = [], logs = [], anns = [], drafts = [], notes = [], times = [];
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
      profiles.set(u.id, Object.assign(p, { name: p.custom_name || u.name, avatar: p.no_avatar ? '' : u.avatar, d_name: u.name, d_avatar: u.avatar, discord_id: u.discordId, last_seen: new Date().toISOString() }, isAdmin ? { is_admin: true } : {}));
    },
    async setIdentity(uid, customName, noAvatar) {
      const p = profiles.get(uid); if (!p) return null;
      Object.assign(p, { custom_name: customName || null, no_avatar: !!noAvatar, name: customName || p.d_name || p.name, avatar: noAvatar ? '' : (p.d_avatar || '') });
      return { id: uid, name: p.name, avatar: p.avatar, custom: p.custom_name || '', noAvatar: p.no_avatar };
    },
    async nameTaken(name, uid) { return [...profiles.values()].some((q) => q.user_id !== uid && String(q.name).toLowerCase() === name.toLowerCase()); },
    async isAdmin(uid) { return !!(profiles.get(uid) || {}).is_admin; },
    async isJury(uid) { return !!(profiles.get(uid) || {}).is_jury; },
    async setJury(uid, on) { const p = profiles.get(uid); if (p) p.is_jury = !!on; },
    async listJurors() { return [...profiles.values()].filter((p) => p.is_jury).map((p) => ({ id: p.user_id, name: p.name, avatar: p.avatar || '' })); },
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
    async getProfileByDiscord(did) { const p = [...profiles.values()].find((q) => q.discord_id === String(did)); return p ? { user_id: p.user_id, name: p.name, avatar: '' } : null; },
    async getProfileByShare(sid) { const p = [...profiles.values()].find((q) => q.share_id === sid); return p ? { user_id: p.user_id, name: p.name, avatar: '' } : null; },

    async recentSeen(n) { return [...profiles.values()].filter((p) => p.last_seen).sort((x, y) => Date.parse(y.last_seen) - Date.parse(x.last_seen)).slice(0, n); },
    async allProfiles() { return [...profiles.values()]; },
    async allSaves() { return [...saves.entries()].map(([user_id, r]) => ({ user_id, data: JSON.parse(JSON.stringify(r.data)) })); },
    async listPlayers() {
      return [...profiles.values()].map((p) => { const s = sumOf(p.user_id) || {}; return { id: p.user_id, name: p.name, avatar: '', discordId: p.discord_id || '', createdAt: p.created_at, lastSeen: p.last_seen, isAdmin: !!p.is_admin, owned: s.owned || 0, mythics: s.mythics || 0, score: s.score || 0, opened: s.opened || 0 }; });
    },
    async codesByUser() { const m = {}; codes.forEach((c) => { if (c.used && c.by) m[c.by] = (m[c.by] || 0) + 1; }); return m; },
    async runsBoard() {
      const m = await this.codesByUser();
      return Object.keys(m).filter((id) => { const s = sumOf(id); return s && !s.hidden; })
        .map((id) => { const s = sumOf(id); return { id, runs: m[id], owned: s.owned || 0, mythics: s.mythics || 0, score: s.score || 0, opened: s.opened || 0 }; })
        .sort((a, b) => b.runs - a.runs || (a.id < b.id ? -1 : 1));
    },
    async periodBoard(period, key) {
      const kf = period === 'day' ? ['dk', 'd', 'dr'] : ['wk', 'w', 'wr'];
      return [...saves.entries()].filter(([id, r]) => { const s = sumOf(id); return s && !s.hidden && r.data.per && r.data.per[kf[0]] === key; })
        .map(([id, r]) => { const s = sumOf(id); return { id, score: r.data.per[kf[1]] || 0, runs: r.data.per[kf[2]] || 0, owned: s.owned || 0, mythics: s.mythics || 0, opened: s.opened || 0 }; });
    },
    // ----- temps de la map -----
    times,
    async addTime(row) { const id = times.length + 1; times.push(Object.assign({ id, status: 'pending', paid: false, hide_run: false, created_at: new Date(1e12 + id * 1000).toISOString() }, row)); return id; },
    async listTimes(f) { return times.filter((t) => (!f.week || t.week === f.week) && (!f.status || t.status === f.status) && (!f.user || t.user_id === f.user)).map((t) => Object.assign({}, t)).reverse(); },
    async timesToSettle(cur) { return times.filter((t) => t.week < cur && (t.status === 'pending' || (t.status === 'accepted' && !t.paid))).map((t) => Object.assign({}, t)); },
    async getTime(id) { const t = times.find((x) => x.id === id); return t ? Object.assign({}, t) : null; },
    async updateTime(id, f) { Object.assign(times.find((x) => x.id === id), f); },
    async deleteTime(id) { const i = times.findIndex((x) => x.id === id); if (i >= 0) times.splice(i, 1); },
    async claimTimePaid(id) { await Promise.resolve(); const t = times.find((x) => x.id === id); if (!t || t.paid) return false; t.paid = true; return true; },
    async unclaimTimePaid(id) { const t = times.find((x) => x.id === id); if (t) t.paid = false; },
    async settleWeek(week) { times.forEach((t) => { if (t.week === week && t.status === 'accepted') t.paid = true; }); },
    async recordTime(device) { const a = times.filter((t) => t.status === 'accepted' && t.device === device).sort((x, y) => x.ms - y.ms || x.id - y.id); return a[0] ? Object.assign({}, a[0]) : null; },
    async countPendingTimes() { return times.filter((t) => t.status === 'pending').length; },
    async getEquipped(ids) { const m = {}; ids.forEach((i) => { const r = saves.get(i); if (r && r.data.title) m[i] = r.data.title; }); return m; },
    async titleStats() {
      const counts = {}; let total = 0;
      saves.forEach((r) => { if (!(r.data.opened > 0)) return; total++; Object.keys(r.data.titles || {}).forEach((k) => { counts[k] = (counts[k] || 0) + 1; }); });
      return { counts, total };
    },
    async userRuns(uid) { let n = 0; codes.forEach((c) => { if (c.used && c.by === uid) n++; }); return n; },
    async codeStats() { return { total: codes.size, used: [...codes.values()].filter((c) => c.used).length }; },
    async setAdminFlag(uid, v) { const p = profiles.get(uid); if (p) p.is_admin = !!v; },
    async listDrafts() { return drafts.slice().reverse(); },
    async getDraft(id) { return drafts.find((d) => d.id === id) || null; },
    async addDraft(row) { drafts.push(Object.assign({ id: drafts.length + 100, votes: {}, created_at: new Date(1e12).toISOString() }, row)); },
    async notify(uid, text) { notes.push({ id: notes.length + 1, user_id: uid, text, created_at: new Date().toISOString() }); },
    async listNotes(uid) { return notes.filter((n) => n.user_id === uid).reverse(); },
    async readNotes(uid, ids) { for (let i = notes.length - 1; i >= 0; i--) if (notes[i].user_id === uid && ids.includes(notes[i].id)) notes.splice(i, 1); },
    async updateDraft(id, f) { const d = drafts.find((x) => x.id === id); if (d) Object.assign(d, f); },
    async deleteDraft(id) { const i = drafts.findIndex((d) => d.id === id); if (i >= 0) drafts.splice(i, 1); },
    async setDraftVotes(id, votes) { const d = drafts.find((x) => x.id === id); if (d) d.votes = votes; },
    async addCard(row) { const id = cards.length; cards[id] = [row.name, row.cat, row.rarity, row.descr || '', row.img || '']; return id; },
    async deleteCard(id) { cards.length = id; },
    async updateCard(id, f) { const c = cards[id]; if (f.cat !== undefined) c[1] = f.cat; if (f.rarity !== undefined) c[2] = f.rarity; if (f.retired !== undefined) c[5] = f.retired ? 1 : 0; if (f.name !== undefined) c[0] = f.name; if (f.descr !== undefined) c[3] = f.descr; if (f.img !== undefined) c[4] = f.img; },
    async uploadImage(buf) { return 'https://x.test/storage/v1/object/public/cards/c' + buf.length + '.webp'; },
    async listAnnouncements(n) { return anns.slice().reverse().slice(0, n).map((a) => ({ id: a.id, text: a.text, created_at: a.created_at })); },
    async addAnnouncement(text) { anns.push({ id: anns.length + 1, text, created_at: new Date(1e12).toISOString() }); },
    async deleteAnnouncement(id) { const i = anns.findIndex((a) => a.id === id); if (i >= 0) anns.splice(i, 1); },
    async logAdmin(e) { logs.push(Object.assign({ at: new Date(1e12).toISOString() }, e)); },
    async recentLogs(n) { return logs.slice().reverse().slice(0, n); },
  };
};
