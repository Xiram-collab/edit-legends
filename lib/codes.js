// Codes de la map Fortnite : pas de liste, chaque code est vérifié en refaisant le calcul de la map.
// Format XXXX-XXXX-XXXX-XX (alphabet sans I, O, 0, 1). Chiffres 1-5 : minutes depuis le 01/01/2026 UTC,
// 6-10 : aléatoire, 11-14 : signature. À n'utiliser que côté serveur.
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EPOCH_MINUTES = 29453760; // 2026-01-01T00:00:00Z

function checkCode(input, nowMs, maxAgeMs) {
  const s = String(input == null ? '' : input).toUpperCase().trim().replace(/[\s-]/g, '');
  if (!/^[A-HJ-NP-Z2-9]{14}$/.test(s)) return { valid: false, reason: 'format' };
  const d = [...s].map((c) => CHARSET.indexOf(c));
  let h = 558874;
  for (const x of d.slice(0, 10)) h = (h * 218 + x + 28822) % 1048573;
  const sig = d.slice(10).reduce((a, x) => a * 32 + x, 0);
  if (h !== sig) return { valid: false, reason: 'signature' };
  const t = d.slice(0, 5).reduce((a, x) => a * 32 + x, 0);
  const createdAt = (EPOCH_MINUTES + t) * 60000;
  const now = nowMs == null ? Date.now() : nowMs;
  if (createdAt > now + 5 * 60000) return { valid: false, reason: 'futur' };
  if (maxAgeMs && now - createdAt > maxAgeMs) return { valid: false, reason: 'expire', createdAt };
  return { valid: true, normalized: s.replace(/(.{4})(.{4})(.{4})(.{2})/, '$1-$2-$3-$4'), createdAt };
}

// Fabrique un code valide (tests uniquement) : même calcul que la map.
function makeCode(createdAtMs, rnd) {
  const t = Math.floor(createdAtMs / 60000) - EPOCH_MINUTES;
  const d = [];
  for (let k = 4; k >= 0; k--) d.push(Math.floor(t / Math.pow(32, k)) % 32);
  let r = rnd == null ? Math.floor(Math.random() * Math.pow(32, 5)) : rnd;
  for (let k = 4; k >= 0; k--) d.push(Math.floor(r / Math.pow(32, k)) % 32);
  let h = 558874; for (const x of d) h = (h * 218 + x + 28822) % 1048573;
  for (let k = 3; k >= 0; k--) d.push(Math.floor(h / Math.pow(32, k)) % 32);
  const s = d.map((x) => CHARSET[x]).join('');
  return s.replace(/(.{4})(.{4})(.{4})(.{2})/, '$1-$2-$3-$4');
}

module.exports = { checkCode, makeCode, CHARSET, EPOCH_MINUTES };
