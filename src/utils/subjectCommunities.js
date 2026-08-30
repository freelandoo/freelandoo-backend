// src/utils/subjectCommunities.js
// Fonte ÚNICA das três modalidades de comunidade cujo assunto é uma COISA:
// o pet, o carro e o jogo (mig 210).
//
// Módulo puro: sem I/O, sem require de storage. É o que o torna testável e o
// que permite usá-lo em qualquer camada — do controller ao SQL builder.
//
// Por que um módulo e não literais espalhados: foi escrevendo
// `kind === 'condo'` na mão, guard a guard, que os vazamentos C2/C3 do
// condomínio nasceram. Modalidade nova declara aqui o que é, e o resto do
// sistema pergunta em vez de lembrar.

const SUBJECT_KINDS = Object.freeze(["pet", "car", "games"]);

// Modalidades PESSOAIS: o assunto pertence a uma pessoa e cada dono cria a sua
// (dois cachorros da mesma raça são duas comunidades). Elas ficam fora do
// ranking de comunidades — uma comunidade de 1 membro competindo com uma de 300
// não mede nada, só polui a tabela.
const PERSONAL_KINDS = Object.freeze(["pet", "games"]);

// Modalidades COLETIVAS: o assunto é do mundo, não de alguém. Uma por assunto
// no site inteiro, garantida por índice (ux_profile_car_model).
const COLLECTIVE_KINDS = Object.freeze(["car"]);

// Cada modalidade tem kill-switch próprio: elas podem ser seguradas em momentos
// diferentes (o carro depende da FIPE, o pet não depende de nada).
const FEATURE_FLAG = Object.freeze({
  pet: "pet",
  car: "carro",
  games: "games",
});

const PET_SPECIES = Object.freeze(["dog", "cat", "other"]);

const GAME_PLATFORMS = Object.freeze([
  "pc",
  "playstation",
  "xbox",
  "nintendo",
  "mobile",
  "retro",
  "outra",
]);

const MAX = Object.freeze({
  display_name: 80,
  bio: 200,
  breed_label: 80,
  game_title: 120,
  gamertag: 60,
  brand_code: 16,
  brand_label: 80,
  model_code: 32,
  model_label: 120,
});

function isSubjectKind(kind) {
  return SUBJECT_KINDS.includes(kind);
}

function isPersonalKind(kind) {
  return PERSONAL_KINDS.includes(kind);
}

function trimOrNull(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

/** Nome + bio, as duas coisas que TODA comunidade tem. */
function normalizeCommon(payload) {
  const display_name = trimOrNull(payload?.display_name, MAX.display_name);
  const bio = trimOrNull(payload?.bio, MAX.bio);
  return { display_name, bio };
}

/**
 * Pet. `is_mixed` (vira-lata) é decidido pela raça escolhida e não pelo cliente:
 * é o catálogo que sabe qual linha é SRD, e deixar o front declarar isso abriria
 * a porta para um Golden marcado como vira-lata.
 */
function validatePet(payload, breedRow) {
  const { display_name } = normalizeCommon(payload);
  if (!display_name) return { error: "Dê um nome ao seu pet." };
  const species = String(payload?.species || "").trim();
  if (!PET_SPECIES.includes(species)) {
    return { error: "Escolha se é cachorro, gato ou outro animal." };
  }
  // Raça é opcional de propósito: quem não sabe a raça do bicho que resgatou
  // não pode ficar impedido de criar a comunidade dele.
  const breed_label =
    (breedRow && breedRow.label) || trimOrNull(payload?.breed_label, MAX.breed_label);
  const birthYearRaw = payload?.birth_year;
  let birth_year = null;
  if (birthYearRaw !== undefined && birthYearRaw !== null && birthYearRaw !== "") {
    const n = Number(birthYearRaw);
    const currentYear = new Date().getUTCFullYear();
    if (!Number.isInteger(n) || n < 1970 || n > currentYear) {
      return { error: "Ano de nascimento inválido." };
    }
    birth_year = n;
  }
  return {
    species,
    id_breed: breedRow ? breedRow.id_breed : null,
    breed_label,
    is_mixed: breedRow ? !!breedRow.is_mixed : false,
    birth_year,
  };
}

/** Games. Sem catálogo global: não existe "dono do Minecraft". */
function validateGame(payload) {
  const game_title = trimOrNull(payload?.game_title, MAX.game_title);
  if (!game_title) return { error: "Informe o jogo." };
  const platform = String(payload?.platform || "").trim();
  if (!GAME_PLATFORMS.includes(platform)) {
    return { error: "Escolha a plataforma." };
  }
  return {
    platform,
    game_title,
    gamertag: trimOrNull(payload?.gamertag, MAX.gamertag),
  };
}

/**
 * Carro. Os rótulos são gravados junto dos códigos porque a FIPE renomeia e
 * aposenta modelo: se a comunidade dependesse de uma consulta viva para saber o
 * próprio nome, ela ficaria anônima no dia em que o modelo saísse da tabela.
 */
function validateCar(payload) {
  const brand_code = trimOrNull(payload?.brand_code, MAX.brand_code);
  const model_code = trimOrNull(payload?.model_code, MAX.model_code);
  const brand_label = trimOrNull(payload?.brand_label, MAX.brand_label);
  const model_label = trimOrNull(payload?.model_label, MAX.model_label);
  if (!brand_code || !brand_label) return { error: "Escolha a marca do carro." };
  if (!model_code || !model_label) return { error: "Escolha o modelo do carro." };
  return { brand_code, model_code, brand_label, model_label };
}

/** Nome default da comunidade do carro: "Marca Modelo". */
function carDisplayName({ brand_label, model_label }) {
  return `${brand_label} ${model_label}`.trim().slice(0, MAX.display_name);
}

module.exports = {
  SUBJECT_KINDS,
  PERSONAL_KINDS,
  COLLECTIVE_KINDS,
  FEATURE_FLAG,
  PET_SPECIES,
  GAME_PLATFORMS,
  MAX,
  isSubjectKind,
  isPersonalKind,
  trimOrNull,
  normalizeCommon,
  validatePet,
  validateGame,
  validateCar,
  carDisplayName,
};
