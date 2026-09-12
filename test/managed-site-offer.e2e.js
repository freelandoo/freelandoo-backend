/**
 * Suíte da OFERTA DO SITE PRONTO (mig 242).
 *
 * ═══ O QUE ELA PROTEGE ═══
 *
 * 1. A BRECHA, DO LADO NOVO. A mig 241 trancou a escrita do cliente em três
 *    travas, e agora existe uma porta em que o CLIENTE grava `template` +
 *    `template_data` — por tabela interposta. O caso central desta suíte é o
 *    payload hostil: o líder manda `data` e `template` junto do `id_offer`, e o
 *    que tem que ficar gravado é o conteúdo DA OFERTA, não o dele. Se um dia
 *    alguém "completar" o service lendo `body.data`, este teste cai.
 *
 * 2. O PINO DA DECISÃO. O aceite vem preso ao `id_offer` que o cliente estava
 *    vendo. Revisar a oferta cria linha NOVA — se a revisão editasse a linha no
 *    lugar, o id continuaria valendo e a pessoa confirmaria um texto que nunca
 *    leu. O teste exercita a revisão e exige id diferente.
 *
 * 3. UMA OFERTA VIVA. O índice parcial é o que faz "o site reservado para você"
 *    ser uma coisa só. O teste tenta a segunda pendente e exige a recusa PELO
 *    NOME do índice — sem o nome, um NOT NULL qualquer passaria por "protegido".
 *
 * 4. DEVOLVER NÃO QUEIMA O PRODUTO. `setManaged` limpa o `template_data` do
 *    site; sem a reabertura da oferta, um clique em "devolver" apagaria o site
 *    que nós escrevemos e só montar tudo de novo o traria de volta. O teste
 *    devolve e ACEITA OUTRA VEZ, com o conteúdo idêntico.
 *
 * 5. O DOCUMENTO DO CLIENTE. Aceitar não pode encostar em `sections` — é o que
 *    ele reencontra se devolver.
 *
 * Transacional (BEGIN → ROLLBACK) como `managed-site.e2e.js`: pode rodar contra
 * o banco de produção sem deixar linha. NÃO existe COMMIT neste arquivo.
 *
 * Uso: `npm run test:managed-site-offer`
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

    /**
     * Roda algo que DEVE falhar e devolve o erro.
     *
     * ⚠️ O SAVEPOINT não é higiene: um INSERT recusado aborta a transação
     * inteira no Postgres, e sem voltar a um ponto salvo TODO comando seguinte
     * falharia com "current transaction is aborted" — a suíte morreria no
     * primeiro teste de constraint, que é justamente o que ela veio provar.
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
    const OfferStorage = require("../src/storages/ManagedSiteOfferStorage");

    // ─── 1. A migration ───────────────────────────────────────────────────
    console.log("\n[1] Migration 242");
    const migDir = path.join(__dirname, "..", "src", "databases", "migrations");
    // A 241 precisa estar aplicada (as colunas do site). Em banco de produção
    // ela já está; aplicá-la de novo é no-op, e é o que faz esta suíte rodar
    // também num banco que ainda não a viu.
    await client.query(fs.readFileSync(path.join(migDir, "241_managed_site.sql"), "utf8"));
    const sql = fs.readFileSync(path.join(migDir, "242_managed_site_offer.sql"), "utf8");
    await client.query(sql);
    await client.query(sql);
    check("aplicada DUAS vezes sem estourar (idempotente)", true);

    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'tb_managed_site_offer'
        ORDER BY column_name`
    );
    const by = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
    check("template_data é jsonb NOT NULL", by.template_data?.data_type === "jsonb" && by.template_data?.is_nullable === "NO");
    check("status é NOT NULL", by.status?.is_nullable === "NO");
    check("decided_at é nullable — NULL = ainda esperando", by.decided_at?.is_nullable === "YES");

    const idx = await client.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'ux_managed_site_offer_pending'`
    );
    check(
      "o índice da oferta viva existe, é ÚNICO e é PARCIAL",
      idx.rowCount === 1 && /UNIQUE/i.test(idx.rows[0].indexdef) && /WHERE/i.test(idx.rows[0].indexdef)
    );

    const limpo = await client.query(`SELECT COUNT(*)::int AS n FROM public.tb_managed_site_offer`);
    check("a tabela nasce vazia — a migration não inventa oferta para ninguém", limpo.rows[0].n === 0, `n=${limpo.rows[0].n}`);

    // ─── 2. Fixtures ──────────────────────────────────────────────────────
    const stamp = Date.now().toString(36);
    async function mkUser(tag) {
      const r = await client.query(
        `INSERT INTO public.tb_user (nome, email, senha, username, ativo)
              VALUES ($1, $2, 'x', $3, TRUE) RETURNING id_user`,
        [`User ${tag}`, `mso_${tag}_${stamp}@ex.com`, `mso_${tag}_${stamp}`]
      );
      return r.rows[0].id_user;
    }
    const cat = await client.query(`SELECT id_category FROM public.tb_category ORDER BY id_category LIMIT 1`);
    async function mkProfile(id_user, tag) {
      await client.query(
        `INSERT INTO public.tb_profile
              (id_user, id_category, display_name, sub_profile_slug, is_user_account, is_visible)
              VALUES ($1, $2, $3, $4, TRUE, FALSE)`,
        [id_user, cat.rows[0].id_category, `Perfil ${tag}`, `mso-${tag}-${stamp}`]
      );
    }
    const leader = await mkUser("leader");
    await mkProfile(leader, "leader");
    const forasteiro = await mkUser("outro");
    await mkProfile(forasteiro, "outro");
    const adminUser = await mkUser("admin");

    const machine = await client.query(`SELECT id_machine FROM public.tb_machine ORDER BY id_machine LIMIT 1`);
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
    const idc = await mkCommunity(`Oficina ${stamp}`);
    const idc2 = await mkCommunity(`Outra oficina ${stamp}`);

    // O site que o líder já tinha — é ele que não pode se perder.
    await CommunitySiteService.save({ id_user: leader }, { id_profile: idc }, {
      config: {
        siteName: "Meu site antigo",
        tagline: "feito por mim",
        sections: [{ kind: "hero", enabled: true, title: "Bem-vindo", data: {} }],
      },
    });

    /** O documento que NÓS escrevemos. É este texto que tem que chegar no ar. */
    const DOC = {
      business: {
        name: "Ricardo Fogões",
        city: "Aguaí",
        state: "SP",
        phoneDisplay: "(19) 99999-0000",
        whatsappNumber: "5519999990000",
        heroPhoto: "https://cdn.exemplo.com/ricardo.jpg",
      },
      services: [
        { slug: "conserto-residencial", label: "Conserto residencial", cardText: "Fogão que não acende." },
        { slug: "industriais", label: "Fogões industriais", cardText: "Cozinha profissional." },
      ],
      cities: [
        { slug: "aguai", name: "Aguaí", uf: "SP" },
        { slug: "casa-branca", name: "Casa Branca", uf: "SP" },
      ],
      faq: [{ q: "Atende no sábado?", a: "Sim, até as 12h." }],
    };

    // ─── 3. Nós reservamos o site ─────────────────────────────────────────
    console.log("\n[3] A plataforma reserva o site");

    const ruim = await ManagedSiteService.prepareOffer(
      { id_user: adminUser },
      { id_profile: idc },
      { template: "barbearia-inventada", data: {} }
    );
    check("tema desconhecido é recusado ANTES de virar oferta", !!ruim.error, JSON.stringify(ruim).slice(0, 90));
    check(
      "e nada foi gravado",
      (await client.query(`SELECT COUNT(*)::int AS n FROM public.tb_managed_site_offer`)).rows[0].n === 0
    );

    const r1 = await ManagedSiteService.prepareOffer(
      { id_user: adminUser },
      { id_profile: idc },
      { template: "oficina-local", data: DOC, note: "Montamos a partir do que você escreveu." }
    );
    check("a oferta é criada", !!r1.offer?.id_offer, JSON.stringify(r1).slice(0, 120));
    check("nasce esperando o cliente", r1.offer?.status === "pending");
    check("com autoria de quem montou", String(r1.offer?.created_by_user) === String(adminUser));
    check("e o recado que o cliente vai ler", r1.offer?.note === "Montamos a partir do que você escreveu.");

    // ⚠️ O caso do índice: uma segunda pendente na mesma comunidade, por baixo
    // do service, tem que ser recusada PELO NOME.
    const dup = await fails(() =>
      client.query(
        `INSERT INTO public.tb_managed_site_offer (id_profile, template, template_data)
              VALUES ($1, 'oficina-local', '{}'::jsonb)`,
        [idc]
      )
    );
    check(
      "uma SEGUNDA oferta viva é recusada pelo índice ux_managed_site_offer_pending",
      !!dup && String(dup.message).includes("ux_managed_site_offer_pending"),
      dup ? dup.message.slice(0, 90) : "não recusou"
    );

    // ⚠️ Revisar cria linha NOVA e retira a anterior — é o que mantém o pino
    // do aceite válido.
    const r2 = await ManagedSiteService.prepareOffer(
      { id_user: adminUser },
      { id_profile: idc },
      { template: "oficina-local", data: { ...DOC, business: { ...DOC.business, name: "Ricardo Fogões 2" } } }
    );
    check("revisar cria uma oferta NOVA (id diferente)", r2.offer.id_offer !== r1.offer.id_offer);
    const estados = await client.query(
      `SELECT status, COUNT(*)::int AS n FROM public.tb_managed_site_offer
        WHERE id_profile = $1 GROUP BY status ORDER BY status`,
      [idc]
    );
    const mapa = Object.fromEntries(estados.rows.map((r) => [r.status, r.n]));
    check("a anterior foi RETIRADA, não apagada (fica o histórico)", mapa.withdrawn === 1, JSON.stringify(mapa));
    check("e sobra exatamente uma esperando", mapa.pending === 1, JSON.stringify(mapa));

    // ─── 4. O cliente lê ──────────────────────────────────────────────────
    console.log("\n[4] O cliente lê o que está reservado");

    const anon = await CommunitySiteService.getOffer({}, { id_profile: idc });
    check("anônimo não lê a oferta", anon.statusCode === 401, JSON.stringify(anon).slice(0, 80));

    const alheio = await CommunitySiteService.getOffer({ id_user: forasteiro }, { id_profile: idc });
    check("quem não é o líder não lê a oferta", alheio.statusCode === 403, JSON.stringify(alheio).slice(0, 80));

    const vista = await CommunitySiteService.getOffer({ id_user: leader }, { id_profile: idc });
    check("o líder vê a oferta esperando", vista.offer?.id_offer === r2.offer.id_offer);
    check("o site dele ainda NÃO é gerenciado", vista.managed === false);
    check("o resumo diz o negócio", vista.offer?.summary?.business === "Ricardo Fogões 2");
    check("conta as páginas — home + 2 serviços + 2 cidades", vista.offer?.summary?.counts?.pages === 5, JSON.stringify(vista.offer?.summary?.counts));
    check("e lista os endereços que o site vai ter", (vista.offer?.summary?.pages || []).map((p) => p.slug).join(",") === "conserto-residencial,industriais,aguai,casa-branca");

    // ⚠️⚠️ A OFERTA TEM QUE SE ANUNCIAR. `has_offer` vem na leitura do site — a
    // que o construtor faz a cada visita — e é o que acende a bolinha no botão.
    // Sem ele a oferta fica esperando atrás de um botão que não muda de
    // aparência, e o líder só a encontra se resolver abrir o painel por conta
    // própria. Foi exatamente o que aconteceu no primeiro teste desta feature:
    // o site estava reservado e a tela não dizia nada.
    const leituraDoSite = await CommunitySiteService.get(
      { id_user: leader },
      { id_profile: idc }
    );
    check("a leitura do site avisa que há oferta esperando", leituraDoSite.has_offer === true, JSON.stringify(leituraDoSite.has_offer));

    const semNada = await CommunitySiteService.get({ id_user: leader }, { id_profile: idc2 });
    check("e não avisa onde não há", semNada.has_offer === false, JSON.stringify(semNada.has_offer));

    // ⚠️ O documento NÃO sai nesta porta: ela abre a cada clique no botão, e o
    // texto é de um site que talvez nunca seja aceito.
    const serial = JSON.stringify(vista);
    check(
      "o documento inteiro NÃO viaja no resumo",
      !serial.includes("template_data") && !serial.includes("Fogão que não acende"),
      serial.slice(0, 120)
    );
    check(
      "nem a URL da foto — só se existe",
      !serial.includes("cdn.exemplo.com") && vista.offer?.summary?.hasPhoto === true
    );

    // ─── 5. O ACEITE ──────────────────────────────────────────────────────
    console.log("\n[5] O aceite — e a brecha");

    const semId = await CommunitySiteService.acceptOffer({ id_user: leader }, { id_profile: idc }, {});
    check("aceitar sem dizer qual oferta é recusado", semId.statusCode === 400);

    const alheio2 = await CommunitySiteService.acceptOffer(
      { id_user: forasteiro },
      { id_profile: idc },
      { id_offer: r2.offer.id_offer }
    );
    check("quem não é o líder não aceita", alheio2.statusCode === 403);

    // Oferta de OUTRA comunidade: o id é verdadeiro, o alvo é que não é dele.
    const rOutra = await ManagedSiteService.prepareOffer(
      { id_user: adminUser },
      { id_profile: idc2 },
      { template: "oficina-local", data: DOC }
    );
    const cruzado = await CommunitySiteService.acceptOffer(
      { id_user: leader },
      { id_profile: idc },
      { id_offer: rOutra.offer.id_offer }
    );
    check("oferta de OUTRA comunidade não é aplicada aqui", cruzado.statusCode === 409, JSON.stringify(cruzado).slice(0, 90));

    // ⚠️⚠️ O CASO CENTRAL: o payload hostil. O líder manda conteúdo junto.
    const hostil = await CommunitySiteService.acceptOffer(
      { id_user: leader },
      { id_profile: idc },
      {
        id_offer: r2.offer.id_offer,
        template: "oficina-local",
        data: { business: { name: "INVADIDO", phoneDisplay: "(00) 00000-0000" }, services: [], cities: [] },
        managed: false,
      }
    );
    check("o aceite responde sucesso", hostil.managed === true, JSON.stringify(hostil).slice(0, 120));

    const gravado = await CommunitySiteStorage.getByProfile(pool, idc);
    check(
      "⚠️ o que ficou gravado é o NOSSO conteúdo, não o que o cliente mandou",
      gravado.template_data?.business?.name === "Ricardo Fogões 2",
      String(gravado.template_data?.business?.name)
    );
    check(
      "⚠️ e o `managed: false` do corpo foi ignorado — o site fica travado",
      gravado.managed_by_platform === true
    );
    check("o tema gravado é o da oferta", gravado.template === "oficina-local");

    // O documento do construtor tem que estar intacto — é o que ele reencontra.
    check("o site do construtor continua guardado", gravado.site_name === "Meu site antigo");
    check("com a seção dele intacta", Array.isArray(gravado.sections) && gravado.sections.length === 1);

    // Agora o líder não escreve mais.
    const tentaSalvar = await CommunitySiteService.save({ id_user: leader }, { id_profile: idc }, {
      config: { siteName: "sobrescrevi", sections: [] },
    });
    check("depois de aceito, o líder não salva mais (403)", tentaSalvar.statusCode === 403, JSON.stringify(tentaSalvar).slice(0, 90));
    check(
      "e o documento dele continua lá depois da tentativa",
      (await CommunitySiteStorage.getByProfile(pool, idc)).site_name === "Meu site antigo"
    );

    const deNovo = await CommunitySiteService.acceptOffer(
      { id_user: leader },
      { id_profile: idc },
      { id_offer: r2.offer.id_offer }
    );
    check("aceitar a MESMA oferta duas vezes é recusado", deNovo.statusCode === 409);

    const depois = await CommunitySiteService.getOffer({ id_user: leader }, { id_profile: idc });
    check("não há mais oferta esperando", depois.offer === null);
    check("e a tela diz em que tema o site está", depois.current?.business === "Ricardo Fogões 2");

    // ─── 6. A porta de saída ──────────────────────────────────────────────
    console.log("\n[6] Devolver ao construtor");

    const alheio3 = await CommunitySiteService.releaseManaged({ id_user: forasteiro }, { id_profile: idc });
    check("quem não é o líder não devolve", alheio3.statusCode === 403);

    const solto = await CommunitySiteService.releaseManaged({ id_user: leader }, { id_profile: idc2 });
    check("devolver um site que não é gerenciado é recusado", solto.statusCode === 409);

    const devolveu = await CommunitySiteService.releaseManaged({ id_user: leader }, { id_profile: idc });
    check("o líder devolve o site ao construtor", devolveu.released === true, JSON.stringify(devolveu).slice(0, 90));

    const voltou = await CommunitySiteStorage.getByProfile(pool, idc);
    check("o site volta a ser editável por ele", voltou.managed_by_platform === false);
    check("e o tema sai de cena (senão ele editaria seções que ninguém vê)", voltou.template === null);
    check("o documento dele reaparece inteiro", voltou.site_name === "Meu site antigo" && voltou.sections.length === 1);

    const salvouDeNovo = await CommunitySiteService.save({ id_user: leader }, { id_profile: idc }, {
      config: { siteName: "Voltei a editar", sections: [] },
    });
    check("e ele volta a salvar de verdade", !salvouDeNovo.error, JSON.stringify(salvouDeNovo).slice(0, 90));

    // ⚠️ O produto não foi queimado: a oferta voltou para a fila, inteira.
    const reaberta = await CommunitySiteService.getOffer({ id_user: leader }, { id_profile: idc });
    check("⚠️ a oferta volta a ESPERAR depois da devolução", reaberta.offer?.id_offer === r2.offer.id_offer, JSON.stringify(reaberta.offer).slice(0, 90));
    check("com o conteúdo intacto", reaberta.offer?.summary?.business === "Ricardo Fogões 2");

    const aceitaDeNovo = await CommunitySiteService.acceptOffer(
      { id_user: leader },
      { id_profile: idc },
      { id_offer: r2.offer.id_offer }
    );
    check("e ele consegue aceitar outra vez", aceitaDeNovo.managed === true);
    check(
      "com o MESMO texto de antes",
      (await CommunitySiteStorage.getByProfile(pool, idc)).template_data?.business?.name === "Ricardo Fogões 2"
    );

    // ─── 7. Retirar o convite ─────────────────────────────────────────────
    console.log("\n[7] Retirar a oferta");

    await CommunitySiteService.releaseManaged({ id_user: leader }, { id_profile: idc });
    const pend = await OfferStorage.getPending(pool, idc);
    check("a oferta está esperando de novo", !!pend);

    const retirou = await ManagedSiteService.withdrawOffer({ id_profile: idc });
    check("a plataforma retira o convite", retirou.offer?.status === "withdrawn", JSON.stringify(retirou).slice(0, 90));

    const semOferta = await CommunitySiteService.getOffer({ id_user: leader }, { id_profile: idc });
    check("e o cliente não vê mais nada esperando", semOferta.offer === null);

    const tardio = await CommunitySiteService.acceptOffer(
      { id_user: leader },
      { id_profile: idc },
      { id_offer: r2.offer.id_offer }
    );
    check("um clique atrasado numa aba esquecida não aplica nada", tardio.statusCode === 409);
    check(
      "e o site continua sendo dele",
      (await CommunitySiteStorage.getByProfile(pool, idc)).managed_by_platform === false
    );

    const vazio = await ManagedSiteService.withdrawOffer({ id_profile: idc });
    check("retirar quando não há nada esperando é 404, não um silêncio", vazio.statusCode === 404);

    // ─── 8. O CHECK do status ─────────────────────────────────────────────
    console.log("\n[8] A lista fechada de estados");
    const status = await fails(() =>
      client.query(
        `INSERT INTO public.tb_managed_site_offer (id_profile, template, template_data, status)
              VALUES ($1, 'oficina-local', '{}'::jsonb, 'inventado')`,
        [idc2]
      )
    );
    check(
      "estado inventado é recusado pela constraint chk_managed_site_offer_status",
      !!status && String(status.message).includes("chk_managed_site_offer_status"),
      status ? status.message.slice(0, 90) : "não recusou"
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(`\n${pass}/${pass + fail} passaram${fail ? ` — ${fail} FALHARAM` : ""}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
