// Gestionnaire unique de l'API de jeu. La base de données est injectée (db) pour pouvoir tester sans Supabase.
const crypto = require('crypto');
const C = require('./config');
const G = require('./game');
const M = require('./missions');
const T = require('./times');

const rand = () => crypto.randomInt(0, 1e9) / 1e9;
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizeCode(raw) { return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function codeFormatOk(c) { return c.length === 8 && [...c].every((ch) => ALPH.includes(ch)); }

function publicConfig() {
  return { HOUR: C.HOUR, MAXSTOCK: C.MAXSTOCK, RAR: C.RAR, PACKS: C.PACKS, WH: C.WH, SCORE: C.SCORE, SPIN_PRICE: C.SPIN_PRICE };
}

const RANK_SORTS = ['score', 'owned', 'mythics', 'opened', 'runs'];
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


// ---------- Bot Discord : lecture seule d'un profil (équipe / tier list) + annonces ----------
const TIER_DEFAULT = ['Commun', 'Atypique', 'Rare', 'Épique', 'Légendaire', 'Mythique'];
async function botProfile(db, discordId, now) {
  if (!/^\d{5,25}$/.test(String(discordId || ''))) return null;
  const p = await db.getProfileByDiscord(String(discordId));
  if (!p) return null;
  const row = await db.loadSave(p.user_id);
  const S = G.normalizeState(row ? row.data : {}, now || Date.now());
  const cards = await db.getCards();
  const card = (i) => { const c = cards[i]; return c ? { name: c[0], cat: c[1], rarity: c[2], img: c[4] || '' } : null; };
  const team = S.team.map((i) => (i != null && S.col[i] > 0 && cards[i] && cards[i][1] <= 1 ? card(i) : null));
  const tiers = [];
  for (let cat = 0; cat < 5; cat++) {
    const map = cat === 4 ? S.jtier : S.tier, ord = (cat === 4 ? S.jord : S.tord) || [];
    const ok = (i) => cards[i] && (cat === 4 || (cards[i][1] === cat && S.col[i] > 0)) && map[i] != null && map[i] !== '' && '012345'.includes(map[i]);
    const ids = ord.filter(ok);
    Object.keys(map).map(Number).filter(ok).filter((i) => !ids.includes(i)).sort((a, b) => cards[b][2] - cards[a][2]).forEach((i) => ids.push(i));
    const rows = [5, 4, 3, 2, 1, 0].map((lv) => ({ level: lv, name: (S.tnames && S.tnames[lv]) || TIER_DEFAULT[lv], cards: ids.filter((i) => +map[i] === lv).map(card) }));
    tiers.push(rows);
  }
  const ex = S.extra || {};
  const extra = {};
  for (const k of ['coach', 'stade', 'club']) extra[k] = ex[k] != null && S.col[ex[k]] > 0 && cards[ex[k]] ? card(ex[k]) : null;
  const vitrine = (S.vitrine || []).filter((i) => i != null && S.col[i] > 0 && cards[i]).map(card);
  const RN = ['Commun', 'Atypique', 'Rare', 'Épique', 'Légendaire', 'Mythique'];
  const collection = [5, 4, 3, 2, 1, 0].map((r) => {
    const all = cards.map((c, i) => i).filter((i) => cards[i] && cards[i][2] === r && (!cards[i][5] || S.col[i] > 0));
    const mine = all.filter((i) => S.col[i] > 0).sort((a, b) => cards[a][0].localeCompare(cards[b][0], 'fr', { sensitivity: 'base', numeric: true }));
    return { rarity: r, name: RN[r], owned: mine.length, total: all.length, cards: mine.map((i) => Object.assign(card(i), { count: S.col[i] })) };
  });
  const live = cards.filter((c) => c && !c[5]);
  const best = (cats, n) => live.filter((c) => cats.includes(c[1])).map((c) => c[2] + 1).sort((x, y) => y - x).slice(0, n).reduce((x, y) => x + y, 0);
  const starsMax = best([0, 1], 12) + best([2], 1) + best([3], 1);
  return { name: p.name, avatar: p.avatar || '', team, extra, starsMax, tiers, vitrine, collection };
}

// Pseudo : 2 à 20 caractères (lettres, chiffres, espace, _ . -). Retourne null si invalide, '' pour « pseudo Discord ».
function cleanName(v) {
  const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length < 2 || t.length > 20 || !/^[\p{L}\p{N} _.\-]+$/u.test(t)) return null;
  return t;
}

function createHandler(db, opts = {}) {
  const adminIds = (opts.adminIds || '').split(',').map((s) => s.trim()).filter(Boolean);
  const now = opts.now || (() => Date.now());
  const boardTop = opts.boardTop || 20;

  const storeImage = async (data) => {
    if (!data) return '';
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(data));
    if (!m) throw new G.GameError('Image invalide (png, jpg ou webp)');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 600000) throw new G.GameError('Image trop lourde (600 Ko maximum)');
    return db.uploadImage(buf, 'image/' + m[1]);
  };

  // Lit l'état, applique fn, enregistre avec contrôle de version (évite les doubles dépenses en cas de requêtes simultanées).
  async function withState(uid, fn, track = true) {
    const allCards = await db.getCards();
    for (let attempt = 0; attempt < 5; attempt++) {
      let row = await db.loadSave(uid);
      let S, version;
      if (!row) { S = G.newState(now()); version = -1; } else { S = G.normalizeState(row.data, now()); version = row.version; }
      G.regen(S, now());
      const before = track ? G.counters(S, allCards) : null;
      const extra = await fn(S);
      const sum = G.summary(S, allCards);
      if (track) G.trackScore(S, before, G.counters(S, allCards), now());
      if (await db.saveSave(uid, S, version, sum)) return { S, extra };
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

  // ----- titres : part des joueurs, couleur, affichage sous les pseudos -----
  async function titleInfo() {
    const st = await db.titleStats();
    const total = Math.max(1, st.total || 1), out = {};
    M.TITLES.forEach((t) => { const pct = Math.round((((st.counts || {})[t.id] || 0) / total) * 1000) / 10; out[t.id] = { n: t.n, t: M.tierOf(pct) }; });
    return out;
  }
  // Ajoute { title: {n, t} } (ou null) à chaque ligne portant un identifiant de joueur
  async function attachTitles(rows) {
    const ids = [...new Set(rows.filter(Boolean).map((r) => r.id))];
    if (!ids.length) return rows;
    const [eq, info] = await Promise.all([db.getEquipped(ids), titleInfo()]);
    rows.forEach((r) => { if (r) r.title = (eq[r.id] && info[eq[r.id]]) || null; });
    return rows;
  }
  const stored = (S) => ({ runs: S.runs || 0, friends: S.fr || 0 });
  async function missionExt(uid) {
    const [fr, runs] = await Promise.all([db.listFriends(uid), db.userRuns(uid)]);
    return { friends: fr.filter((r) => r.status === 'accepted').length, runs };
  }

  // ---------- classement des temps de la map ----------
  const REWARD_TXT = (w) => (w ? w.c + ' Coins' + (w.g ? ' + 1 pack ' + (w.g === 3 ? 'Épique+' : 'Rare+') : '') : '');
  const weekOf = (wk) => Date.parse(wk + 'T12:00:00Z');   // un instant au milieu du lundi, pour retrouver les bornes de la semaine
  let lastSettle = 0;
  // Verse les récompenses des semaines terminées (une seule fois par gagnant, même si plusieurs requêtes arrivent en même temps).
  async function settleTimes() {
    if (now() - lastSettle < 30000) return;
    lastSettle = now();
    const cur = G.parisKeys(now()).wk;
    const pend = await db.timesToSettle(cur);
    const weeks = [...new Set(pend.filter((r) => r.status === 'accepted').map((r) => r.week))].sort().slice(0, 4);
    for (const wk of weeks) {
      const waiting = pend.some((r) => r.week === wk && r.status === 'pending');
      if (waiting && now() < G.nextWeekStart(weekOf(wk)) + C.TIME_GRACE_MS) continue;   // l'admin n'a pas fini de valider cette semaine
      const ranked = T.rankRows(await db.listTimes({ week: wk, status: 'accepted' })).slice(0, T.REWARDS().length);
      let failed = false;
      for (let i = 0; i < ranked.length && !failed; i++) {
        const r = ranked[i], w = T.REWARDS()[i];
        if (r.paid || !(await db.claimTimePaid(r.id))) continue;
        try {
          await withState(r.user_id, (S) => { S.money = Math.min(1e12, (S.money || 0) + w.c); if (w.g != null) S.wp[w.g] = (S.wp[w.g] || 0) + 1; return {}; }, false);
          await db.notify(r.user_id, 'Classement des temps (semaine du ' + wk.split('-').reverse().join('/') + ') : tu finis #' + (i + 1) + ' avec ' + T.fmtTime(r.ms) + ' ! Récompense : ' + REWARD_TXT(w) + '.').catch(() => {});
        } catch (e) { await db.unclaimTimePaid(r.id); failed = true; }
      }
      if (!failed) await db.settleWeek(wk);
    }
  }

  async function timesView(uid) {
    await settleTimes().catch(() => {});
    const wk = G.parisKeys(now()).wk;
    const all = await db.listTimes({ week: wk });
    const ranked = T.rankRows(all);
    const rec = await db.recordTime();
    const prevWk = G.parisKeys(weekOf(wk) - 7 * 86400000).wk;
    const prev = T.rankRows(await db.listTimes({ week: prevWk, status: 'accepted' })).slice(0, 3);
    const ids = [...new Set([...ranked.slice(0, 50).map((r) => r.user_id), ...(rec ? [rec.user_id] : []), ...prev.map((r) => r.user_id)])];
    const pr = await db.getProfiles(ids);
    const who = (id) => ({ name: (pr[id] || {}).name || 'Joueur', avatar: (pr[id] || {}).avatar || '' });
    // le lien d'un run masqué n'est jamais envoyé aux autres joueurs
    const pub = (r) => ({ ms: r.ms, hidden: !!r.hide_run, link: !r.hide_run || r.user_id === uid ? r.link : '', note: r.note || '', device: r.device || '', platform: r.platform || '' });
    const rows = ranked.slice(0, 50).map((r, i) => Object.assign({ rank: i + 1, id: r.user_id, at: r.created_at, reward: T.REWARDS()[i] || null }, who(r.user_id), pub(r)));
    await attachTitles(rows);
    const mineAll = all.filter((r) => r.user_id === uid);
    const idx = ranked.findIndex((r) => r.user_id === uid);
    return {
      week: wk, resetAt: G.nextWeekStart(now()), now: now(), rewards: T.REWARDS(), devices: T.DEVICES, platforms: T.PLATFORMS, maxPending: C.TIME_MAX_PENDING,
      record: rec ? Object.assign({ id: rec.user_id, week: rec.week }, who(rec.user_id), pub(rec)) : null,
      rows, total: ranked.length,
      me: { rank: idx >= 0 ? idx + 1 : null, ms: idx >= 0 ? ranked[idx].ms : null, reward: idx >= 0 ? T.REWARDS()[idx] || null : null,
        list: mineAll.slice(0, 10).map((r) => ({ id: r.id, ms: r.ms, status: r.status, hidden: !!r.hide_run, at: r.created_at })) },
      lastWeek: { week: prevWk, rows: prev.map((r, i) => Object.assign({ rank: i + 1, id: r.user_id, ms: r.ms }, who(r.user_id))) },
    };
  }

  // Classement entre amis (moi + amis acceptés), mêmes tris et périodes que le classement général
  async function friendsBoard(uid, sort, period) {
    const frs = await db.listFriends(uid);
    const ids = [uid, ...frs.filter((r) => r.status === 'accepted').map((r) => (r.a === uid ? r.b : r.a))];
    const keys = G.parisKeys(now());
    const launch = period !== 'all' && keys.wk <= (opts.periodAll || C.PERIOD_ALL || {})[period];
    const useWeek = period === 'week' && !launch, ps = sort === 'runs' ? 'runs' : 'score';
    const [sums, profs] = await Promise.all([db.getSummaries(ids), db.getProfiles(ids)]);
    const val = {};
    if (useWeek) (await db.periodBoard('week', keys.wk)).forEach((r) => { val[r.id] = { score: r.score, runs: r.runs }; });
    else if (ps === 'runs') { const m = await db.codesByUser(); ids.forEach((id) => { val[id] = { score: (sums[id] || EMPTY_SUM).score, runs: m[id] || 0 }; }); }
    else ids.forEach((id) => { val[id] = { score: (sums[id] || EMPTY_SUM).score, runs: 0 }; });
    const rows = ids.map((id) => {
      const s = sums[id] || EMPTY_SUM, p = profs[id] || {}, v = val[id] || { score: 0, runs: 0 };
      return { id, name: p.name || 'Joueur', avatar: p.avatar || '', owned: s.owned, mythics: s.mythics, score: v.score, runs: v.runs, opened: s.opened, hidden: false };
    }).sort((a, b) => b[ps] - a[ps] || String(a.name).localeCompare(String(b.name), 'fr')).slice(0, 100).map((r, i) => Object.assign(r, { rank: i + 1 }));
    await attachTitles(rows);
    const me = rows.find((r) => r.id === uid) || Object.assign({ rank: null }, EMPTY_SUM, { score: 0, runs: 0 });
    return { scope: 'friends', sort: ps, period, launch, rows, near: null, total: rows.length, me: Object.assign({}, me, { rank: me.rank }) };
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
    const out = {
      now: now(),
      friends: rows.filter((r) => r.status === 'accepted').map(mk).sort((x, y) => y.score - x.score),
      incoming: rows.filter((r) => r.status === 'pending' && r.b === uid).map(mk),
      outgoing: rows.filter((r) => r.status === 'pending' && r.a === uid).map(mk),
    };
    await attachTitles([...out.friends, ...out.incoming, ...out.outgoing]);
    return out;
  }

  const dayMs = 86400000;
  async function adminApi(a, body, uid, isOwner, cards) {
    const ok = (json) => ({ status: 200, json });
    const guardTarget = async (id) => {
      const p = await db.getProfile(id);
      if (!p) throw new G.GameError('Joueur introuvable', 404);
      if (!isOwner && adminIds.includes(p.discord_id || '')) throw new G.GameError('Compte propriétaire protégé', 403);
      return p;
    };
    switch (a) {
      case 'atimes': {
        const wk = G.parisKeys(now()).wk;
        const [pendingRows, weekRows] = await Promise.all([db.listTimes({ status: 'pending' }), db.listTimes({ week: wk, status: 'accepted' })]);
        const ids = [...new Set([...pendingRows, ...weekRows].map((r) => r.user_id))];
        const pr = await db.getProfiles(ids);
        const nm = (id) => ({ name: (pr[id] || {}).name || 'Joueur', avatar: (pr[id] || {}).avatar || '' });
        const bestOf = {}; weekRows.forEach((r) => { if (!bestOf[r.user_id] || r.ms < bestOf[r.user_id]) bestOf[r.user_id] = r.ms; });
        const full = (r) => ({ id: r.id, userId: r.user_id, week: r.week, ms: r.ms, link: r.link, note: r.note || '', device: r.device || '', platform: r.platform || '', hidden: !!r.hide_run, at: r.created_at, paid: !!r.paid });
        return ok({ week: wk,
          pending: pendingRows.slice().reverse().map((r) => Object.assign(full(r), nm(r.user_id), { best: bestOf[r.user_id] || null })),
          accepted: T.rankRows(weekRows).map((r, i) => Object.assign(full(r), nm(r.user_id), { rank: i + 1 })) });
      }
      case 'atimedecide': {
        const r = await db.getTime(+body.id);
        if (!r) throw new G.GameError('Temps introuvable', 404);
        const st = body.status === 'accepted' ? 'accepted' : body.status === 'rejected' ? 'rejected' : null;
        if (!st) throw new G.GameError('Décision invalide');
        if (r.paid) throw new G.GameError('Cette semaine est déjà soldée : les récompenses sont versées');
        await db.updateTime(r.id, { status: st, decided_at: new Date(now()).toISOString() });
        await db.logAdmin({ admin_id: uid, target_id: r.user_id, action: 'temps-' + st, detail: { id: r.id, ms: r.ms } });
        if (r.status === 'pending') await db.notify(r.user_id, st === 'accepted' ? 'Ton temps de ' + T.fmtTime(r.ms) + ' a été validé : il est dans le classement des temps !' : 'Ton temps de ' + T.fmtTime(r.ms) + ' a été refusé (preuve insuffisante ou temps invalide).').catch(() => {});
        return ok({ ok: true, status: st });
      }
      case 'aonline': {
        const rows = await db.recentSeen(150);
        const total = (await db.allProfiles()).length;
        return ok({ now: now(), total, rows: rows.map((p) => ({ id: p.user_id, name: p.name, avatar: p.avatar || '', lastSeen: p.last_seen || null, isAdmin: !!p.is_admin })) });
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
        return ok({ player: { id: p.user_id, name: p.name, avatar: p.avatar || '', discordId: p.discord_id || '', createdAt: p.created_at || null, lastSeen: p.last_seen || null, isAdmin: !!p.is_admin, customName: p.custom_name || '', noAvatar: !!p.no_avatar, isOwner: adminIds.includes(p.discord_id || ''), summary: sum },
          state: { money: T.money, stock: T.stock, wp: T.wp, col: T.col, pulled: T.pulled, opened: T.opened } });
      }
      case 'apact': {
        const id = String(body.id || '');
        await guardTarget(id);
        const r = await withState(id, (T) => { G.playerAction(T, cards, body.a, body.v, +body.i, now()); return {}; }, false);
        await db.logAdmin({ admin_id: uid, target_id: id, action: String(body.a), detail: { v: body.v ?? null, i: body.i ?? null } });
        return ok({ state: { money: r.S.money, stock: r.S.stock, wp: r.S.wp, col: r.S.col, pulled: r.S.pulled, opened: r.S.opened }, summary: G.summary(r.S, cards) });
      }
      case 'aresetall': {
        if (!isOwner) throw new G.GameError('Réservé au propriétaire', 403);
        if (body.confirm !== 'RESET') throw new G.GameError('Confirmation manquante');
        const rows = await db.allSaves(); let done = 0;
        for (let k = 0; k < rows.length; k += 8) {
          await Promise.all(rows.slice(k, k + 8).map((r) => withState(r.user_id, (S) => { G.resetPlayer(S, now()); }).then(() => { done++; })));
        }
        await db.logAdmin({ admin_id: uid, target_id: uid, action: 'resetall', detail: { players: done } });
        return ok({ ok: true, done });
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
        const nm = {}, isStaff = {}; profs.forEach((p) => { nm[p.user_id] = p.name; isStaff[p.user_id] = !!p.is_admin || adminIds.includes(p.discord_id || ''); });
        return ok({ drafts: drafts.map((d) => ({ id: d.id, name: d.name, cat: d.cat, rarity: d.rarity, descr: d.descr || '', img: d.img || '', by: nm[d.created_by] || '?', player: !isStaff[d.created_by], status: d.status || 'jury', at: d.created_at,
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
      case 'acarddraftedit': {
        if (!isOwner) throw new G.GameError('Réservé au propriétaire', 403);
        const d = await db.getDraft(+body.id);
        if (!d) throw new G.GameError('Carte introuvable', 404);
        const f = {};
        if (body.name !== undefined) {
          const name = String(body.name).trim().slice(0, 40);
          if (!name) throw new G.GameError('Nom vide');
          if (cards.some((c) => c && c[0].toLowerCase() === name.toLowerCase())) throw new G.GameError('Une carte porte déjà ce nom');
          f.name = name;
        }
        if (body.cat !== undefined) { if (![0, 1, 2, 3].includes(+body.cat)) throw new G.GameError('Catégorie invalide'); f.cat = +body.cat; }
        if (body.rarity !== undefined) { if (![0, 1, 2, 3, 4, 5].includes(+body.rarity)) throw new G.GameError('Rareté invalide'); f.rarity = +body.rarity; }
        if (body.descr !== undefined) f.descr = String(body.descr).trim().slice(0, 140);
        if (body.image) f.img = await storeImage(body.image);
        await db.updateDraft(d.id, f);
        return ok({ ok: true });
      }
      case 'acodes': {
        const [rows, byUser, saves] = await Promise.all([db.listPlayers(), db.codesByUser(), db.allSaves()]);
        const wh = {}; saves.forEach((s) => { wh[s.user_id] = s.data && s.data.wheel; });
        const out = rows.map((r) => ({ id: r.id, name: r.name, codes: byUser[r.id] || 0, wheel: C.WH.map((_, k) => (Array.isArray(wh[r.id]) ? +wh[r.id][k] || 0 : 0)) }));
        out.sort((x, y) => y.codes - x.codes || String(x.name).localeCompare(String(y.name), 'fr'));
        return ok({ rows: out, total: out.length });
      }
      case 'ajury': {
        if (!isOwner) throw new G.GameError('Réservé au propriétaire', 403);
        const [jurors, profs, saves] = await Promise.all([db.listJurors(), db.allProfiles(), db.allSaves()]);
        const nm = {}; profs.forEach((p) => { nm[p.user_id] = p; });
        const lists = [];
        saves.forEach((r) => { const j = r.data && r.data.jl; if (j && j.sent) lists.push({ id: r.user_id, name: (nm[r.user_id] || {}).name || '?', sent: j.sent, t: j.sentT || {}, o: j.sentO || [] }); });
        lists.sort((a, b) => b.sent - a.sent);
        const sum = {};
        lists.forEach((l) => Object.keys(l.t).forEach((k) => { (sum[k] = sum[k] || []).push(+l.t[k]); }));
        const avg = {}; Object.keys(sum).forEach((k) => { avg[k] = { n: sum[k].length, avg: sum[k].reduce((x, y) => x + y, 0) / sum[k].length }; });
        return ok({ jurors, lists, avg });
      }
      case 'ajurydel': {
        if (!isOwner) throw new G.GameError('Réservé au propriétaire', 403);
        const id = String(body.id || '');
        if (!(await db.getProfile(id))) throw new G.GameError('Joueur introuvable', 404);
        await withState(id, (S) => { if (S.jl) { S.jl.sent = 0; S.jl.sentT = {}; S.jl.sentO = []; } });
        return ok({ ok: true });
      }
      case 'asetjury': {
        if (!isOwner) throw new G.GameError('Réservé au propriétaire', 403);
        const id = String(body.id || '');
        const pr = await db.getProfile(id);
        if (!pr) throw new G.GameError('Joueur introuvable', 404);
        await db.setJury(id, !!body.on);
        if (body.on) await withState(id, (S) => { if (S.jl) { S.jl.t = {}; S.jl.o = []; } });   // nouvelle session : brouillon vide, l'ancien envoi reste visible
        if (body.on) await db.notify(id, 'Tu es maintenant membre du jury : un onglet Jury est apparu dans le menu pour classer les nouvelles cartes.').catch(() => {});
        return ok({ ok: true });
      }
      case 'acardaccept': {
        if (!isOwner) throw new G.GameError('Réservé au propriétaire', 403);
        const d = await db.getDraft(+body.id);
        if (!d) throw new G.GameError('Carte introuvable', 404);
        await db.updateDraft(d.id, { status: 'jury' });
        if (d.created_by) await withState(d.created_by, (S) => { S.accepted = (S.accepted || 0) + 1; }, false).catch(() => {});
        if (d.created_by && d.created_by !== uid) await db.notify(d.created_by, 'Ta carte « ' + d.name + ' » a été validée : elle passe devant le jury. Tu peux proposer de nouvelles cartes. Tu seras prévenu quand elle sera publiée.').catch(() => {});
        return ok({ ok: true });
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
        if (d.created_by && d.created_by !== uid) await db.notify(d.created_by, 'Ta carte « ' + d.name + ' » est publiée ! Elle est maintenant dans les packs.').catch(() => {});
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
          if (d.created_by && d.created_by !== uid) await db.notify(d.created_by, 'Ta carte « ' + d.name + ' » est publiée ! Elle est maintenant dans les packs.').catch(() => {});
          done++;
        }
        return ok({ ok: true, done, skipped });
      }
      case 'acarddel': {
        const d = await db.getDraft(+body.id);
        if (!d) throw new G.GameError('Carte introuvable', 404);
        if (!isOwner && d.created_by !== uid) throw new G.GameError('Tu ne peux supprimer que tes propositions', 403);
        await db.deleteDraft(d.id);
        if (d.created_by && d.created_by !== uid) {
          const reason = String(body.reason || '').trim().slice(0, 300);
          await db.notify(d.created_by, 'Ta carte « ' + d.name + ' » a été refusée.' + (reason ? ' Raison : ' + reason : '')).catch(() => {});
        }
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
      case 'acardwipe': {
        // efface la carte partout : collections, doublons, équipes, vitrines, tier lists ; la carte est retirée des packs et n'apparaît plus nulle part
        if (!isOwner) throw new G.GameError('Réservé au propriétaire', 403);
        const id = +body.id;
        if (!cards[id]) throw new G.GameError('Carte inconnue', 404);
        await db.updateCard(id, { retired: true });
        let n = 0;
        for (const r of await db.allSaves()) {
          const d = r.data || {};
          if ((d.col || {})[id] > 0) n++;
          await withState(r.user_id, (S) => { G.purgeCard(S, id); });
        }
        return ok({ ok: true, holders: n });
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
      case 'asetident': {
        const id = String(body.id || '');
        const p = await guardTarget(id);
        const c = cleanName(body.name);
        if (c === null) throw new G.GameError('Pseudo invalide : 2 à 20 caractères (lettres, chiffres, espace, _ . -)');
        const noAvatar = typeof body.noAvatar === 'boolean' ? body.noAvatar : !!p.no_avatar;
        const out = await db.setIdentity(id, c, noAvatar);
        await db.logAdmin({ admin_id: uid, target_id: id, action: 'ident', detail: { name: c || null, noAvatar } });
        return ok({ profile: out });
      }
      case 'apost': {
        const text = String(body.text || '').trim().slice(0, 2000);
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
          const pr = (await db.getProfile(uid)) || {};
          return { status: 200, json: { state: result.S, cards, config: publicConfig(), isAdmin: admin, isOwner, isJury: !!(await db.isJury(uid)), profile: { id: uid, name: pr.name || user.name, avatar: pr.avatar != null ? pr.avatar : user.avatar, custom: pr.custom_name || '', noAvatar: !!pr.no_avatar, discordName: pr.d_name || user.name } } };
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
        case 'openall': {
          // ouvre tous les packs et cartes en attente (sauf « Mythique au choix », qui demande un choix) ; 100 packs max par appel
          let nb = 0;
          result = await withState(uid, (S) => {
            const ids = [];
            for (const g of [0, 2, 3, 4, 6]) {
              while ((S.wp[g] || 0) > 0 && nb < 100) { ids.push(...G.openWaiting(S, cards, g, rand)); nb++; }
            }
            if (!nb) throw new G.GameError('Aucun pack en attente');
            return { cards: ids };
          });
          break;
        }
        case 'openwp': {
          result = await withState(uid, (S) => ({ cards: G.openWaiting(S, cards, +body.g, rand, body.card === undefined ? undefined : +body.card) }));
          break;
        }
        case 'prefs': {
          result = await withState(uid, (S) => { G.sanitizePrefs(S, body.prefs || {}, cards); return {}; });
          return { status: 200, json: { ok: true } };
        }
        case 'spinpay': {
          // tour de roue payé en Coins (sans code) : ne compte pas comme un run
          result = await withState(uid, (S) => {
            if (S.money < C.SPIN_PRICE) throw new G.GameError('Pas assez de Coins');
            S.money -= C.SPIN_PRICE; S.spins = (S.spins || 0) + 1;
            return G.spinForReward(S, rand, cards);
          });
          break;
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
            result = await withState(uid, (S) => { S.bad = 0; G.trackRun(S, now()); return G.spinForReward(S, rand, cards); });
          } catch (e) { await db.unuseCode(code); throw e; }
          break;
        }
        case 'admin': {
          if (!admin) return { status: 403, json: { error: 'Réservé à l\'administrateur' } };
          result = await withState(uid, (S) => G.adminAction(S, cards, body.a, body.v, +body.i, rand, now()), false);
          break;
        }

        // ---------- communauté ----------
        case 'board': {
          const sort = RANK_SORTS.includes(body.sort) ? body.sort : 'score';
          if (body.scope === 'friends') return { status: 200, json: await friendsBoard(uid, sort, body.period === 'week' ? 'week' : 'all') };
          const top = boardTop;
          const period = body.period === 'day' || body.period === 'week' ? body.period : 'all';
          const pkey = period === 'day' ? G.parisKeys(now()).dk : G.parisKeys(now()).wk;
          const launch = period !== 'all' && pkey <= (opts.periodAll || C.PERIOD_ALL || {})[period];   // site tout neuf : la période = tout l'historique
          if (period !== 'all' && !launch) {
            // période en cours (heure de Paris) : points et runs gagnés depuis minuit / lundi minuit
            const keys = G.parisKeys(now());
            const ps = sort === 'runs' ? 'runs' : 'score';
            const all = (await db.periodBoard(period, period === 'day' ? keys.dk : keys.wk)).filter((r) => r[ps] > 0)
              .sort((a, b) => b[ps] - a[ps] || (a.id < b.id ? -1 : 1));
            const decorate = async (list, off) => { const pr = await db.getProfiles(list.map((r) => r.id)); return list.map((r, i) => Object.assign({}, r, { rank: off + i + 1, name: (pr[r.id] || {}).name || 'Joueur', avatar: (pr[r.id] || {}).avatar || '' })); };
            const rows = await decorate(all.slice(0, top), 0);
            const idx = all.findIndex((r) => r.id === uid); const rank = idx >= 0 ? idx + 1 : null;
            let near = null;
            if (rank && rank > top) { const off = Math.max(top, rank - 2); near = await decorate(all.slice(off, rank + 1), off); }
            const sm = (await db.getSummaries([uid]))[uid] || EMPTY_SUM;
            const mine = idx >= 0 ? all[idx] : { score: 0, runs: 0 };
            await attachTitles([...rows, ...(near || [])]);
            return { status: 200, json: { sort: ps, period, rows, near, total: all.length, me: Object.assign({ rank }, sm, { score: mine.score, runs: mine.runs }) } };
          }
          if (sort === 'runs') {
            const all = await db.runsBoard();
            const decorate = async (list, off) => { const pr = await db.getProfiles(list.map((r) => r.id)); return list.map((r, i) => Object.assign({}, r, { rank: off + i + 1, name: (pr[r.id] || {}).name || 'Joueur', avatar: (pr[r.id] || {}).avatar || '' })); };
            const rows = await decorate(all.slice(0, top), 0);
            const sm = (await db.getSummaries([uid]))[uid] || EMPTY_SUM;
            const idx = all.findIndex((r) => r.id === uid); const rank = idx >= 0 ? idx + 1 : null;
            let near = null;
            if (rank && rank > top) { const off = Math.max(top, rank - 2); near = await decorate(all.slice(off, rank + 1), off); }
            await attachTitles([...rows, ...(near || [])]);
            return { status: 200, json: { sort, period, launch, rows, near, total: all.length, me: Object.assign({ rank }, sm, { runs: idx >= 0 ? all[idx].runs : 0 }) } };
          }
          const rows = (await db.leaderboard(sort, top, 0)).map((r, i) => Object.assign({ rank: i + 1 }, r));
          const m = (await db.getSummaries([uid]))[uid] || EMPTY_SUM;
          let rank = null, near = null;
          if (!m.hidden && m.owned > 0) rank = await db.rankOf(sort, m[sort], uid);
          // Hors du haut du classement : le joueur juste au-dessus, lui, et celui juste en dessous
          if (rank && rank > top) {
            const offset = Math.max(top, rank - 2);
            near = (await db.leaderboard(sort, rank - offset + 1, offset)).map((r, i) => Object.assign({ rank: offset + i + 1 }, r));
          }
          await attachTitles([...rows, ...(near || [])]);
          return { status: 200, json: { sort, period, launch, rows, near, total: await db.rankedCount(), me: Object.assign({ rank }, m) } };
        }
        case 'missions': {
          const ext = await missionExt(uid);
          result = await withState(uid, (S) => { S.runs = Math.max(S.runs || 0, ext.runs); S.fr = ext.friends; return {}; }, false);
          const st = await db.titleStats();
          return { status: 200, json: Object.assign({ state: result.S }, M.view(result.S, M.context(result.S, cards, stored(result.S), now()), st)) };
        }
        case 'claim': {
          // sans requête supplémentaire : amis et runs viennent des valeurs enregistrées à l'ouverture de l'onglet
          let got = null;
          result = await withState(uid, (S) => { got = M.claim(S, M.context(S, cards, stored(S), now()), Array.isArray(body.ids) ? body.ids.map(String).slice(0, 80) : null); return {}; }, false);
          const st = await db.titleStats();
          return { status: 200, json: Object.assign({ state: result.S, got }, M.view(result.S, M.context(result.S, cards, stored(result.S), now()), st)) };
        }
        case 'settitle': {
          const id = body.id === null || body.id === '' || body.id === undefined ? null : String(body.id);
          result = await withState(uid, (S) => {
            if (id !== null && !(S.titles || {})[id]) throw new G.GameError('Titre non débloqué', 403);
            S.title = id; return {};
          }, false);
          const st = await db.titleStats();
          return { status: 200, json: Object.assign({ state: result.S }, M.view(result.S, M.context(result.S, cards, stored(result.S), now()), st)) };
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
          const canSee = rel === 'self' || rel === 'friend';
          if (sum.hidden && !canSee && !admin) throw new G.GameError('Ce profil est privé', 403);
          const out = { id, name: p.name, avatar: p.avatar || '', owned: sum.owned, mythics: sum.mythics, score: sum.score, opened: sum.opened, hidden: sum.hidden, rel, since: p.created_at || null };
          if (!sum.hidden && sum.owned > 0) out.rank = await db.rankOf('score', sum.score, id);
          const row = await db.loadSave(id);
          const T = G.normalizeState(row ? row.data : {}, now());
          await attachTitles([out]);
          out.vitrine = T.vitrine.filter((x) => x != null && (T.col[x] || 0) > 0);
          if (canSee) { out.col = T.col; out.team = T.team; out.extra = T.extra; }
          return { status: 200, json: { profile: out } };
        }
        // battement de coeur : upsertProfile (ci-dessus) a déjà mis à jour « vu pour la dernière fois »
        case 'ping': {
          const fr = await db.listFriends(uid);
          const anns = await db.listAnnouncements(5);
          const notes = await db.listNotes(uid);
          await settleTimes().catch(() => {});
          const tp = admin ? await db.countPendingTimes().catch(() => 0) : 0;
          let mc = 0;
          try { const sv = await db.loadSave(uid); if (sv) { const T2 = G.normalizeState(sv.data, now()); mc = M.readyCount(T2, M.context(T2, cards, stored(T2), now())); } } catch (e) { /* pastille facultative */ }
          return { status: 200, json: { ok: true, mc, tp, reqs: fr.filter((r) => r.status === 'pending' && r.b === uid).length, ann: anns.map((x) => ({ id: x.id, text: x.text, at: x.created_at })), notes: notes.map((x) => ({ id: x.id, text: x.text, at: x.created_at })) } };
        }
        // ---------- propositions de cartes par les joueurs ----------
        case 'cardsubmit': {
          const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 40), cat = +body.cat, rarity = +body.rarity, descr = String(body.descr || '').trim().slice(0, 140);
          if (name.length < 2) throw new G.GameError('Donne un nom à la carte (2 caractères minimum)');
          if (![0, 1, 2, 3].includes(cat)) throw new G.GameError('Catégorie invalide');
          if (![0, 1, 2, 3, 4, 5].includes(rarity)) throw new G.GameError('Rareté invalide');
          const drafts = await db.listDrafts();
          if (drafts.filter((d) => d.created_by === uid && d.status === 'new').length >= 10) throw new G.GameError('Tu as déjà 10 propositions en attente : attends qu\'elles soient traitées');
          const lc = name.toLowerCase();
          if (cards.some((c) => c && c[0].toLowerCase() === lc)) throw new G.GameError('Cette carte existe déjà');
          if (drafts.some((d) => String(d.name).toLowerCase() === lc)) throw new G.GameError('Cette carte a déjà été proposée');
          const img = await storeImage(body.image);
          await db.addDraft({ name, cat, rarity, descr, img, created_by: uid, status: 'new' });
          return { status: 200, json: { ok: true } };
        }
        case 'notread': {
          await db.readNotes(uid, (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isFinite).slice(0, 20));
          return { status: 200, json: { ok: true } };
        }
        case 'cardmine': {
          const drafts = (await db.listDrafts()).filter((d) => d.created_by === uid);
          return { status: 200, json: { rows: drafts.map((d) => ({ id: d.id, name: d.name, cat: d.cat, rarity: d.rarity, img: d.img || '', status: d.status || 'jury' })) } };
        }
        case 'cardmydel': {
          const d = await db.getDraft(+body.id);
          if (!d || d.created_by !== uid) throw new G.GameError('Proposition introuvable', 404);
          if (d.status !== 'new') throw new G.GameError('Cette carte est déjà acceptée : tu ne peux plus l\'annuler');
          await db.deleteDraft(d.id);
          return { status: 200, json: { ok: true } };
        }
        case 'setident': {
          const pr = await db.getProfile(uid);
          let custom = pr && pr.custom_name || '';
          if (body.name !== undefined) {
            const c = cleanName(body.name);
            if (c === null) throw new G.GameError('Pseudo invalide : 2 à 20 caractères (lettres, chiffres, espace, _ . -)');
            if (c && await db.nameTaken(c, uid)) throw new G.GameError('Ce pseudo est déjà pris');
            custom = c;
          }
          const noAvatar = typeof body.noAvatar === 'boolean' ? body.noAvatar : !!(pr && pr.no_avatar);
          return { status: 200, json: { profile: await db.setIdentity(uid, custom, noAvatar) } };
        }
        // ---------- classement des temps de la map ----------
        case 'times': return { status: 200, json: await timesView(uid) };
        case 'timesubmit': {
          const ms = T.parseTime(body.time);
          if (ms == null) throw new G.GameError('Temps invalide : écris-le comme 1:23.456 (minutes:secondes.millièmes)');
          const link = T.cleanLink(body.link);
          if (!link) throw new G.GameError('Lien de la vidéo invalide : il doit commencer par https://');
          const device = T.DEVICES.includes(body.device) ? body.device : null, platform = T.PLATFORMS.includes(body.platform) ? body.platform : null;
          if (!device) throw new G.GameError('Choisis ton périphérique');
          if (!platform) throw new G.GameError('Choisis ta plateforme');
          const wk = G.parisKeys(now()).wk;
          const mine = await db.listTimes({ week: wk, user: uid });
          if (mine.filter((r) => r.status === 'pending').length >= C.TIME_MAX_PENDING) throw new G.GameError('Tu as déjà ' + C.TIME_MAX_PENDING + ' temps en attente de validation');
          const best = Math.min(Infinity, ...mine.filter((r) => r.status === 'accepted').map((r) => r.ms));
          if (ms >= best) throw new G.GameError('Ton meilleur temps validé cette semaine est ' + T.fmtTime(best) + ' : propose un temps plus rapide');
          await db.addTime({ user_id: uid, week: wk, ms, link, note: String(body.note || '').replace(/\s+/g, ' ').trim().slice(0, 200), device, platform, hide_run: body.hide === true, status: 'pending' });
          return { status: 200, json: { ok: true } };
        }
        case 'timedel': {
          const r = await db.getTime(+body.id);
          if (!r || r.user_id !== uid) throw new G.GameError('Temps introuvable', 404);
          if (r.status !== 'pending') throw new G.GameError('Ce temps est déjà traité');
          await db.deleteTime(r.id);
          return { status: 200, json: { ok: true } };
        }
        case 'share': return { status: 200, json: { sid: await db.ensureShareId(uid) } };

        // ---------- jury : tier list des cartes proposées ----------
        case 'jlcards': case 'jlsave': case 'jlsend': {
          if (!admin && !(await db.isJury(uid))) return { status: 403, json: { error: 'Réservé au jury' } };
          const drafts = (await db.listDrafts()).filter((d) => d.status === 'jury');
          const items = [];
          if (admin) cards.forEach((c, i) => { if (c && !c[5]) items.push({ k: 'c' + i, name: c[0], cat: c[1], rarity: c[2], img: c[4] || '', draft: false }); });
          drafts.forEach((d) => items.push({ k: 'd' + d.id, name: d.name, cat: d.cat, rarity: d.rarity, img: d.img || '', draft: true }));
          const keys = new Set(items.map((x) => x.k));
          if (a === 'jlcards') {
            const r = await withState(uid, () => ({}));
            return { status: 200, json: { items, jl: r.S.jl || null } };
          }
          if (a === 'jlsave') {
            const t = {}; const src = body.t && typeof body.t === 'object' ? body.t : {};
            Object.keys(src).forEach((k) => { if (keys.has(k) && ['0', '1', '2', '3', '4', '5'].includes(String(src[k]))) t[k] = String(src[k]); });
            const o = (Array.isArray(body.o) ? body.o : []).filter((k) => typeof k === 'string' && t[k] !== undefined).slice(0, 400);
            await withState(uid, (S) => { S.jl = Object.assign({ sent: 0, sentT: {}, sentO: [] }, S.jl, { t, o }); });
            return { status: 200, json: { ok: true } };
          }
          let nb = 0;
          await withState(uid, (S) => { const j = Object.assign({ t: {}, o: [], sent: 0, sentT: {}, sentO: [] }, S.jl); nb = Object.keys(j.t).filter((k) => keys.has(k)).length; if (!nb) return; j.sentT = Object.assign({}, j.t); j.sentO = j.o.slice(); j.sent = now(); S.jl = j; });
          if (!nb) throw new G.GameError('Classe au moins une carte avant d\'envoyer');
          if (!admin) await db.setJury(uid, false);   // un membre du jury n'a qu'un seul envoi : le rôle est retiré
          const profs = await db.allProfiles();
          const me = profs.find((p) => p.user_id === uid);
          for (const p of profs) if (p.user_id !== uid && adminIds.includes(p.discord_id || '')) await db.notify(p.user_id, (me ? me.name : 'Un membre du jury') + ' t\'a envoyé sa tier list jury (onglet Admin > Jury).').catch(() => {});
          return { status: 200, json: { ok: true } };
        }
        // ---------- administration (réservée) ----------
        case 'atimes': case 'atimedecide': case 'aover': case 'aonline': case 'aplayers': case 'aplayer': case 'apact': case 'aowners': case 'alog': case 'asetadmin': case 'aresetall': case 'asetident': case 'apost': case 'adelann': case 'acards': case 'acardnew': case 'acarddraftedit': case 'acardaccept': case 'acardwipe': case 'acodes': case 'ajury': case 'ajurydel': case 'asetjury': case 'acardvote': case 'acardpub': case 'acarddel': case 'acardedit': case 'acardretire': case 'acardremove': case 'acardpubmany': {
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

module.exports = { createHandler, publicShare, botProfile, normalizeCode, codeFormatOk };
