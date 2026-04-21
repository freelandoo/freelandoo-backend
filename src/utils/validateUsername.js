const USERNAME_RE = /^[a-z0-9][a-z0-9_.]{2,29}$/;

function normalizeUsername(raw) {
  if (typeof raw !== "string") return null;
  const u = raw.trim().toLowerCase();
  return u || null;
}

function validateUsername(raw) {
  const u = normalizeUsername(raw);
  if (!u) return { ok: false, error: "username_required" };
  if (u.length < 3) return { ok: false, error: "username_too_short" };
  if (u.length > 30) return { ok: false, error: "username_too_long" };
  if (!USERNAME_RE.test(u)) return { ok: false, error: "username_invalid_format" };
  return { ok: true, username: u };
}

module.exports = { validateUsername, normalizeUsername };
