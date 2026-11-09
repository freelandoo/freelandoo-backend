// src/services/MeuMundoCharacterService.js — MEU MUNDO 3D B3 (2026-11-08): PERSONAGENS.
//
// Decisões do Alex (docs/CRONOGRAMA_2026-11.md, "B3 — decisões"): vários personagens por
// jogador e UM ativo; os outros ficam na CÁPSULA congelados (Life.freeze/thaw); FUSÃO de
// dois adultos vivos consome os pais e o filho nasce com 20% do maior pico de cada
// atributo; a espécie do filho é escolhida entre as dos pais (sem sorteio); certificado
// público por link. A regra das espécies, da altura e da fusão é a GERADA do front
// (utils/meuMundoCharacters.js). Sem cápsula sorteada paga (loot box é proibida para
// menores — ECA Digital, Lei 15.211/2025): personagem novo vem de fusão, prêmio (B9),
// mercado (B4) ou da conversão das skins (mig 340), sempre por tb_mm_character_grant.
//
// Tudo que mexe na vida passa pelo núcleo MeuMundoLifeService.withLife (mesma transação,
// mesmo lock da pessoa): trocar = congelar o ativo e descongelar outro.

const crypto = require("crypto");
const pool = require("../databases");
const LS = require("../storages/MeuMundoLifeStorage");
const { rowToState } = require("../storages/MeuMundoLifeStorage");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const Life = require("../utils/meuMundoLife");
const Soul = require("../utils/meuMundoSoul");
const Chars = require("../utils/meuMundoCharacters");
const { characterBody, characterHeight, speciesOf } = require("../utils/meuMundoSpecies");

/** Require tardio (o serviço da vida usa este para entregar os grants). */
const LifeService = () => require("./MeuMundoLifeService");
const PowerService = () => require("./MeuMundoPowerService");

const ERRORS = {
  notFound: ["Personagem não encontrado", 404],
  notCapsule: ["Esse personagem não está na cápsula", 409],
  busy: ["Ele está internado ou preso: espere sair para trocar", 409],
  pair: ["Escolha dois personagens diferentes", 400],
  alive: ["Só personagens vivos podem fundir", 409],
  adult: ["Só dois adultos podem fundir", 409],
  species: ["A espécie do filho tem que ser a de um dos pais", 400],
  sex: ["Sexo inválido", 400],
  full: ["A cápsula está cheia", 409],
  badSpecies: ["Espécie inválida", 400],
  admin: ["Só para administrador", 403],
  coins: ["Moedas insuficientes", 402],
  accel: ["Ele já tem 15 anos ou mais", 409],
  key: ["Pedido inválido", 400],
  gone: ["Esse personagem não está vivo nem na cápsula", 409],
  gene: ["Genética não encontrada", 404],
  geneFull: ["O congelador de genéticas está cheio", 409],
};
const fail = (code) => {
  const [error, statusCode] = ERRORS[code] || ["Não foi possível", 400];
  return { error, statusCode, code };
};

const ORIGIN_OF_SOURCE = { skin: "skin", prize: "prize", gift: "gift", admin_test: "admin_test", lab: "lab" };
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const newSeed = () => crypto.randomInt(1, 2 ** 31 - 1);
const ms = (v) => (v == null ? null : new Date(v).getTime());
const iso = (v) => (v == null ? null : new Date(v).toISOString());
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
/** Quantas genéticas a pessoa guarda sem usar. */
const GENE_SLOTS = 10;

/** A alma com o temperamento trocado e os gostos que vêm com ele (o psicopata gosta de lutar…). */
function withTemper(soul, temper) {
  if (!temper || temper === soul.temper) return soul;
  const out = { ...soul, temper, likes: { ...soul.likes }, hates: { ...soul.hates } };
  if (temper === "psicopata") out.likes.act = "fight";
  else if (temper === "competitivo") out.likes.act = "minigame";
  else if (temper === "bondoso") out.likes.act = "praying";
  if (temper === "covarde") out.hates.act = "fight";
  if (out.likes.act === out.hates.act) out.hates.act = out.likes.act === "studying" ? "working" : "studying";
  return out;
}

/** Maior valor já alcançado em cada atributo (o que a fusão e a herança olham). */
const peaksOf = (s) => Object.fromEntries(Life.ATTRS.map((k) => [k, Math.max(Number(s[k]) || 0, Number(s.peaks && s.peaks[k]) || 0)]));

/** Genética de nascença (certificado): semente, personalidade, temperamento, atributos e altura. */
function geneticsOf(s, extra = {}) {
  const so = Soul.soulOf(s);
  return {
    seed: s.seed,
    personality: s.personality,
    temper: so.temper,
    attrs: Object.fromEntries(Life.ATTRS.map((k) => [k, r2(s[k])])),
    birthHeight: Chars.GROW.BIRTH,
    ...extra,
  };
}

/** Genética de quem nasceu antes do B3 (NULL na coluna): sai da semente, que é determinística. */
function legacyGenetics(row) {
  const b = Life.birth(row.seed, 0);
  Soul.soulOf(b);
  return { ...geneticsOf(b), birthHeight: 1.4, legacy: true };
}

/** Clã e sexo do jogador (a espécie de quem não tem segue a classe). */
async function clanOf(db, idUser) {
  const r = await db.query(`SELECT clan, sex FROM tb_mm_clan WHERE id_user = $1`, [idUser]);
  return r.rows[0] || { clan: null, sex: null };
}

/** Resumo de um personagem para a tela da cápsula e do ranking. `s` = estado (simulado se for o ativo). */
function summary(row, s, k, condition, now) {
  const active = row.status === "alive";
  // Congelado: tudo parado no instante em que foi guardado.
  const t = active ? now : s.simAt;
  const stage = s.growth && s.growth.stage === "adult" ? "adult" : "young";
  const who = { species: row.species, sex: row.sex, clan: k.clan, clanSex: k.sex };
  const so = Soul.soulOf(s);
  return {
    id: row.id_character,
    serial: Number(row.serial),
    serialText: Chars.serialText(row.serial),
    certCode: row.cert_code,
    status: row.status,
    species: speciesOf(row.species, k.clan),
    sex: Chars.speciesSex(speciesOf(row.species, k.clan), row.sex || k.sex),
    body: characterBody({ ...who, stage, condition }),
    height: characterHeight({ ...who, growth: s.growth }, t),
    stage,
    adult: stage === "adult",
    activeDays: Chars.activeDays(s.growth, t),
    lifeLeftDays: Math.max(0, Math.round(Life.LIFE.DAYS - (s.wearDays || 0))),
    lineage: row.lineage_gen,
    origin: row.origin,
    petName: so.petName || null,
    temper: so.temper,
    attrs: Object.fromEntries(Life.ATTRS.map((x) => [x, Math.round(Number(s[x]) || 0)])),
    peaks: Object.fromEntries(Object.entries(peaksOf(s)).map(([x, v]) => [x, Math.round(v)])),
    power: row.power == null ? null : Number(row.power),
    frozenAt: iso(row.frozen_at),
    bornAt: iso(row.born_at),
  };
}

/**
 * Entrega os personagens pendentes (tb_mm_character_grant) direto na cápsula. Chamado
 * pelo withLife (toda leitura/ação), dentro da transação e do lock da pessoa. Grants da
 * conversão das skins e prêmios entram mesmo com a cápsula cheia (nada se perde).
 */
async function claimGrants(c, idUser, now) {
  const grants = await LS.openGrants(c, idUser);
  const created = [];
  for (const g of grants) {
    if (!Chars.speciesById(g.species)) {
      await LS.claimGrant(c, g.id_grant, null);
      continue;
    }
    const n = Life.birth(newSeed(), now);
    n.status = "capsule";
    const origin = ORIGIN_OF_SOURCE[g.source] || "gift";
    const row = await LS.insert(c, idUser, await LS.nextGeneration(c, idUser), n, {
      species: g.species,
      sex: Chars.speciesSex(g.species, g.sex),
      origin,
      genetics: geneticsOf(n),
      ownerReason: origin === "prize" ? "prize" : origin === "gift" ? "gift" : origin === "lab" ? "market" : "origin",
    });
    await LS.claimGrant(c, g.id_grant, row.id_character);
    await LS.insertEvents(c, row.id_character, [{ at: now, kind: "born", data: { origin, species: g.species } }]);
    await PowerService().refresh(c, idUser, row.id_character, n);
    created.push(row.id_character);
  }
  return created;
}

class MeuMundoCharacterService {
  /** GET /characters — o ativo (simulado até agora) + a cápsula (congelados). */
  static async list(idUser) {
    return LifeService().withLife(idUser, async (s, ctx) => ({ characters: await MeuMundoCharacterService.mine(ctx.client, idUser, s, ctx) }));
  }

  /** Lista dentro de uma transação já aberta (o ativo usa o estado `s` simulado). */
  static async mine(c, idUser, s, ctx) {
    const k = await clanOf(c, idUser);
    const condition = (await c.query(`SELECT body FROM tb_mm_avatar_pref WHERE id_user = $1`, [idUser])).rows[0]?.body || "normal";
    const rows = await LS.listMine(c, idUser);
    const activeId = (ctx.newRow || ctx.row).id_character;
    const list = [];
    for (const row of rows) {
      // morto antigo: só o ativo (tela de morte) aparece
      if (row.status === "dead" && row.id_character !== activeId) continue;
      const st = row.id_character === activeId ? ctx.newState || s : rowToState(row);
      list.push(summary(row, st, k, condition, ctx.now));
    }
    const used = list.filter((x) => x.status === "capsule").length;
    // B12: o acelerador serve para quem ainda não chegou aos 15 anos (o congelado mede no instante em que parou)
    for (const x of list) {
      const row = rows.find((r) => r.id_character === x.id);
      const st = row && row.id_character === activeId ? ctx.newState || s : row ? rowToState(row) : null;
      x.canAccel = !!st && (x.status === "alive" || x.status === "capsule") && Chars.canAccelerate(st.growth, x.status === "alive" ? ctx.now : st.simAt);
    }
    const free = await MeuMundoStorage.isAdmin(c, idUser);
    const lab = {
      free,
      accelPrice: free ? 0 : Chars.LAB.ACCEL_PRICE,
      accelYears: Chars.LAB.ACCEL_YEARS,
      embryos: Chars.SPECIES.map((d) => ({ species: d.id, kind: d.kind, sex: d.sex, price: free ? 0 : Chars.embryoPrice(d.id) })),
      // 09/11: genéticas à venda e a regra da mistura que a tela mostra
      genes: Chars.SPECIES.map((d) => ({ species: d.id, kind: d.kind, sex: d.sex, price: free ? 0 : Chars.genePrice(d.id) })),
      inherit: Chars.FUSION.INHERIT,
      geneSlots: GENE_SLOTS,
    };
    // as genéticas guardadas (o temperamento delas sai da semente, como o de um personagem)
    const genetics = (await LS.openGenetics(c, idUser)).map((g) => ({
      id: g.id_genetics,
      species: g.species,
      sex: g.sex,
      boughtAt: iso(g.created_at),
    }));
    // quantas misturas tem a linha de cada um (certidão)
    for (const x of list) {
      const row = rows.find((r) => r.id_character === x.id);
      x.mixCount = Number(row && row.genetics && row.genetics.mix && row.genetics.mix.count) || 0;
    }
    return { list, capsule: { used, slots: Chars.CAPSULE.SLOTS }, species: Chars.SPECIES_IDS, lab, genetics };
  }

  /**
   * POST /characters/:id/use — troca: o ativo vai para a cápsula (congelado) e este sai
   * dela (descongela de onde parou). Com o ativo morto, só tira o outro da cápsula.
   */
  static async use(idUser, rawId) {
    if (!UUID.test(String(rawId || ""))) return fail("notFound");
    return LifeService().withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      const target = await LS.lockCharacter(c, idUser, rawId);
      if (!target) return fail("notFound");
      if (target.status !== "capsule") return fail("notCapsule");
      if (s.status === "alive") {
        if (s.activity.kind === "hospital" || s.activity.kind === "jail") return fail("busy");
        Life.freeze(s, ctx.now);
        s.status = "capsule";
        // grava já: o índice único de "um vivo por pessoa" precisa do antigo fora antes
        await LS.save(c, ctx.row.id_character, s);
        await LS.markFrozen(c, ctx.row.id_character, ctx.now);
        ctx.events.push({ at: ctx.now, kind: "capsule_in", data: { by: "swap" } });
      } else if (s.status === "dead") {
        await LS.markDeathSeen(c, ctx.row.id_character);
      }
      const ts = rowToState(target);
      Soul.soulOf(ts);
      const shift = Life.thaw(ts, ctx.now);
      ts.status = "alive";
      await LS.save(c, target.id_character, ts);
      await LS.markThawed(c, target.id_character);
      ctx.newRow = target;
      ctx.newState = ts;
      ctx.newEvents = [{ at: ctx.now, kind: "capsule_out", data: { frozenMs: shift } }];
      return { swapped: { from: ctx.row.id_character, to: target.id_character } };
    }).then((out) => (out && !out.error ? MeuMundoCharacterService.withList(idUser, out) : out));
  }

  /**
   * POST /characters/fuse { a, b|gene, species } — a MISTURA do Laboratório de Criogenia
   * (pedido do Alex, 09/11; regra MIX em characters/rules.ts). `a` é o PRIMEIRO, um
   * personagem adulto (o ativo ou da cápsula); o outro é outro adulto (`b`) ou uma GENÉTICA
   * comprada (`gene`). RESULTADO FIXO, sem sorteio: o filho tem a personalidade do primeiro
   * e 20% de cada atributo dele; a espécie é a que a pessoa escolheu entre as dos dois.
   * Os dois somem (personagens viram histórico 'fused'; a genética fica usada).
   * O ativo, se for um dos pais, congela na mistura e o filho sai andando; senão o filho
   * nasce na cápsula. Tudo vai para a certidão (genetics.mix).
   */
  static async fuse(idUser, body = {}) {
    const a = String(body.a || "");
    const b = body.b ? String(body.b) : "";
    const gene = body.gene ? String(body.gene) : "";
    if (!UUID.test(a)) return fail("notFound");
    if (Boolean(b) === Boolean(gene)) return fail("pair");
    if (b && a === b) return fail("pair");
    if (b && !UUID.test(b)) return fail("notFound");
    if (gene && !UUID.test(gene)) return fail("gene");
    return LifeService().withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      const k = await clanOf(c, idUser);
      const activeId = ctx.row.id_character;
      const parents = [];
      for (const id of b ? [a, b] : [a]) {
        const row = id === activeId ? ctx.row : await LS.lockCharacter(c, idUser, id);
        if (!row) return fail("notFound");
        const st = id === activeId ? s : rowToState(row);
        if (!(row.status === "alive" || row.status === "capsule") || st.status === "dead") return fail("alive");
        if (!(st.growth && st.growth.stage === "adult")) return fail("adult");
        if (id === activeId && (st.activity.kind === "hospital" || st.activity.kind === "jail")) return fail("busy");
        Soul.soulOf(st);
        const species = speciesOf(row.species, k.clan);
        parents.push({
          kind: "character",
          row,
          st,
          species,
          sex: Chars.speciesSex(species, row.sex || k.sex),
          power: Number(row.power) || 0,
          peaks: peaksOf(st),
          temper: st.soul.temper,
          personality: st.personality,
          seed: st.seed,
          lineage: row.lineage_gen || 1,
          count: Number(row.genetics && row.genetics.mix && row.genetics.mix.count) || 0,
          active: id === activeId,
        });
      }
      if (gene) {
        const g = await LS.lockGenetics(c, idUser, gene);
        if (!g || !Chars.speciesById(g.species)) return fail("gene");
        const born = Life.birth(g.seed, 0);
        parents.push({
          kind: "genetics",
          gene: g,
          species: g.species,
          sex: Chars.speciesSex(g.species, g.sex),
          peaks: {},
          temper: Soul.bornSoul(g.seed).temper,
          personality: born.personality,
          seed: g.seed,
          lineage: 0,
          count: 0,
          active: false,
        });
      }
      const [A, B] = parents;

      // a espécie: a que a pessoa escolheu entre as dos dois (sem sorteio)
      const species = String(body.species || "");
      if (!Chars.mixSpecies(A.species, B.species).includes(species)) return fail("species");
      const def = Chars.speciesById(species);
      const W = A.species === species ? A : B;
      const sex = def.sex || W.sex;

      // O filho: personalidade do primeiro (igual) e 20% de cada atributo dele
      const seed = Chars.fusionSeed(A.seed, B.seed);
      const child = Life.birth(seed, ctx.now);
      child.personality = { ...A.personality };
      const inherit = Chars.mixInherit(A.peaks);
      Life.applyInheritance(child, inherit);
      child.soul = withTemper(Soul.bornSoul(seed), A.temper);
      Soul.soulOf(child);
      const activeParent = parents.some((p) => p.active);
      child.status = activeParent ? "alive" : "capsule";

      // Os pais saem (antes do filho entrar: um vivo por pessoa)
      for (const p of parents) {
        if (p.kind !== "character") continue;
        p.st.status = "fused";
        if (p.active) Life.freeze(p.st, ctx.now);
        await LS.save(c, p.row.id_character, p.st);
      }
      const brief = (p) =>
        p.kind === "genetics"
          ? { kind: "genetics", species: p.species, sex: p.sex, temper: p.temper }
          : {
              kind: "character",
              serial: Number(p.row.serial),
              serialText: Chars.serialText(p.row.serial),
              certCode: p.row.cert_code,
              species: p.species,
              sex: p.sex,
              power: p.power,
              temper: p.temper,
              name: (p.st.soul && p.st.soul.petName) || null,
            };
      const mix = {
        count: Chars.mixCount(A.count, B.count),
        a: brief(A),
        b: brief(B),
        // resultado fixo: o primeiro ("a") passa personalidade e atributos; a espécie veio de `species`
        first: "a",
        species: W === A ? "a" : "b",
        temper: A.temper || null,
      };
      const row = await LS.insert(c, idUser, await LS.nextGeneration(c, idUser), child, {
        species,
        sex,
        lineageGen: Math.max(A.lineage, B.lineage) + 1,
        parentA: A.kind === "character" ? A.row.id_character : null,
        parentB: B.kind === "character" ? B.row.id_character : null,
        origin: "fusion",
        genetics: geneticsOf(child, { inherited: inherit, mix }),
      });
      for (const p of parents) {
        if (p.kind === "genetics") {
          await LS.useGenetics(c, p.gene.id_genetics, row.id_character, ctx.now);
          continue;
        }
        await LS.markFused(c, p.row.id_character, row.id_character, ctx.now);
        if (!p.active) await LS.insertEvents(c, p.row.id_character, [{ at: ctx.now, kind: "fused", data: { into: row.id_character } }]);
      }
      const bornEv = { at: ctx.now, kind: "born", data: { origin: "fusion", species, inherited: inherit } };
      if (activeParent) {
        ctx.events.push({ at: ctx.now, kind: "fused", data: { into: row.id_character } });
        ctx.newRow = row;
        ctx.newState = child;
        ctx.newEvents = [bornEv];
      } else {
        await LS.insertEvents(c, row.id_character, [bornEv]);
        await PowerService().refresh(c, idUser, row.id_character, child);
      }
      return {
        fused: {
          child: row.id_character,
          certCode: row.cert_code,
          species,
          sex,
          inherited: inherit,
          temper: A.temper || null,
          active: activeParent,
        },
      };
    }).then((out) => (out && !out.error ? MeuMundoCharacterService.withList(idUser, out) : out));
  }

  /**
   * POST /characters/genetics { species, sex?, key } — compra a GENÉTICA de uma espécie no
   * laboratório (fica guardada até a mistura; GENE_SLOTS no máximo). Paga em Esmeralda;
   * admin não paga; `key` é a chave do pedido (reenvio não compra duas vezes).
   */
  static async buyGenetics(idUser, body = {}) {
    const species = String(body.species || "");
    if (!Chars.speciesById(species)) return fail("badSpecies");
    if (body.sex != null && body.sex !== "m" && body.sex !== "f") return fail("sex");
    const key = String(body.key || "");
    if (!KEY_RE.test(key)) return fail("key");
    return LifeService().withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      const price = (await MeuMundoStorage.isAdmin(c, idUser)) ? 0 : Chars.genePrice(species);
      const row = await LS.addGenetics(c, idUser, { species, sex: Chars.speciesSex(species, body.sex), seed: newSeed(), ref: key, price });
      if (!row) return { gene: null, repeat: true };
      if ((await LS.openGenetics(c, idUser)).length > GENE_SLOTS) return fail("geneFull");
      if (ctx.coins < price) return fail("coins");
      ctx.coins -= price;
      ctx.what = `genetics:${species}`;
      return { gene: row.id_genetics, paid: price };
    }).then((out) => (out && !out.error ? MeuMundoCharacterService.withList(idUser, out) : out));
  }

  /**
   * POST /characters/test-grant { species, sex } — TESTE (hoje só admin joga): ganha um
   * personagem da espécie na cápsula, respeitando as vagas. Sai quando o jogo abrir.
   */
  static async testGrant(idUser, body = {}) {
    const species = String(body.species || "");
    if (!Chars.speciesById(species)) return fail("badSpecies");
    if (body.sex != null && body.sex !== "m" && body.sex !== "f") return fail("sex");
    return LifeService().withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      if (!(await MeuMundoStorage.isAdmin(c, idUser))) return fail("admin");
      if ((await LS.capsuleCount(c, idUser)) >= Chars.CAPSULE.SLOTS) return fail("full");
      await LS.addGrant(c, idUser, { species, sex: Chars.speciesSex(species, body.sex), source: "admin_test", ref: crypto.randomUUID() });
      const created = await claimGrants(c, idUser, ctx.now);
      return { granted: created };
    }).then((out) => (out && !out.error ? MeuMundoCharacterService.withList(idUser, out) : out));
  }

  /**
   * POST /characters/embryo { species, sex?, key } — B12: compra o EMBRIÃO no Laboratório
   * de Criogenia. Nasce na cápsula (1,00 m, 0 dia de vida ativa) pelo grant de origem
   * 'lab'; `key` é a chave do pedido (clique duplo ou reenvio não compram duas vezes).
   * Paga em Esmeralda (ctx.coins); admin não paga.
   */
  static async buyEmbryo(idUser, body = {}) {
    const species = String(body.species || "");
    if (!Chars.speciesById(species)) return fail("badSpecies");
    if (body.sex != null && body.sex !== "m" && body.sex !== "f") return fail("sex");
    const key = String(body.key || "");
    if (!KEY_RE.test(key)) return fail("key");
    return LifeService().withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      const id = await LS.addGrant(c, idUser, { species, sex: Chars.speciesSex(species, body.sex), source: "lab", ref: key });
      if (!id) return { granted: [], repeat: true };
      if ((await LS.capsuleCount(c, idUser)) >= Chars.CAPSULE.SLOTS) return fail("full");
      const price = (await MeuMundoStorage.isAdmin(c, idUser)) ? 0 : Chars.embryoPrice(species);
      if (ctx.coins < price) return fail("coins");
      ctx.coins -= price;
      ctx.what = `embryo:${species}`;
      const created = await claimGrants(c, idUser, ctx.now);
      return { granted: created, paid: price };
    }).then((out) => (out && !out.error ? MeuMundoCharacterService.withList(idUser, out) : out));
  }

  /**
   * POST /characters/:id/accelerate — B12: o ACELERADOR leva o personagem aos 15 anos
   * (a fase de jovem completa: GROW.YOUNG_DAYS de vida ativa). Vale para o ativo e para
   * quem está na cápsula; quem já passou dos 15 é recusado (não cobra duas vezes).
   */
  static async accelerate(idUser, rawId) {
    if (!UUID.test(String(rawId || ""))) return fail("notFound");
    return LifeService().withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      const active = rawId === ctx.row.id_character;
      const row = active ? ctx.row : await LS.lockCharacter(c, idUser, rawId);
      if (!row) return fail("notFound");
      const st = active ? s : rowToState(row);
      if (active ? s.status !== "alive" : row.status !== "capsule") return fail("gone");
      const t = active ? ctx.now : st.simAt;
      if (!Chars.canAccelerate(st.growth, t)) return fail("accel");
      const price = (await MeuMundoStorage.isAdmin(c, idUser)) ? 0 : Chars.LAB.ACCEL_PRICE;
      if (ctx.coins < price) return fail("coins");
      ctx.coins -= price;
      ctx.what = "accelerator";
      const before = Chars.activeDays(st.growth, t);
      st.growth = Chars.accelerated(st.growth, t);
      const ev = { at: ctx.now, kind: "accelerated", data: { fromDays: before, years: Chars.LAB.ACCEL_YEARS } };
      if (active) ctx.events.push(ev);
      else {
        await LS.save(c, row.id_character, st);
        await LS.insertEvents(c, row.id_character, [ev]);
      }
      return { accelerated: { id: row.id_character, paid: price } };
    }).then((out) => (out && !out.error ? MeuMundoCharacterService.withList(idUser, out) : out));
  }

  /** Depois de uma ação, a lista nova (outra leitura: o ativo pode ter mudado). */
  static async withList(idUser, out) {
    const l = await MeuMundoCharacterService.list(idUser);
    return { ...out, characters: l.characters, character: l.character, wallet: l.wallet, avatar: l.avatar, height: l.height };
  }

  /**
   * GET /meu-mundo/public/certificado/:code — certificado público. Sem dados do dono além
   * do apelido do jogo; pais e avós com número de série e o código da página deles.
   */
  static async certificate(rawCode) {
    const code = String(rawCode || "");
    if (!/^[0-9a-f]{12}$/.test(code)) return fail("notFound");
    const row = await LS.certificate(pool, code);
    if (!row) return fail("notFound");
    const k = await clanOf(pool, row.id_user);
    const s = rowToState(row);
    const now = Date.now();
    const t = row.status === "alive" ? Math.min(now, ms(row.sim_at) || now) : s.simAt;
    const parents = await LS.byIds(pool, [row.parent_a, row.parent_b]);
    const grand = await LS.byIds(pool, parents.flatMap((p) => [p.parent_a, p.parent_b]));
    const brief = (p) => {
      if (!p) return null;
      return {
        serialText: Chars.serialText(p.serial),
        certCode: p.cert_code,
        species: speciesOf(p.species, null),
        sex: p.sex,
        lineage: p.lineage_gen,
        status: p.status,
        parents: [p.parent_a, p.parent_b],
      };
    };
    const byId = new Map([...parents, ...grand].map((p) => [p.id_character, p]));
    const parentList = [row.parent_a, row.parent_b].filter(Boolean).map((id) => {
      const p = byId.get(id);
      const out = brief(p);
      if (out) out.parents = (out.parents || []).filter(Boolean).map((g) => brief(byId.get(g))).filter(Boolean);
      return out;
    }).filter(Boolean);
    const so = Soul.soulOf(s);
    const species = speciesOf(row.species, k.clan);
    return {
      certificate: {
        serial: Number(row.serial),
        serialText: Chars.serialText(row.serial),
        species,
        sex: Chars.speciesSex(species, row.sex || k.sex),
        name: so.petName || null,
        owner: row.nickname || null,
        bornAt: iso(row.born_at),
        status: row.status,
        diedAt: iso(row.died_at),
        deathCause: row.death_cause || null,
        origin: row.origin,
        lineage: row.lineage_gen,
        stage: s.growth && s.growth.stage === "adult" ? "adult" : "young",
        activeDays: Chars.activeDays(s.growth, t),
        height: characterHeight({ species: row.species, sex: row.sex, clan: k.clan, clanSex: k.sex, growth: s.growth }, t),
        genetics: row.genetics || legacyGenetics(row),
        peaks: Object.fromEntries(Object.entries(peaksOf(s)).map(([x, v]) => [x, Math.round(v)])),
        parents: parentList,
      },
    };
  }
}

MeuMundoCharacterService.claimGrants = claimGrants;
MeuMundoCharacterService.summary = summary;
MeuMundoCharacterService.geneticsOf = geneticsOf;

module.exports = MeuMundoCharacterService;
