// src/utils/meuMundoDomains.js — MEU MUNDO 3D, lore v2 D1: os Seis Domínios (regra pura).
//
// A lore (historia/v2/04-mundo-exploravel.md): cada Domínio tem 10 setores; o
// setor 10 é o deus. Decisão do Alex (10/11): os seis são uma TRAVESSIA, em
// ordem fixa — só se chega ao próximo atravessando o anterior (vencer o setor
// 10 abre a passagem) E com o nível do treinador da tabela (5, 9, 13, 17, 21,
// 25). Quem já atravessou volta direto ao começo de qualquer Domínio aberto.
// Liberou o setor, ele fica livre para lutar de novo.
//
// O cliente NÃO tem cópia desta tabela: o GET /domains manda tudo pronto
// (aberto/fechado, setores, nível e Poder recomendado). Quem decide é o
// servidor (MeuMundoDomainService), o aparelho só desenha.
//
// Monstros: sem arte nova na D1, cada setor usa um corpo que já existe, na
// ordem da lore (1–3 comuns, 4–6 fortes, 7–8 elite, 9 guardião, 10 o deus). Os
// Lobos de Ferrugem já são o elite da Floresta. As fatias D2 e D5…D9 trocam
// os placeholders pelos mutantes de cada Domínio.
//
// Nível do monstro: pela régua do B7 (a soma dos status do monstro ≈ o Poder
// recomendado; o Brutamontes nv. 15 ≈ 2.300), o menor nível cuja soma alcança
// o Poder recomendado do setor, nunca menor que o do setor anterior. A D2
// calibrou a Floresta com robô lutando (LEVELS_BY_DOMAIN): a régua do B7 deixava
// tudo no nv. 1 e o robô vencia 100% dos setores.
"use strict";

const FightSim = require("./meuMundoFight");

const SECTORS = 10;

const DOMAINS = Object.freeze(
  [
    { id: "floresta", god: "noctis", need: 5, power: [870, 8820], kit: "floresta" },
    { id: "canion", god: "zephyra", need: 9, power: [9260, 11540], kit: "canion" },
    { id: "gelo", god: "maru", need: 13, power: [11800, 13900], kit: "gelo" },
    { id: "fabrica", god: "aeryn", need: 17, power: [14130, 15970], kit: "fabrica" },
    { id: "vulcao", god: "kragor", need: 21, power: [16140, 17860], kit: "forja" },
    { id: "orbital", god: "iris", need: 25, power: [18390, 21690], kit: "orbital" },
  ].map((d) => Object.freeze({ ...d, power: Object.freeze(d.power) }))
);
const DOMAIN_IDS = Object.freeze(DOMAINS.map((d) => d.id));
const BY_ID = new Map(DOMAINS.map((d, i) => [d.id, { ...d, index: i }]));

/** Corpos de hoje por setor (placeholders até a fatia de cada Domínio). */
const SECTOR_KINDS = Object.freeze(["cavaleiro", "cavaleiro", "cavaleiro", "garras", "garras", "garras", "wolf", "wolf", "stone", "brute"]);
/**
 * D2 — a Floresta da Lua pela lore (historia/v2/04-mundo-exploravel.md §1). A REGRA da luta
 * é a de um tipo que já existe (sem tipo novo: a luta antiga não muda, sem RULES_VERSION);
 * quem a criatura É fica em FOES (nome da lore + o corpo que a desenha). Mutantes sem arte
 * (Mariposas, Cervo Oco, Coruja de Mil Olhos) seguem no corpo de placeholder até o Alex
 * mandar as peças (roteiro §4).
 *   1–2 Mariposas Cinzentas · 3–4 Cervos Ocos / Corujas de Mil Olhos (placeholders)
 *   5–6 Sonâmbulos (Raposas de olhos fechados: corpo da Raposa adulta, lutando de mão)
 *   7–8 Lobos de Ferrugem (elite, já existem) · 9 Selene de Sombra (Vampira adulta, espada)
 *   10 NOCTIS (o corpo do deus, de arma de fogo: a regra do Ciborgue + as fases da D4, BOSS_BY_DOMAIN)
 */
/**
 * D5 — o Cânion das Tempestades pela lore (§2), no mesmo molde:
 *   1–2 Abutres de Pó (animal; placeholder) · 3 Chacais de Vento (o bando dos lobos, placeholder)
 *   4–5 Mensageiros Sem Rosto (Raposas rápidas: regra da Dama, corpo da Raposa adulta de mão)
 *   6 Escorpião Para-raios (regra do Brutamontes, placeholder) · 7–8 Harpias (elite: a Dama das Garras,
 *   que nasceu como o tipo `harpy`) · 9 A Carta (redemoinho de papel e raio: regra do Golem de Pedra,
 *   o do raio reto; placeholder) · 10 ZÉPHYRA (corpo da deusa com a espada: regra do Cavaleiro + fases)
 */
const KINDS_BY_DOMAIN = Object.freeze({
  floresta: Object.freeze(["cavaleiro", "cavaleiro", "garras", "garras", "brute", "brute", "wolf", "wolf", "cavaleiro", "ciborgue"]),
  canion: Object.freeze(["cavaleiro", "cavaleiro", "wolf", "garras", "garras", "brute", "garras", "garras", "stone", "cavaleiro"]),
  // Domínios v2 (DV6–DV9, §3–6), no mesmo molde da D5: regra = tipo que já existe; quem a criatura É
  // fica em FOES. Mar de Gelo: Peixes-Lanterna 1–2, Caranguejos-Âncora 3 (o machado), Afogados da Maré
  // 4–5 (Raposa adulta de mão), Serpentes do Rio 6 (o bando dos lobos), Ciborgue 7–8 (elite, Tomé),
  // Ondina 9 (Raposa adulta de espada), MARÚ 10 (espada, regra do Cavaleiro + fases).
  gelo: Object.freeze(["cavaleiro", "cavaleiro", "brute", "garras", "garras", "wolf", "ciborgue", "ciborgue", "cavaleiro", "cavaleiro"]),
  // Fábrica de Bronze: Ratos de Engrenagem 1–2, Aranhas-Relógio 3, Cobaias 4–5 (Raposa adulta de mão),
  // Golens de Sucata 6 (o Golem), Dama das Garras 7–8 (elite, a cobaia 14), A Esteira 9 (o braço: o
  // Brutamontes), AERYN 10 (arqueira de luz: regra de tiro do Ciborgue + fases).
  fabrica: Object.freeze(["wolf", "wolf", "garras", "garras", "garras", "stone", "garras", "garras", "brute", "ciborgue"]),
  // Vulcão de Kragor: Salamandras de Brasa 1–2, Mineiros Fundidos 3–4 (Raposa adulta de mão), Touros de
  // Lava 5, Lutadores do Poço 6, Golem de Pedra 7–8 (elite), Brutamontes 9 (porteiro), KRAGOR 10 (machado).
  vulcao: Object.freeze(["wolf", "wolf", "garras", "garras", "brute", "cavaleiro", "stone", "stone", "brute", "brute"]),
  // Cidade Orbital: Pombas Prismáticas 1–2, Camaleões Rachados 3, Pintores Sem Cor 4–5 (Raposa adulta de
  // mão), Espelhos 6, Cavaleiro Dourado 7–8 (elite), O Arco Partido 9 (o raio reto do Golem), ÍRIS 10.
  orbital: Object.freeze(["garras", "garras", "wolf", "garras", "garras", "cavaleiro", "cavaleiro", "cavaleiro", "stone", "ciborgue"]),
});

/**
 * Quem o monstro do setor É (lore) e o corpo que o desenha. `body` = skin que existe;
 * `rig` = luta com os golpes/arma do tipo (espada, arma de fogo); sem `rig` = de mão,
 * como o desafio do Hall. `art: false` = placeholder até a arte do Alex.
 */
const FOES_BY_DOMAIN = Object.freeze({
  floresta: Object.freeze([
    { id: "mariposa", art: false },
    { id: "mariposa", art: false },
    { id: "cervo", art: false },
    { id: "coruja", art: false },
    { id: "sonambulo", body: "raposa_adulto", art: true },
    { id: "sonambulo", body: "raposa_adulto", art: true },
    { id: "lobo", art: true },
    { id: "lobo", art: true },
    { id: "selene", body: "vampira_adulta", rig: true, art: false },
    { id: "noctis", body: "noctis", rig: true, art: true },
  ].map((f) => Object.freeze(f))),
  canion: Object.freeze([
    { id: "abutre", art: false },
    { id: "abutre", art: false },
    { id: "chacal", art: false },
    { id: "mensageiro", body: "raposa_adulto", art: false },
    { id: "mensageiro", body: "raposa_adulto", art: false },
    { id: "escorpiao", art: false },
    { id: "harpia", art: true },
    { id: "harpia", art: true },
    { id: "carta", art: false },
    { id: "zephyra", body: "zephyra", rig: true, art: true },
  ].map((f) => Object.freeze(f))),
  gelo: Object.freeze([
    { id: "peixe", art: false },
    { id: "peixe", art: false },
    { id: "caranguejo", art: false },
    { id: "afogado", body: "raposa_adulto", art: false },
    { id: "afogado", body: "raposa_adulto", art: false },
    { id: "serpente", art: false },
    { id: "ciborgue", art: true },
    { id: "ciborgue", art: true },
    { id: "ondina", body: "raposa_adulta", rig: true, art: false },
    { id: "maru", body: "maru", rig: true, art: true },
  ].map((f) => Object.freeze(f))),
  fabrica: Object.freeze([
    { id: "rato", art: false },
    { id: "rato", art: false },
    { id: "aranha", art: false },
    { id: "cobaia", body: "raposa_adulto", art: false },
    { id: "cobaia", body: "raposa_adulto", art: false },
    { id: "sucata", art: false },
    { id: "garras", art: true },
    { id: "garras", art: true },
    { id: "esteira", art: false },
    { id: "aeryn", body: "aeryn", rig: true, art: true },
  ].map((f) => Object.freeze(f))),
  vulcao: Object.freeze([
    { id: "salamandra", art: false },
    { id: "salamandra", art: false },
    { id: "mineiro", body: "raposa_adulto", art: false },
    { id: "mineiro", body: "raposa_adulto", art: false },
    { id: "touro", art: false },
    { id: "lutador", body: "raposa_adulto", rig: true, art: false },
    { id: "golem", art: true },
    { id: "golem", art: true },
    { id: "brutamontes", art: true },
    { id: "kragor", body: "kragor", rig: true, art: true },
  ].map((f) => Object.freeze(f))),
  orbital: Object.freeze([
    { id: "pomba", art: false },
    { id: "pomba", art: false },
    { id: "camaleao", art: false },
    { id: "pintor", body: "raposa_adulto", art: false },
    { id: "pintor", body: "raposa_adulto", art: false },
    { id: "espelho", body: "raposa_adulta", rig: true, art: false },
    { id: "cavaleiro", art: true },
    { id: "cavaleiro", art: true },
    { id: "arco", art: false },
    { id: "iris", body: "iris", rig: true, art: true },
  ].map((f) => Object.freeze(f))),
});

/**
 * Nível do monstro calibrado com ROBÔ (scripts/mm-domain-calibrate.js --fit): a ficha com o
 * Poder recomendado do setor (a da lore) vence a fração TARGET do setor. Domínio sem tabela
 * cai na régua do B7 (sectorLevel).
 */
// S14 (2026-11-12, proposta aprovada pelo Alex "Aprovo, grava"): os deuses viram o muro de "6 meses de
// jogo bem jogado" (20 vitórias/dia) e os setores 1–9 sobem junto. Conta: scripts/mm-boss-wall.js
// (o herói do dia D pela regra real; robô do mm-domain-calibrate). Floresta medida (setor 1 no dia 2,
// Noctis no dia 180); os outros com --fit: setores do deus anterior até perto do próprio, deus em
// 270/365/455/545/730 dias. A trava de treinador (5, 9, 13, 17, 21, 25) fica.
const LEVELS_BY_DOMAIN = Object.freeze({
  floresta: Object.freeze([6, 9, 15, 20, 23, 30, 44, 60, 66, 97]),
  // --fit (40 lutas por ponto): robô no alvo do setor ou acima; deus 45–57% no dia dele.
  canion: Object.freeze([79, 84, 108, 108, 112, 112, 131, 131, 131, 135]),
  gelo: Object.freeze([104, 105, 124, 150, 150, 150, 150, 150, 175, 192]),
  fabrica: Object.freeze([159, 164, 184, 184, 184, 184, 194, 194, 194, 221]),
  vulcao: Object.freeze([204, 213, 213, 213, 213, 213, 213, 226, 232, 242]),
  orbital: Object.freeze([225, 244, 244, 259, 259, 259, 267, 267, 288, 289]),
});
const tbl = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze(v)])));
/**
 * Nível de aventura e Poder do herói no dia-alvo de cada setor (mm-boss-wall: 20 vitórias/dia;
 * equipamento raro +10 até Noctis, épico +15 depois, lendário +15 na Orbital). O robô de calibrar
 * luta com esse herói; o Poder vira o "Poder recomendado" do painel.
 */
const HEROES_BY_DOMAIN = tbl({
  floresta: [5, 7, 11, 14, 19, 24, 30, 41, 55, 70],
  canion: [72, 74, 76, 78, 80, 82, 84, 86, 88, 90],
  gelo: [92, 93, 95, 97, 99, 101, 103, 104, 106, 108],
  fabrica: [110, 111, 113, 114, 116, 118, 119, 121, 122, 124],
  vulcao: [125, 127, 128, 130, 131, 133, 134, 135, 137, 138],
  orbital: [141, 144, 147, 150, 152, 155, 158, 160, 163, 166],
});
const POWER_BY_DOMAIN = tbl({
  floresta: [870, 1140, 1620, 2010, 2550, 3140, 3900, 5240, 6930, 8820],
  canion: [9260, 9520, 9780, 10040, 10290, 10550, 10800, 11050, 11300, 11540],
  gelo: [11800, 11990, 12250, 12490, 12750, 12980, 13230, 13420, 13670, 13900],
  fabrica: [14130, 14310, 14540, 14720, 14940, 15170, 15350, 15570, 15750, 15970],
  vulcao: [16140, 16360, 16530, 16750, 16920, 17140, 17310, 17480, 17690, 17860],
  orbital: [18390, 18780, 19170, 19540, 19880, 20250, 20630, 20950, 21330, 21690],
});
/**
 * D4: o deus do setor 10 luta em FASES (regra `BOSSES` em meuMundoFight.js, setup.boss no
 * ticket). Domínio sem chefão com fases (ainda sem fatia) luta como antes.
 */
const BOSS_BY_DOMAIN = Object.freeze({ floresta: "noctis", canion: "zephyra", gelo: "maru", fabrica: "aeryn", vulcao: "kragor", orbital: "iris" });
/** O chefão com fases do setor (só o 10), ou null. */
const bossOf = (domainId, sector) => (sector === SECTORS && BOSS_BY_DOMAIN[domainId]) || null;
/** Vitórias do robô com o Poder recomendado, do setor 1 ao 10 (o fim fica no deus). */
const TARGET = Object.freeze([0.9, 0.86, 0.82, 0.78, 0.74, 0.7, 0.66, 0.62, 0.56, 0.5]);
/** Nível de aventura que o robô usa em cada setor (S14: o herói do dia-alvo do setor). */
const heroOf = (domainId, sector) => {
  const t = HEROES_BY_DOMAIN[domainId];
  return t && sectorOk(sector) ? t[sector - 1] : 1;
};

/**
 * Lugares da cena: Pedraverde (a clareira com o Golem sentado) fica ao lado do setor 6 da Floresta.
 * `spots` = pontos dentro do lugar que também viram visita (C5: "golem", a ~4 m dele, sem arma).
 */
const PLACES_BY_DOMAIN = Object.freeze({
  floresta: Object.freeze([Object.freeze({ id: "pedraverde", sector: 6, spots: Object.freeze(["golem"]) })]),
});

/**
 * C5: o lugar já está ao alcance? A clareira fica ao lado do setor dela, então abre
 * junto com o setor (o anterior vencido). Devolve o lugar ou null.
 */
function placeOf(domainId, placeId) {
  return (PLACES_BY_DOMAIN[domainId] || []).find((p) => p.id === placeId) || null;
}
function placeOpen(domainId, placeId, best = {}, bypass = false) {
  const p = placeOf(domainId, placeId);
  if (!p) return false;
  return !!bypass || p.sector <= (Number(best[domainId]) || 0) + 1;
}

/**
 * Domínios v2 (DV1, plano MEU MUNDO 3D/planos/2026-11-11-dominios-v2.md): MUNDO ABERTO, 3 cenas
 * por Domínio. Cena = faixa de setores; o chefe da cena é o último setor dela (cena 3: o guardião
 * (9) na porta do castelo e o deus (10) dentro). A passagem para a cena seguinte abre quando o
 * chefe da cena anterior cai — é o mesmo que o primeiro setor da cena seguinte abrir, então as
 * travas de setor (sectorOpen) continuam as mesmas. O arquivo da cena no aparelho é
 * `<domínio>-<n>` (front: features/meu-mundo/engine/cena-codigo/cenas).
 */
const SCENES = Object.freeze(
  [
    { n: 1, sectors: [1, 2, 3], boss: 3 },
    { n: 2, sectors: [4, 5, 6, 7], boss: 7 },
    { n: 3, sectors: [8, 9, 10], boss: 9, god: 10 },
  ].map((c) => Object.freeze({ ...c, sectors: Object.freeze(c.sectors) }))
);
/** Os seis usam a mesma divisão (o plano §1.3); fica por Domínio para um deles poder mudar. */
const SCENES_BY_DOMAIN = Object.freeze(Object.fromEntries(DOMAIN_IDS.map((id) => [id, SCENES])));
const scenesOf = (domainId) => SCENES_BY_DOMAIN[domainId] || null;
/** A cena (1–3) onde fica o setor. */
function sceneOf(domainId, sector) {
  const list = scenesOf(domainId);
  const c = list && list.find((x) => x.sectors.includes(sector));
  return c ? c.n : null;
}
const sceneName = (domainId, n) => `${domainId}-${n}`;
/** A cena está aberta? (a 1 com o Domínio; a N quando o chefe da N−1 caiu) */
function sceneOpen(domainId, n, trainerLevel, best, bypass = false) {
  const list = scenesOf(domainId);
  const c = list && list.find((x) => x.n === n);
  if (!c) return false;
  return sectorOpen(domainId, c.sectors[0], trainerLevel, best, bypass);
}

/** Os três palcos de luta por Domínio (entrada, setores fundos, palácio do deus). */
function stageOf(sector) {
  if (sector >= 9) return "palacio";
  if (sector >= 5) return "fundo";
  return "entrada";
}

const domainOf = (id) => BY_ID.get(String(id || "")) || null;
const sectorOk = (s) => Number.isInteger(s) && s >= 1 && s <= SECTORS;

/** Poder recomendado do setor (S14: o Poder do herói do dia-alvo, de 10 em 10). */
function recommendedPower(domainId, sector) {
  const d = domainOf(domainId);
  if (!d || !sectorOk(sector)) return null;
  return POWER_BY_DOMAIN[d.id][sector - 1];
}

function foeOf(domainId, sector) {
  const list = FOES_BY_DOMAIN[domainId];
  const f = list && list[sector - 1];
  return f ? { id: f.id, body: f.body || null, rig: !!f.rig, art: !!f.art } : null;
}

function kindOf(domainId, sector) {
  const list = KINDS_BY_DOMAIN[domainId] || SECTOR_KINDS;
  return list[sector - 1];
}

/** Soma dos status do monstro no nível (vida + ataque + defesa + acuracidade + velocidade). */
function mobPower(kind, level) {
  const ms = FightSim.MOB_SHEETS[kind];
  const base = FightSim.mobBase(level);
  return (base.hp * ms[0] + base.rate * (ms[1] + ms[2] + ms[3] + ms[4])) / 100;
}

const LEVELS = new Map();
/** Nível do monstro de cada setor (pela régua do B7, sem descer de um setor para o outro). */
function sectorLevel(domainId, sector) {
  const d = domainOf(domainId);
  if (!d || !sectorOk(sector)) return null;
  if (!LEVELS.has(d.id) && LEVELS_BY_DOMAIN[d.id]) LEVELS.set(d.id, LEVELS_BY_DOMAIN[d.id]);
  if (!LEVELS.has(d.id)) {
    const out = [];
    let prev = 1;
    for (let s = 1; s <= SECTORS; s++) {
      const want = recommendedPower(d.id, s);
      const kind = kindOf(d.id, s);
      let L = prev;
      while (L < 200 && mobPower(kind, L) < want) L++;
      out.push(L);
      prev = L;
    }
    LEVELS.set(d.id, out);
  }
  return LEVELS.get(d.id)[sector - 1];
}

/**
 * Por que o Domínio está fechado (null = aberto).
 * `best` = { [domain]: maior setor vencido }; `bypass` = administrador.
 */
function lockOf(domainId, trainerLevel, best, bypass = false) {
  const d = domainOf(domainId);
  if (!d) return { code: "domain" };
  if (bypass) return null;
  const prev = d.index > 0 ? DOMAINS[d.index - 1] : null;
  // a travessia vem primeiro: quem não atravessou o anterior nem chega à porta
  if (prev && (Number(best[prev.id]) || 0) < SECTORS) return { code: "crossing", from: prev.id };
  if ((Number(trainerLevel) || 1) < d.need) return { code: "trainer", level: d.need };
  return null;
}

/** O setor está aberto? (o 1 abre com o Domínio; o N depois de vencer o N−1) */
function sectorOpen(domainId, sector, trainerLevel, best, bypass = false) {
  if (!sectorOk(sector)) return false;
  if (lockOf(domainId, trainerLevel, best, bypass)) return false;
  return bypass || sector <= (Number(best[domainId]) || 0) + 1;
}

/** A tela: os seis com setores, travas e a passagem para o próximo. */
function view(trainerLevel, best, bypass = false) {
  return DOMAINS.map((d, i) => {
    const lock = lockOf(d.id, trainerLevel, best, bypass);
    const top = Math.max(0, Math.min(SECTORS, Number(best[d.id]) || 0));
    const next = DOMAINS[i + 1] || null;
    return {
      id: d.id,
      god: d.god,
      kit: d.kit,
      need: d.need,
      open: !lock,
      lock,
      best: top,
      crossed: top >= SECTORS,
      // trecho de passagem: aparece depois do setor 10 vencido
      places: (PLACES_BY_DOMAIN[d.id] || []).map((p) => ({ id: p.id, sector: p.sector, spots: [...(p.spots || [])] })),
      passage: next && (bypass || top >= SECTORS) ? { to: next.id, open: !lockOf(next.id, trainerLevel, best, bypass) } : null,
      // DV1: as 3 cenas do mundo aberto (o aparelho monta `name`; `passage` = a saída para a próxima)
      scenes: (scenesOf(d.id) || []).map((c, ci, list) => {
        const open = !lock && (bypass || c.sectors[0] <= top + 1);
        const nx = list[ci + 1] || null;
        return {
          n: c.n,
          name: sceneName(d.id, c.n),
          sectors: [...c.sectors],
          boss: c.boss,
          god: c.god || null,
          open,
          cleared: top >= c.sectors[c.sectors.length - 1],
          passage: nx ? { to: nx.n, open: open && (bypass || top >= c.boss) } : null,
        };
      }),
      sectors: Array.from({ length: SECTORS }, (_, k) => {
        const s = k + 1;
        return {
          n: s,
          scene: sceneOf(d.id, s),
          kind: kindOf(d.id, s),
          foe: foeOf(d.id, s),
          boss: bossOf(d.id, s),
          level: sectorLevel(d.id, s),
          power: recommendedPower(d.id, s),
          stage: stageOf(s),
          open: !lock && (bypass || s <= top + 1),
          cleared: s <= top,
        };
      }),
    };
  });
}

module.exports = {
  SECTORS,
  DOMAINS,
  DOMAIN_IDS,
  SECTOR_KINDS,
  KINDS_BY_DOMAIN,
  FOES_BY_DOMAIN,
  LEVELS_BY_DOMAIN,
  PLACES_BY_DOMAIN,
  BOSS_BY_DOMAIN,
  SCENES,
  SCENES_BY_DOMAIN,
  scenesOf,
  sceneOf,
  sceneName,
  sceneOpen,
  bossOf,
  placeOf,
  placeOpen,
  TARGET,
  heroOf,
  foeOf,
  domainOf,
  stageOf,
  recommendedPower,
  kindOf,
  mobPower,
  sectorLevel,
  lockOf,
  sectorOpen,
  view,
};
