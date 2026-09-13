/**
 * Suíte do PEDIDO DE SITE PRONTO (mig 243) + a volta do PUBLICAR ao cliente.
 *
 * ═══ O QUE ELA PROTEGE ═══
 *
 * 1. O PEDIDO FUNCIONA SEM SITE NENHUM. É o caso que mais importa e o mais
 *    fácil de quebrar: comunidade que nunca abriu o construtor não tem linha em
 *    `tb_community_site`, e é justamente para quem nunca montou nada que o site
 *    pronto mais vale. Um guard escrito como "o site existe?" derrubaria a
 *    venda no melhor cliente, com 404.
 *
 * 2. O SEGUNDO CLIQUE É INOFENSIVO. Apertar duas vezes é o caso comum. Sem o
 *    ON CONFLICT DO NOTHING sobre o índice parcial, o segundo clique vira 500
 *    de unicidade na cara de quem acabou de pedir.
 *
 * 3. RESERVAR FECHA O PEDIDO, NA MESMA TRANSAÇÃO. O teste derruba de propósito
 *    o fechamento e exige que a OFERTA tenha sumido junto — se um dia os dois
 *    passos se separarem, este caso cai. Fila que mostra negócio já atendido é
 *    fila que se aprende a ignorar.
 *
 * 4. ⚠️ A REVERSÃO DO PUBLICAR (decisão do Alex, 2026-09-12). Até aqui
 *    `setPublished` RECUSAVA site gerenciado; agora o cliente publica. O que
 *    substituiu a trava é o gate de plano, e é isso que esta suíte prova nos
 *    DOIS sentidos: com o plano ativo publica; sem plano NÃO republica — que é
 *    o caso do fim da carência, o único que a trava antiga realmente protegia.
 *    O teste assina o plano DE VERDADE (`tb_user_plan_subscription`), então ele
 *    também prova que `site-freelandoo` carrega `site_share` — se a cópia de
 *    chaves da mig 241 se perder, o cliente fica sem publicar o próprio site.
 *
 * 5. DESPUBLICAR CONTINUA FORA DO GATE. Porta de saída trancada é a única que
 *    não pode existir.
 *
 * Transacional (BEGIN -> ROLLBACK) como as irmãs: pode rodar contra o banco de
 * produção sem deixar linha. NÃO existe COMMIT neste arquivo.
 *
 * Uso: `npm run test:managed-site-request`
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
  if (typeof cond !== "boolean") {
    throw new Error(`check("${name}") recebeu ${typeof cond} — a condição tem que ser booleana.`);
  }
  if (cond) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.log(`  XX  ${name}${extra ? ` — ${extra}` : ""}`);
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

    /**
     * Roda algo que DEVE falhar e devolve o erro.
     *
     * ⚠️ O SAVEPOINT não é higiene: um comando recusado aborta a transação
     * inteira no Postgres, e sem voltar a um ponto salvo TODO comando seguinte
     * falharia com "current transaction is aborted".
     */
    let probe = 0;
    async function fails(fn) {
      probe += 1;
      const sp = `probe_${probe}`;
      await client.query(`SAVEPOINT ${sp}`);
      try {
        await fn();
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        return null;
      } catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        return e;
      }
    }

    const CommunityStorage = require("../src/storages/CommunityStorage");
    const CommunitySiteStorage = require("../src/storages/CommunitySiteStorage");
    const CommunitySiteService = require("../src/services/CommunitySiteService");
    const ManagedSiteService = require("../src/services/ManagedSiteService");
    const RequestStorage = require("../src/storages/ManagedSiteRequestStorage");

    // --- 1. A migration -----------------------------------------------------
    console.log("\n[1] Migration 243");
    const migDir = path.join(__dirname, "..", "src", "databases", "migrations");
    // As irmãs precisam estar aplicadas. Em produção já estão; reaplicar é
    // no-op, e é o que faz a suíte rodar num banco que ainda não as viu.
    await client.query(fs.readFileSync(path.join(migDir, "241_managed_site.sql"), "utf8"));
    await client.query(fs.readFileSync(path.join(migDir, "242_managed_site_offer.sql"), "utf8"));
    const sql = fs.readFileSync(path.join(migDir, "243_managed_site_request.sql"), "utf8");
    await client.query(sql);
    await client.query(sql);
    check("aplicada DUAS vezes sem estourar (idempotente)", true);

    const cols = await client.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'tb_managed_site_request'`
    );
    const by = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
    check("status é NOT NULL", by.status?.is_nullable === "NO");
    check("note é nullable — pedir não é preencher formulário", by.note?.is_nullable === "YES");
    check("decided_at é nullable — NULL = ainda na fila", by.decided_at?.is_nullable === "YES");
    check(
      "requested_by_user é nullable — apagar a conta não apaga o pedido",
      by.requested_by_user?.is_nullable === "YES"
    );

    const idx = await client.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'ux_managed_site_request_pending'`
    );
    check(
      "o índice do pedido vivo existe, é UNICO e é PARCIAL",
      idx.rowCount === 1 && /UNIQUE/i.test(idx.rows[0].indexdef) && /WHERE/i.test(idx.rows[0].indexdef)
    );

    const chk = await client.query(
      `SELECT conname FROM pg_constraint WHERE conname = 'chk_managed_site_request_status'`
    );
    check("o CHECK de status é NOMEADO (alargável sem varrer o catálogo)", chk.rowCount === 1);

    // ⚠️ AQUI HAVIA UMA CONTAGEM GLOBAL ("a tabela nasce vazia") e ela
    // envelheceu no primeiro pedido de verdade feito em produção: lia a
    // tabela inteira e acusava o produto funcionando. A mesma pergunta, com
    // o recorte certo, está logo depois das fixtures.

    // --- 2. Fixtures --------------------------------------------------------
    const stamp = Date.now().toString(36);
    async function mkUser(tag) {
      const r = await client.query(
        `INSERT INTO public.tb_user (nome, email, senha, username, ativo)
              VALUES ($1, $2, 'x', $3, TRUE) RETURNING id_user`,
        [`User ${tag}`, `msr_${tag}_${stamp}@ex.com`, `msr_${tag}_${stamp}`]
      );
      return r.rows[0].id_user;
    }
    const cat = await client.query(
      `SELECT id_category FROM public.tb_category ORDER BY id_category LIMIT 1`
    );
    async function mkProfile(id_user, tag) {
      await client.query(
        `INSERT INTO public.tb_profile
              (id_user, id_category, display_name, sub_profile_slug, is_user_account, is_visible)
              VALUES ($1, $2, $3, $4, TRUE, FALSE)`,
        [id_user, cat.rows[0].id_category, `Perfil ${tag}`, `msr-${tag}-${stamp}`]
      );
    }
    const leader = await mkUser("leader");
    await mkProfile(leader, "leader");
    const forasteiro = await mkUser("outro");
    await mkProfile(forasteiro, "outro");
    const adminUser = await mkUser("admin");

    const machine = await client.query(
      `SELECT id_machine FROM public.tb_machine ORDER BY id_machine LIMIT 1`
    );
    async function mkCommunity(nome) {
      const c = await CommunityStorage.createCommunity(pool, {
        id_user: leader,
        id_machine: machine.rows[0].id_machine,
        display_name: nome,
        bio: null,
        avatar_url: null,
        theme: null,
        kind: "common",
        address: null,
      });
      return c.id_profile;
    }
    // SEM SITE: esta comunidade nunca abriu o construtor. É o caso do teste 3.
    const semSite = await mkCommunity(`Nunca montou ${stamp}`);
    const comSite = await mkCommunity(`Ja montou ${stamp}`);
    await CommunitySiteService.save({ id_user: leader }, { id_profile: comSite }, {
      config: {
        siteName: "Meu site",
        sections: [{ kind: "hero", enabled: true, title: "Oi", data: {} }],
      },
    });

    const DOC = {
      business: { name: "Ricardo Fogoes", city: "Aguai", state: "SP", whatsappNumber: "5519999990000" },
      services: [{ slug: "conserto", label: "Conserto", cardText: "Fogao." }],
      cities: [{ slug: "aguai", name: "Aguai", uf: "SP" }],
    };

    const pedidoZero = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_managed_site_request WHERE id_profile = ANY($1::uuid[])`,
      [[semSite, comSite]]
    );
    check("a migration não inventa pedido para comunidade nenhuma", pedidoZero.rows[0].n === 0, `n=${pedidoZero.rows[0].n}`);

    // --- 3. O cliente pede --------------------------------------------------
    console.log("\n[3] Pedir o site");

    const semLinha = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_community_site WHERE id_profile = $1`,
      [semSite]
    );
    check("a comunidade do teste realmente NAO tem linha de site", semLinha.rows[0].n === 0);

    const ped = await CommunitySiteService.requestSite(
      { id_user: leader },
      { id_profile: semSite },
      { note: "quero destacar fogao industrial" }
    );
    check(
      "o líder pede SEM nunca ter aberto o construtor",
      !ped.error && !!ped.request?.id_request,
      JSON.stringify(ped).slice(0, 140)
    );
    check("e o pedido nasce como novo", ped.created === true);

    const denovo = await CommunitySiteService.requestSite(
      { id_user: leader },
      { id_profile: semSite },
      {}
    );
    check(
      "o SEGUNDO clique não estoura e devolve o MESMO pedido",
      !denovo.error && denovo.created === false &&
        denovo.request?.id_request === ped.request.id_request,
      JSON.stringify(denovo).slice(0, 140)
    );
    check(
      "e continua havendo UMA linha só",
      (await client.query(
        `SELECT COUNT(*)::int AS n FROM public.tb_managed_site_request WHERE id_profile = $1`,
        [semSite]
      )).rows[0].n === 1
    );

    const alheio = await CommunitySiteService.requestSite(
      { id_user: forasteiro },
      { id_profile: comSite },
      {}
    );
    check("quem não é líder não pede pelo negócio dos outros", !!alheio.error && alheio.statusCode === 403);

    const anon = await CommunitySiteService.requestSite({}, { id_profile: comSite }, {});
    check("sem sessão, 401", !!anon.error && anon.statusCode === 401);

    const nota = await client.query(
      `SELECT note FROM public.tb_managed_site_request WHERE id_profile = $1`,
      [semSite]
    );
    check("a nota do cliente foi guardada", nota.rows[0].note === "quero destacar fogao industrial");

    // --- 4. A fila que chega até nós ----------------------------------------
    console.log("\n[4] A fila da plataforma");

    await CommunitySiteService.requestSite({ id_user: leader }, { id_profile: comSite }, {});
    const fila = await ManagedSiteService.listRequests();
    const meus = (fila.requests || []).filter((r) => [semSite, comSite].includes(r.id_profile));
    check("os dois pedidos aparecem na fila", meus.length === 2, `n=${meus.length}`);
    check(
      "a fila diz o NOME do negócio (uma fila de UUID não é fila)",
      meus.every((r) => typeof r.community_name === "string" && r.community_name.length > 0)
    );
    check(
      "e diz quem pediu",
      meus.every((r) => r.requested_by_username === `msr_leader_${stamp}`)
    );
    check(
      "has_site separa quem já montou de quem nunca abriu o construtor",
      meus.find((r) => r.id_profile === comSite)?.has_site === true &&
        meus.find((r) => r.id_profile === semSite)?.has_site === false
    );
    const idxSem = fila.requests.findIndex((r) => r.id_profile === semSite);
    const idxCom = fila.requests.findIndex((r) => r.id_profile === comSite);
    check("mais ANTIGO primeiro — quem esperou mais é atendido antes", idxSem < idxCom);

    // --- 5. Reservar responde o pedido, na MESMA transação ------------------
    console.log("\n[5] Reservar fecha o pedido");

    // O CASO QUE PROVA A TRANSAÇÃO: derruba o fechamento e exige que a OFERTA
    // tenha sumido junto. Separados um dia, este teste cai.
    const real = RequestStorage.answerPendingForProfile;
    RequestStorage.answerPendingForProfile = async () => {
      throw new Error("falha forcada depois do INSERT da oferta");
    };
    const boom = await fails(() =>
      ManagedSiteService.prepareOffer(
        { id_user: adminUser },
        { id_profile: semSite },
        { template: "oficina-local", data: DOC }
      )
    );
    RequestStorage.answerPendingForProfile = real;
    check("o erro forçado subiu", !!boom);
    check(
      "e a OFERTA não ficou gravada — os dois passos são um só",
      (await client.query(
        `SELECT COUNT(*)::int AS n FROM public.tb_managed_site_offer WHERE id_profile = $1`,
        [semSite]
      )).rows[0].n === 0
    );
    check(
      "o pedido continua na fila, esperando",
      await RequestStorage.hasPending(pool, semSite)
    );

    const res = await ManagedSiteService.prepareOffer(
      { id_user: adminUser },
      { id_profile: semSite },
      { template: "oficina-local", data: DOC, note: "montado a partir do que voce ja tinha" }
    );
    check("agora a reserva passa", !res.error && !!res.offer?.id_offer, JSON.stringify(res).slice(0, 140));
    check(
      "e ela DIZ qual pedido respondeu",
      res.answered_request === ped.request.id_request,
      String(res.answered_request)
    );
    check("o pedido saiu da fila", !(await RequestStorage.hasPending(pool, semSite)));
    check(
      "e ficou marcado como respondido (histórico, não apagado)",
      (await client.query(
        `SELECT status FROM public.tb_managed_site_request WHERE id_profile = $1`,
        [semSite]
      )).rows[0].status === "answered"
    );

    // Venda ATIVA: reservar sem ninguém ter pedido é caminho normal.
    const c3 = await mkCommunity(`Sem pedido ${stamp}`);
    const ativo = await ManagedSiteService.prepareOffer(
      { id_user: adminUser },
      { id_profile: c3 },
      { template: "oficina-local", data: DOC }
    );
    check(
      "reservar SEM pedido não é erro (a venda ativa é caminho normal)",
      !ativo.error && ativo.answered_request === null
    );

    // --- 6. Tirar da fila sem virar site ------------------------------------
    console.log("\n[6] Dispensar");

    const pendComSite = await RequestStorage.getPending(pool, comSite);
    const dis = await ManagedSiteService.dismissRequest(
      { id_user: adminUser },
      { id_request: pendComSite.id_request }
    );
    check("dispensar responde ok", !dis.error && dis.request?.status === "dismissed");
    check("e o pedido sai da fila", !(await RequestStorage.hasPending(pool, comSite)));

    const dis2 = await ManagedSiteService.dismissRequest(
      { id_user: adminUser },
      { id_request: pendComSite.id_request }
    );
    check("dispensar de novo não reescreve a decisão", !!dis2.error && dis2.statusCode === 409);

    // Dispensado não bloqueia pedir de novo (o índice só vê 'pending').
    const repede = await CommunitySiteService.requestSite(
      { id_user: leader },
      { id_profile: comSite },
      {}
    );
    check("depois de dispensado, dá para pedir de novo", !repede.error && repede.created === true);

    // --- 7. A REVERSÃO: o cliente publica o site gerenciado -----------------
    console.log("\n[7] Publicar — a volta para o cliente");

    const aceite = await CommunitySiteService.acceptOffer(
      { id_user: leader },
      { id_profile: semSite },
      { id_offer: res.offer.id_offer }
    );
    check(
      "o cliente aceita a oferta",
      !aceite.error && aceite.managed === true,
      JSON.stringify(aceite).slice(0, 140)
    );

    const semPlano = await CommunitySiteService.setPublished(
      { id_user: leader },
      { id_profile: semSite },
      { published: true }
    );
    check(
      "SEM plano ativo o cliente NÃO publica — é o caso do fim da carência",
      !!semPlano.error,
      JSON.stringify(semPlano).slice(0, 160)
    );
    check(
      "e a recusa aponta o plano do SITE, não o Negócio (senão ele assina o errado)",
      /Site Freelandoo/i.test(String(semPlano.error)),
      String(semPlano.error)
    );
    check(
      "e `needs_plan` leva ao plano CERTO — o Negócio devolveria o botão e não pararia a carência",
      semPlano.needs_plan === "site-freelandoo",
      String(semPlano.needs_plan)
    );
    check(
      "o site continua fora do ar",
      (await CommunitySiteStorage.getByProfile(pool, semSite)).is_published === false
    );

    // Assina o plano DE VERDADE — é isto que prova que `site-freelandoo`
    // carrega `site_share` (a cópia de chaves da mig 241).
    const plano = await client.query(
      `SELECT id_plan FROM public.tb_plan WHERE slug = 'site-freelandoo'`
    );
    check("o plano do site existe (seed da mig 241)", plano.rowCount === 1);
    const temChave = await client.query(
      `SELECT 1 FROM public.tb_plan_feature f
         JOIN public.tb_plan p ON p.id_plan = f.id_plan
        WHERE p.slug = 'site-freelandoo' AND f.feature_key = 'site_share'`
    );
    check(
      "e ele CARREGA site_share — sem isso o cliente não publica o próprio site",
      temChave.rowCount === 1
    );
    const soDele = await client.query(
      `SELECT p.slug FROM public.tb_plan_feature f
         JOIN public.tb_plan p ON p.id_plan = f.id_plan
        WHERE f.feature_key = 'managed_site'`
    );
    check(
      "e managed_site é EXCLUSIVA dele — é ela que gateia o publicar do site gerenciado",
      soDele.rowCount === 1 && soDele.rows[0].slug === "site-freelandoo",
      JSON.stringify(soDele.rows)
    );

    await client.query(
      `INSERT INTO public.tb_user_plan_subscription (id_user, id_plan, status, price_cents)
            VALUES ($1, $2, 'active', 9900)`,
      [leader, plano.rows[0].id_plan]
    );

    const comPlano = await CommunitySiteService.setPublished(
      { id_user: leader },
      { id_profile: semSite },
      { published: true }
    );
    check(
      "COM o plano ativo, o CLIENTE publica o site gerenciado (era 403 antes)",
      !comPlano.error && comPlano.is_published === true,
      JSON.stringify(comPlano).slice(0, 160)
    );
    check(
      "e o endereço foi cunhado na publicação",
      typeof comPlano.slug === "string" && comPlano.slug.length > 0
    );
    check(
      "o site continua sendo gerenciado (publicar não devolve a edição)",
      (await CommunitySiteStorage.getByProfile(pool, semSite)).managed_by_platform === true
    );

    const editar = await CommunitySiteService.save(
      { id_user: leader },
      { id_profile: semSite },
      { config: { siteName: "invadido", sections: [] } }
    );
    check(
      "mas EDITAR continua recusado — as alterações seguem sendo nossas",
      !!editar.error && editar.statusCode === 403,
      JSON.stringify(editar).slice(0, 140)
    );

    const despub = await CommunitySiteService.setPublished(
      { id_user: leader },
      { id_profile: semSite },
      { published: false }
    );
    check("despublicar funciona", !despub.error && despub.is_published === false);

    // Sem plano, despublicar TEM que continuar valendo — é a porta de saída.
    await client.query(
      `UPDATE public.tb_user_plan_subscription SET status = 'canceled' WHERE id_user = $1`,
      [leader]
    );
    await CommunitySiteStorage.setPublished(pool, semSite, true);
    const saida = await CommunitySiteService.setPublished(
      { id_user: leader },
      { id_profile: semSite },
      { published: false }
    );
    check(
      "e despublicar continua fora do gate mesmo SEM plano (porta de saída)",
      !saida.error && saida.is_published === false,
      JSON.stringify(saida).slice(0, 140)
    );

    // --- 8. Coerência -------------------------------------------------------
    console.log("\n[8] Coerência");
    const jaENosso = await CommunitySiteService.requestSite(
      { id_user: leader },
      { id_profile: semSite },
      {}
    );
    check(
      "quem já tem site nosso não entra na fila de novo",
      !!jaENosso.error && jaENosso.statusCode === 409,
      JSON.stringify(jaENosso).slice(0, 140)
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("ERRO:", e);
  process.exit(1);
});
