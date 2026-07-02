// src/middlewares/extRateLimit.js
// Limite simples por conexão: 60 requests/minuto (janela fixa, em memória).
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 60;
const buckets = new Map(); // id_connection -> { count, windowStart }

function extRateLimit(req, res, next) {
  const key = req.apiConnection?.id_connection || req.ip;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS) {
    res.set("Retry-After", String(Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000)));
    return res.status(429).json({ error: "Limite de requisições excedido (60/min)" });
  }
  return next();
}

// GC ocasional pra Map não crescer indefinidamente.
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.windowStart < cutoff) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref?.();

module.exports = extRateLimit;
