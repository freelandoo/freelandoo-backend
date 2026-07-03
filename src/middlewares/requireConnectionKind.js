// src/middlewares/requireConnectionKind.js
// Monta DEPOIS de apiConnectionAuth. Garante que o token usado é do tipo certo
// para a rota: um token de dados (flnd_data_) não pode chamar /ext/v1
// (mensagens) e um token de atendimento não pode chamar /ext/v1/data.
function requireConnectionKind(kind) {
  return function connectionKindGate(req, res, next) {
    const actual = req.apiConnection?.kind || "atendimento";
    if (actual !== kind) {
      return res.status(403).json({
        error: "Token de API não autorizado para este recurso.",
        expected_kind: kind,
      });
    }
    return next();
  };
}

module.exports = requireConnectionKind;
