const MeuMundoService = require("../services/MeuMundoService");

// Bairro persistente do usuário (mig 291) + reserva na sala online.
async function adminNeighborhood(req, res) {
  res.set("Cache-Control", "no-store");
  return res.json(await MeuMundoService.enter(req.user.id_user));
}

// Reconexão: revalida acesso e residência e devolve uma reserva nova.
async function adminSession(req, res) {
  res.set("Cache-Control", "no-store");
  const out = await MeuMundoService.reconnect(req.user.id_user);
  if (out.error) return res.status(out.statusCode || 400).json({ error: out.error });
  return res.json(out);
}

async function adminStatus(_req, res) {
  res.set("Cache-Control", "no-store");
  return res.json(await MeuMundoService.status());
}

module.exports = { adminNeighborhood, adminSession, adminStatus };
