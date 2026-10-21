// src/utils/workoutValidity.js
// A FONTE ÚNICA do "a ficha venceu" (mig 296, substitui o workoutExpiry.js).
//
// Até a mig 296 a régua era um número só (PLAN_EXPIRY_DAYS = 90) para todas as
// fichas. Agora a validade é POR FICHA (`tb_workout_plan.validade_dias`,
// 30 / 60 / 90), escolhida por quem monta o treino — aluno ou professor — e o
// vencimento é `created_at + validade_dias` (decisões Q6/Q18 da spec do
// Coliseu: os planos que já existiam ficaram com 90; os novos nascem com 60).
//
// As telas não guardam número nenhum: a API devolve `validade_dias` e
// `vence_em` por ficha, e o corte de "vencida" é feito no banco.
const { z } = require("zod");

const VALIDADE_OPCOES = Object.freeze([30, 60, 90]);
const VALIDADE_PADRAO = 60;

// Aceita número ou string numérica ("60") — o front manda o valor de um
// <select>, e um cliente de API pode mandar qualquer um dos dois.
const validadeDiasSchema = z.coerce
  .number({ message: "Validade inválida." })
  .int("Validade inválida.")
  .refine((n) => VALIDADE_OPCOES.includes(n), { message: "Validade deve ser 30, 60 ou 90 dias." });

/**
 * Lê `validade_dias` de um corpo de requisição.
 * - ausente (undefined/null/"") → `fallback` (passe VALIDADE_PADRAO na
 *   criação; sem fallback = undefined = "não mexer", para a edição);
 * - inválido → { error }.
 */
function parseValidadeDias(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return { value: fallback };
  const r = validadeDiasSchema.safeParse(raw);
  if (!r.success) return { error: r.error.issues[0]?.message || "Validade inválida." };
  return { value: r.data };
}

/** Data de vencimento da ficha (Date) — created_at + validade_dias. */
function venceEm(createdAt, validadeDias) {
  const base = new Date(createdAt);
  if (Number.isNaN(base.getTime())) return null;
  const dias = Number(validadeDias) || VALIDADE_PADRAO;
  return new Date(base.getTime() + dias * 24 * 3600 * 1000);
}

/** Dias inteiros até vencer (negativo = vencida há N dias). */
function diasRestantes(createdAt, validadeDias, now = Date.now()) {
  const v = venceEm(createdAt, validadeDias);
  if (!v) return null;
  return Math.ceil((v.getTime() - now) / (24 * 3600 * 1000));
}

module.exports = {
  VALIDADE_OPCOES,
  VALIDADE_PADRAO,
  validadeDiasSchema,
  parseValidadeDias,
  venceEm,
  diasRestantes,
};
