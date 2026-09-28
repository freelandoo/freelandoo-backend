// src/utils/aiQuota.js
// A COTA DO ATENDENTE DE IA (mig 263) — a régua, num lugar só.
//
// Decisão do Alex (2026-09-27): qualquer pessoa conecta o atendente de graça, e
// ele atende até DUAS PESSOAS POR DIA. Depois disso ele para e pede para
// assinar. Quem assina (R$29 / R$59 / R$99) ganha uma cota de RESPOSTAS por
// ciclo de cobrança.
//
// ─── DUAS PONTAS PERGUNTAM ISTO, E NÃO PODEM DISCORDAR ─────────────────────
//
// O WORKER (decide se responde) e a TELA (mostra "1 de 2 hoje"). Escrito duas
// vezes, a tela diria que ainda sobra uma pessoa enquanto o worker já recusa —
// ou o contrário, e aí a conta do LLM corre para quem não pagou.
//
// ─── "PESSOA" É A CONVERSA ─────────────────────────────────────────────────
//
// Um contato é o par (canal, conversa). É o que a IA enxerga: uma conversa de
// WhatsApp, uma DM, uma O.S. A mesma pessoa no WhatsApp e na DM conta duas
// vezes — não há como saber que são a mesma sem pedir dado que não temos.
//
// Dentro do dia, a conversa que JÁ foi atendida continua sendo atendida: o
// limite é de pessoas, não de mensagens. Cortar no meio de uma conversa que o
// atendente começou seria o pior jeito de parar.
//
// ─── O DIA É O DE SÃO PAULO ────────────────────────────────────────────────
//
// Em UTC, o dia virava às 21h e a pessoa ganhava duas vagas novas no meio da
// noite. Mesma régua dos Indicadores (mig 235).
//
// ─── SÓ CONTA O QUE FOI RESPONDIDO ─────────────────────────────────────────
//
// `status = 'done'`: trabalho pulado (o dono já tinha respondido, janela
// fechada) não gastou a vaga de ninguém.

const TZ = "America/Sao_Paulo";

/** Quantas pessoas por dia a camada grátis atende. */
const FREE_CONTACTS_PER_DAY = 2;

/** Assinatura sem data de ciclo conhecida conta os últimos 30 dias. */
const FALLBACK_CYCLE_DAYS = 30;

/**
 * A assinatura paga VIVA da pessoa, ou null.
 *
 * A incluída no Plano Negócio (mig 234) não conta: ela acabou com o plano
 * (mig 263). O filtro `id_plan_subscription IS NULL` segura o caso de alguma
 * ter escapado da migration.
 */
async function getPaidSub(conn, id_user) {
  const r = await conn.query(
    `SELECT s.id_sub, s.status, s.current_period_start, s.activated_at,
            COALESCE(s.reply_limit_monthly, p.reply_limit_monthly) AS reply_limit,
            p.name AS plan_name
       FROM public.tb_atendimento_ia_sub s
       JOIN public.tb_atendimento_ia_plan p ON p.id_plan = s.id_plan
      WHERE s.id_user = $1
        AND s.status IN ('active', 'past_due')
        AND s.id_plan_subscription IS NULL
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [id_user]
  );
  return r.rows[0] || null;
}

/** As conversas atendidas HOJE (dia de São Paulo). */
async function contactsToday(conn, id_user) {
  const r = await conn.query(
    `SELECT DISTINCT channel, ref_id
       FROM public.tb_ai_reply_job
      WHERE id_user = $1
        AND status = 'done'
        AND updated_at >= (date_trunc('day', NOW() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`,
    [id_user]
  );
  return r.rows.map((row) => `${row.channel}:${row.ref_id}`);
}

/** Respostas feitas desde o começo do ciclo. */
async function repliesSince(conn, id_user, since) {
  const r = await conn.query(
    `SELECT COUNT(*)::int AS n
       FROM public.tb_ai_reply_job
      WHERE id_user = $1 AND status = 'done' AND updated_at >= $2`,
    [id_user, since]
  );
  return r.rows[0]?.n || 0;
}

function cycleStart(sub) {
  const fallback = new Date(Date.now() - FALLBACK_CYCLE_DAYS * 86400000);
  const candidates = [sub.current_period_start, sub.activated_at]
    .map((d) => (d ? new Date(d) : null))
    .filter((d) => d && !Number.isNaN(d.getTime()));
  // O começo do ciclo, mas nunca mais de 30 dias atrás: âncora velha (ciclo
  // que o webhook não atualizou) somaria meses e travaria quem está em dia.
  const start = candidates[0] || fallback;
  return start < fallback ? fallback : start;
}

/**
 * O retrato da cota, sem decidir nada — é o que a tela mostra.
 *
 * @returns {Promise<{ tier: 'free'|'paid', plan_name: string|null,
 *   limit: number, used: number, period: 'day'|'cycle', contacts?: string[] }>}
 */
async function getStatus(conn, id_user) {
  const sub = await getPaidSub(conn, id_user);
  if (sub && Number(sub.reply_limit) > 0) {
    const used = await repliesSince(conn, id_user, cycleStart(sub));
    return {
      tier: "paid",
      plan_name: sub.plan_name,
      limit: Number(sub.reply_limit),
      used,
      period: "cycle",
    };
  }
  const contacts = await contactsToday(conn, id_user);
  return {
    tier: "free",
    plan_name: null,
    limit: FREE_CONTACTS_PER_DAY,
    used: contacts.length,
    period: "day",
    contacts,
  };
}

/**
 * Pode responder ESTA conversa agora?
 *
 * @returns {Promise<{ allowed: boolean, status: object }>}
 */
async function canReply(conn, id_user, channel, ref_id) {
  const status = await getStatus(conn, id_user);
  if (status.tier === "paid") {
    return { allowed: status.used < status.limit, status };
  }
  const key = `${channel}:${ref_id}`;
  if (status.contacts.includes(key)) return { allowed: true, status };
  return { allowed: status.used < status.limit, status };
}

/** Já avisamos hoje que a cota acabou? Um aviso por dia, não um por mensagem. */
async function alreadyWarnedToday(conn, id_user) {
  const r = await conn.query(
    `SELECT 1
       FROM public.tb_notification
      WHERE id_recipient_user = $1
        AND type = 'ai_quota_reached'
        AND created_at >= (date_trunc('day', NOW() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')
      LIMIT 1`,
    [id_user]
  );
  return r.rowCount > 0;
}

module.exports = {
  FREE_CONTACTS_PER_DAY,
  getStatus,
  canReply,
  alreadyWarnedToday,
};
