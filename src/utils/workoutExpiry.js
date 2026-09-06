// src/utils/workoutExpiry.js
// A FONTE ÚNICA do "a ficha venceu".
//
// Ficha vencida = o aluno está com a MESMA ficha ativa há PLAN_EXPIRY_DAYS dias
// ou mais. É a régua que acende a bolinha vermelha no botão "Membros" da
// academia, monta o modal que recebe o professor e marca a linha na grade de
// treinos por data.
//
// Mora aqui, e não espalhado nas telas, porque as três superfícies precisam
// concordar: um 90 escrito no front e outro no SQL vira aluno listado no modal
// que não aparece marcado na grade — divergência calada, do tipo que ninguém
// percebe até o professor desconfiar do aviso.
//
// A resposta da API carrega o número (`days`), então mudar aqui muda as três
// telas sem deploy do front.
const PLAN_EXPIRY_DAYS = 90;

module.exports = { PLAN_EXPIRY_DAYS };
