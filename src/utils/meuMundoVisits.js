// src/utils/meuMundoVisits.js — MEU MUNDO 3D: parâmetros de produto das visitas (mm3d-09).
//
// Valores INICIAIS, ajustáveis por variável de ambiente sem mudar código:
//   MM_INVITE_TTL_S        expiração do convite pendente (padrão 300 s = 5 min)
//   MM_VISIT_GRACE_S       tolerância de desconexão durante a visita (padrão 60 s)
//   MM_INVITES_PER_MIN     limite de convites enviados por anfitrião por minuto (6)
//   MM_ENTER_RADIUS_M      distância máxima da porta para entrar (4 m)
// Regras fixas desta entrega (não são parâmetro): um visitante por morador,
// uma visita ativa por pessoa, ninguém se convida, visitante não convida.

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

const VISIT_RULES = Object.freeze({
  inviteTtlMs: num(process.env.MM_INVITE_TTL_S, 300) * 1000,
  disconnectGraceMs: num(process.env.MM_VISIT_GRACE_S, 60) * 1000,
  invitesPerMinute: num(process.env.MM_INVITES_PER_MIN, 6),
  enterRadius: num(process.env.MM_ENTER_RADIUS_M, 4),
  /** Visitantes de outros bairros na rua: no máximo um por titular. */
  visitorsPerResident: 1,
});

module.exports = { VISIT_RULES };
