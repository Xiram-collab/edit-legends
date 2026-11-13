// Classement des temps de la map : validation des propositions et calcul des places / récompenses.
const C = require('./config');

const DEVICES = ['Clavier / souris', 'Manette'];   // un classement par périphérique
const PLATFORMS = ['PC', 'PlayStation', 'Xbox', 'Switch', 'Mobile'];

// « 1:23.456 », « 83.456 », « 1m23s », « 0:58 » -> millisecondes (1 s à 1 h) ou null
function parseTime(raw) {
  const t = String(raw == null ? '' : raw).trim().toLowerCase().replace(',', '.').replace(/\s+/g, '');
  let ms = null, m;
  if ((m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(t))) ms = ((+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 + (m[4] ? +m[4].padEnd(3, '0') : 0);
  else if ((m = /^(\d{1,2})m(\d{1,2})(?:\.(\d{1,3}))?s?$/.exec(t))) ms = ((+m[1]) * 60 + (+m[2])) * 1000 + (m[3] ? +m[3].padEnd(3, '0') : 0);
  else if ((m = /^(\d{1,4})(?:\.(\d{1,3}))?s?$/.exec(t))) ms = (+m[1]) * 1000 + (m[2] ? +m[2].padEnd(3, '0') : 0);
  return ms != null && ms >= 1000 && ms <= 3600000 ? ms : null;
}
function fmtTime(ms) {
  const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, r = ms % 1000;
  return m + ':' + String(s).padStart(2, '0') + '.' + String(r).padStart(3, '0');
}
function cleanLink(v) {
  const l = String(v || '').trim();
  if (!/^https?:\/\/[^\s<>"']{4,290}$/i.test(l)) return null;
  return l;
}
const REWARDS = () => C.TIME_REWARDS;

// Meilleur temps accepté de chaque joueur, trié (plus petit d'abord ; à égalité, le plus ancien gagne)
function rankRows(rows) {
  const best = new Map();
  rows.filter((r) => r.status === 'accepted').forEach((r) => {
    const b = best.get(r.user_id);
    if (!b || r.ms < b.ms || (r.ms === b.ms && String(r.created_at) < String(b.created_at))) best.set(r.user_id, r);
  });
  return [...best.values()].sort((a, b) => a.ms - b.ms || (String(a.created_at) < String(b.created_at) ? -1 : 1) || (a.id - b.id));
}
module.exports = { DEVICES, PLATFORMS, parseTime, fmtTime, cleanLink, rankRows, REWARDS };
