// Gestionnaire unique de l'API de jeu. La base de données est injectée (db) pour pouvoir tester sans Supabase.
const crypto = require('crypto');
const C = require('./config');
const G = require('./game');

const rand = () => crypto.randomInt(0, 1e9) / 1e9;
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizeCode(raw) { return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function codeFormatOk(c) { return c.length === 8 && [...c].every((ch) => ALPH.includes(ch)); }

function publicConfig() {
  return { HOUR: C.HOUR, MAXSTOCK: C.MAXSTOCK, RAR: C.RAR, PACKS: C.PACKS, WH: C.WH, SCORE: C.SCORE };
}

const RANK_SORTS = ['score', 'owned', 'mythics', 'opened'];
const EMPTY_SUM = { owned: 0, mythics: 0, score: 0, opened: 0, hidden: false };

// Données publiques d'une collection partagée par lien (sans connexion). null si le lien n'existe pas.
async function publicShare(db, sid) {
  if (!/^[a-z0-9]{6,16}$/.test(String(sid || ''))) return null;
  const p = await db.getProfileByShare(sid);
  if (!p) return null;
  const row = await db.loadSave(p.user_id);
  const S = G.normalizeState(row ? row.data : {}, Date.now());
  const cards = await db.getCards();
  const sum = G.summary(S, cards);
  return { name: p.name, avatar: p.avatar || '', owned: sum.owned, mythics: sum.mythics, score: sum.score, opened: sum.opened, col: S.col, cards };
}

function createHandler(db, opts = {}) {
  const adminIds = (opts.adminIds || '').split(',').map((s) => s.trim()).filter(Boolean);
  const now = opts.now || (() => Date.now());
  const boardTop = opts.boardTop || 20;

  // Lit l'état, applique fn, enregistre avec contrôle de version (évite les doubles dépenses en cas de requêtes simultanées).
  async function withState(uid, fn) {
    const allCards = await db.getCards();
    for (let attempt = 0; attempt < 5; attempt++) {
      let row = await db.loadSave(uid);
      let S, version;
      if (!row) { S = G.newState(now()); version = -1; } else { S = G.normalizeState(row.data, now()); version = row.version; }
      G.regen(S, now());
      const extra = await fn(S);
      if (await db.saveSave(uid, S, version, G.summary(S, allCards))) return { S, extra };
    }
    throw new G.GameError('Serveur occupé, réessaie', 503);
  }


  // 'friend' | 'sent' (j'ai invité) | 'received' (il m'a invité) | 'none'
  async function relation(uid, other) {
    const r = await db.getFriendRow(uid, other);
    if (!r) return 'none';
    if (r.status === 'accepted') return 'friend';
    return r.a === uid ? 'sent' : 'received';
  }

  async function friendsOverview(uid) {
    const rows = await db.listFriends(uid);
    const others = rows.map((r) => (r.a === uid ? r.b : r.a));
    const [sums, profs] = await Promise.all([db.getSummaries(others), db.getProfiles(others)]);
    const accepted = rows.filter((r) => r.status === 'accepted').map((r) => (r.a === uid ? r.b : r.a));
    const noPres = {};
    await Promise.all(accepted.map(async (id) => { const sv = await db.loadSave(id); if (sv && sv.data && sv.data.hidep) noPres[id] = true; }));
    const mk = (r) => {
      const id = r.a === uid ? r.b : r.a, p = profs[id] || {}, s = sums[id] || EMPTY_SUM;
      return { id, name: p.name || 'Joueur', avatar: p.avatar || '', owned: s.owned, mythics: s.mythics, score: s.score, opened: s.opened, lastSeen: r.status === 'accepted' && !noPres[id] ? (p.last_seen || null) : undefined };
    };
    return {
      now: now(),
      friends: rows.filter((r) => r.status === 'accepted').map(mk).sort((x, y) => y.score - x.score),
      incoming: rows.filter((r) => r.status === 'pending' && r.b === uid).map(mk),
      outgoing: rows.filter((r) => r.status === 'pending' && r.a === uid).map(mk),
    };
  }

  const dayMs = 86400000;
  async function adminApi(a, body, uid, isOwner, cards) {
    const ok = (json) => ({ status: 200, json });
    const storeImage = async (data) => {
      if (!data) return '';
      const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(data));
      if (!m) throw new G.GameError('Image invalide (png, jpg ou webp)');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 600000) throw new G.GameError('Image trop lourde (600 Ko maximum)');
      return db.uploadImage(buf, 'image/' + m[1]);
    };
    const guardTarget = async (id) => {
      const p = await db.getProfile(id);
      if (!p) throw new G.GameError('Joueur introuvable', 404);
      if (!isOwner && adminIds.includes(p.discord_id || '')) throw new G.GameError('Compte propriétaire protégé', 403);
      return p;
    };
    switch (a) {
      case 'aonline': {
        const rows = await db.recentSeen(150);
        return ok({ now: now(), rows: rows.map((p) => ({ id: p.user_id, name: p.name, avatar: p.avatar || '', lastSeen: p.last_seen || null, isAdmin: !!p.is_admin })) });
      }
      case 'aplayers': {
        const q = String(body.q || '').trim().toLowerCase().slice(0, 40);
        const sort = ['lastSeen', 'score', 'createdAt', 'name', 'opened'].includes(body.sort) ? body.sort : 'lastSeen';
        let rows = await db.listPlayers();
        const total = rows.length;
        if (q) rows = rows.filter((r) => (r.name || '').toLowerCase().includes(q) || (r.discordId || '') === q);
        const date = (k) => (x, y) => (Date.parse(y[k]) || 0) - (Date.parse(x[k]) || 0);
        const cmp = { name: (x, y) => String(x.name).localeCompare(String(y.name), 'fr'), score: (x, y) => (y.score || 0) - (x.score || 0), opened: (x, y) => (y.opened || 0) - (x.opened || 0), lastSeen: date('lastSeen'), createdAt: date('createdAt') }[sort];
        rows.sort(cmp);
        return ok({ total, rows: rows.slice(0, 100) });
      }
      case 'aplayer': {
        const p = await db.getProfile(String(body.id || ''));
        if (!p) throw new G.GameError('Joueur introuvable', 404);
        const row = await db.loadSave(p.user_id);
        const T = G.normalizeState(row ? row.data : {}, now());
        const sum = G.summary(T, cards);
        return ok({ player: { id: p.user_id, name: p.name, avatar: p.avatar || '', discordId: p.discord_id || '', createdAt: p.created_at || null, lastSeen: p.last_seen || null, isAdmin: !!p.is_admin, isOwner: adminIds.includes(p.discord_id || ''), summary: sum },
          state: { money: T.money, stock: T.stock, wp: T.wp, col: T.col, pulled: T.pulled, opened: T.opened } });
      }
      case 'apact': {
        const id = String(body.id || '');
        await guardTarget(id);
        const r = await withState(id, (T) => { G.playerAction(T, cards, body.a, body.v, +body.i, now()); return {}; });
        await db.logAdmin({ admin_id: uid, target_id: id, action: String(body.a), detail: { v: body.v ?? null, i: body.i ?? null } });
        return ok({ state: { money: r.S.money, stock: r.S.stock, wp: r.S.wp, col: r.S.col, pulled: r.S.pulled, opened: r.S.opened }, summary: G.summary(r.S, cards) });
      }
      case 'asetadmin': {
        if (!isOwner) throw new G.GameError('Seul le propriétaire peut nommer des admins', 403);
        const p = await db.getProfile(String(body.id || ''));
        if (!p) throw new G.GameError('Joueur introuvable', 404);
        if (adminIds.includes(p.discord_id || '')) throw new G.GameError('Le propriétaire est toujours admin');
        await db.setAdminFlag(p.user_id, !!body.v);
        await db.logAdmin({ admin_id: uid, target_id: p.user_id, action: body.v ? 'admin+' : 'admin-', detail: {} });
        return ok({ isAdmin: !!body.v });
      }
      case 'acards': {
        const [drafts, profs] = await Promise.all([db.listDrafts(), db.allProfiles()]);
        const nm = {}; profs.forEach((p) => { nm[p.user_id] = p.name; });
        return ok({ drafts: drafts.map((d) => ({ id: d.id, name: d.name, cat: d.cat, rarity: d.rarity, descr: d.descr || '', img: d.img || '', by: nm[d.created_by] || '?', at: d.created_at,
          votes: Object.keys(d.votes || {}).map((u) => ({ name: nm[u] || '?', rarity: d.votes[u] })), mine: (d.votes || {})[uid] === undefined ? null : d.votes[uid] })) });
      }
      case 'acardnew': {
        const name = String(body.name || '').trim().slice(0, 40), cat = +body.cat, rarity = +body.rarity, descr = String(body.descr || '').trim().slice(0, 140);
        if (!name) throw new G.GameError('Donne un nom à la carte');
        if (![0, 1, 2, 3].includes(cat)) throw new G.GameError('Catégorie invalide');
        if (![0, 1, 2, 3, 4, 5].includes(rarity)) throw new G.GameError('Rareté invalide');
        const pub = body.status === 'public';
        if (pub && !isOwner) throw new G.GameError('Seul le propriétaire peut publier une carte', 403);
        if (cards.some((c) => c && c[0].toLowerCase() === name.toLowerCase())) throw new G.GameError('Une carte porte déjà ce nom');
        const img = await storeImage(body.image);
        if (pub) { const id = await db.addCard({ name, cat, rarity, descr, img }); return ok({ ok: true, id, public: true }); }
        await db.addDraft({ name, cat, rarity, descr, img, created_by: uid });
        return ok({ ok: true, public: false });
      }
      case 'acardvote': {
        const d = await db.getDraft(+body.id);
        if (!d) throw new G.GameError('Carte introuvable', 404);
        const r = +body.rarity;
        if (![0, 1, 2, 3, 4, 5].includes(r)) throw new G.GameError('Rareté invalide');
        const votes = Object.assign({}, d.votes || {}); votes[uid] = r;
        await db.setDraftVotes(d.id, votes);
        return ok({ ok: true });
      }
      case 'acardpub': {
        if (!isOwner) throw new G.GameError('Seul le propriétaire peut publier une carte', 403);
        const d = await db.getDraft(+body.id);
        if (!d) throw new G.GameError('Carte introuvable', 404);
        const rarity = body.rarity === undefined ? d.rarity : +body.rarity;
        if (![0, 1, 2, 3, 4, 5].includes(rarity)) throw new G.GameError('Rareté invalide');
        if (cards.some((c) => c && c[0].toLowerCase() === String(d.name).toLowerCase())) throw new G.GameError('Une carte porte déjà ce nom');
        const id = await db.addCard({ name: d.name, cat: d.cat, rarity, descr: d.descr || '', img: d.img || '' });
        await db.deleteDraft(d.id);
        return ok({ ok: true, id });
      }
      case 'acardpubmany': {
        if (!isOwner) throw new G.GameError('Seul le propriétaire peut publier une carte', 403);
        const items = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
        let done = 0; const skipped = [];
        for (const it of items) {
          const d = await db.getDraft(+it.id);
          const rarity = it.rarity === undefined ? (d && d.rarity) : +it.rarity;
          if (!d || ![0, 1, 2, 3, 4, 5].includes(rarity)) { skipped.push(d ? d.name : '?'); continue; }
          if (cards.some((c) => c && c[0].toLowerCase() === String(d.name).toLowerCase())) { skipped.push(d.name); continue; }
          await db.addCard({ name: d.name, cat: d.cat, rarity, descr: d.descr || '', img: d.img || '' });
          await db.deleteDraft(d.id);
          done++;
        }
        return ok({ ok: true, done, skipped });
      }
      case 'acarddel': {
        const d = await db.getDraft(+body.id);
        if (!d) throw new G.GameError('Carte introuvable', 404);
        if (!isOwner && d.created_by !== uid) throw new G.GameError('Tu ne peux supprimer que tes propositions', 403);
        await db.deleteDraft(d.id);
        return ok({ ok: true });
      }
      case 'acardedit': {
        if (!isOwner) throw new G.GameError('Réservé au propriétaire', 403);
        const id = +body.id;
        if (!cards[id]) throw new G.GameError('Carte inconnue', 404);
        const f = {};
        if (body.name !== undefined) {
          const name = String(body.name).trim().slice(0, 40);
          if (!name) throw new G.GameError('Nom vide');
          if (cards.some((c, i) => i !== id && c && c[0].toLowerCase() === name.toLowerCase())) throw new G.GameError('Une carte porte déjà ce nom');
          f.name = name;
        }
        if (body.cat !== undefined) { if (![0, 1, 2, 3].includes(+body.cat)) throw new G.GameError('Catégorie invalide'); f.cat = +body.cat; }
        if (body.rarity !== undefined) { if (![0, 1, 2, 3, 4, 5].includes(+body.rarity)) throw new G.GameError('Rareté invalide'); f.rarity = +body.rarity; }
        if (body.descr !== undefined) f.descr = String(body.descr).trim().slice(0, 140);
        if (body.image) f.img = await storeImage(body.image);
        await db.updateCard(id, f);
        return ok({ ok: true });
      }
      case 'acardretire': {
        if (!isOwner) throw new G.GameError('Réservé au propriétaire', 403);
        const id = +body.id;
        if (!cards[id]) throw new G.GameError('Carte inconnue', 404);
        await db.updateCard(id, { retired: !!body.retired });
        return ok({ ok: true });
      }
      case 'acardremove': {
        if (!isOwner) throw new G.GameError('Réservé au propriétaire', 403);
        const id = +body.id;
        if (!cards[id]) throw new G.GameError('Carte inconnue', 404);
        if (id !== cards.length - 1) throw new G.GameError('Seule la dernière carte ajoutée peut être supprimée pour de bon (les numéros des autres cartes sont utilisés par les collections). Utilise « Retirer des packs ».');
        const holders = (await db.allSaves()).filter((r) => r.data && ((r.data.col || {})[id] > 0 || (r.data.pulled || {})[id] > 0)).length;
        if (holders) throw new G.GameError(holders + ' joueur(s) possèdent cette carte : utilise « Retirer des packs » à la place.');
        await db.updateCard(id, { retired: true });
        for (const r of await db.allSaves()) await withState(r.user_id, (S) => { G.purgeCard(S, id); });
        await db.deleteCard(id);
        return ok({ ok: true });
      }
      case 'apost': {
        const text = String(body.text || '').trim().slice(0, 300);
        if (!text) throw new G.GameError('Annonce vide');
        await db.addAnnouncement(text);
        return ok({ ok: true });
      }
      case 'adelann': { await db.deleteAnnouncement(+body.id); return ok({ ok: true }); }
      case 'alog': {
        const [logs, profs] = await Promise.all([db.recentLogs(60), db.allProfiles()]);
        const nm = {}; profs.forEach((p) => { nm[p.user_id] = p.name; });
        return ok({ rows: logs.map((l) => ({ at: l.at, admin: nm[l.admin_id] || '?', target: nm[l.target_id] || '(compte supprimé)', action: l.action, detail: l.detail })) });
      }
      case 'aowners': {
        const cid = +body.card;
        if (!cards[cid]) throw new G.GameError('Carte inconnue');
        const [saves, profs] = await Promise.all([db.allSaves(), db.allProfiles()]);
        const nm = {}; profs.forEach((p) => { nm[p.user_id] = p; });
        const rows = [];
        saves.forEach((r) => {
          const d = r.data || {}, n = (d.col && d.col[cid]) || 0, pl = (d.pulled && d.pulled[cid]) || 0;
          if ((n > 0 || pl > 0) && nm[r.user_id]) rows.push({ id: r.user_id, name: nm[r.user_id].name, avatar: nm[r.user_id].avatar || '', count: n, pulled: pl });
        });
        rows.sort((x, y) => y.count - x.count || y.pulled - x.pulled);
        return ok({ card: cid, rows: rows.slice(0, 200) });
      }
      case 'aover': {
        const [profs, saves, codes] = await Promise.all([db.allProfiles(), db.allSaves(), db.codeStats()]);
        const t = now(), nm = {};
        profs.forEach((p) => { nm[p.user_id] = p; });
        const ts = (x) => (x ? Date.parse(x) || 0 : 0);
        const users = {
          total: profs.length,
          new24h: profs.filter((p) => t - ts(p.created_at) < dayMs).length,
          new7d: profs.filter((p) => t - ts(p.created_at) < 7 * dayMs).length,
          active24h: profs.filter((p) => t - ts(p.last_seen) < dayMs).length,
          active7d: profs.filter((p) => t - ts(p.last_seen) < 7 * dayMs).length,
          admins: profs.filter((p) => p.is_admin).length,
        };
        const nC = cards.length;
        const owners = Array(nC).fill(0), pulled = Array(nC).fill(0), copies = Array(nC).fill(0), mythOwn = {};
        const tot = { opened: 0, money: 0, stock: 0, copies: 0, pulled: 0, wp: {} };
        saves.forEach((r) => {
          if (!nm[r.user_id]) return;
          const d = r.data || {};
          tot.opened += d.opened || 0; tot.money += d.money || 0; tot.stock += d.stock || 0;
          Object.keys(d.wp || {}).forEach((g) => { tot.wp[g] = (tot.wp[g] || 0) + (d.wp[g] || 0); });
          Object.keys(d.col || {}).forEach((k) => {
            const n = d.col[k] || 0, c = cards[k]; if (!c || n <= 0) return;
            owners[k]++; copies[k] += n; tot.copies += n;
            if (c[2] === 5) (mythOwn[k] = mythOwn[k] || []).push({ id: r.user_id, name: nm[r.user_id].name, count: n });
          });
          Object.keys(d.pulled || {}).forEach((k) => { if (cards[k]) { pulled[k] += d.pulled[k] || 0; tot.pulled += d.pulled[k] || 0; } });
        });
        const byRarity = [0, 1, 2, 3, 4, 5].map((r) => ({ r, cards: 0, pulled: 0, copies: 0 }));
        const cardRows = [];
        cards.forEach((c, i) => {
          if (!c) return;
          byRarity[c[2]].cards++; byRarity[c[2]].pulled += pulled[i]; byRarity[c[2]].copies += copies[i];
          cardRows.push({ id: i, owners: owners[i], pulled: pulled[i], copies: copies[i] });
        });
        const mythics = cards.map((c, i) => (c && c[2] === 5 ? { id: i, owners: (mythOwn[i] || []).sort((x, y) => y.count - x.count) } : null)).filter(Boolean);
        const recent = profs.slice().sort((x, y) => ts(y.created_at) - ts(x.created_at)).slice(0, 10).map((p) => ({ id: p.user_id, name: p.name, avatar: p.avatar || '', createdAt: p.created_at || null }));
        return ok({ users, totals: tot, byRarity, cards: cardRows, mythics, recent, codes });
      }
    }
    throw new G.GameError('Action inconnue');
  }

  return async function handle(token, body) {
    // Aperçu public pour la page d'accueil (avant connexion) : seulement la liste des cartes, aucune donnée de joueur.
    if (body && body.action === 'preview') return { status: 200, json: { cards: await db.getCards() } };
    if (body && body.action === 'pubshare') {
      const out = await publicShare(db, body.sid);
      return out ? { status: 200, json: out } : { status: 404, json: { error: 'Lien introuvable' } };
    }
    const user = await db.getUser(token);
    if (!user) return { status: 401, json: { error: 'Connecte-toi avec Discord' } };
    const uid = user.id;
    const isOwner = adminIds.includes(user.discordId || '');
    const isAdmin = isOwner;
    await db.upsertProfile(user, isAdmin);
    const admin = isAdmin || (await db.isAdmin(uid));
    const cards = await db.getCards();
    const a = body && body.action;
    let result;

    try {
      switch (a) {
        case 'me': {
          result = await withState(uid, () => ({}));
          return { status: 200, json: { state: result.S, cards, config: publicConfig(), isAdmin: admin, isOwner, profile: { id: uid, name: user.name, avatar: user.avatar } } };
        }
        case 'open': {
          result = await withState(uid, (S) => {
            if (body.kind === 'free') return { cards: G.openFree(S, cards, rand, now()) };
            if (body.kind === 'buy') return { cards: G.buyPack(S, cards, +body.g, rand) };
            throw new G.GameError('Type de pack inconnu');
          });
          break;
        }
        case 'sell': {
          result = await withState(uid, (S) => ({ gain: body.all ? G.sellAll(S, cards) : G.sellOne(S, cards, +body.i) }));
          break;
        }
        case 'openwp': {
          result = await withState(uid, (S) => ({ cards: G.openWaiting(S, cards, +body.g, rand) }));
          break;
        }
        case 'prefs': {
          result = await withState(uid, (S) => { G.sanitizePrefs(S, body.prefs || {}, cards); return {}; });
          return { status: 200, json: { ok: true } };
        }
        case 'code': {
          const code = normalizeCode(body.code);
          let locked = 0;
          // 1) verrou anti-devinette
          result = await withState(uid, (S) => { if (S.lock && now() < S.lock) locked = Math.ceil((S.lock - now()) / 1000); return {}; });
          if (locked) return { status: 429, json: { error: 'Trop d\'essais, attends ' + locked + ' s' } };
          // 2) consommation atomique et définitive du code
          const used = codeFormatOk(code) && (await db.useCode(code, uid));
          if (!used) {
            let lockMsg = null;
            await withState(uid, (S) => {
              S.bad = (S.bad || 0) + 1;
              if (S.bad >= C.BAD_TRIES) { S.bad = 0; S.lock = now() + C.LOCK_MS; lockMsg = 'Trop d\'essais, attends ' + Math.ceil(C.LOCK_MS / 1000) + ' s'; }
              return {};
            });
            return { status: 400, json: { error: lockMsg || 'Code invalide ou déjà utilisé' } };
          }
          // 3) la roue décide
          try {
            result = await withState(uid, (S) => { S.bad = 0; return { res: G.spinForReward(S, rand) }; });
          } catch (e) { await db.unuseCode(code); throw e; }
          break;
        }
        case 'admin': {
          if (!admin) return { status: 403, json: { error: 'Réservé à l\'administrateur' } };
          result = await withState(uid, (S) => G.adminAction(S, cards, body.a, body.v, +body.i, rand, now()));
          break;
        }

        // ---------- communauté ----------
        case 'board': {
          const sort = RANK_SORTS.includes(body.sort) ? body.sort : 'score';
          const top = boardTop;
          const rows = (await db.leaderboard(sort, top, 0)).map((r, i) => Object.assign({ rank: i + 1 }, r));
          const m = (await db.getSummaries([uid]))[uid] || EMPTY_SUM;
          let rank = null, near = null;
          if (!m.hidden && m.owned > 0) rank = await db.rankOf(sort, m[sort], uid);
          // Hors du haut du classement : le joueur juste au-dessus, lui, et celui juste en dessous
          if (rank && rank > top) {
            const offset = Math.max(top, rank - 2);
            near = (await db.leaderboard(sort, rank - offset + 1, offset)).map((r, i) => Object.assign({ rank: offset + i + 1 }, r));
          }
          return { status: 200, json: { sort, rows, near, total: await db.rankedCount(), me: Object.assign({ rank }, m) } };
        }
        case 'search': {
          const q = String(body.q || '').trim().slice(0, 40);
          if (q.length < 2) return { status: 200, json: { rows: [] } };
          return { status: 200, json: { rows: await db.searchProfiles(q, uid) } };
        }
        case 'friends': return { status: 200, json: await friendsOverview(uid) };
        case 'fadd': {
          const id = String(body.id || '');
          if (!id || id === uid) throw new G.GameError('Joueur invalide');
          if (!(await db.getProfile(id))) throw new G.GameError('Joueur introuvable', 404);
          const row = await db.getFriendRow(uid, id);
          if (row && row.status === 'accepted') return { status: 200, json: { rel: 'friend' } };
          if (row && row.a === id) { await db.setFriendStatus(id, uid, 'accepted'); return { status: 200, json: { rel: 'friend' } }; }
          if (row) return { status: 200, json: { rel: 'sent' } };
          const all = await db.listFriends(uid);
          if (all.length >= 300) throw new G.GameError('Liste d\'amis pleine');
          if (all.filter((r) => r.status === 'pending' && r.a === uid).length >= 50) throw new G.GameError('Trop de demandes en attente');
          await db.addFriendRow(uid, id);
          return { status: 200, json: { rel: 'sent' } };
        }
        case 'faccept': {
          const id = String(body.id || '');
          const row = await db.getFriendRow(uid, id);
          if (!row || row.status !== 'pending' || row.b !== uid) throw new G.GameError('Aucune demande de ce joueur', 404);
          await db.setFriendStatus(id, uid, 'accepted');
          return { status: 200, json: { rel: 'friend' } };
        }
        case 'fremove': {
          await db.deleteFriend(uid, String(body.id || ''));
          return { status: 200, json: { rel: 'none' } };
        }
        case 'profile': {
          const id = String(body.id || '');
          const p = await db.getProfile(id);
          if (!p) throw new G.GameError('Joueur introuvable', 404);
          const sum = (await db.getSummaries([id]))[id] || EMPTY_SUM;
          const rel = id === uid ? 'self' : await relation(uid, id);
          const canSee = rel === 'self' || rel === 'friend' || admin;
          if (sum.hidden && !canSee) throw new G.GameError('Ce profil est privé', 403);
          const out = { id, name: p.name, avatar: p.avatar || '', owned: sum.owned, mythics: sum.mythics, score: sum.score, opened: sum.opened, hidden: sum.hidden, rel, since: p.created_at || null };
          if (!sum.hidden && sum.owned > 0) out.rank = await db.rankOf('score', sum.score, id);
          if (canSee) {
            const row = await db.loadSave(id);
            const T = G.normalizeState(row ? row.data : {}, now());
            out.col = T.col; out.team = T.team;
          }
          return { status: 200, json: { profile: out } };
        }
        // battement de coeur : upsertProfile (ci-dessus) a déjà mis à jour « vu pour la dernière fois »
        case 'ping': {
          const fr = await db.listFriends(uid);
          const anns = await db.listAnnouncements(5);
          return { status: 200, json: { ok: true, reqs: fr.filter((r) => r.status === 'pending' && r.b === uid).length, ann: anns.map((x) => ({ id: x.id, text: x.text, at: x.created_at })) } };
        }
        case 'share': return { status: 200, json: { sid: await db.ensureShareId(uid) } };

        // ---------- administration (réservée) ----------
        case 'aover': case 'aonline': case 'aplayers': case 'aplayer': case 'apact': case 'aowners': case 'alog': case 'asetadmin': case 'apost': case 'adelann': case 'acards': case 'acardnew': case 'acardvote': case 'acardpub': case 'acarddel': case 'acardedit': case 'acardretire': case 'acardremove': case 'acardpubmany': {
          if (!admin) return { status: 403, json: { error: 'Réservé à l\'administrateur' } };
          return await adminApi(a, body, uid, isOwner, cards);
        }
        case 'delete': {
          await db.deleteUser(uid);
          return { status: 200, json: { ok: true } };
        }
        default:
          return { status: 400, json: { error: 'Action inconnue' } };
      }
    } catch (e) {
      if (e instanceof G.GameError) return { status: e.code, json: { error: e.message } };
      throw e;
    }
    return { status: 200, json: Object.assign({ state: result.S }, result.extra, body.nc !== undefined && +body.nc !== cards.length ? { catalog: cards } : {}) };
  };
}

module.exports = { createHandler, publicShare, normalizeCode, codeFormatOk };
