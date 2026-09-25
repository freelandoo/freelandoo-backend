// test/subject-platforms.e2e.js — PET, CARRO E GAMES COMO PLATAFORMAS (mig 262)
//
// Roda: npm run test:subject-platforms
//
// O que ela prova: a aba "mesmo X" das plataformas de assunto — pet por RAÇA
// (catálogo e "outra raça" digitada), games por JOGO ATUAL normalizado — e que
// o botão genérico de entrar recusa as plataformas (ninguém vira "membro" do
// cachorro de outra pessoa).
//
// ⚠️ PODE APONTAR PARA PRODUÇÃO: tudo acontece numa transação que termina em
// ROLLBACK, a migration inclusive. Não existe `COMMIT` neste arquivo. O pool é
// trocado no `require.cache` pelo client da transação ANTES do primeiro require
// dos services. O `connect()` dos services recebe um embrulho que troca
// BEGIN/COMMIT/ROLLBACK por SAVEPOINT — senão o ROLLBACK de dentro do service
// desfaria a transação do teste inteira.

require("dotenv").config();
process.env.DATABASE_SSL = "true";
process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = "false";

const fs = require("fs");
const path = require("path");
const pool = require("../src/databases");

let PASS = 0;
let FAIL = 0;

function check(label, cond, extra = "") {
  if (typeof cond === "function" || (cond && typeof cond.then === "function")) {
    FAIL++;
    console.log(`✗ ${label} — condição assíncrona (faça o await antes)`);
    return;
  }
  if (cond) {
    PASS++;
    console.log(`✓ ${label}`);
  } else {
    FAIL++;
    console.log(`✗ ${label}${extra ? " — " + extra : ""}`);
  }
}

async function one(c, sql, params = []) {
  const r = await c.query(sql, params);
  return r.rows[0];
}

(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    // Transação aninhada por savepoint para quem chama pool.connect().
    let sp = 0;
    const nested = {
      async connect() {
        const name = `sp_${++sp}`;
        let open = false;
        return {
          async query(sql, params) {
            const t = typeof sql === "string" ? sql.trim().toUpperCase() : "";
            if (t === "BEGIN") { open = true; return c.query(`SAVEPOINT ${name}`); }
            if (t === "COMMIT") { open = false; return c.query(`RELEASE SAVEPOINT ${name}`); }
            if (t === "ROLLBACK") {
              if (!open) return { rows: [] };
              open = false;
              return c.query(`ROLLBACK TO SAVEPOINT ${name}`);
            }
            return c.query(sql, params);
          },
          release() {},
        };
      },
      query: (...a) => c.query(...a),
    };
    const poolPath = require.resolve("../src/databases");
    require.cache[poolPath].exports = nested;
    const CommunityService = require("../src/services/CommunityService");

    // ── 1. a migration ──────────────────────────────────────────────────────
    const sql = fs.readFileSync(
      path.join(__dirname, "../src/databases/migrations/262_subject_platform_scopes.sql"),
      "utf8"
    );
    await c.query(sql);
    await c.query(sql);
    check("migration 262 aplica e é idempotente", true);

    const norm = async (t) => (await one(c, `SELECT public.fl_norm_key($1) AS k`, [t])).k;
    check("normaliza caixa e acento", (await norm("ÉLDEN Ríng")) === "elden ring");
    check("colapsa pontuação e espaço", (await norm("  Elden -- Ring!! ")) === "elden ring");
    check("vazio vira NULL", (await norm("  !! ")) === null && (await norm(null)) === null);

    // ── 2. o elenco ─────────────────────────────────────────────────────────
    const stamp = Date.now();
    let seq = 0;
    const tag = (p) => `spl${p}${stamp}${++seq}`;
    const category = await one(c, `SELECT id_category FROM public.tb_category LIMIT 1`);
    const newUser = async (p) => {
      const u = await one(
        c,
        `INSERT INTO public.tb_user (nome, email, username) VALUES ($1, $2, $3) RETURNING id_user`,
        [p, `${tag(p)}@t.test`, tag(p)]
      );
      await c.query(
        `INSERT INTO public.tb_profile (id_user, sub_profile_slug, display_name, id_category, is_user_account)
         VALUES ($1, $2, 'Conta', $3, TRUE)`,
        [u.id_user, tag("acc"), category.id_category]
      );
      return u.id_user;
    };
    const mkSpace = async (owner, kind) => {
      const p = await one(
        c,
        `INSERT INTO public.tb_profile
           (id_user, sub_profile_slug, display_name, is_community, community_kind, id_leader_user)
         VALUES ($1, $2, $3, TRUE, $4, $1) RETURNING id_profile`,
        [owner, tag("cm"), `${kind} ${seq}`, kind]
      );
      await c.query(
        `INSERT INTO public.tb_community_member (id_community_profile, id_user, role)
         VALUES ($1, $2, 'leader')`,
        [p.id_profile, owner]
      );
      return p.id_profile;
    };
    const recado = (id_profile, id_user, body) =>
      c.query(
        `INSERT INTO public.tb_community_feed_item (id_community_profile, id_author_user, kind, body)
         VALUES ($1, $2, 'recado', $3)`,
        [id_profile, id_user, body]
      );
    const bodies = (res) => (res.items || []).map((i) => i.caption);

    const breeds = (await c.query(
      `SELECT id_breed, species, is_mixed FROM public.tb_pet_breed WHERE is_active = TRUE`
    )).rows;
    const dogX = breeds.find((b) => b.species === "dog" && !b.is_mixed);
    const dogY = breeds.find((b) => b.species === "dog" && !b.is_mixed && b.id_breed !== dogX.id_breed);
    const dogSrd = breeds.find((b) => b.species === "dog" && b.is_mixed);
    const catSrd = breeds.find((b) => b.species === "cat" && b.is_mixed);
    check("catálogo tem as raças do teste", !!(dogX && dogY && dogSrd && catSrd));

    const pet = async (owner, { species, id_breed = null, breed_label = null }) => {
      const id = await mkSpace(owner, "pet");
      await c.query(
        `INSERT INTO public.tb_community_pet (id_profile, species, id_breed, breed_label, is_mixed)
         VALUES ($1, $2, $3, $4, FALSE)`,
        [id, species, id_breed, breed_label]
      );
      return id;
    };

    const viewer = await newUser("v");
    const u1 = await newUser("a");
    const u2 = await newUser("b");
    const u3 = await newUser("c");
    const u4 = await newUser("d");
    const u5 = await newUser("e");

    // ── 3. pet ──────────────────────────────────────────────────────────────
    const vDog = await pet(viewer, { species: "dog", id_breed: dogX.id_breed });
    const u1Pet = await pet(u1, { species: "dog", id_breed: dogX.id_breed });
    const u2Pet = await pet(u2, { species: "dog", id_breed: dogY.id_breed });
    const u5Pet = await pet(u5, { species: "cat", id_breed: catSrd.id_breed });
    await recado(vDog, viewer, "PET-V");
    await recado(u1Pet, u1, "PET-MESMA-RACA");
    await recado(u2Pet, u2, "PET-OUTRA-RACA");
    await recado(u5Pet, u5, "PET-GATO-SRD");

    const petAll = await CommunityService.getFeedPosts({ id_profile: vDog }, { limit: 24 }, { id_user: viewer });
    const allB = bodies(petAll);
    check("pet 'all' junta os pets de todo mundo",
      ["PET-V", "PET-MESMA-RACA", "PET-OUTRA-RACA", "PET-GATO-SRD"].every((b) => allB.includes(b)),
      JSON.stringify(allB));
    check("pet 'all' devolve pet_scope", petAll.pet_scope === "all");

    const same = await CommunityService.getFeedPosts(
      { id_profile: vDog }, { limit: 24, scope: "same_breed" }, { id_user: viewer });
    const sameB = bodies(same);
    check("mesma raça do catálogo casa", sameB.includes("PET-MESMA-RACA") && sameB.includes("PET-V"));
    check("outra raça fica fora", !sameB.includes("PET-OUTRA-RACA") && !sameB.includes("PET-GATO-SRD"));

    // Vira-lata: cachorro SRD não casa com gato SRD (linhas diferentes do catálogo).
    const vSrd = await pet(viewer, { species: "dog", id_breed: dogSrd.id_breed });
    await recado(vSrd, viewer, "PET-V-SRD");
    const withSrd = bodies(await CommunityService.getFeedPosts(
      { id_profile: vDog }, { limit: 24, scope: "same_breed" }, { id_user: viewer }));
    check("dois pets de quem olha: as duas raças valem", withSrd.includes("PET-MESMA-RACA") && withSrd.includes("PET-V-SRD"), JSON.stringify(withSrd));
    check("vira-lata de cachorro não casa com vira-lata de gato", !withSrd.includes("PET-GATO-SRD"));

    // "Outra raça" digitada: espécie + texto normalizado.
    const vFree = await pet(viewer, { species: "dog", breed_label: "Pastor Maremano" });
    const u3Pet = await pet(u3, { species: "dog", breed_label: "pastor  maremano!" });
    const u4Pet = await pet(u4, { species: "cat", breed_label: "Pastor Maremano" });
    await recado(vFree, viewer, "PET-V-LIVRE");
    await recado(u3Pet, u3, "PET-LIVRE-IGUAL");
    await recado(u4Pet, u4, "PET-LIVRE-OUTRA-ESPECIE");
    const free = bodies(await CommunityService.getFeedPosts(
      { id_profile: vDog }, { limit: 24, scope: "same_breed" }, { id_user: viewer }));
    check("'outra raça' com o mesmo texto casa", free.includes("PET-LIVRE-IGUAL"));
    check("'outra raça' de outra espécie não casa", !free.includes("PET-LIVRE-OUTRA-ESPECIE"));

    // Sem raça e sem sessão: o motivo, não uma lista vazia muda.
    const noBreedUser = await newUser("f");
    await pet(noBreedUser, { species: "dog" });
    const needs = await CommunityService.getFeedPosts(
      { id_profile: vDog }, { scope: "same_breed" }, { id_user: noBreedUser });
    check("pet sem raça → needs_pet_breed", needs.needs_pet_breed === true && needs.items.length === 0);
    const anon = await CommunityService.getFeedPosts({ id_profile: vDog }, { scope: "same_breed" }, null);
    check("sem sessão → needs_pet_breed", anon.needs_pet_breed === true);

    // Privado fica fora do agregado.
    await c.query(`UPDATE public.tb_profile SET community_privacy = 'private' WHERE id_profile = $1`, [u1Pet]);
    const afterPriv = bodies(await CommunityService.getFeedPosts({ id_profile: vDog }, { limit: 24 }, { id_user: viewer }));
    check("pet privado sai do feed agregado", !afterPriv.includes("PET-MESMA-RACA"));

    // ── 4. carro continua como estava ───────────────────────────────────────
    const vCar = await mkSpace(viewer, "car");
    const carNeeds = await CommunityService.getFeedPosts(
      { id_profile: vCar }, { scope: "same_model" }, { id_user: viewer });
    check("carro sem modelo → needs_car_model", carNeeds.needs_car_model === true && carNeeds.car_scope === "same_model");

    // ── 5. games ────────────────────────────────────────────────────────────
    const games = await one(
      c,
      `SELECT id_profile FROM public.tb_profile
        WHERE community_kind = 'games' AND deleted_at IS NULL LIMIT 1`
    );
    check("plataforma de games existe", !!games);
    const setGame = (id_user, title) =>
      c.query(
        `INSERT INTO public.tb_user_current_game (id_user, game_title) VALUES ($1, $2)
         ON CONFLICT (id_user) DO UPDATE SET game_title = EXCLUDED.game_title`,
        [id_user, title]
      );
    const gNeeds = await CommunityService.getFeedPosts(
      { id_profile: games.id_profile }, { scope: "same_game" }, { id_user: viewer });
    check("sem jogo declarado → needs_current_game", gNeeds.needs_current_game === true && gNeeds.game_scope === "same_game");

    await setGame(viewer, "Elden Ring");
    await setGame(u1, "  ÉLDEN ring!! ");
    await setGame(u2, "Minecraft");
    const gk = await one(c, `SELECT game_key FROM public.tb_user_current_game WHERE id_user = $1`, [u1]);
    check("game_key é gerado na escrita", gk.game_key === "elden ring");
    await recado(games.id_profile, u1, "GAME-MESMO");
    await recado(games.id_profile, u2, "GAME-OUTRO");
    const gSame = bodies(await CommunityService.getFeedPosts(
      { id_profile: games.id_profile }, { limit: 24, scope: "same_game" }, { id_user: viewer }));
    check("mesmo jogo (grafia diferente) aparece", gSame.includes("GAME-MESMO"), JSON.stringify(gSame));
    check("outro jogo fica fora", !gSame.includes("GAME-OUTRO"));
    const gAll = await CommunityService.getFeedPosts(
      { id_profile: games.id_profile }, { limit: 24 }, { id_user: viewer });
    check("games 'all' mostra os dois", bodies(gAll).includes("GAME-MESMO") && bodies(gAll).includes("GAME-OUTRO"));
    check("games 'all' devolve game_scope", gAll.game_scope === "all");

    // ── 6. a porta de entrar ────────────────────────────────────────────────
    const joinPet = await CommunityService.join({ id_user: u2 }, { id_profile: vDog });
    check("entrar no pet de outra pessoa é recusado (409)", joinPet.statusCode === 409 && joinPet.is_platform === true,
      JSON.stringify(joinPet));
    const joinCar = await CommunityService.join({ id_user: u2 }, { id_profile: vCar });
    check("entrar no carro de outra pessoa é recusado (409)", joinCar.statusCode === 409);
    const own = await CommunityService.join({ id_user: viewer }, { id_profile: vDog });
    check("o dono continua dono (re-entrar devolve ok)", own.ok === true && own.role === "leader");
    const members = await one(
      c,
      `SELECT COUNT(*)::int AS n FROM public.tb_community_member WHERE id_community_profile = $1`,
      [vDog]
    );
    check("nenhum membro novo no pet", members.n === 1);
  } catch (err) {
    FAIL++;
    console.error("✗ erro inesperado:", err);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }

  const left = await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_user WHERE email LIKE 'spl%@t.test'`);
  check("depois do ROLLBACK nenhum usuário de teste ficou", left.rows[0].n === 0);
  const col = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'tb_user_current_game' AND column_name = 'game_key'`
  );
  check("depois do ROLLBACK a migration não ficou aplicada", col.rowCount === 0);

  console.log(`\n${PASS} ok · ${FAIL} falhas`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
})();
