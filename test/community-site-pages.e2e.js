// test/community-site-pages.e2e.js — SUB-PÁGINAS DO SITE + textStyles (mig 238)
//
// Roda: npm run test:site-pages
//
// ─── POR QUE ESTE TESTE PODE APONTAR PARA PRODUÇÃO ──────────────────────────
//
// As outras suítes e2e exigem `TEST_DATABASE_URL` e RECUSAM a URL de produção,
// porque elas comitam o que criam. Esta não comita nada: tudo acontece dentro de
// UMA transação que termina em ROLLBACK, incluindo a aplicação da migration. O
// `COMMIT` não existe neste arquivo — e o passo final confere, já fora da
// transação, que as colunas criadas pelo teste não ficaram no banco.
//
// ─── O QUE ESTA SUÍTE PROVA, E POR QUE ELA EXISTE ───────────────────────────
//
// A mig 238 tem DUAS metades, e a primeira é conserto de um defeito que está em
// produção hoje: `textStyles` era validado no save, NÃO TINHA COLUNA, e não
// voltava no GET — toda alça de tamanho de texto voltava ao padrão no
// recarregamento seguinte. O caso mais importante aqui é o round-trip completo
// (upsert → getByProfile → toConfig), porque ele é o único que pega esse tipo de
// perda: cada peça isolada parecia correta, e o valor morria no caminho.
//
// A segunda metade são as sub-páginas. O que se confere é o que o banco e o
// normalizador garantem — endereço único, endereço reservado recusado, teto, e a
// seção de sub-página entrando no MESMO desempate de ids da home (duas seções com
// o mesmo id dividiriam a mesma entrada de `textStyles`, e mexer numa mudaria a
// outra à distância).

require("dotenv").config();

// O `.env` local aponta para um Postgres gerenciado com certificado
// self-signed; sem isto o driver recusa a conexão antes do primeiro SELECT.
process.env.DATABASE_SSL = "true";
process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = "false";

const fs = require("fs");
const path = require("path");
const pool = require("../src/databases");

let PASS = 0;
let FAIL = 0;

/**
 * ⚠️ RECUSA FUNÇÃO ASSYNC de propósito. Uma promise é sempre verdadeira, então
 * `check("x", algoAsync())` passaria sem olhar para nada.
 */
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

/** Roda algo que deve falhar e devolve o nome da constraint violada. */
async function violates(c, fn) {
  await c.query("SAVEPOINT sp");
  try {
    await fn();
    await c.query("RELEASE SAVEPOINT sp");
    return null;
  } catch (err) {
    await c.query("ROLLBACK TO SAVEPOINT sp");
    return err.constraint || err.code || "erro-sem-nome";
  }
}

const sec = (id, kind = "about") => ({
  id,
  kind,
  enabled: true,
  title: `t-${id}`,
  subtitle: "",
  data: {},
});

(async () => {
  const c = await pool.connect();

  try {
    await c.query("BEGIN");

    const poolPath = require.resolve("../src/databases");
    require.cache[poolPath].exports = c;

    const CommunitySite = require("../src/utils/communitySite");
    const Storage = require("../src/storages/CommunitySiteStorage");

    // ── 1. a migration ──────────────────────────────────────────────────────
    const sql = fs.readFileSync(
      path.join(__dirname, "../src/databases/migrations/238_community_site_pages.sql"),
      "utf8"
    );
    await c.query(sql);
    check("migration 238 aplica", true);
    await c.query(sql);
    check("migration 238 é idempotente (2ª aplicação não falha)", true);

    const cols = await c.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'tb_community_site'
          AND column_name IN ('text_styles', 'pages')
        ORDER BY column_name`
    );
    check("as duas colunas existem", cols.rows.length === 2, JSON.stringify(cols.rows));
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
    check("pages é jsonb NOT NULL", byName.pages?.data_type === "jsonb" && byName.pages?.is_nullable === "NO");
    check(
      "text_styles é jsonb NOT NULL",
      byName.text_styles?.data_type === "jsonb" && byName.text_styles?.is_nullable === "NO"
    );
    check("pages nasce como lista vazia", /\[\]/.test(byName.pages?.column_default || ""));
    check("text_styles nasce como objeto vazio", /\{\}/.test(byName.text_styles?.column_default || ""));

    const checks = await c.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.tb_community_site'::regclass
          AND conname LIKE 'chk_community_site_%'
        ORDER BY conname`
    );
    const names = checks.rows.map((r) => r.conname);
    for (const n of [
      "chk_community_site_pages_array",
      "chk_community_site_pages_size",
      "chk_community_site_text_styles_object",
      "chk_community_site_text_styles_size",
    ]) {
      check(`CHECK ${n} existe`, names.includes(n), names.join(","));
    }
    // Exatamente um de cada: o DROP antes do ADD é o que impede a constraint
    // antiga de ficar de pé em paralelo numa 2ª aplicação.
    check(
      "não há CHECK duplicado de pages_array",
      names.filter((n) => n === "chk_community_site_pages_array").length === 1
    );

    // ── 2. o elenco ─────────────────────────────────────────────────────────
    let seq = 0;
    const stamp = Date.now();
    const mk = (p) => `sp-${p}-${stamp}-${++seq}`;
    const mkUser = (p) => `sp${p}${stamp}${++seq}`;

    const leader = await one(
      c,
      `INSERT INTO public.tb_user (nome, email, username)
       VALUES ('Líder Páginas', $1, $2) RETURNING id_user`,
      [`${mkUser("l")}@t.test`, mkUser("l")]
    );
    const biz = await one(
      c,
      `INSERT INTO public.tb_profile
         (id_user, sub_profile_slug, display_name, is_community, community_kind, id_leader_user)
       VALUES ($1, $2, 'Negócio Teste', TRUE, 'common', $1) RETURNING id_profile`,
      [leader.id_user, mk("biz")]
    );

    // ── 3. O CONSERTO: textStyles e pages fazem round-trip ──────────────────
    //
    // É o caso que justifica a migration. Antes dela o upsert não gravava
    // `text_styles` e o GET não o devolvia: o líder arrastava a alça, a tela
    // respondia, e o valor morria no caminho para o banco.
    const config = CommunitySite.normalizeConfig({
      siteName: "Padaria do Zé",
      tagline: "pão quente",
      theme: { primary: "#B4470F" },
      textStyles: { "sec:h1": { fontSize: 64, width: 80 } },
      sections: [sec("h1", "hero"), sec("h2")],
      pages: [
        {
          id: "p1",
          slug: "aguai",
          title: "Conserto em Aguaí",
          subtitle: "atendemos a cidade toda",
          enabled: true,
          sections: [sec("a1"), sec("a2", "faq")],
        },
        { id: "p2", slug: "mogi", title: "Mogi", subtitle: "", enabled: false, sections: [] },
      ],
    });
    check("normalizeConfig devolve pages", Array.isArray(config.pages) && config.pages.length === 2);
    check("normalizeConfig devolve textStyles", !!config.textStyles["sec:h1"]);

    await Storage.upsert(c, biz.id_profile, config);
    const row = await Storage.getByProfile(c, biz.id_profile);

    check("upsert grava pages", Array.isArray(row.pages) && row.pages.length === 2);
    check(
      "upsert grava text_styles (o defeito que a mig 238 conserta)",
      !!row.text_styles && row.text_styles["sec:h1"]?.fontSize === 64,
      JSON.stringify(row.text_styles)
    );

    // O round-trip COMPLETO, que é o que o construtor faz: o service projeta a
    // linha de volta para o documento. Projeção campo a campo — o que não está
    // na lista do `toConfig` não chega ao construtor, por mais que esteja no
    // banco. Foi exatamente assim que `textStyles` se perdeu.
    const Service = require("../src/services/CommunitySiteService");
    const got = await Service.get(
      { id_user: leader.id_user },
      { id_profile: biz.id_profile }
    );
    const back = got?.config || null;
    check("o service devolve o documento para o líder", !!back, JSON.stringify(Object.keys(got || {})));
    if (back) {
      check("round-trip: textStyles volta do banco", back.textStyles?.["sec:h1"]?.fontSize === 64);
      check("round-trip: pages volta do banco", (back.pages || []).length === 2);
      check(
        "round-trip: a sub-página mantém as seções dela",
        (back.pages?.[0]?.sections || []).length === 2
      );
      check("round-trip: a home não foi tocada", (back.sections || []).length === 2);
      check("round-trip: página desligada continua desligada", back.pages?.[1]?.enabled === false);
    }

    // Segundo save: o UPDATE do ON CONFLICT também tem que levar as colunas.
    // Sem elas no SET, só o primeiro save (o INSERT) gravaria — e o sintoma
    // seria "some quando eu edito de novo".
    const config2 = CommunitySite.normalizeConfig({
      ...config,
      textStyles: { "sec:h1": { fontSize: 20, width: 50 } },
      pages: config.pages.slice(0, 1),
    });
    await Storage.upsert(c, biz.id_profile, config2);
    const row2 = await Storage.getByProfile(c, biz.id_profile);
    check("2º save atualiza text_styles", row2.text_styles["sec:h1"].fontSize === 20);
    check("2º save atualiza pages", row2.pages.length === 1);

    // ── 4. o normalizador: endereço de página ───────────────────────────────
    const norm = (pages) => CommunitySite.normalizeConfig({ sections: [], pages }).pages;

    check("slug é normalizado para minúsculo", norm([{ slug: "AGUAI" }])[0]?.slug === "aguai");
    check("slug com acento é descartado", norm([{ slug: "aguaí" }]).length === 0);
    check("slug com barra é descartado", norm([{ slug: "a/b" }]).length === 0);
    check("slug vazio é descartado", norm([{ slug: "" }]).length === 0);
    check(
      "slug `agendar` é RECUSADO (já é a página de agendamento da mig 221)",
      norm([{ slug: "agendar" }]).length === 0
    );
    check("slug `api` é recusado", norm([{ slug: "api" }]).length === 0);
    check(
      "endereço repetido: a primeira fica",
      (() => {
        const out = norm([
          { slug: "aguai", title: "primeira" },
          { slug: "aguai", title: "segunda" },
        ]);
        return out.length === 1 && out[0].title === "primeira";
      })()
    );
    check(
      "teto de páginas é aplicado",
      norm(Array.from({ length: 40 }, (_, i) => ({ slug: `p${i}` }))).length ===
        CommunitySite.LIMITS.PAGES
    );
    check("página nasce ligada quando não diz nada", norm([{ slug: "x" }])[0]?.enabled === true);
    check("página desligada continua desligada", norm([{ slug: "x", enabled: false }])[0]?.enabled === false);

    // ── 5. ids de seção: o desempate é do SITE INTEIRO ──────────────────────
    //
    // ⚠️ As chaves de `textStyles` são globais (`sec:<id>`). Uma seção da home e
    // uma de sub-página com o mesmo id dividiriam a MESMA entrada de tamanho:
    // mexer numa mudaria a outra, à distância e sem aviso.
    const dup = CommunitySite.normalizeConfig({
      sections: [sec("mesmo")],
      pages: [{ slug: "a", sections: [sec("mesmo")] }],
    });
    check(
      "id repetido entre home e sub-página é desempatado",
      dup.sections[0].id !== dup.pages[0].sections[0].id,
      `${dup.sections[0].id} vs ${dup.pages[0].sections[0].id}`
    );

    // E a poda de `textStyles` tem que considerar as seções das sub-páginas:
    // deixá-las de fora zeraria, em silêncio, todo tamanho escolhido fora da home.
    const keep = CommunitySite.normalizeConfig({
      sections: [sec("h1")],
      pages: [{ slug: "a", sections: [sec("a1")] }],
      textStyles: {
        "sec:h1": { fontSize: 30 },
        "sec:a1": { fontSize: 40 },
        "sec:fantasma": { fontSize: 50 },
      },
    });
    check("textStyles da home sobrevive", keep.textStyles["sec:h1"]?.fontSize === 30);
    check(
      "textStyles de seção de SUB-PÁGINA sobrevive",
      keep.textStyles["sec:a1"]?.fontSize === 40,
      JSON.stringify(keep.textStyles)
    );
    check("textStyles de seção que não existe é podado", !keep.textStyles["sec:fantasma"]);

    // ── 6. o link para outra página do próprio site ─────────────────────────
    const linkOf = (url) =>
      CommunitySite.normalizeConfig({
        sections: [{ ...sec("s", "areas"), data: { items: [{ name: "Aguaí", url }] } }],
      }).sections[0].data.items[0].url;

    check("link `pagina:aguai` é aceito", linkOf("pagina:aguai") === "pagina:aguai");
    check("link `pagina:` vazio é recusado", linkOf("pagina:") === "");
    check("link `pagina:A Guaí` (inválido) é recusado", linkOf("pagina:A Guaí") === "");
    check("javascript: continua recusado", linkOf("javascript:alert(1)") === "");
    check("link externo continua aceito", linkOf("https://x.test/a") === "https://x.test/a");
    check("token `agendar` continua aceito", linkOf("agendar") === "agendar");

    // ── 7. o CHECK do banco recusa pelo NOME ────────────────────────────────
    const badArray = await violates(c, () =>
      c.query(`UPDATE public.tb_community_site SET pages = '{"a":1}'::jsonb WHERE id_profile = $1`, [
        biz.id_profile,
      ])
    );
    check("pages que não é array é recusado pelo CHECK", badArray === "chk_community_site_pages_array", String(badArray));

    const badObj = await violates(c, () =>
      c.query(`UPDATE public.tb_community_site SET text_styles = '[]'::jsonb WHERE id_profile = $1`, [
        biz.id_profile,
      ])
    );
    check(
      "text_styles que não é objeto é recusado pelo CHECK",
      badObj === "chk_community_site_text_styles_object",
      String(badObj)
    );

    // ── 8. documento ANTIGO continua valendo ────────────────────────────────
    //
    // Quem já publicou não tem `pages` no documento. Isso não pode mudar de
    // forma: sub-página é acréscimo, nunca migração de quem existe.
    const legacy = CommunitySite.normalizeConfig({
      siteName: "Antigo",
      sections: [sec("h1")],
    });
    check("documento sem pages vira lista vazia", Array.isArray(legacy.pages) && legacy.pages.length === 0);
    check("documento sem textStyles vira objeto vazio", JSON.stringify(legacy.textStyles) === "{}");
    await Storage.upsert(c, biz.id_profile, legacy);
    const legacyRow = await Storage.getByProfile(c, biz.id_profile);
    check("site de uma página só grava e lê sem erro", Array.isArray(legacyRow.pages) && legacyRow.pages.length === 0);
  } catch (err) {
    FAIL++;
    console.log("✗ ERRO FATAL:", err.message);
    console.log(err.stack);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }

  // ── 9. produção intocada ──────────────────────────────────────────────────
  const after = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'tb_community_site' AND column_name IN ('text_styles', 'pages')`
  );
  check(
    "depois do ROLLBACK as colunas do teste NÃO existem no banco",
    after.rows[0].n === 0,
    `encontradas=${after.rows[0].n}`
  );

  await pool.end();
  console.log(`\nPASS=${PASS} FAIL=${FAIL}`);
  process.exit(FAIL ? 1 : 0);
})();
