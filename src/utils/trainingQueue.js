// src/utils/trainingQueue.js
// Fila de treinos do professor (mig 305): quem da academia precisa de ficha
// nova. PURO — a mesma régua do Coliseu (lib/freelandoo/rotulos.ts, barraTreino),
// para a aba Treinos de lá e o modal daqui listarem as mesmas pessoas.
//
// - sem ficha ativa            → "sem_treino"
// - vencida (dias ≤ 0)         → "vencido"
// - faltando ≤ 20% da validade → "vencendo"
// - em dia                     → fora da fila (null)
//
// Quem já tem proposta de ficha esperando o aluno confirmar SAI da fila: o
// professor já fez a parte dele, e listá-lo de novo é o aviso que nunca some.
const { diasRestantes, VALIDADE_PADRAO } = require("./workoutValidity");

const LIMIAR_VENCENDO = 0.2;

/** Situação de um membro na fila, ou null quando o treino está em dia. */
function situacaoTreino({ treino_criado_em, treino_validade_dias, proposta_pendente }, now = Date.now()) {
  if (proposta_pendente) return null;
  if (!treino_criado_em) return "sem_treino";
  const restantes = diasRestantes(treino_criado_em, treino_validade_dias, now);
  if (restantes === null) return "sem_treino";
  if (restantes <= 0) return "vencido";
  const validade = Number(treino_validade_dias) || VALIDADE_PADRAO;
  return restantes / validade <= LIMIAR_VENCENDO ? "vencendo" : null;
}

const ORDEM = { vencido: 0, vencendo: 1, sem_treino: 2 };

/** Linhas do banco → itens da fila, na ordem de urgência (vencido primeiro). */
function montarFila(rows, now = Date.now()) {
  return rows
    .map((r) => {
      const situacao = situacaoTreino(r, now);
      if (!situacao) return null;
      return {
        id_member: r.id_member,
        id_user: r.id_user,
        nome: r.nome,
        situacao,
        treino_nome: r.treino_nome || null,
        dias_restantes: r.treino_criado_em ? diasRestantes(r.treino_criado_em, r.treino_validade_dias, now) : null,
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        ORDEM[a.situacao] - ORDEM[b.situacao] ||
        (a.dias_restantes ?? 0) - (b.dias_restantes ?? 0) ||
        String(a.nome).localeCompare(String(b.nome), "pt-BR")
    );
}

module.exports = { situacaoTreino, montarFila, LIMIAR_VENCENDO };
