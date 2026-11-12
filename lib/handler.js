// Gestionnaire unique de l'API de jeu. La base de données est injectée (db) pour pouvoir tester sans Supabase.
const crypto = require('crypto');
const C = require('./config');
const G = require('./game');

const rand = () => crypto.randomInt(0, 1e9) / 1e9;
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizeCode(raw) { return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function codeFormatOk(c) { return c.length === 8 && [...c].every((ch) => ALPH.includes(ch)); }

function publicConfig() {
  return { HOUR: C.HOUR, MAXSTOCK: C.MAXSTOCK, RAR: C.RAR, PACKS: C.PACKS, WH: C.WH };
}

function createHandler(db, opts = {}) {
  const adminIds = (opts.adminIds || '').split(',').map((s) => s.trim()).filter(Boolean);
  const now = opts.now || (() => Date.now());

  // Lit l'état, applique fn, enregistre avec contrôle de version (évite les doubles dépenses en cas de requêtes simultanées).
  async function withState(uid, fn) {
    for (let attempt = 0; attempt < 5; attempt++) {
      let row = await db.loadSave(uid);
      let S, version;
      if (!row) { S = G.newState(now()); version = -1; } else { S = G.normalizeState(row.data, now()); version = row.version; }
      G.regen(S, now());
      const extra = await fn(S);
      if (await db.saveSave(uid, S, version)) return { S, extra };
    }
    throw new G.GameError('Serveur occupé, réessaie', 503);
  }

  return async function handle(token, body) {
    // Aperçu public pour la page d'accueil (avant connexion) : seulement la liste des cartes, aucune donnée de joueur.
    if (body && body.action === 'preview') return { status: 200, json: { cards: await db.getCards() } };
    const user = await db.getUser(token);
    if (!user) return { status: 401, json: { error: 'Connecte-toi avec Discord' } };
    const uid = user.id;
    const isAdmin = adminIds.includes(user.discordId || '');
    await db.upsertProfile(user, isAdmin);
    const admin = isAdmin || (await db.isAdmin(uid));
    const cards = await db.getCards();
    const a = body && body.action;
    let result;

    try {
      switch (a) {
        case 'me': {
          result = await withState(uid, () => ({}));
          return { status: 200, json: { state: result.S, cards, config: publicConfig(), isAdmin: admin, profile: { name: user.name, avatar: user.avatar } } };
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
    return { status: 200, json: Object.assign({ state: result.S }, result.extra) };
  };
}

module.exports = { createHandler, normalizeCode, codeFormatOk };
