// Base de données en mémoire pour tester l'API sans Supabase.
module.exports = function fakeDb(cards, validCodes) {
  const saves = new Map(), profiles = new Map(), codes = new Map(validCodes.map((c) => [c, { used: false }]));
  const users = { tokA: { id: 'A', discordId: '111', name: 'Alice', avatar: '' }, tokB: { id: 'B', discordId: '222', name: 'Bob', avatar: '' } };
  return {
    saves, codes, profiles,
    async getUser(t) { return users[t] || null; },
    async upsertProfile(u, isAdmin) { const p = profiles.get(u.id) || {}; profiles.set(u.id, Object.assign(p, { name: u.name }, isAdmin ? { is_admin: true } : {})); },
    async isAdmin(uid) { return !!(profiles.get(uid) || {}).is_admin; },
    async loadSave(uid) { await Promise.resolve(); const r = saves.get(uid); return r ? { data: JSON.parse(JSON.stringify(r.data)), version: r.version } : null; },
    async saveSave(uid, S, version) {
      await new Promise((r) => setImmediate(r)); // laisse d'autres requêtes s'intercaler, comme en vrai
      const r = saves.get(uid);
      if (version < 0) { if (r) return false; saves.set(uid, { data: JSON.parse(JSON.stringify(S)), version: 0 }); return true; }
      if (!r || r.version !== version) return false;
      saves.set(uid, { data: JSON.parse(JSON.stringify(S)), version: version + 1 }); return true;
    },
    async getCards() { return cards; },
    async useCode(code, uid) { const c = codes.get(code); if (!c || c.used) return false; c.used = true; c.by = uid; return true; },
    async unuseCode(code) { const c = codes.get(code); if (c) c.used = false; },
    async deleteUser(uid) { saves.delete(uid); profiles.delete(uid); },
  };
};
