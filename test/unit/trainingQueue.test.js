const test = require("node:test");
const assert = require("node:assert/strict");
const { situacaoTreino, montarFila } = require("../../src/utils/trainingQueue");

const DIA = 24 * 3600 * 1000;
const AGORA = Date.parse("2026-10-26T12:00:00Z");
const criadoHa = (dias) => new Date(AGORA - dias * DIA).toISOString();

test("sem ficha ativa entra como sem_treino", () => {
  assert.equal(situacaoTreino({ treino_criado_em: null }, AGORA), "sem_treino");
});

test("ficha vencida e ficha vencendo (≤ 20% da validade)", () => {
  assert.equal(situacaoTreino({ treino_criado_em: criadoHa(61), treino_validade_dias: 60 }, AGORA), "vencido");
  assert.equal(situacaoTreino({ treino_criado_em: criadoHa(60), treino_validade_dias: 60 }, AGORA), "vencido");
  assert.equal(situacaoTreino({ treino_criado_em: criadoHa(50), treino_validade_dias: 60 }, AGORA), "vencendo");
  assert.equal(situacaoTreino({ treino_criado_em: criadoHa(10), treino_validade_dias: 60 }, AGORA), null);
});

test("proposta de ficha esperando o aluno tira da fila", () => {
  assert.equal(situacaoTreino({ treino_criado_em: null, proposta_pendente: true }, AGORA), null);
  assert.equal(
    situacaoTreino({ treino_criado_em: criadoHa(90), treino_validade_dias: 30, proposta_pendente: true }, AGORA),
    null
  );
});

test("fila ordena vencido, vencendo, sem treino e descarta quem está em dia", () => {
  const fila = montarFila(
    [
      { id_member: "a", nome: "Ana", treino_criado_em: null },
      { id_member: "b", nome: "Bia", treino_criado_em: criadoHa(55), treino_validade_dias: 60 },
      { id_member: "c", nome: "Caio", treino_criado_em: criadoHa(5), treino_validade_dias: 60 },
      { id_member: "d", nome: "Duda", treino_criado_em: criadoHa(100), treino_validade_dias: 30 },
      { id_member: "e", nome: "Edu", treino_criado_em: criadoHa(40), treino_validade_dias: 30 },
    ],
    AGORA
  );
  assert.deepEqual(
    fila.map((f) => [f.id_member, f.situacao]),
    [
      ["d", "vencido"],
      ["e", "vencido"],
      ["b", "vencendo"],
      ["a", "sem_treino"],
    ]
  );
});
