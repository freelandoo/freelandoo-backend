// src/utils/meuMundoClans.js — MEU MUNDO 3D mm3d-58: as CLASSES (mig 318).
//
// Regra do Alex (2026-10-31): duas classes, RAPOSAS (cajado) e VAMPIROS
// (espada). Todo jogador escolhe ao entrar; cada bairro é de UMA classe (20
// casas — encheu, abre outro da mesma classe); o centro mistura todos. Um
// ARTEFATO raro troca a classe (consumido na troca; recarga de 30 dias).
//
// O corpo da classe não se grava: sai da classe, do sexo e da fase da VIDA
// (jovem → adulto, GROWTH em meuMundoLife.js) — espelho em
// features/meu-mundo/classes.ts do front.

const CLANS = Object.freeze(["raposa", "vampiro"]);
const SEXES = Object.freeze(["m", "f"]);

// [classe][sexo][fase] → corpo (id do GLB, pipeline/build_deuses.py)
const BODY = Object.freeze({
  raposa: Object.freeze({ m: { young: "raposa", adult: "raposa_adulto" }, f: { young: "raposa_f", adult: "raposa_adulta" } }),
  vampiro: Object.freeze({ m: { young: "vampiro", adult: "vampiro_adulto" }, f: { young: "vampira", adult: "vampira_adulta" } }),
});
const CLAN_BODIES = Object.freeze(
  CLANS.flatMap((c) => SEXES.flatMap((s) => [BODY[c][s].young, BODY[c][s].adult]))
);

const ARTIFACT = Object.freeze({ KIND: "troca_classe", COOLDOWN_DAYS: 30 });

const isClan = (v) => CLANS.includes(v);
const isSex = (v) => SEXES.includes(v);

/** Corpo da classe; null sem classe. */
function clanBody(clan, sex, stage) {
  if (!isClan(clan)) return null;
  return BODY[clan][isSex(sex) ? sex : "m"][stage === "adult" ? "adult" : "young"];
}

module.exports = { CLANS, SEXES, CLAN_BODIES, ARTIFACT, isClan, isSex, clanBody };
