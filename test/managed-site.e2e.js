/**
 * Suíte do SITE FEITO PELA FREELANDOO (mig 241).
 *
 * ═══ O QUE ELA PROTEGE ═══
 *
 * 1. A BRECHA. "Ninguém além da gente coloca site aqui" é uma promessa que se
 *    apoia em guards espalhados por dois services. Aqui ela vira asserção: o
 *    líder tenta salvar, tenta publicar, e leva 403 — com o DOCUMENTO DELE
 *    intacto no banco depois da tentativa.
 *
 * 2. A PORTA DE SAÍDA. Despublicar CONTINUA valendo para o cliente, inclusive
 *    no site gerenciado. Trancar as duas direções deixaria alguém sem como
 *    tirar do ar hoje um endereço errado, e a carência de 30 dias não serve
 *    para isso.
 *
 * 3. O PLANO SUPERIOR. `ux_user_plan_active` (mig 225) é único por pessoa entre
 *    as assinaturas vivas — é ELE que impede um "plano à parte" e obriga o
 *    plano do site a carregar as chaves do Negócio. O teste exercita a corrida
 *    real: com o plano do site ativo, tentar abrir o Negócio é recusado pelo
 *    ÍNDICE, pelo nome.
 *
 * 4. O TEMA CHEGA AO MUNDO. `getPublicBySlug` tem que devolver `template` —
 *    sem isso a página abre pelo canvas de seções, que num site de tema está
 *    vazio, e o resultado é uma página EM BRANCO no domínio do cliente sem um
 *    único erro em lugar nenhum.
 *
 * Transacional (BEGIN → ROLLBACK) como `business-plan.e2e.js`: pode rodar
 * contra o banco de produção sem deixar linha. NÃO existe COMMIT neste arquivo.
 *
 * Uso: `npm run test:managed-site`
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (typeof cond === "function") {
    throw new Error(`check("${name}") recebeu função — passe o valor já avaliado.`);
  }
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main() {
  const url = (process.env.DATABASE_URL || "").split("?")[0];
  if (!url) throw new Error("DATABASE_URL ausente.");

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query("BEGIN");

  try {
    const pool = require("../src/databases");
    pool.query = (...args) => client.query(...args);
    let depth = 0;
    pool.connect = async () => ({
      query: async (text, params) => {
        const t = String(text).trim().toUpperCase();
        if (t === "BEGIN") { depth += 1; return client.query(`SAVEPOINT svc_${depth}`); }
        if (t === "COMMIT") { const d = depth; depth -= 1; return client.query(`RELEASE SAVEPOINT svc_${d}`); }
        if (t === "ROLLBACK") { const d = depth; depth -= 1; return client.query(`ROLLBACK TO SAVEPOINT svc_${d}`); }
        return client.query(text, params);
      },
      release: () => {},
    });

    const CommunityStorage = require("../src/storages/CommunityStorage");
    const CommunitySiteStorage = require("../src/storages/CommunitySiteStorage");
    const CommunitySiteService = require("../src/services/CommunitySiteService");
    const ManagedSiteService = require("../src/services/ManagedSiteService");
    const PlanStorage = require("../src/storages/PlanStorage");
    const PlanService = require("../src/services/PlanService");
    const { MANAGED_SITE_PLAN_SLUG, MANAGED_SITE_GATE } = require("../src/utils/managedSite");

    // ─── 1. A migration ───────────────────────────────────────────────────
    console.log("\n[1] Migration 241");
    const migPath = path.join(__dirname, "..", "src", "databases", "migrations", "241_managed_site.sql");
    const sql = fs.readFileSync(migPath, "utf8");
    await client.query(sql);
    await client.query(sql);
    check("aplicada DUAS vezes sem estourar (idempotente)", true);

    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'tb_community_site'
          AND column_name IN ('template','template_data','managed_by_platform','grace_until')
        ORDER BY column_name`
    );
    check("as quatro colunas existem", cols.rowCount === 4, `n=${cols.rowCount}`);
    const by = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
    check("template é nullable — NULL significa 'site do construtor'", by.template?.is_nullable === "YES");
    check("template_data é jsonb NOT NULL", by.template_data?.data_type === "jsonb" && by.template_data?.is_nullable === "NO");
    check("managed_by_platform nasce FALSE", /false/i.test(by.managed_by_platform?.column_default || ""));
    check("grace_until é timestamptz nullable", by.grace_until?.data_type === "timestamp with time zone" && by.grace_until?.is_nullable === "YES");

    const idx = await client.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_community_site_grace'`
    );
    check("índice da carência existe e é PARCIAL", idx.rowCount === 1 && /WHERE/i.test(idx.rows[0].indexdef));

    // ⚠️ AQUI HAVIA UMA CONTAGEM GLOBAL ("nenhum site é gerenciado") e ela
    // envelheceu no dia em que o primeiro site foi entregue de verdade: lia a
    // tabela inteira e acusava o produto funcionando como contaminação. As
    // duas perguntas abaixo dizem a mesma coisa e continuam verdadeiras
    // depois de mil entregas.

    // 1. ESTRUTURAL: acrescentar as colunas não pôde ligar nada, porque a
    //    linha que já existia nasceu com o default seguro.
    const defs = await client.query(
      `SELECT column_name, column_default, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tb_community_site'
          AND column_name IN ('template', 'managed_by_platform')`
    );
    const porNome = Object.fromEntries(defs.rows.map((r) => [r.column_name, r]));
    check(
      "o default de managed_by_platform é FALSE — a migration não liga nada",
      /false/i.test(String(porNome.managed_by_platform?.column_default || "")),
      JSON.stringify(porNome.managed_by_platform)
    );
    check(
      "e `template` nasce NULL (o site continua sendo o do canvas)",
      porNome.template?.column_default === null && porNome.template?.is_nullable === "YES",
      JSON.stringify(porNome.template)
    );

    // 2. INVARIANTE: não existe site gerenciado SEM tema — o estado que o
    //    código chama de pior dos dois mundos (o cliente editaria seções que
    //    ninguém vê). É o que um backfill mal feito produziria.
    const orfaos = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_community_site
        WHERE managed_by_platform = TRUE AND template IS NULL`
    );
    check("nenhum site gerenciado ficou sem tema", orfaos.rows[0].n === 0, `n=${orfaos.rows[0].n}`);

    // ─── 2. O plano ───────────────────────────────────────────────────────
    console.log("\n[2] O plano superior");
    const planoSite = await PlanStorage.getPlanBySlug(pool, MANAGED_SITE_PLAN_SLUG);
    check("plano 'site-freelandoo' seedado", !!planoSite);
    check("custa R$99,00 (em centavos)", planoSite && Number(planoSite.price_cents) === 9900, String(planoSite?.price_cents));

    const keysSite = await client.query(
      `SELECT f.feature_key FROM public.tb_plan_feature f
         JOIN public.tb_plan p ON p.id_plan = f.id_plan
        WHERE p.slug = $1 ORDER BY 1`,
      [MANAGED_SITE_PLAN_SLUG]
    );
    const keysNegocio = await client.query(
      `SELECT f.feature_key FROM public.tb_plan_feature f
         JOIN public.tb_plan p ON p.id_plan = f.id_plan
        WHERE p.slug = 'profissional' ORDER BY 1`
    );
    const setSite = new Set(keysSite.rows.map((r) => r.feature_key));
    const faltando = keysNegocio.rows.map((r) => r.feature_key).filter((k) => !setSite.has(k));
    check(
      "o plano do site é SUPERSET do Negócio — quem paga mais não perde porta",
      faltando.length === 0,
      `faltando: ${faltando.join(",")}`
    );
    check("e tem a chave própria", setSite.has(MANAGED_SITE_GATE));
    check(
      "a chave NÃO tem produto na Loja de Funções (lá, fora de venda = grátis para todos)",
      (await client.query(`SELECT 1 FROM public.tb_function_product WHERE feature_key = $1`, [MANAGED_SITE_GATE])).rowCount === 0
    );

    // ─── 3. Fixtures ──────────────────────────────────────────────────────
    const stamp = Date.now().toString(36);
    async function mkUser(tag) {
      const r = await client.query(
        `INSERT INTO public.tb_user (nome, email, senha, username, ativo)
              VALUES ($1, $2, 'x', $3, TRUE) RETURNING id_user`,
        [`User ${tag}`, `ms_${tag}_${stamp}@ex.com`, `ms_${tag}_${stamp}`]
      );
      return r.rows[0].id_user;
    }
    const cat = await client.query(`SELECT id_category FROM public.tb_category ORDER BY id_category LIMIT 1`);
    async function mkProfile(id_user, tag) {
      const r = await client.query(
        `INSERT INTO public.tb_profile
              (id_user, id_category, display_name, sub_profile_slug, is_user_account, is_visible)
              VALUES ($1, $2, $3, $4, TRUE, FALSE) RETURNING id_profile`,
        [id_user, cat.rows[0].id_category, `Perfil ${tag}`, `ms-${tag}-${stamp}`]
      );
      return r.rows[0].id_profile;
    }
    const leader = await mkUser("leader");
    await mkProfile(leader, "leader");

    const machine = await client.query(`SELECT id_machine FROM public.tb_machine ORDER BY id_machine LIMIT 1`);
    const community = await CommunityStorage.createCommunity(pool, {
      id_user: leader,
      id_machine: machine.rows[0].id_machine,
      display_name: `Oficina ${stamp}`,
      bio: null,
      avatar_url: null,
      theme: null,
      kind: "common",
      address: null,
    });
    const idc = community.id_profile;

    // O líder monta o site DELE primeiro — é esse documento que não pode se
    // perder quando o site vira gerenciado.
    await CommunitySiteService.save({ id_user: leader }, { id_profile: idc }, {
      config: {
        siteName: "Meu site antigo",
        tagline: "feito por mim",
        sections: [{ kind: "hero", enabled: true, title: "Bem-vindo", data: {} }],
      },
    });
    const antes = await CommunitySiteStorage.getByProfile(pool, idc);
    check("o líder salvou o site dele normalmente (construtor segue livre)", antes?.site_name === "Meu site antigo");
    check("com uma seção no documento", Array.isArray(antes.sections) && antes.sections.length === 1);

    // ─── 4. Nós montamos o site ───────────────────────────────────────────
    console.log("\n[4] A plataforma monta o site");
    const ruim = await ManagedSiteService.apply({ id_profile: idc }, { template: "barbearia-inventada", data: {} });
    check("tema desconhecido é recusado com 400", ruim.statusCode === 400, JSON.stringify(ruim));

    const applied = await ManagedSiteService.apply({ id_profile: idc }, {
      template: "oficina-local",
      data: {
        business: { name: "Oficina Teste", whatsappNumber: "+55 (19) 99495-7125" },
        services: [{ slug: "conserto", label: "Conserto", h1: "Conserto de fogões" }],
        cities: [{ slug: "aguai", name: "Aguaí" }],
        googleProfileUrl: "javascript:alert(1)",
      },
    });
    check("apply grava o tema", applied.template === "oficina-local", JSON.stringify(applied).slice(0, 200));
    check("e trava a edição do cliente", applied.managed === true);
    check("o normalizador rodou no caminho real (link perigoso virou vazio)", applied.data.googleProfileUrl === "");
    check("e o telefone ficou só com dígitos", applied.data.business.whatsappNumber === "5519994957125");

    const depois = await CommunitySiteStorage.getByProfile(pool, idc);
    check(
      "⚠️ O DOCUMENTO DO CLIENTE CONTINUA LÁ — apply não apaga o que ele montou",
      depois.site_name === "Meu site antigo" && depois.sections.length === 1
    );

    // ─── 5. A brecha ──────────────────────────────────────────────────────
    console.log("\n[5] O cliente não edita");
    const save1 = await CommunitySiteService.save({ id_user: leader }, { id_profile: idc }, {
      config: { siteName: "INVASÃO", tagline: "", sections: [] },
    });
    check("salvar num site gerenciado é recusado com 403", save1.statusCode === 403, JSON.stringify(save1));
    const aposTentativa = await CommunitySiteStorage.getByProfile(pool, idc);
    check(
      "e NADA foi gravado — nem o nome, nem o esvaziamento das seções",
      aposTentativa.site_name === "Meu site antigo" && aposTentativa.sections.length === 1
    );
    check("o tema seguiu intacto", aposTentativa.template === "oficina-local");

    // ⚠️ ESTA ASSERÇÃO ENVELHECEU E FOI REESCRITA (2026-09-12). Ela dizia
    // "publicar é recusado com 403 (quem põe no ar somos nós)" — era a regra da
    // mig 241, e o Alex a inverteu: o cliente aceita o site e publica ele
    // mesmo, junto com o domínio. O que segurava o caso real (republicar o que
    // a plataforma tirou do ar por falta de pagamento) passou a ser o GATE DE
    // PLANO, e é ele que esta asserção passa a exigir.
    //
    // O líder do fixture não assina nada, então a recusa aqui é 402 por plano —
    // nunca mais 403 por ser gerenciado. Os dois sentidos (com e sem plano)
    // estão em `test/managed-site-request.e2e.js`.
    const pubCliente = await CommunitySiteService.setPublished({ id_user: leader }, { id_profile: idc }, { published: true });
    check(
      "publicar é recusado por PLANO (402), não por ser gerenciado",
      pubCliente.statusCode === 402,
      JSON.stringify(pubCliente)
    );
    check(
      "e a recusa aponta o plano do site — o Negócio devolveria o botão sem parar a carência",
      pubCliente.needs_plan === "site-freelandoo",
      String(pubCliente.needs_plan)
    );
    check(
      "o site continua fora do ar",
      (await CommunitySiteStorage.getByProfile(pool, idc)).is_published === false
    );

    // ─── 6. Publicação pela plataforma ────────────────────────────────────
    console.log("\n[6] A plataforma publica");
    const pub = await ManagedSiteService.setPublished({ id_profile: idc }, { published: true });
    check("publicado", pub.is_published === true, JSON.stringify(pub).slice(0, 200));
    check("e o endereço público foi reservado na mesma hora", !!pub.slug, String(pub.slug));

    const publico = await CommunitySiteService.getPublicBySlug({ slug: pub.slug });
    check("o site responde pelo endereço público", !publico.error && publico.locked === false, JSON.stringify(publico).slice(0, 160));
    check(
      "⚠️ e ele carrega o TEMA — sem isto a página abriria em branco, sem erro",
      publico.template && publico.template.slug === "oficina-local"
    );
    check("com os dados dentro", publico.template?.data?.services?.length === 1);

    // ─── 7. A porta de saída ──────────────────────────────────────────────
    console.log("\n[7] Despublicar continua sendo do cliente");
    const off = await CommunitySiteService.setPublished({ id_user: leader }, { id_profile: idc }, { published: false });
    check("o cliente consegue TIRAR DO AR o site gerenciado", off.is_published === false, JSON.stringify(off).slice(0, 160));
    await ManagedSiteService.setPublished({ id_profile: idc }, { published: true });

    // ─── 8. O plano ativo ─────────────────────────────────────────────────
    console.log("\n[8] O direito e a assinatura única");
    check(
      "sem plano, o líder não tem a chave do site gerenciado",
      (await PlanService.hasFeature(leader, MANAGED_SITE_GATE)) === false
    );

    const pend = await PlanStorage.createPending(pool, {
      id_user: leader,
      id_plan: planoSite.id_plan,
      price_cents: planoSite.price_cents,
      stripe_session_id: `cs_test_ms_${stamp}`,
    });
    await PlanStorage.activate(pool, pend.id_subscription, {
      stripe_subscription_id: `sub_ms_${stamp}`,
      stripe_customer_id: `cus_ms_${stamp}`,
      current_period_end: new Date(Date.now() + 30 * 864e5),
    });
    check("com o plano ativo, a chave do site é dele", (await PlanService.hasFeature(leader, MANAGED_SITE_GATE)) === true);
    check(
      "e ele ganhou junto as portas do Negócio (é superset, não plano paralelo)",
      (await PlanService.hasFeature(leader, "site_share")) === true &&
        (await PlanService.hasFeature(leader, "community_members")) === true
    );

    // A razão de ser do plano superior, exercitada.
    const negocio = await PlanStorage.getPlanBySlug(pool, "profissional");
    let violou = null;
    await client.query("SAVEPOINT sp_dupla");
    try {
      const p2 = await PlanStorage.createPending(pool, {
        id_user: leader,
        id_plan: negocio.id_plan,
        price_cents: negocio.price_cents,
        stripe_session_id: `cs_test_ms2_${stamp}`,
      });
      await PlanStorage.activate(pool, p2.id_subscription, {
        stripe_subscription_id: `sub_ms2_${stamp}`,
        stripe_customer_id: `cus_ms_${stamp}`,
        current_period_end: new Date(Date.now() + 30 * 864e5),
      });
    } catch (e) {
      violou = e.constraint || null;
    }
    await client.query("ROLLBACK TO SAVEPOINT sp_dupla");
    check(
      "⚠️ DUAS assinaturas vivas são recusadas PELO NOME do índice — é por isso que o plano do site é SUPERIOR, não paralelo",
      violou === "ux_user_plan_active",
      String(violou)
    );

    // ─── 9. A carência ────────────────────────────────────────────────────
    console.log("\n[9] A carência");
    const vencido = new Date(Date.now() - 864e5);
    await CommunitySiteStorage.setGrace(pool, idc, vencido);
    const expirados = await CommunitySiteStorage.listGraceExpired(pool);
    check("o sweeper enxerga o site vencido", expirados.some((r) => String(r.id_profile) === String(idc)));
    check("e sabe quem é o dono, sem uma segunda consulta", expirados.find((r) => String(r.id_profile) === String(idc))?.id_leader_user === leader);

    await CommunitySiteStorage.setGrace(pool, idc, null);
    check(
      "assinatura de volta PARA o relógio",
      !(await CommunitySiteStorage.listGraceExpired(pool)).some((r) => String(r.id_profile) === String(idc))
    );

    // Um site do construtor não pode ser alcançado pela carência: lá a regra é
    // a do PlanService (perde a porta, não o que já é seu).
    const outroLeader = await mkUser("outro");
    await mkProfile(outroLeader, "outro");
    const c2 = await CommunityStorage.createCommunity(pool, {
      id_user: outroLeader,
      id_machine: machine.rows[0].id_machine,
      display_name: `Construtor ${stamp}`,
      bio: null, avatar_url: null, theme: null, kind: "common", address: null,
    });
    await CommunitySiteService.save({ id_user: outroLeader }, { id_profile: c2.id_profile }, {
      config: { siteName: "Site do cliente", tagline: "", sections: [] },
    });
    const tocou = await CommunitySiteStorage.setGrace(pool, c2.id_profile, vencido);
    check("⚠️ setGrace NÃO alcança site do construtor — ele nunca sai do ar por plano", tocou === null);

    // ─── 10. Devolver ao cliente ──────────────────────────────────────────
    console.log("\n[10] Release");
    const rel = await ManagedSiteService.release({ id_profile: idc });
    check("o tema foi apagado", rel.template === null);
    check("e a edição destravou", rel.managed === false);
    const volta = await CommunitySiteStorage.getByProfile(pool, idc);
    check(
      "⚠️ o cliente reencontra o site que ele tinha antes de contratar",
      volta.site_name === "Meu site antigo" && volta.sections.length === 1
    );
    check("e continua no ar (release não tira ninguém do ar de surpresa)", volta.is_published === true);
    const save2 = await CommunitySiteService.save({ id_user: leader }, { id_profile: idc }, {
      config: { siteName: "Agora sim", tagline: "", sections: [] },
    });
    check("e volta a poder editar", !save2.error && save2.config.siteName === "Agora sim", JSON.stringify(save2).slice(0, 160));

    // ─── 11. Só a comunidade de negócio ───────────────────────────────────
    console.log("\n[11] Modalidade");
    const pet = await CommunityStorage.createCommunity(pool, {
      id_user: outroLeader,
      id_machine: null,
      display_name: `Pet ${stamp}`,
      bio: null, avatar_url: null, theme: null, kind: "pet", address: null,
    });
    const noPet = await ManagedSiteService.apply({ id_profile: pet.id_profile }, {
      template: "oficina-local",
      data: {},
    });
    check("site gerenciado em comunidade que não é negócio: recusado", noPet.statusCode === 403, JSON.stringify(noPet).slice(0, 160));

    console.log(`\n${pass} passaram, ${fail} falharam`);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
