/**
 * O ATENDENTE DENTRO DE CASA (mig 253): chaves do admin, base de conhecimento,
 * fila de resposta e medidor de tokens.
 *
 * Exercita contra o Postgres de PRODUÇÃO dentro de UMA transação que termina em
 * ROLLBACK. **Não existe COMMIT neste arquivo** — é isso, e só isso, que torna
 * seguro apontar para produção. No fim, confere que produção ficou intocada.
 *
 * ─── OS DEFEITOS ESCRITOS COMO ASSERÇÃO ─────────────────────────────────────
 *
 * Todos silenciosos — nenhum deles dá erro em lugar nenhum:
 *
 *  1. "a re-entrega não enfileira de novo" — o webhook da Meta é at-least-once.
 *     Sem o índice parcial de dedupe, a MESMA mensagem re-entregue três vezes
 *     manda três respostas ao cliente e paga três chamadas de LLM por ele.
 *  2. "dois workers não pegam o mesmo trabalho" — sem `FOR UPDATE SKIP LOCKED`,
 *     duas instâncias do backend leem a mesma linha `pending` e o cliente
 *     recebe duas respostas. O sintoma só aparece onde há mais de um processo:
 *     em produção.
 *  3. "trabalho preso volta para a fila" — uma queda no meio da chamada de LLM
 *     deixa a linha em `running` para sempre; ela nunca mais é reivindicada e
 *     aquela conversa fica sem resposta, sem nada indicando o porquê.
 *  4. "editar o modelo não apaga a chave" — sem o COALESCE no upsert, salvar o
 *     formulário sem reenviar o segredo zera a credencial e o atendente
 *     emudece na próxima mensagem.
 *  5. "sent_via continua aceitando 'app' e 'api'" — CHECK reescrito com nome
 *     NOVO deixaria o antigo de pé em paralelo recusando 'ai', e a IA falharia
 *     ao GRAVAR a resposta depois de já ter falado com o cliente.
 *  6. "custo não apurado é NULL, nunca zero" — zero faria o painel afirmar
 *     gasto que ninguém mediu.
 *  7. "a chave não sai nas leituras" — um `SELECT *` distraído carregaria o
 *     segredo para dentro de uma resposta HTTP do painel.
 *  8. "a base de conhecimento sobe até o dono" — ela guarda tabela de preço e
 *     endereço; um SELECT por id solto seria o dossiê de um vendedor servido a
 *     quem adivinhasse um número.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const BE = path.join(__dirname, "..");
const MIG = path.join(BE, "src/databases/migrations/253_atendimento_ai.sql");
const AiProviderStorage = require(path.join(BE, "src/storages/AiProviderStorage"));
const AiKnowledgeStorage = require(path.join(BE, "src/storages/AiKnowledgeStorage"));
const AiJobStorage = require(path.join(BE, "src/storages/AiJobStorage"));
const { seal, open } = require(path.join(BE, "src/utils/secretBox"));

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
    // caso de duas conferências mortas dizendo ok (`lista.length === 0 || msg`).
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

(async () => {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete("sslmode");
  const c = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");

  // ⚠️ O ESTADO É MEDIDO ANTES e no fim se exige voltar a ele — nunca "a tabela
  // não existe". A mig 253 vai subir para produção, e uma asserção escrita como
  // "depois do ROLLBACK não há tb_ai_usage" nasceria com prazo de validade.
  // É a lição já paga nas suítes das migs 241/246/247/248.
  let antesTabelas = null;

  try {
    antesTabelas = (
      await c.query(
        `SELECT COUNT(*)::int n FROM information_schema.tables
          WHERE table_schema='public' AND table_name LIKE 'tb_ai_%'`
      )
    ).rows[0].n;
    console.log("\n[producao, antes] tabelas tb_ai_*:", antesTabelas, "\n");

    const sql = fs.readFileSync(MIG, "utf8");

    /* ───────────────────────── 1. a migration ───────────────────────────── */
    await c.query(sql);
    check("a migration aplica", true);
    const segunda = await attempt(c, () => c.query(sql));
    check("a migration e idempotente (2a aplicacao)", segunda.ok, segunda.error?.message);

    const tabs = (
      await c.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND table_name IN
          ('tb_ai_provider_key','tb_ai_knowledge','tb_ai_reply_job','tb_ai_usage')`
      )
    ).rowCount;
    check("as 4 tabelas existem", tabs === 4, "vieram " + tabs);

    const cons = (
      await c.query(
        `SELECT conname FROM pg_constraint WHERE conname IN
         ('tb_ai_provider_key_provider_chk','tb_ai_provider_key_priority_chk',
          'tb_ai_knowledge_source_chk','tb_ai_reply_job_channel_chk',
          'tb_ai_reply_job_status_chk','tb_message_sent_via_chk',
          'tb_service_request_message_sent_via_chk')`
      )
    ).rowCount;
    check("as 7 constraints existem PELO NOME", cons === 7, "vieram " + cons);

    // DEFEITO 5: superset, com o MESMO nome.
    for (const tabela of ["tb_message", "tb_service_request_message"]) {
      const def = (
        await c.query(
          `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname=$1`,
          [tabela + "_sent_via_chk"]
        )
      ).rows[0].d;
      check(
        `${tabela}.sent_via e SUPERSET (app, api, ai)`,
        def.includes("'app'") && def.includes("'api'") && def.includes("'ai'"),
        def
      );
    }
    const dup = (
      await c.query(
        `SELECT COUNT(*)::int n FROM pg_constraint con
           JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relname='tb_message' AND con.contype='c'
            AND pg_get_constraintdef(con.oid) LIKE '%sent_via%'`
      )
    ).rows[0].n;
    check("existe EXATAMENTE UM check de sent_via em tb_message", dup === 1, "vieram " + dup);

    /* ───────────────────── 2. a lista fechada de provedor ────────────────── */
    const gemini = await attempt(c, () =>
      c.query(
        `INSERT INTO public.tb_ai_provider_key (provider,api_key_sealed,key_hint,model)
         VALUES ('gemini','x','abcd','m')`
      )
    );
    check(
      "provedor fora da lista e recusado PELO NOME da constraint",
      !gemini.ok && String(gemini.error?.message).includes("tb_ai_provider_key_provider_chk"),
      gemini.error?.message
    );

    /* ─────────────────────────── 3. as chaves ───────────────────────────── */
    const SEGREDO = "sk-ant-teste-" + Math.random().toString(36).slice(2);
    await AiProviderStorage.upsert(c, {
      provider: "anthropic",
      label: "Principal",
      api_key_sealed: seal(SEGREDO),
      key_hint: SEGREDO.slice(-4),
      model: "claude-sonnet-5",
      priority: 1,
      price_in_mtok: 3,
      price_out_mtok: 15,
    });

    // DEFEITO 7: a chave não pode sair nas leituras públicas.
    const lista = await AiProviderStorage.list(c);
    check("a chave nao aparece em list()", !("api_key_sealed" in lista[0]), Object.keys(lista[0]).join(","));
    const um = await AiProviderStorage.get(c, "anthropic");
    check("a chave nao aparece em get()", !("api_key_sealed" in um));
    check("o hint guarda so os 4 ultimos", um.key_hint === SEGREDO.slice(-4), um.key_hint);

    // Round-trip do selo: o que entrou é o que sai.
    const selada = await AiProviderStorage.getSealedFor(c, "anthropic");
    check("a chave selada abre com o mesmo valor", open(selada.api_key_sealed) === SEGREDO);
    check("a chave NAO esta em claro no banco", selada.api_key_sealed !== SEGREDO);

    // DEFEITO 4: salvar o formulário sem reenviar a chave não pode apagá-la.
    await AiProviderStorage.upsert(c, {
      provider: "anthropic",
      api_key_sealed: null,
      key_hint: null,
      model: "claude-opus-5",
      priority: 1,
      price_in_mtok: 5,
      price_out_mtok: 25,
    });
    const depois = await AiProviderStorage.getSealedFor(c, "anthropic");
    check("editar o modelo NAO apaga a chave", open(depois.api_key_sealed) === SEGREDO);
    check("o modelo novo foi gravado", depois.model === "claude-opus-5", depois.model);

    // A ordem de tentativa é priority e DEPOIS o nome — nunca a de inserção.
    await AiProviderStorage.upsert(c, {
      provider: "openai",
      api_key_sealed: seal("sk-openai-teste"),
      key_hint: "este",
      model: "gpt-4o-mini",
      priority: 2,
    });
    const usaveis = await AiProviderStorage.listUsable(c);
    check(
      "a principal vem antes da reserva",
      usaveis[0].provider === "anthropic" && usaveis[1].provider === "openai",
      usaveis.map((u) => u.provider + ":" + u.priority).join(" ")
    );

    // Desligar tira da fila de tentativa sem apagar a chave.
    await AiProviderStorage.upsert(c, { provider: "openai", is_enabled: false });
    const so1 = await AiProviderStorage.listUsable(c);
    check("provedor desligado sai da fila de tentativa", so1.length === 1, "vieram " + so1.length);
    const aindaLa = await AiProviderStorage.getSealedFor(c, "openai");
    check("desligar NAO apaga a chave", open(aindaLa.api_key_sealed) === "sk-openai-teste");
    await AiProviderStorage.upsert(c, { provider: "openai", is_enabled: true });

    // Criar provedor NOVO sem chave tem que ser recusado — e o e o guard do
    // AiSettingsService transforma isso numa frase em vez de um 500.
    const semChave = await attempt(c, () =>
      AiProviderStorage.upsert(c, { provider: "openai", model: "x" , api_key_sealed: null })
    );
    check("editar provedor existente sem chave e ACEITO", semChave.ok, semChave.error?.message);

    /* ─────────────────── 4. a fila e o webhook at-least-once ─────────────── */
    const users = (await c.query("SELECT id_user FROM public.tb_user LIMIT 2")).rows;
    check("existem 2 usuarios para o cenario", users.length === 2);
    const dono = users[0].id_user;
    const outro = users[1].id_user;

    const j1 = await AiJobStorage.enqueue(c, {
      id_user: dono,
      channel: "whatsapp",
      ref_id: "conv-1",
      trigger_message_id: "wamid.AAA",
      trigger_text: "quanto custa um corte?",
    });
    check("a 1a mensagem enfileira", !!j1);

    // DEFEITO 1: a re-entrega da Meta não pode virar segunda resposta.
    const j2 = await AiJobStorage.enqueue(c, {
      id_user: dono,
      channel: "whatsapp",
      ref_id: "conv-1",
      trigger_message_id: "wamid.AAA",
      trigger_text: "quanto custa um corte?",
    });
    check("a RE-ENTREGA da mesma mensagem NAO enfileira de novo", j2 === null);

    // Mesma mensagem, canal diferente: é outra coisa e passa.
    const j3 = await AiJobStorage.enqueue(c, {
      id_user: dono,
      channel: "dm",
      ref_id: "dm-1",
      trigger_message_id: "wamid.AAA",
    });
    check("o mesmo id em OUTRO canal enfileira", !!j3);

    // Disparo manual nasce sem trigger e pode repetir (é um clique).
    const m1 = await AiJobStorage.enqueue(c, { id_user: dono, channel: "dm", ref_id: "dm-9" });
    const m2 = await AiJobStorage.enqueue(c, { id_user: dono, channel: "dm", ref_id: "dm-9" });
    check("o disparo manual pode repetir", !!m1 && !!m2);

    // DEFEITO 2: dois workers não podem pegar o mesmo trabalho.
    const lote1 = await AiJobStorage.claimDue(c, 10);
    check("o worker reivindica os pendentes", lote1.length === 4, "pegou " + lote1.length);
    check(
      "reivindicar marca running e conta a tentativa",
      lote1.every((j) => j.status === "running" && j.attempts === 1)
    );
    const lote2 = await AiJobStorage.claimDue(c, 10);
    check("um 2o worker NAO pega os mesmos trabalhos", lote2.length === 0, "pegou " + lote2.length);

    // DEFEITO 3: trabalho preso em running volta para a fila.
    const soltos0 = await AiJobStorage.releaseStuck(c, 10);
    check("trabalho recem-reivindicado NAO e solto", soltos0 === 0, "soltou " + soltos0);
    await c.query(
      `UPDATE public.tb_ai_reply_job SET updated_at = NOW() - INTERVAL '30 minutes'
        WHERE status='running'`
    );
    const soltos = await AiJobStorage.releaseStuck(c, 10);
    check("trabalho PRESO em running volta para a fila", soltos === 4, "soltou " + soltos);

    // Falha com espera volta para pending — nunca fica em running.
    const preso = (await AiJobStorage.claimDue(c, 1))[0];
    await AiJobStorage.retryLater(c, preso.id_job, { seconds: 120, last_error: "429" });
    const rel = (
      await c.query("SELECT status, next_attempt_at > NOW() futuro FROM public.tb_ai_reply_job WHERE id_job=$1", [
        preso.id_job,
      ])
    ).rows[0];
    check("retry volta para pending e adia", rel.status === "pending" && rel.futuro === true);

    await AiJobStorage.finish(c, preso.id_job, { status: "done", answer: "Corte sai R$ 40." });
    const fim = (
      await c.query("SELECT status, answer FROM public.tb_ai_reply_job WHERE id_job=$1", [preso.id_job])
    ).rows[0];
    check("concluir grava a resposta", fim.status === "done" && fim.answer === "Corte sai R$ 40.");

    const canal = await attempt(c, () =>
      c.query(`INSERT INTO public.tb_ai_reply_job (id_user,channel,ref_id) VALUES ($1,'telegram','x')`, [dono])
    );
    check(
      "canal fora da lista e recusado PELO NOME da constraint",
      !canal.ok && String(canal.error?.message).includes("tb_ai_reply_job_channel_chk"),
      canal.error?.message
    );

    /* ───────────────────────── 5. o medidor ─────────────────────────────── */
    await AiJobStorage.recordUsage(c, {
      id_user: dono,
      provider: "anthropic",
      model: "claude-sonnet-5",
      channel: "whatsapp",
      input_tokens: 1000,
      output_tokens: 500,
      cost_usd: 0.0105,
    });
    // DEFEITO 6: sem preço informado, o custo é NULL — nunca zero.
    await AiJobStorage.recordUsage(c, {
      id_user: dono,
      provider: "openai",
      model: "gpt-4o-mini",
      channel: "dm",
      input_tokens: 800,
      output_tokens: 200,
      cost_usd: null,
    });
    const resumo = await AiJobStorage.usageSummary(c, { days: 1 });
    const semPreco = resumo.find((r) => r.provider === "openai");
    const comPreco = resumo.find((r) => r.provider === "anthropic");
    check("o medidor conta tokens dos dois provedores", resumo.length === 2, "vieram " + resumo.length);
    check("custo NAO apurado fica NULL, nunca 0", semPreco.cost_usd === null, String(semPreco.cost_usd));
    check("custo apurado soma", Number(comPreco.cost_usd) === 0.0105, String(comPreco.cost_usd));
    check("o painel sabe quantas chamadas sairam sem preco", Number(semPreco.calls_without_price) === 1);

    /* ─────────────────── 6. a base de conhecimento ──────────────────────── */
    const k = await AiKnowledgeStorage.create(c, {
      id_user: dono,
      source: "text",
      title: "Tabela de precos",
      content: "Corte R$ 40. Barba R$ 25. Rua das Flores, 100.",
    });
    check(
      "o documento nasce ativo e conta caracteres",
      k.is_active === true && k.char_count === "Corte R$ 40. Barba R$ 25. Rua das Flores, 100.".length,
      String(k.char_count)
    );

    // DEFEITO 8: a leitura sobe até o dono.
    const doDono = await AiKnowledgeStorage.get(c, dono, k.id_knowledge);
    const doOutro = await AiKnowledgeStorage.get(c, outro, k.id_knowledge);
    check("o dono le o proprio documento", !!doDono);
    check("OUTRO usuario NAO le o documento alheio", doOutro === null);

    const naLista = await AiKnowledgeStorage.listByUser(c, dono);
    check("a lista da tela NAO carrega o texto inteiro", !("content" in naLista[0]), Object.keys(naLista[0]).join(","));

    // Desligar tira do dossiê sem perder o texto.
    await AiKnowledgeStorage.update(c, dono, k.id_knowledge, { is_active: false });
    const ativos = await AiKnowledgeStorage.listActiveContent(c, dono);
    check("documento desligado sai do dossie", ativos.length === 0, "vieram " + ativos.length);
    const guardado = await AiKnowledgeStorage.get(c, dono, k.id_knowledge);
    check("mas o texto continua guardado", guardado.content.includes("Corte R$ 40"));

    // Editar o texto recalcula o contador na MESMA instrução.
    await AiKnowledgeStorage.update(c, dono, k.id_knowledge, { content: "abc", is_active: true });
    const recontado = await AiKnowledgeStorage.get(c, dono, k.id_knowledge);
    check("editar recalcula char_count", recontado.char_count === 3, String(recontado.char_count));

    const fonte = await attempt(c, () =>
      c.query(
        `INSERT INTO public.tb_ai_knowledge (id_user,source,title,content) VALUES ($1,'docx','x','y')`,
        [dono]
      )
    );
    check(
      "fonte fora da lista e recusada PELO NOME da constraint",
      !fonte.ok && String(fonte.error?.message).includes("tb_ai_knowledge_source_chk"),
      fonte.error?.message
    );

    // O CASCADE do dono existe (a base morre com a conta, não fica órfã).
    const fk = (
      await c.query(
        `SELECT confdeltype FROM pg_constraint
          WHERE conrelid='public.tb_ai_knowledge'::regclass AND contype='f'
            AND confrelid='public.tb_user'::regclass`
      )
    ).rows[0];
    check("a base de conhecimento cai com a conta (CASCADE)", fk.confdeltype === "c", fk.confdeltype);

    /* ──────────────────────────── 7. o kill-switch ──────────────────────── */
    const fl = (
      await c.query("SELECT is_enabled FROM public.tb_feature_flag WHERE flag_key='atendimento_ai'")
    ).rows[0];
    check("a flag atendimento_ai nasce LIGADA", !!fl && fl.is_enabled === true);
  } catch (e) {
    fail++;
    console.log("\nERRO NAO ESPERADO:", e.message);
    console.log(e.stack);
  }

  await c.query("ROLLBACK");

  // Produção tem que ter voltado ao estado medido no começo.
  const depoisTabelas = (
    await c.query(
      `SELECT COUNT(*)::int n FROM information_schema.tables
        WHERE table_schema='public' AND table_name LIKE 'tb_ai_%'`
    )
  ).rows[0].n;
  check(
    "producao voltou ao estado de antes do teste",
    depoisTabelas === antesTabelas,
    `antes ${antesTabelas}, depois ${depoisTabelas}`
  );

  await c.end();
  console.log(`\n${pass}/${pass + fail} passaram` + (fail ? ` — ${fail} FALHARAM` : ""));
  process.exit(fail ? 1 : 0);
})();
