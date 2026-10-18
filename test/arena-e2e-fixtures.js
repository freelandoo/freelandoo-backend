// Fixtures SINTÉTICAS para o teste de navegador da Arena (Módulos 04/05).
//
//   node test/arena-e2e-fixtures.js seed [n]        → cria n contas (padrão 2, máx 8) + catálogo, imprime JSON
//   node test/arena-e2e-fixtures.js block <email>   → bloqueia a conta (blocked_at = agora)
//   node test/arena-e2e-fixtures.js state <email>   → imprime jogador/preferências do banco
//
// Banco de TESTE apenas (recusa produção). Contas com e-mail `.invalid`, que
// não recebe correio: nenhum e-mail real é enviado.

const DB_URL = process.env.TEST_DATABASE_URL || "postgres://postgres:test@127.0.0.1:55432/freelandoo_test";
if (/railway|rlwy\.net|proxy\.rlwy/i.test(DB_URL)) {
  console.error("[guard] TEST_DATABASE_URL parece produção. Abortando.");
  process.exit(1);
}
process.env.DATABASE_URL = DB_URL;
process.env.DATABASE_URL_COLD = "";

const { Client } = require("pg");
const { syncAvatars } = require("../src/services/ArenaAvatarSync");
const bcrypt = require("bcrypt");
const AuthStorage = require("../src/storages/AuthStorage");
const { syncCatalog } = require("../src/services/ArenaCatalogSync");
const catalog = require("../src/databases/seeds/arena-catalog.json");

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    if (cmd === "seed") {
      const out = await syncCatalog(db, catalog, { apply: true });
      if (!out.ok) throw new Error(out.errors.join("; "));
      // Avatares (M10): o mesmo seed que o build da Arena exporta.
      const av = await syncAvatars(db, require("../src/databases/seeds/arena-avatars.json"), { apply: true });
      if (!av.ok) throw new Error(av.errors.join("; "));
      for (const [cat, team, label] of [
        ["futebol", "teste-azul", "Time sintético Azul"],
        ["futebol", "teste-verde", "Time sintético Verde"],
        ["politica", "teste-grupo-a", "Grupo sintético A"],
      ]) {
        await db.query(
          `INSERT INTO public.tb_arena_team (category_id, team_id, labels, is_synthetic)
           VALUES ($1, $2, $3::jsonb, TRUE) ON CONFLICT (category_id, team_id) DO NOTHING`,
          [cat, team, JSON.stringify({ "pt-BR": label, en: label, es: label })]
        );
      }
      // Política habilitada SÓ neste banco de teste, para exercitar o fluxo.
      await db.query(`UPDATE public.tb_arena_category SET consent_policy_version = 1 WHERE category_id = 'politica'`);
      const stamp = Date.now().toString(36);
      const password = `Teste-${stamp}-senha`;
      const hash = await bcrypt.hash(password, 6);
      const accounts = [];
      const count = Math.max(2, Math.min(8, Number(arg) || 2));
      for (const tag of "abcdefgh".slice(0, count).split("")) {
        const email = `arena.e2e.${tag}.${stamp}@teste.invalid`;
        const r = await db.query(
          `INSERT INTO public.tb_user (nome, username, email, senha, ativo, onboarding_tour_done)
           VALUES ($1, $2, $3, $4, TRUE, TRUE) RETURNING id_user`,
          [`Conta sintética ${tag.toUpperCase()}`, `arena_e2e_${tag}_${stamp}`.slice(0, 30), email, hash]
        );
        // Aceite dos Termos já registrado: o teste é da Arena, não do aceite.
        await db.query(
          `INSERT INTO public.tb_user_action_consent (id_user, action_key, terms_version)
           SELECT $1, 'signup', COALESCE(MAX(terms_version), 1) FROM public.tb_user_action_consent
           ON CONFLICT DO NOTHING`,
          [r.rows[0].id_user]
        );
        // Perfil-conta, como o cadastro real cria: é ele que o personagem
        // representa no social da Arena (M09) — sem ele o cartão diz "indisponível".
        await AuthStorage.ensureUserAccountProfile(db, r.rows[0].id_user, `Conta sintética ${tag.toUpperCase()}`);
        accounts.push({ email, username: `arena_e2e_${tag}_${stamp}`.slice(0, 30) });
      }
      console.log(JSON.stringify({ password, accounts }));
    } else if (cmd === "block") {
      await db.query(`UPDATE public.tb_user SET blocked_at = NOW() WHERE email = $1`, [arg]);
      console.log("{}");
    } else if (cmd === "state") {
      const r = await db.query(
        `SELECT p.player_id, p.active_category_id, p.revision,
                COALESCE(json_agg(json_build_object('c', pr.category_id, 't', pr.team_id) ORDER BY pr.category_id)
                  FILTER (WHERE pr.category_id IS NOT NULL), '[]') AS prefs
           FROM public.tb_user u
           JOIN public.tb_arena_player p ON p.id_user = u.id_user
           LEFT JOIN public.tb_arena_preference pr ON pr.id_user = u.id_user
          WHERE u.email = $1
          GROUP BY p.player_id, p.active_category_id, p.revision`,
        [arg]
      );
      console.log(JSON.stringify(r.rows[0] || null));
    } else {
      throw new Error("uso: seed | block <email> | state <email>");
    }
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
