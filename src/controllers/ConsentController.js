const pool = require("../databases");
const ConsentStorage = require("../storages/ConsentStorage");

// Ações conhecidas — recusa qualquer chave fora desta lista.
const VALID_ACTIONS = new Set([
  "signup", // aceite geral dos Termos/Privacidade no cadastro (mig 129)
  "publish_content",
  "publish_offer",
  "purchase",
  "platform_purchase",
  "affiliate",
]);

module.exports = {
  async listMine(req, res) {
    const consents = await ConsentStorage.listForUser(pool, req.user.id_user);
    return res.json({ consents });
  },

  async accept(req, res) {
    const action_key = String(req.body?.action_key || "").trim();
    const terms_version = Number(req.body?.terms_version);
    if (!VALID_ACTIONS.has(action_key)) {
      return res.status(400).json({ error: "action_key inválido" });
    }
    if (!Number.isInteger(terms_version) || terms_version < 1) {
      return res.status(400).json({ error: "terms_version inválido" });
    }
    const ip =
      (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
      req.ip ||
      null;
    const user_agent =
      (req.headers["user-agent"] || "").toString().slice(0, 1000) || null;
    const consent = await ConsentStorage.upsert(pool, {
      id_user: req.user.id_user,
      action_key,
      terms_version,
      ip,
      user_agent,
    });
    return res.status(201).json({ consent });
  },
};
