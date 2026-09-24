// src/utils/spaceCaps.js
// Quantos espaços de cada modalidade uma pessoa pode ter.
//
// Decisão do Alex (2026-09-17), olhando o menu da foto de perfil oferecer
// "Cadastrar condomínio" para quem já tinha um: *"só pode uma de condomínio, e
// uma de rua, somente o pet pode ter mais de uma"*.
//
// ⚠️ O TETO NÃO É DO MENU, É DA REGRA — e é por isso que ele mora aqui e não no
// front. O condomínio tem TRÊS portas (o menu, `/comunidades/criar?tipo=condo`
// e a PLANTA, que é como um morador entra no prédio de outra pessoa) e o bairro
// tem duas (criar e entrar). Escondendo só o botão, as outras continuariam
// abertas e o limite seria decoração.
//
// ⚠️ "TER" AQUI É MEMBRESIA, e é o MESMO predicado que o menu desenha
// (`SubjectCommunityStorage.listMySpaces`). Contar só o que a pessoa LIDERA
// deixaria passar o segundo condomínio de quem entrou pela planta — que é
// justamente o caminho de quem só mora. Duas definições de "meu condomínio"
// fariam a pessoa levar "você já tem um" olhando para uma lista vazia.
//
// ⚠️ O PET É A EXCEÇÃO DECLARADA: duas cachorras são duas comunidades, e o
// menu continua listando e oferecendo "Novo pet". Modalidade que não estiver
// nesta tabela não tem teto POR AQUI (a comunidade temática, por exemplo, já é
// limitada pelo ingresso vendido — `create_cap`/`member_cap`).

const SubjectCommunityStorage = require("../storages/SubjectCommunityStorage");

// ⚠️ O CARRO SAIU DA TABELA NA MIG 259 (2026-09-24): "cadastrar o carro dela,
// um ou mais, estilo o meu pet". Ficou sem teto, como o pet.
const SPACE_LIMIT = Object.freeze({
  pet: Infinity,
  car: Infinity,
  condo: 1,
  neighborhood: 1,
});

// A frase diz o que a pessoa JÁ TEM, nunca "não pode": o caminho a partir daqui
// é abrir o que é dela, e é isso que o front oferece com `existing_community`.
const CAP_MESSAGE = Object.freeze({
  condo: "Você já está em um condomínio.",
  neighborhood: "Você já está na comunidade de um bairro.",
});

function limitFor(kind) {
  const n = SPACE_LIMIT[kind];
  return n === undefined ? Infinity : n;
}

/** Modalidade de UM só por pessoa. O front lê o mesmo conceito para decidir se desenha o "+". */
function isSingleSpaceKind(kind) {
  return limitFor(kind) === 1;
}

/**
 * Guarda das modalidades de um só. Devolve `null` quando pode seguir, ou o erro
 * pronto (409 + a comunidade que a pessoa já tem) quando não pode.
 *
 * `allow_id_profile` é o que mantém a porta de RE-ENTRADA aberta: trocar de
 * apartamento dentro do mesmo prédio, ou reabrir a comunidade do carro que já é
 * seu, não é "um segundo espaço" — sem essa folga o guard trancaria quem já
 * está dentro.
 *
 * 409 e não 403 de propósito: a diferença entre *"você não pode"* e *"isso já
 * existe e é seu"* é o que faz a tela oferecer o caminho certo.
 */
async function assertSingleSpace(conn, { id_user, kind, allow_id_profile = null }) {
  if (!id_user || !isSingleSpaceKind(kind)) return null;

  const existing = await SubjectCommunityStorage.findMySpaceByKind(conn, id_user, kind);
  if (!existing) return null;
  if (allow_id_profile && String(existing.id_profile) === String(allow_id_profile)) {
    return null;
  }

  return {
    error: CAP_MESSAGE[kind] || "Você já tem um espaço desse tipo.",
    statusCode: 409,
    existing_community: {
      id_profile: existing.id_profile,
      display_name: existing.display_name,
    },
  };
}

module.exports = {
  SPACE_LIMIT,
  CAP_MESSAGE,
  limitFor,
  isSingleSpaceKind,
  assertSingleSpace,
};
