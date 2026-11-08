// GERADO por scripts/build-characters-sim.js a partir de
// freelandoo frontend/.../features/meu-mundo/characters/*.ts — NÃO EDITAR AQUI.
// Mudou a regra dos personagens no front? Rode o script e commite os dois repos juntos.
/* eslint-disable */
"use strict";

// ── characters/rules.ts ───────────────────────────────────────────────────────────
// features/meu-mundo/characters/rules.ts — B3 (2026-11-08): PERSONAGENS no lugar das skins.
//
// Fonte ÚNICA da regra dos personagens individuais; o servidor roda a cópia GERADA
// (freelandoo-backend/src/utils/meuMundoCharacters.js, scripts/build-characters-sim.js).
// Mudou aqui → rode o script no back e commite os dois repos juntos (o unit confere).
//
// Decisões do Alex (08/11):
//  • vários personagens por jogador, UM ativo; os outros ficam na CÁPSULA, congelados
//    (5 vagas: CAPSULE.SLOTS);
//  • as skins viraram ESPÉCIES (SPECIES): quem tinha uma ganhou um personagem dela;
//  • todos nascem com 1,00 m e crescem em linha até a altura de jovem em 30 dias de vida
//    ativa; viram adultos pela regra GROWTH da vida e crescem até a altura final da espécie
//    em mais 30 dias;
//  • FUSÃO de dois adultos vivos: os pais somem, o filho nasce com 20% do maior pico entre
//    eles em cada atributo, a espécie é escolhida entre as dos pais (sem sorteio) e a
//    personalidade/alma se misturam pela semente.
// Módulo PURO: sem import/export de outros arquivos (o gerador do back não entende).

/** Espécie: id (= id do corpo, salvo as classes), altura final, altura de jovem e sexo. */
                             
            
                                                                                           
                                  
                                    
               
                                                                           
                                 
                                                             
                       
 

const CLAN_YOUNG = { m: 1.7, f: 1.65 }
/** Jovem das espécies de corpo único: a mesma proporção jovem/adulto das classes (1,70 / 2,40). */
const YOUNG_RATIO = 1.7 / 2.4
const youngOf = (adult        ) => {
  const v = Math.round(Math.max(1, adult * YOUNG_RATIO) * 100) / 100
  return { m: v, f: v }
}
const god = (id        , adult        , sex           )             => ({ id, kind: "god", adult, young: youngOf(adult), sex })
const special = (id        , adult        , sex           )             => ({ id, kind: "special", adult, young: youngOf(adult), sex })

const SPECIES                        = Object.freeze([
  { id: "raposa", kind: "clan", adult: 2.4, young: CLAN_YOUNG, sex: null },
  { id: "vampiro", kind: "clan", adult: 2.4, young: CLAN_YOUNG, sex: null },
  god("aurion", 3.2, "m"),
  god("morkhan", 3.2, "m"),
  god("kragor", 3.2, "m"),
  god("zephyra", 3.2, "f"),
  god("maru", 3.2, "m"),
  god("iris", 3.2, "f"),
  god("noctis", 3.2, "m"),
  god("aeryn", 3.2, "f"),
  special("ciborgue", 2.7, "m"),
  special("cavaleiro", 2.0, "m"),
  special("golem", 4.0, "m"),
  special("garras", 2.0, "f"),
  special("brutamontes", 4.0, "m"),
  special("sergio", 1.8, "m"),
  special("ekaterina", 1.8, "f"),
]                )

const SPECIES_IDS                    = Object.freeze(SPECIES.map((s) => s.id))

const speciesById = (id                           )                    => SPECIES.find((s) => s.id === id) ?? null

/** [classe][sexo][fase] → corpo (espelho de meuMundoClans.js BODY / classes.ts). */
const CLAN_BODY                                                                      = {
  raposa: { m: { young: "raposa", adult: "raposa_adulto" }, f: { young: "raposa_f", adult: "raposa_adulta" } },
  vampiro: { m: { young: "vampiro", adult: "vampiro_adulto" }, f: { young: "vampira", adult: "vampira_adulta" } },
}

/** Sexo que vale para a espécie (a espécie de sexo fixo manda; senão o do personagem; padrão m). */
function speciesSex(species                           , sex                           )            {
  const d = speciesById(species)
  if (d && d.sex) return d.sex
  return sex === "f" ? "f" : "m"
}

/** Corpo que a cena desenha para a espécie; null = espécie desconhecida (quem chama decide). */
function speciesBody(species                           , sex                           , stage                           )                {
  const d = speciesById(species)
  if (!d) return null
  if (d.kind === "clan") return CLAN_BODY[d.id][speciesSex(d.id, sex)][stage === "adult" ? "adult" : "young"]
  return d.id
}

// ═══ CRESCER ═══
const GROW = Object.freeze({ BIRTH: 1.0, YOUNG_DAYS: 30, ADULT_DAYS: 30 })
const DAY_MS = 86400000
const at01 = (v        ) => (v < 0 ? 0 : v > 1 ? 1 : v)
const r2 = (v        ) => Math.round(v * 100) / 100

                             
                       
                                                                                      
                      
                                                   
                    
 

/**
 * Altura de agora (m, 2 casas): 1,00 m ao nascer → altura de jovem em 30 dias de vida
 * ativa (em linha); fica nela até virar adulto; adulto → altura final em mais 30 dias.
 * Espécie desconhecida: 1,80 (a dos avatares do bairro).
 */
function speciesHeight(species                           , sex                           , growth                               , t        )         {
  const d = speciesById(species)
  if (!d) return 1.8
  const young = d.young[speciesSex(d.id, sex)]
  const from = growth && growth.from ? Number(growth.from) : 0
  const at = growth && growth.at ? Number(growth.at) : 0
  if (growth && growth.stage === "adult") {
    const k = at > 0 ? at01((t - at) / (GROW.ADULT_DAYS * DAY_MS)) : 1
    return r2(young + (d.adult - young) * k)
  }
  const k = from > 0 ? at01((t - from) / (GROW.YOUNG_DAYS * DAY_MS)) : 1
  return r2(GROW.BIRTH + (young - GROW.BIRTH) * k)
}

/** Dias de vida ATIVA (o nascimento já vem deslocado pelo tempo congelado). */
function activeDays(growth                               , t        )         {
  const from = growth && growth.from ? Number(growth.from) : 0
  return from > 0 ? Math.max(0, Math.floor((t - from) / DAY_MS)) : 0
}

// ═══ CÁPSULA ═══
const CAPSULE = Object.freeze({ SLOTS: 5 })

// ═══ FUSÃO ═══
const FUSION = Object.freeze({ INHERIT: 0.2 })
/** Atributos herdados na fusão (os de prática; mesmo conjunto de ATTRS da vida). */
const FUSION_ATTRS                    = Object.freeze(["strength", "intelligence", "dexterity", "speed", "accuracy"])

/** O que o filho herda: 20% do MAIOR pico entre os dois pais, por atributo (2 casas). */
function fusionInherit(peaksA                                           , peaksB                                           )                         {
  const out                         = {}
  for (const k of FUSION_ATTRS) {
    const a = Number((peaksA && peaksA[k]) || 0)
    const b = Number((peaksB && peaksB[k]) || 0)
    out[k] = r2(FUSION.INHERIT * Math.max(a, b))
  }
  return out
}

/** Espécies que o filho pode ter (as dos pais, sem repetir; sem sorteio). */
function fusionSpecies(speciesA                           , speciesB                           )           {
  const out           = []
  for (const s of [speciesA, speciesB]) if (s && speciesById(s) && !out.includes(s)) out.push(s)
  return out
}

/** Semente do filho: mistura determinística das duas (a ordem dos pais não importa). */
function fusionSeed(seedA        , seedB        )         {
  const lo = Math.min(seedA | 0, seedB | 0) >>> 0
  const hi = Math.max(seedA | 0, seedB | 0) >>> 0
  let h = (Math.imul(lo ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(hi ^ 0xc2b2ae35, 0x27d4eb2f)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  return (h % 2147483646) + 1
}

/** Gerador pela semente (mulberry32), o mesmo jeito da vida. */
function rngOf(seed        ) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Personalidade do filho: média dos pais ± 0,1 pela semente (0–1, 2 casas). */
function fusionPersonality(pA                                           , pB                                           , seed        )                         {
  const r = rngOf(seed)
  const keys = ["discipline", "anxiety", "optimism", "appetite", "resilience", "metabolism"]
  const out                         = {}
  for (const k of keys) {
    const a = Number((pA && pA[k]) ?? 0.5)
    const b = Number((pB && pB[k]) ?? 0.5)
    out[k] = r2(at01((a + b) / 2 + (r() - 0.5) * 0.2))
  }
  return out
}

/** Temperamento do filho: o de um dos pais, escolhido pela semente (nunca um terceiro). */
function fusionTemper(temperA                           , temperB                           , seed        )                {
  const opts = [temperA, temperB].filter((x)              => !!x)
  if (!opts.length) return null
  const r = rngOf(seed ^ 0x5bd1e995)
  return opts[Math.floor(r() * opts.length) % opts.length]
}

// ═══ CERTIFICADO ═══
/** Número de série visível: MM-000123. */
const serialText = (n                                    )         => `MM-${String(Number(n) || 0).padStart(6, "0")}`

// ═══ SKINS → ESPÉCIES (conversão da mig 340) ═══
/**
 * A skin que a pessoa tinha (tb_mm_skin_owned) → espécie e sexo do personagem que ela ganha.
 * "feminina" era a versão feminina do padrão (não é espécie) e fica de fora; as skins de
 * teste das classes viram a espécie da classe com o sexo do corpo.
 */
const SKIN_SPECIES                                                                = Object.freeze({
  sergio: { species: "sergio", sex: "m" },
  ekaterina: { species: "ekaterina", sex: "f" },
  aurion: { species: "aurion", sex: "m" },
  morkhan: { species: "morkhan", sex: "m" },
  kragor: { species: "kragor", sex: "m" },
  zephyra: { species: "zephyra", sex: "f" },
  maru: { species: "maru", sex: "m" },
  iris: { species: "iris", sex: "f" },
  noctis: { species: "noctis", sex: "m" },
  aeryn: { species: "aeryn", sex: "f" },
  ciborgue: { species: "ciborgue", sex: "m" },
  cavaleiro: { species: "cavaleiro", sex: "m" },
  golem: { species: "golem", sex: "m" },
  garras: { species: "garras", sex: "f" },
  brutamontes: { species: "brutamontes", sex: "m" },
  raposa: { species: "raposa", sex: "m" },
  "raposa-f": { species: "raposa", sex: "f" },
  "raposa-adulto": { species: "raposa", sex: "m" },
  "raposa-adulta": { species: "raposa", sex: "f" },
  vampiro: { species: "vampiro", sex: "m" },
  vampira: { species: "vampiro", sex: "f" },
  "vampiro-adulto": { species: "vampiro", sex: "m" },
  "vampira-adulta": { species: "vampiro", sex: "f" },
})

module.exports = { SPECIES, SPECIES_IDS, speciesById, speciesSex, speciesBody, GROW, speciesHeight, activeDays, CAPSULE, FUSION, FUSION_ATTRS, fusionInherit, fusionSpecies, fusionSeed, fusionPersonality, fusionTemper, serialText, SKIN_SPECIES };
