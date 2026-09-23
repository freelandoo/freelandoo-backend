/**
 * PROSPECÇÃO (mig 254): a base de empresas, a proveniência, a fila, as listas
 * de leads e o opt-out da LGPD.
 *
 * Exercita contra o Postgres de PRODUÇÃO dentro de UMA transação que termina em
 * ROLLBACK. **Não existe COMMIT neste arquivo** — é isso, e só isso, que torna
 * seguro apontar para produção. No fim, confere que produção ficou intocada.
 *
 * ─── OS DEFEITOS ESCRITOS COMO ASSERÇÃO ─────────────────────────────────────
 *
 * Todos silenciosos — nenhum deles dá erro em lugar nenhum:
 *
 *  1. "o mesmo ponto do OSM re-lido não cria segunda empresa" — sem o UNIQUE
 *     parcial `ux_company_osm_ref`, cada varredura semanal da cidade duplicaria
 *     a base inteira, e a tela mostraria a mesma academia cinco vezes.
 *  2. "dez pedidos iguais viram UM trabalho" — sem `ux_company_job_live`, dez
 *     pessoas pedindo "academias em São Bernardo" no mesmo minuto disparariam
 *     dez varreduras contra um serviço público e gratuito, que é exatamente
 *     como se perde acesso a ele.
 *  3. "dois workers não pegam o mesmo trabalho" — sem `FOR UPDATE SKIP LOCKED`,
 *     duas instâncias do backend varrem a mesma cidade e pagam duas vezes.
 *  4. "trabalho preso volta para a fila" — uma queda no meio de um crawl deixa
 *     a linha em `running` para sempre, e aquela busca fica eternamente
 *     "procurando", sem nada indicando o porquê.
 *  5. "fonte fraca não apaga fonte forte NO BANCO" — o teste do caminho
 *     completo, e não só da função pura: o crawler achando um e-mail de
 *     template depois da Receita não pode trocar o campo.
 *  6. "a lista de outro negócio não é legível nem gravável" — um SELECT por
 *     `id_list` solto seria a carteira de prospecção de um concorrente servida
 *     a quem adivinhasse um UUID.
 *  7. "opt-out não apaga, SUPRIME" — apagada, a próxima varredura recriaria a
 *     empresa e ela voltaria à vitrine como se nada tivesse sido pedido.
 *  8. "empresa suprimida some de TODA leitura de lista" — inclusive da lista de
 *     leads onde ela já estava salva.
 *  9. "coordenada fora do planeta é recusada" — `lat` e `lon` trocados (o OSM
 *     devolve um par, o GeoJSON o inverso) entrariam em silêncio e a empresa
 *     apareceria no meio do oceano.
 * 10. "a busca por raio não traz quem está fora dele" — a bounding box sozinha
 *     traz os cantos do quadrado; é o haversine que fecha o círculo.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const BE = path.join(__dirname, "..");
const MIG = path.join(BE, "src/databases/migrations/254_prospeccao.sql");
const CompanyStorage = require(path.join(BE, "src/storages/CompanyStorage"));
const CompanyJobStorage = require(path.join(BE, "src/storages/CompanyJobStorage"));
const LeadListStorage = require(path.join(BE, "src/storages/LeadListStorage"));
const CompanyIngestService = require(path.join(BE, "src/services/CompanyIngestService"));

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond === true) {
    pass++;
    console.log("  ok  " + name);
  } else if (cond === false) {
    fail++;
    console.log("FAIL  " + name + (extra ? " -> " + extra : ""));
  } else {
    // Asserção não-booleana passaria como "ok" numa comparação frouxa. Já houve
    // caso de conferências mortas dizendo ok (`lista.length === 0 || msg`).
    fail++;
    console.log("FAIL  " + name + " -> assercao nao-booleana (" + typeof cond + ")");
  }
}

/** Roda algo que PODE falhar sem derrubar a transação inteira do teste. */
async function attempt(c, fn) {
  const sp = "sp_" + Math.random().toString(36).slice(2, 10);
  await c.query("SAVEPOINT " + sp);
  try {
    const value = await fn();
    await c.query("RELEASE SAVEPOINT " + sp);
    return { ok: true, value };
  } catch (err) {
    await c.query("ROLLBACK TO SAVEPOINT " + sp);
    await c.query("RELEASE SAVEPOINT " + sp);
    return { ok: false, error: err };
  }
}

const draft = (fields, extra = {}) => ({ fields, ...extra });

(async () => {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete("sslmode");
  const c = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");

  // ⚠️ O ESTADO É MEDIDO ANTES e no fim se exige voltar a ele — nunca "a tabela
  // não existe". A mig 254 vai subir para produção, e uma asserção escrita como
  // "depois do ROLLBACK não há tb_company" nasceria com prazo de validade.
  // Lição já paga nas suítes das migs 241/246/247/248.
  let antesTabelas = null;
  let antesEmpresas = null;

  try {
    antesTabelas = (
      await c.query(
        `SELECT COUNT(*)::int n FROM information_schema.tables
          WHERE table_schema='public'
            AND table_name IN ('tb_company','tb_company_source','tb_company_job',
                               'tb_lead_list','tb_lead_list_item',
                               'tb_company_suppression','tb_osm_area_cache',
                               'prospeccao_settings')`
      )
    ).rows[0].n;
    console.log("\n[producao, antes] tabelas do subsistema:", antesTabelas, "\n");

    const sql = fs.readFileSync(MIG, "utf8");

    /* ───────────────────────── 1. a migration ───────────────────────────── */
    await c.query(sql);
    check("a migration aplica", true);
    const segunda = await attempt(c, () => c.query(sql));
    check("a migration e idempotente (2a aplicacao)", segunda.ok, segunda.error?.message);

    const tabs = (
      await c.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public'
            AND table_name IN ('tb_company','tb_company_source','tb_company_job',
                               'tb_lead_list','tb_lead_list_item',
                               'tb_company_suppression','tb_osm_area_cache',
                               'prospeccao_settings')`
      )
    ).rowCount;
    check("as 8 tabelas existem", tabs === 8, "vieram " + tabs);

    // ⚠️ PELO NOME DA CONSTRAINT. Sem isso, um NOT NULL qualquer passaria por
    // "protegido" — armadilha que já mordeu duas vezes neste projeto.
    const cons = (
      await c.query(
        `SELECT conname FROM pg_constraint WHERE conname IN
         ('chk_company_cnpj_digits','chk_company_enrichment_status',
          'chk_company_confidence','chk_company_latlon',
          'chk_company_source_kind','chk_company_source_conf',
          'chk_company_job_kind','chk_company_job_status',
          'chk_lead_item_stage','chk_company_suppression_kind',
          'chk_prospeccao_settings_singleton')`
      )
    ).rowCount;
    check("as 11 constraints existem PELO NOME", cons === 11, "vieram " + cons);

    const idx = (
      await c.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN
         ('ux_company_cnpj','ux_company_osm_ref','ix_company_place','ix_company_geo',
          'ux_company_job_live','ux_lead_list_name','ux_company_suppression')`
      )
    ).rowCount;
    check("os 7 indices-chave existem", idx === 7, "vieram " + idx);

    const flag = (
      await c.query(`SELECT is_enabled FROM public.tb_feature_flag WHERE flag_key='prospeccao'`)
    ).rows[0];
    check("a flag prospeccao nasce LIGADA", flag?.is_enabled === true);

    const st = await CompanyStorage.getSettings(c);
    check("os settings nascem com UMA linha", !!st && Number(st.id) === 1);
    check(
      "custo em Polen nasce ZERO (a cobranca e um UPDATE, nao uma migration)",
      Number(st.enrich_cost_polens) === 0 && Number(st.export_cost_polens) === 0
    );
    check(
      "o freio de uso nasce VALENDO (ele nao e preco)",
      Number(st.daily_discover_per_user) > 0 && Number(st.daily_enrich_per_user) > 0
    );

    /* ───────────────── 2. ingestao, matching e dedupe ───────────────────── */
    const osmDraft = draft(
      {
        display_name: "Academia Corpo & Ação",
        category_key: "academia",
        phone: "1143301234",
        city: "São Bernardo do Campo",
        uf: "SP",
        latitude: -23.7,
        longitude: -46.55,
      },
      { osm_ref: "node/999000111", source_url: "https://www.openstreetmap.org/node/999000111" }
    );

    const r1 = await CompanyIngestService.ingest(c, osmDraft, "osm");
    check("a empresa nasce da descoberta", r1.created === true && !!r1.company?.id_company);
    const idA = r1.company.id_company;
    check("name_norm e derivado na escrita", r1.company.name_norm === "academia corpo e acao");

    const r2 = await CompanyIngestService.ingest(c, osmDraft, "osm");
    check(
      "o mesmo ponto do OSM re-lido NAO cria segunda empresa (defeito 1)",
      r2.created === false && r2.company.id_company === idA
    );

    // O crawler chega depois, com o nome em outra grafia e SEM osm_ref: quem
    // tem que reconhecê-lo é o matching por domínio/telefone/nome.
    const siteDraft = draft(
      {
        display_name: "Corpo e Ação",
        phone: "1143301234",
        city: "São Bernardo do Campo",
        uf: "SP",
        email: "contato@corpoeacao.com.br",
        website: "https://www.corpoeacao.com.br",
        instagram: "corpoeacao",
      },
      { source_url: "https://www.corpoeacao.com.br" }
    );
    const r3 = await CompanyIngestService.ingest(c, siteDraft, "website");
    check(
      "o crawler casa com a empresa do OSM em vez de criar outra",
      r3.created === false && r3.company.id_company === idA
    );
    check("o e-mail do site entra num campo que estava vazio", r3.company.email === "contato@corpoeacao.com.br");

    // ⚠️ AQUI EU TINHA ESCRITO O CENÁRIO ERRADO NA PRIMEIRA PASSADA, e vale
    // registrar: montei um "concorrente" com o MESMO nome, o MESMO telefone e a
    // 14 metros, e exigi que ele NÃO fundisse. A suíte reprovou — e ela estava
    // certa. Aquilo não é um concorrente: é a MESMA academia, agora identificada
    // por CNPJ, e fundir é exatamente o caminho pelo qual um ponto do OSM ganha
    // razão social. A regra que existe é outra: CNPJ diferente **dos dois
    // lados** derruba o match para zero.

    // (a) o MESMO negócio chegando pela Receita: TEM que fundir e trazer o CNPJ.
    const mesmoNegocio = draft({
      display_name: "Academia Corpo e Acao",
      cnpj: "11222333000181",
      phone: "1143301234",
      city: "São Bernardo do Campo",
      uf: "SP",
      latitude: -23.7001,
      longitude: -46.5501,
    });
    const rMesmo = await CompanyIngestService.ingest(c, mesmoNegocio, "cnpj");
    check(
      "o ponto do OSM ganha CNPJ em vez de virar uma segunda empresa",
      rMesmo.created === false && rMesmo.company.id_company === idA,
      JSON.stringify({ created: rMesmo.created }).slice(0, 80)
    );
    check("e o CNPJ fica gravado nele", rMesmo.company.cnpj === "11222333000181");

    // (b) o CONCORRENTE de verdade: outro nome, outro telefone, outro CNPJ.
    const rival = draft({
      display_name: "Smart Fit Centro",
      cnpj: "11444777000161",
      phone: "1143309999",
      city: "São Bernardo do Campo",
      uf: "SP",
      latitude: -23.7002,
      longitude: -46.5502,
    });
    const r4 = await CompanyIngestService.ingest(c, rival, "cnpj");
    check(
      "concorrente na mesma rua NAO e fundido",
      r4.created === true && r4.company.id_company !== idA
    );
    const idB = r4.company.id_company;

    // (c) e a regra explícita: CNPJ diferente dos DOIS lados nunca funde, por
    //     mais que tudo o resto bata.
    const clone = draft({
      display_name: "Smart Fit Centro",
      cnpj: "11444777000242",
      phone: "1143309999",
      city: "São Bernardo do Campo",
      uf: "SP",
      latitude: -23.7002,
      longitude: -46.5502,
    });
    const rClone = await CompanyIngestService.ingest(c, clone, "cnpj");
    check(
      "duas lojas da MESMA rede na mesma rua continuam duas empresas (defeito 3)",
      rClone.created === true && rClone.company.id_company !== idB
    );

    /* ───────────── 3. resolucao de conflito NO BANCO (defeito 5) ─────────── */
    await CompanyIngestService.ingest(
      c,
      draft({ cnpj: "11444777000161", email: "financeiro@rival.com.br" }),
      "cnpj"
    );
    const depoisCnpj = await CompanyStorage.getById(c, idB);
    // ⚠️ ESTE RASCUNHO NÃO TEM NOME, e é de propósito: é a forma de um
    // enriquecimento (o crawler devolve contato, não nome). O guard "sem nome"
    // vivia no topo do `ingest` e barrava isto — um no-op silencioso que só não
    // mordeu em produção porque o worker chama `applyFields` direto.
    check("rascunho de ENRIQUECIMENTO (sem nome) atualiza a empresa existente",
      depoisCnpj.email === "financeiro@rival.com.br", "ficou " + depoisCnpj.email);

    await CompanyIngestService.ingest(
      c,
      draft({ cnpj: "11444777000161", email: "suporte@agenciadosite.com.br" }),
      "website"
    );
    const depoisSite = await CompanyStorage.getById(c, idB);
    check(
      "fonte fraca NAO apaga fonte forte no banco (defeito 5)",
      depoisSite.email === "financeiro@rival.com.br",
      "ficou " + depoisSite.email
    );

    const provs = await CompanyStorage.listSources(c, idB);
    const emailSources = provs.filter((p) => p.field === "email").map((p) => p.source).sort();
    check(
      "a proveniencia guarda AS DUAS opinioes, inclusive a que perdeu",
      emailSources.join(",") === "cnpj,website",
      emailSources.join(",")
    );

    const rescored = await CompanyIngestService.rescore(c, idB, { status: "done" });
    check("a nota da linha e calculada e cabe em 0..100",
      Number.isInteger(rescored.confidence) && rescored.confidence >= 0 && rescored.confidence <= 100);

    /* ───────────────── 4. coordenada impossivel (defeito 9) ─────────────── */
    const oceano = await attempt(c, () =>
      c.query(
        `INSERT INTO public.tb_company (display_name, name_norm, latitude, longitude)
         VALUES ('Trocada','trocada', -46.55, -23.7)`
      )
    );
    // -46.55 é latitude válida; o par trocado que importa é longitude > 180.
    const foraDoPlaneta = await attempt(c, () =>
      c.query(
        `INSERT INTO public.tb_company (display_name, name_norm, latitude, longitude)
         VALUES ('Fora','fora', 120, 500)`
      )
    );
    check(
      "coordenada fora do planeta e recusada PELO NOME da constraint (defeito 9)",
      !foraDoPlaneta.ok && /chk_company_latlon/.test(foraDoPlaneta.error?.message || ""),
      foraDoPlaneta.error?.message
    );
    check("coordenada valida passa", oceano.ok);

    // ⚠️ DUAS TRAVAS DIFERENTES, e confundi-las foi o meu segundo erro de
    // asserção: a MÁSCARA (18 caracteres) é barrada pela LARGURA da coluna
    // (CHAR(14)), não pelo CHECK. O CHECK guarda o outro caso — 14 caracteres
    // que não são dígitos —, e é esse que precisa ser conferido pelo nome.
    const cnpjMascarado = await attempt(c, () =>
      c.query(
        `INSERT INTO public.tb_company (display_name, name_norm, cnpj)
         VALUES ('Mascarado','mascarado','12.345.678/0001-90')`
      )
    );
    check("CNPJ com mascara nao entra (largura da coluna)", !cnpjMascarado.ok);

    const cnpjTorto = await attempt(c, () =>
      c.query(
        `INSERT INTO public.tb_company (display_name, name_norm, cnpj)
         VALUES ('Torto','torto','ABCDEFGHIJKLMN')`
      )
    );
    check(
      "CNPJ de 14 caracteres nao-digitos e recusado PELO NOME da constraint",
      !cnpjTorto.ok && /chk_company_cnpj_digits/.test(cnpjTorto.error?.message || ""),
      cnpjTorto.error?.message
    );

    /* ───────────────────────── 5. a fila ─────────────────────────────────── */
    const KEY = "discover:academia:SP:sao bernardo do campo";
    const j1 = await CompanyJobStorage.enqueue(c, {
      kind: "discover",
      dedupe_key: KEY,
      payload: { category: "academia", uf: "SP", city: "São Bernardo do Campo" },
    });
    check("o trabalho entra na fila", !!j1?.id_job);

    const j2 = await CompanyJobStorage.enqueue(c, { kind: "discover", dedupe_key: KEY, payload: {} });
    check("dez pedidos iguais viram UM trabalho (defeito 2)", j2 === null);
    const live = await CompanyJobStorage.findLive(c, KEY);
    check("o pedido repetido acha o trabalho que ja esta vivo", live?.id_job === j1.id_job);

    const claimed = await CompanyJobStorage.claimDue(c, 5);
    check(
      "o claim marca running e devolve o trabalho",
      claimed.some((j) => j.id_job === j1.id_job && j.status === "running")
    );
    const claimedDeNovo = await CompanyJobStorage.claimDue(c, 5);
    check(
      "o 2o worker NAO pega o mesmo trabalho (defeito 3)",
      !claimedDeNovo.some((j) => j.id_job === j1.id_job)
    );

    // Trabalho preso: envelhece o `updated_at` à mão e exige que ele volte.
    await c.query(
      `UPDATE public.tb_company_job SET updated_at = NOW() - INTERVAL '60 minutes' WHERE id_job = $1`,
      [j1.id_job]
    );
    const requeued = await CompanyJobStorage.requeueStuck(c, 20);
    const voltou = await CompanyJobStorage.get(c, j1.id_job);
    check(
      "trabalho preso em running volta para a fila (defeito 4)",
      requeued >= 1 && voltou.status === "pending"
    );

    // Depois de terminado, a MESMA chave pode ser enfileirada de novo — é o
    // que permite revarrer a cidade quando o TTL vencer. O índice é parcial
    // justamente por isso.
    await CompanyJobStorage.finish(c, j1.id_job, { status: "done", result: { found: 3 } });
    const j3 = await CompanyJobStorage.enqueue(c, { kind: "discover", dedupe_key: KEY, payload: {} });
    check("terminado, a mesma chave pode ser enfileirada de novo", !!j3?.id_job);

    const kindTorto = await attempt(c, () =>
      c.query(
        `INSERT INTO public.tb_company_job (kind, dedupe_key) VALUES ('scrape_google','x')`
      )
    );
    check(
      "kind inventado e recusado PELO NOME da constraint",
      !kindTorto.ok && /chk_company_job_kind/.test(kindTorto.error?.message || "")
    );

    /* ───────────────────── 6. listas de lead ─────────────────────────────── */
    const { rows: profs } = await c.query(
      `SELECT id_profile FROM public.tb_profile WHERE deleted_at IS NULL LIMIT 2`
    );
    if (profs.length < 2) {
      check("ha ao menos 2 perfis em producao para o teste de posse", false, "faltam perfis");
    } else {
      const meu = profs[0].id_profile;
      const alheio = profs[1].id_profile;

      const lista = await LeadListStorage.create(c, { id_profile: meu, id_user: null, name: "Academias ABC" });
      check("a lista nasce", !!lista?.id_list);

      const repetida = await LeadListStorage.create(c, {
        id_profile: meu, id_user: null, name: "academias abc",
      });
      check("nome repetido (ignorando caixa) nao cria segunda lista", repetida === null);

      const add = await LeadListStorage.addCompany(c, {
        id_list: lista.id_list, id_profile: meu, id_company: idA,
      });
      check("a empresa entra na lista", !!add);
      const addDeNovo = await LeadListStorage.addCompany(c, {
        id_list: lista.id_list, id_profile: meu, id_company: idA,
      });
      check("clique duplo nao duplica o lead", addDeNovo === null);

      // ⚠️ DEFEITO 6: a mesma chamada, com o id_profile de OUTRO negócio.
      const invasao = await LeadListStorage.addCompany(c, {
        id_list: lista.id_list, id_profile: alheio, id_company: idB,
      });
      check("negocio alheio NAO grava na minha lista (defeito 6)", invasao === null);

      const leituraAlheia = await LeadListStorage.listCompanies(c, {
        id_list: lista.id_list, id_profile: alheio,
      });
      check("negocio alheio NAO le a minha lista (defeito 6)", leituraAlheia.length === 0);

      const minhas = await LeadListStorage.listCompanies(c, { id_list: lista.id_list, id_profile: meu });
      check("o dono le a propria lista", minhas.length === 1 && minhas[0].id_company === idA);
        // ⚠️ O NOME AQUI É O DA RECEITA, NÃO O DO OSM — e isso é o certo: depois
      // da fusão, `display_name` passou a vir da fonte de maior confiança (o
      // nome fantasia do cadastro). Asserção presa ao texto do OSM seria uma
      // asserção contra a própria regra de precedência.
      check(
        "a leitura da lista traz os DADOS da empresa, nao so o id",
        !!minhas[0].display_name && minhas[0].phone === "1143301234",
        JSON.stringify({ nome: minhas[0].display_name, tel: minhas[0].phone })
      );

      const stage = await LeadListStorage.setStage(c, {
        id_list: lista.id_list, id_profile: meu, id_company: idA, stage: "contacted",
      });
      check("o estagio do CRM ja funciona", stage?.stage === "contacted");

      const stageTorto = await attempt(c, () =>
        c.query(
          `UPDATE public.tb_lead_list_item SET stage = 'inventado' WHERE id_list = $1`,
          [lista.id_list]
        )
      );
      check(
        "estagio inventado e recusado PELO NOME da constraint",
        !stageTorto.ok && /chk_lead_item_stage/.test(stageTorto.error?.message || "")
      );

      const funil = await LeadListStorage.stageSummary(c, meu);
      check("o funil conta por estagio", funil.contacted === 1);

      /* ─────────────── 7. opt-out (LGPD) ───────────────────────────────── */
      await c.query(`UPDATE public.tb_company SET domain = 'corpoeacao.com.br' WHERE id_company = $1`, [idA]);
      const sup = await CompanyStorage.suppress(c, {
        kind: "domain", value: "corpoeacao.com.br", reason: "pedido do titular",
      });
      check("o opt-out marca a empresa que ja existe", sup.suppressed === 1);

      const aindaLa = await CompanyStorage.getById(c, idA);
      check("opt-out NAO apaga, SUPRIME (defeito 7)", !!aindaLa && !!aindaLa.suppressed_at);

      const depoisDaSupressao = await LeadListStorage.listCompanies(c, {
        id_list: lista.id_list, id_profile: meu,
      });
      check(
        "empresa suprimida some ate da lista onde ja estava salva (defeito 8)",
        depoisDaSupressao.length === 0
      );

      const reDescoberta = await CompanyIngestService.ingest(c, osmDraft, "osm");
      check(
        "a varredura seguinte NAO recria a empresa suprimida (defeito 7)",
        reDescoberta.skipped === "suprimida",
        JSON.stringify(reDescoberta).slice(0, 120)
      );
    }

    /* ───────────────────── 8. a busca ────────────────────────────────────── */
    // Duas empresas na mesma cidade, uma perto e outra a ~11 km.
    await c.query(
      `INSERT INTO public.tb_company
         (display_name, name_norm, category_key, city, city_norm, uf, latitude, longitude, phone, whatsapp)
       VALUES
         ('Academia Perto','academia perto','academia','São Bernardo do Campo','sao bernardo do campo','SP',-23.70,-46.55,'1143300001','11943300001'),
         ('Academia Longe','academia longe','academia','São Bernardo do Campo','sao bernardo do campo','SP',-23.80,-46.55,'1143300002',NULL)`
    );

    const porCidade = await CompanyStorage.search(c, {
      category_key: "academia", uf: "SP", city: "São Bernardo do Campo",
    });
    check("a busca por categoria + cidade acha as duas", porCidade.total >= 2, "total " + porCidade.total);
    check("a contagem e a pagina batem", porCidade.rows.length <= porCidade.per_page);

    const comWhats = await CompanyStorage.search(c, {
      category_key: "academia", uf: "SP", city: "São Bernardo do Campo", has_whatsapp: true,
    });
    check(
      "o filtro 'com WhatsApp' tira quem nao tem",
      comWhats.rows.every((r) => !!r.whatsapp) && comWhats.total < porCidade.total
    );

    const raio = await CompanyStorage.search(c, {
      category_key: "academia", lat: -23.70, lon: -46.55, radius_m: 3000,
    });
    const nomesNoRaio = raio.rows.map((r) => r.display_name);
    check(
      "a busca por raio NAO traz quem esta fora dele (defeito 10)",
      nomesNoRaio.includes("Academia Perto") && !nomesNoRaio.includes("Academia Longe"),
      nomesNoRaio.join(",")
    );
    check(
      "a busca por raio devolve a distancia calculada",
      raio.rows.length > 0 && Number(raio.rows[0].distance_m) >= 0
    );

    const facets = await CompanyStorage.facetCities(c, { category_key: "academia", uf: "SP" });
    check("as cidades conhecidas alimentam o seletor", facets.some((f) => f.uf === "SP"));

    /* ───────────────────── 9. cache de area do OSM ───────────────────────── */
    await CompanyStorage.setAreaCache(c, {
      uf: "SP", city: "São Bernardo do Campo", osm_area_id: 3600298285, display_name: "SBC",
    });
    const area = await CompanyStorage.getAreaCache(c, "SP", "sao bernardo do campo");
    check("o cache de area guarda e devolve pela cidade normalizada", Number(area?.osm_area_id) === 3600298285);

    await CompanyStorage.setAreaCache(c, { uf: "SP", city: "Cidade Que Nao Existe", osm_area_id: null });
    const semArea = await CompanyStorage.getAreaCache(c, "SP", "cidade que nao existe");
    check(
      "'procurei e nao achei' e guardado (nao re-consulta o geocoder toda vez)",
      !!semArea && semArea.osm_area_id === null
    );
  } catch (err) {
    fail++;
    console.log("FAIL  erro inesperado -> " + err.message);
    console.log(err.stack);
  } finally {
    await c.query("ROLLBACK");

    // ⚠️ A PROVA DE QUE PRODUCAO FICOU INTOCADA — medida DEPOIS do rollback,
    // contra o estado medido ANTES.
    const depoisTabelas = (
      await c.query(
        `SELECT COUNT(*)::int n FROM information_schema.tables
          WHERE table_schema='public'
            AND table_name IN ('tb_company','tb_company_source','tb_company_job',
                               'tb_lead_list','tb_lead_list_item',
                               'tb_company_suppression','tb_osm_area_cache',
                               'prospeccao_settings')`
      )
    ).rows[0].n;
    check(
      "producao voltou EXATAMENTE ao estado de antes",
      depoisTabelas === antesTabelas,
      `antes ${antesTabelas}, depois ${depoisTabelas}`
    );
    antesEmpresas = depoisTabelas;
    await c.end();
  }

  console.log(`\nPASS=${pass} FAIL=${fail}  (tabelas em producao: ${antesEmpresas})\n`);
  process.exit(fail ? 1 : 0);
})();
