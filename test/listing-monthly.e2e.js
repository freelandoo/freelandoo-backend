/**
 * A VITRINE MENSAL (mig 252): R$ 3,50 por anúncio, no condomínio e na rua.
 *
 * Exercita contra o Postgres de PRODUÇÃO dentro de UMA transação que termina em
 * ROLLBACK. **Não existe COMMIT neste arquivo** — é isso, e só isso, que torna
 * seguro apontar para produção. No fim, confere que produção ficou intocada.
 *
 * ─── OS DEFEITOS ESCRITOS COMO ASSERÇÃO ─────────────────────────────────────
 *
 * O padrão da casa é conferir a suíte FALHANDO com o defeito de volta. Os que
 * este arquivo trava, todos silenciosos (nenhum deles dá erro em lugar nenhum):
 *
 *  1. "a vitrine não mostra anúncio não pago" — com o default de `paid` errado
 *     no storage, o rascunho aparece para os vizinhos e a vitrine simplesmente
 *     PARA DE COBRAR, sem ninguém notar.
 *  2. "o estorno RECUA a vigência" — `extendPaidUntil` fixa o mínimo em 1 mês
 *     (`Math.max(1, …)`), então um mês negativo vira positivo e o estorno
 *     daria mais trinta dias de graça a quem recebeu o dinheiro de volta.
 *  3. "a re-entrega da fatura não dá mês de graça" — o webhook é at-least-once;
 *     sem o dedupe por `invoice_ref`, cada re-entrega empurra o `paid_until`.
 *  4. "renovar cedo não perde dias, voltar tarde não ganha tempo parado" — é o
 *     GREATEST, e errá-lo custa dinheiro nos dois sentidos.
 *  5. "cancelar não tira o anúncio do ar" — o mês já pago é de quem pagou.
 *  6. "a cortesia do backfill não se repete" — sem a data fixa, uma segunda
 *     execução daria 30 dias de graça a todo rascunho criado depois.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const BE = path.join(__dirname, "..");
const MIG = path.join(BE, "src/databases/migrations/252_listing_monthly.sql");
const Storage = require(path.join(BE, "src/storages/CommunityListingStorage"));

let pass = 0,
  fail = 0;
function check(name, cond, extra) {
  if (cond === true) {
    pass++;
    console.log("  ok  " + name);
  } else if (cond === false) {
    fail++;
    console.log("FAIL  " + name + (extra ? " -> " + extra : ""));
  } else {
    fail++;
    console.log("FAIL  " + name + " -> assercao nao-booleana (" + typeof cond + ")");
  }
}

/**
 * Roda algo que PODE falhar sem derrubar a transação do teste.
 *
 * ⚠️ NO POSTGRES, UM ERRO ABORTA A TRANSAÇÃO INTEIRA. Como parte das asserções
 * aqui é "isto TEM que ser recusado", sem SAVEPOINT a primeira recusa esperada
 * mataria o resto da suíte — e o ROLLBACK final ainda passaria, dando a
 * impressão de que estava tudo bem.
 */
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

const dias = (a, b) => (new Date(a) - new Date(b)) / 86400000;

(async () => {
  // Mesma normalização do app: o `sslmode=require` da URL sobrepõe o objeto
  // `ssl` do pg e derruba a conexão com o certificado self-signed do proxy.
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete("sslmode");
  const c = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");

  // ⚠️ O ESTADO É MEDIDO ANTES e no fim se exige voltar a ele — nunca "a coluna
  // não existe". A mig 252 vai subir para produção, e uma asserção escrita como
  // "depois do ROLLBACK não há paid_until" nasceria com prazo de validade. É a
  // lição já paga nas suítes das migs 241/246/248.
  let antesColunas = null;
  let antesAnuncios = null;

  try {
    antesColunas = (
      await c.query(
        `SELECT COUNT(*)::int n FROM information_schema.columns
          WHERE table_name='tb_condo_listing' AND column_name='paid_until'`
      )
    ).rows[0].n;
    antesAnuncios = (await c.query("SELECT COUNT(*)::int n FROM public.tb_condo_listing")).rows[0].n;
    console.log("\n[producao, antes] coluna paid_until existe:", antesColunas);
    console.log("[producao, antes] anuncios:", antesAnuncios, "\n");

    /* ─────────────────── 1. um anuncio LEGADO, antes da mig ─────────────── */
    // Criado ANTES da migration e com data antiga, para cair na cortesia do
    // backfill — é o vizinho que já estava anunciando quando a regra mudou.
    const users = (await c.query("SELECT id_user FROM public.tb_user LIMIT 2")).rows;
    check("existem 2 usuarios para o cenario", users.length === 2);
    const [dono, vizinho] = users;

    const comunidade = (
      await c.query(
        `INSERT INTO public.tb_profile
           (id_user, id_category, id_machine, is_community, id_leader_user,
            display_name, sub_profile_slug, community_kind)
         VALUES ($1, NULL, NULL, TRUE, $1, 'Condominio Mensalidade', $2, 'condo')
         RETURNING id_profile`,
        [dono.id_user, "condo-mensal-" + Date.now()]
      )
    ).rows[0];

    const legado = (
      await c.query(
        `INSERT INTO public.tb_condo_listing
           (id_condo, id_user, kind, title, status, created_at)
         VALUES ($1, $2, 'service', 'Anuncio legado', 'active', NOW() - INTERVAL '30 days')
         RETURNING id_listing`,
        [comunidade.id_profile, dono.id_user]
      )
    ).rows[0];

    /* ───────────────────────── 2. a migration ───────────────────────────── */
    const sql = fs.readFileSync(MIG, "utf8");
    await c.query(sql);
    check("a migration 252 aplica", true);

    const cols = (
      await c.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name='tb_condo_listing'
            AND column_name IN ('paid_until','subscription_ref','subscription_status',
                                'subscription_provider')`
      )
    ).rows.map((r) => r.column_name);
    check("o anuncio ganhou as 4 colunas de cobranca", cols.length === 4, cols.join(","));

    const settings = (await c.query("SELECT * FROM public.condo_settings WHERE id = 1")).rows[0];
    check(
      "a mensalidade nasce em R$ 3,50",
      Number(settings.listing_monthly_cents) === 350,
      String(settings.listing_monthly_cents)
    );
    check(
      "a mensalidade em Polens nasce em 350 (1 Polen = R$ 0,01)",
      Number(settings.listing_monthly_polens) === 350,
      String(settings.listing_monthly_polens)
    );
    check(
      "a cota gratis ACABOU (os dois tipos em zero)",
      Number(settings.free_service_listings) === 0 && Number(settings.free_product_listings) === 0,
      `${settings.free_service_listings}/${settings.free_product_listings}`
    );

    // ⚠️ A CORTESIA: quem já estava no ar ganha 30 dias, e não some porque a
    // regra mudou hoje.
    const legadoDepois = (
      await c.query("SELECT paid_until FROM public.tb_condo_listing WHERE id_listing = $1", [
        legado.id_listing,
      ])
    ).rows[0];
    check(
      "o anuncio que ja estava no ar ganhou 30 dias de cortesia",
      legadoDepois.paid_until !== null && Math.round(dias(legadoDepois.paid_until, new Date())) === 30,
      String(legadoDepois.paid_until)
    );

    /* ──────────── 3. idempotencia: a 2a passada nao dá mes de graça ─────── */
    // O caso que a data fixa protege: um RASCUNHO criado DEPOIS da migration
    // não pode ganhar cortesia quando ela rodar de novo.
    const rascunho = (
      await c.query(
        `INSERT INTO public.tb_condo_listing (id_condo, id_user, kind, title, status)
         VALUES ($1, $2, 'product', 'Bolo de cenoura', 'active')
         RETURNING id_listing`,
        [comunidade.id_profile, dono.id_user]
      )
    ).rows[0];

    await c.query(sql);
    check("a migration 252 e idempotente (2a aplicacao)", true);

    const rascunhoDepois = (
      await c.query("SELECT paid_until FROM public.tb_condo_listing WHERE id_listing = $1", [
        rascunho.id_listing,
      ])
    ).rows[0];
    check(
      "⚠️ a 2a passada NAO da cortesia ao rascunho criado depois",
      rascunhoDepois.paid_until === null,
      String(rascunhoDepois.paid_until)
    );

    const legadoOutraVez = (
      await c.query("SELECT paid_until FROM public.tb_condo_listing WHERE id_listing = $1", [
        legado.id_listing,
      ])
    ).rows[0];
    check(
      "a 2a passada tambem nao estica a cortesia de quem ja tinha",
      String(legadoOutraVez.paid_until) === String(legadoDepois.paid_until)
    );

    /* ───────────── 4. a vitrine so mostra o que esta PAGO ───────────────── */
    const paraOsVizinhos = await Storage.list(c, comunidade.id_profile, { kind: "product" });
    check(
      "⚠️ o rascunho NAO aparece na vitrine (a vitrine cobra)",
      paraOsVizinhos.every((l) => String(l.id_listing) !== String(rascunho.id_listing)),
      "ids: " + paraOsVizinhos.map((l) => l.id_listing).join(",")
    );

    const paraODono = await Storage.list(c, comunidade.id_profile, {
      kind: "product",
      id_user: dono.id_user,
      status: "all",
      paid: "all",
    });
    check(
      "o DONO ve o proprio rascunho (e por ele que ele paga)",
      paraODono.some((l) => String(l.id_listing) === String(rascunho.id_listing))
    );
    check(
      "e o rascunho vem marcado como fora do ar",
      paraODono.find((l) => String(l.id_listing) === String(rascunho.id_listing))?.is_live === false
    );

    // O anúncio do legado, esse sim, aparece para os vizinhos.
    const servicos = await Storage.list(c, comunidade.id_profile, { kind: "service" });
    check(
      "o anuncio pago aparece para os vizinhos",
      servicos.some((l) => String(l.id_listing) === String(legado.id_listing))
    );

    /* ──────────────── 5. pagar poe no ar; a conta do GREATEST ───────────── */
    const pago = await Storage.extendPaidUntil(c, rascunho.id_listing, 1);
    check(
      "pagar um mes poe o anuncio no ar",
      pago.paid_until !== null && dias(pago.paid_until, new Date()) > 27
    );

    const agoraNaVitrine = await Storage.list(c, comunidade.id_profile, { kind: "product" });
    check(
      "e agora ele aparece para os vizinhos",
      agoraNaVitrine.some((l) => String(l.id_listing) === String(rascunho.id_listing))
    );

    // ⚠️ RENOVAR ANTES DE VENCER NÃO PERDE OS DIAS QUE FALTAVAM.
    const antesDeRenovar = pago.paid_until;
    const renovado = await Storage.extendPaidUntil(c, rascunho.id_listing, 1);
    check(
      "⚠️ renovar cedo SOMA ao que faltava (nao recomeca do zero)",
      dias(renovado.paid_until, antesDeRenovar) > 27,
      `${antesDeRenovar} -> ${renovado.paid_until}`
    );

    // ⚠️ VOLTAR DEPOIS DE VENCIDO NÃO GANHA O TEMPO EM QUE ESTEVE FORA.
    await c.query(
      "UPDATE public.tb_condo_listing SET paid_until = NOW() - INTERVAL '90 days' WHERE id_listing = $1",
      [rascunho.id_listing]
    );
    const voltou = await Storage.extendPaidUntil(c, rascunho.id_listing, 1);
    check(
      "⚠️ quem voltou depois de 90 dias parado ganha 1 mes, nao 4",
      dias(voltou.paid_until, new Date()) > 27 && dias(voltou.paid_until, new Date()) < 32,
      String(voltou.paid_until)
    );

    /* ─────────────────── 6. o estorno RECUA a vigencia ──────────────────── */
    const antesDoEstorno = voltou.paid_until;
    const encolhido = await Storage.shrinkPaidUntil(c, rascunho.id_listing, 1);
    check(
      "⚠️ o estorno RECUA a vigencia (nao estende)",
      new Date(encolhido.paid_until) < new Date(antesDoEstorno),
      `${antesDoEstorno} -> ${encolhido.paid_until}`
    );
    const foraDaVitrine = await Storage.list(c, comunidade.id_profile, { kind: "product" });
    check(
      "e o anuncio estornado sai da vitrine sozinho",
      foraDaVitrine.every((l) => String(l.id_listing) !== String(rascunho.id_listing))
    );
    const aindaExiste = (
      await c.query("SELECT title FROM public.tb_condo_listing WHERE id_listing = $1", [
        rascunho.id_listing,
      ])
    ).rows[0];
    check(
      "⚠️ mas o anuncio NAO foi apagado — o texto continua do dono",
      aindaExiste?.title === "Bolo de cenoura"
    );

    /* ─────────────── 7. a renovacao do cartao e deduplicada ─────────────── */
    await Storage.attachSubscription(c, legado.id_listing, {
      ref: "preapproval-teste-" + Date.now(),
      provider: "mercadopago",
      status: "active",
    });
    const comSub = await Storage.getByIdRaw(c, legado.id_listing);
    check("a assinatura fica gravada no anuncio", comSub.subscription_status === "active");
    check(
      "e o anuncio e encontrado pela referencia da assinatura",
      (await Storage.getBySubscriptionRef(c, comSub.subscription_ref))?.id_listing ===
        comSub.id_listing
    );

    const fatura = "invoice-teste-" + Date.now();
    const primeira = await Storage.recordRenewalOnce(c, {
      id_condo: comunidade.id_profile,
      id_user: dono.id_user,
      kind: "service",
      id_listing: legado.id_listing,
      payment_provider: "mercadopago",
      amount_cents: 350,
      invoice_ref: fatura,
    });
    check("a 1a entrega da fatura credita", primeira !== null);

    const reentrega = await Storage.recordRenewalOnce(c, {
      id_condo: comunidade.id_profile,
      id_user: dono.id_user,
      kind: "service",
      id_listing: legado.id_listing,
      payment_provider: "mercadopago",
      amount_cents: 350,
      invoice_ref: fatura,
    });
    check(
      "⚠️ a RE-ENTREGA da mesma fatura NAO credita de novo (webhook e at-least-once)",
      reentrega === null
    );

    /* ──────────────── 8. cancelar nao tira o anuncio do ar ──────────────── */
    const antesDeCancelar = (await Storage.getByIdRaw(c, legado.id_listing)).paid_until;
    const solto = await Storage.detachSubscription(c, legado.id_listing);
    check(
      "⚠️ cancelar NAO mexe na vigencia — o mes pago e de quem pagou",
      String(solto.paid_until) === String(antesDeCancelar)
    );
    const depoisDeCancelar = await Storage.getByIdRaw(c, legado.id_listing);
    check(
      "a assinatura e solta e marcada como cancelada",
      depoisDeCancelar.subscription_ref === null &&
        depoisDeCancelar.subscription_status === "canceled"
    );
    const aindaNaVitrine = await Storage.list(c, comunidade.id_profile, { kind: "service" });
    check(
      "e o anuncio CONTINUA na vitrine ate a data vencer",
      aindaNaVitrine.some((l) => String(l.id_listing) === String(legado.id_listing))
    );

    /* ──────────────────── 9. o CHECK do estado da assinatura ────────────── */
    const estadoInventado = await attempt(c, () =>
      c.query(
        "UPDATE public.tb_condo_listing SET subscription_status = 'vencendo' WHERE id_listing = $1",
        [legado.id_listing]
      )
    );
    check(
      "estado de assinatura fora da lista e recusado PELO NOME da constraint",
      !estadoInventado.ok &&
        String(estadoInventado.error.message).includes("tb_condo_listing_sub_status_chk"),
      estadoInventado.ok ? "passou" : estadoInventado.error.message
    );

    /* ───────────────────── 10. preco: override por comunidade ───────────── */
    await Storage.upsertConfig(c, comunidade.id_profile, { listing_monthly_cents: 500 });
    const efetivo = await Storage.getEffectiveSettings(c, comunidade.id_profile);
    check(
      "o override por comunidade vence o preco global",
      Number(efetivo.listing_monthly_cents) === 500,
      String(efetivo.listing_monthly_cents)
    );
    const outra = await Storage.getEffectiveSettings(c, dono.id_user);
    check(
      "quem nao tem override herda os R$ 3,50 globais",
      Number(outra.listing_monthly_cents) === 350,
      String(outra.listing_monthly_cents)
    );

    /* ─────────────── 11. a contagem que a tela do dono mostra ───────────── */
    const noAr = await Storage.countLive(c, comunidade.id_profile, dono.id_user, "service");
    check("o dono tem 1 anuncio de servico no ar", noAr === 1, String(noAr));
    const paradosProduto = await Storage.countLive(c, comunidade.id_profile, dono.id_user, "product");
    check("e nenhum de produto no ar (o dele foi estornado)", paradosProduto === 0);
  } catch (err) {
    fail++;
    console.log("FAIL  execucao -> " + err.message);
  } finally {
    await c.query("ROLLBACK");

    // ⚠️ A PROVA DE QUE PRODUCAO FICOU INTOCADA: o estado volta ao que foi
    // MEDIDO antes, e não a "a coluna não existe".
    const depoisColunas = (
      await c.query(
        `SELECT COUNT(*)::int n FROM information_schema.columns
          WHERE table_name='tb_condo_listing' AND column_name='paid_until'`
      )
    ).rows[0].n;
    const depoisAnuncios = (await c.query("SELECT COUNT(*)::int n FROM public.tb_condo_listing"))
      .rows[0].n;
    check(
      "producao voltou ao estado de antes (colunas)",
      depoisColunas === antesColunas,
      `${antesColunas} -> ${depoisColunas}`
    );
    check(
      "producao voltou ao estado de antes (anuncios)",
      depoisAnuncios === antesAnuncios,
      `${antesAnuncios} -> ${depoisAnuncios}`
    );
    await c.end();
  }

  console.log(`\n${pass}/${pass + fail} OK` + (fail ? ` — ${fail} FALHA(S)` : ""));
  process.exit(fail ? 1 : 0);
})();
