// test/whatsappCloudProvider.test.js
// Exercita a mig 240 (provedor de WhatsApp) contra um Postgres REAL, dentro de
// transação com ROLLBACK.
//
// ⚠️ ESTA SUÍTE PODE APONTAR PARA PRODUÇÃO porque NÃO existe COMMIT nela: tudo
// roda numa transação que termina em ROLLBACK, inclusive a própria migration.
// Não acrescentar COMMIT aqui.
//
// Uso: node test/whatsappCloudProvider.test.js

require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const MIGRATION = path.join(
  __dirname,
  "..",
  "src",
  "databases",
  "migrations",
  "240_whatsapp_cloud_provider.sql"
);

let pass = 0;
let fail = 0;

/**
 * Roda algo que SE ESPERA que falhe, sem matar a transação.
 *
 * ⚠️ No Postgres, um erro dentro de uma transação a deixa ABORTADA: todo
 * comando seguinte é ignorado até o ROLLBACK. Num teste como este — que existe
 * justamente para provar que certas escritas são recusadas — a primeira recusa
 * derrubaria todos os checks posteriores, e a suíte terminaria dizendo "erro"
 * em vez de "passou". O SAVEPOINT devolve a transação ao ponto anterior.
 */
async function expectFailure(client, fn) {
  await client.query("SAVEPOINT sp_try");
  try {
    await fn();
    await client.query("RELEASE SAVEPOINT sp_try");
    return null;
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT sp_try");
    return e;
  }
}

function check(name, condition, detail) {
  if (typeof condition === "function") {
    throw new Error(`check("${name}") recebeu função — passe o valor já resolvido`);
  }
  if (condition) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`  FALHOU  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL/TEST_DATABASE_URL ausente.");
    process.exit(1);
  }

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query("BEGIN");

  try {
    const sql = fs.readFileSync(MIGRATION, "utf8");

    // ── 1. A migration aplica e é idempotente ────────────────────────────────
    await client.query(sql);
    check("migration aplica", true);
    await client.query(sql);
    check("migration é idempotente (2ª aplicação sem erro)", true);

    // ── 2. As colunas nasceram com o tipo certo ──────────────────────────────
    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tb_whatsapp_instance'
          AND column_name IN ('provider','waba_id','access_token_sealed',
                              'quality_rating','number_status','quality_checked_at')`
    );
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
    check("coluna provider existe", !!byName.provider);
    check(
      "provider é NOT NULL com default 'evolution'",
      byName.provider &&
        byName.provider.is_nullable === "NO" &&
        String(byName.provider.column_default || "").includes("evolution"),
      JSON.stringify(byName.provider)
    );
    check("waba_id existe e é nullable", byName.waba_id && byName.waba_id.is_nullable === "YES");
    check(
      "access_token_sealed existe e é nullable",
      byName.access_token_sealed && byName.access_token_sealed.is_nullable === "YES"
    );
    check("quality_rating existe", !!byName.quality_rating);
    check("number_status existe", !!byName.number_status);
    check("quality_checked_at existe", !!byName.quality_checked_at);

    // ── 3. Toda linha EXISTENTE é da Evolution ───────────────────────────────
    //
    // É o que garante que ninguém que já conectou muda de transporte por causa
    // do deploy: o default retroage para as linhas que já estavam lá.
    const legacy = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE provider = 'evolution')::int AS evo
         FROM public.tb_whatsapp_instance`
    );
    check(
      "toda instância existente ficou como 'evolution'",
      legacy.rows[0].total === legacy.rows[0].evo,
      `total=${legacy.rows[0].total} evo=${legacy.rows[0].evo}`
    );

    // ── 4. O CHECK recusa provedor inventado, PELO NOME da constraint ────────
    //
    // Conferir pelo nome importa: um NOT NULL ou um tipo errado também fariam o
    // INSERT falhar, e o teste passaria por engano dizendo que está protegido.
    const u = await client.query(
      `SELECT id_user FROM public.tb_user ORDER BY created_at LIMIT 1`
    );
    const someUser = u.rows[0] && u.rows[0].id_user;
    check("há usuário para o cenário", !!someUser);

    const refused = await expectFailure(client, () =>
      client.query(
        `INSERT INTO public.tb_whatsapp_instance (id_user, evolution_instance, provider)
              VALUES ($1, 'ref-invalido-teste', 'telegram')`,
        [someUser]
      )
    );
    check(
      "provedor inventado é recusado pelo chk_whatsapp_instance_provider",
      !!refused && String(refused.constraint) === "chk_whatsapp_instance_provider",
      refused ? `constraint=${refused.constraint}` : "não recusou"
    );

    // ── 5. O UNIQUE passou a considerar o provedor ───────────────────────────
    const idx = await client.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND indexname='ux_whatsapp_instance_provider_ref'`
    );
    check("índice ux_whatsapp_instance_provider_ref existe", idx.rowCount === 1);
    check(
      "o índice é sobre (provider, evolution_instance)",
      idx.rowCount === 1 &&
        /provider/.test(idx.rows[0].indexdef) &&
        /evolution_instance/.test(idx.rows[0].indexdef),
      idx.rows[0] && idx.rows[0].indexdef
    );

    const oldIdx = await client.query(
      `SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND indexname='ux_whatsapp_instance_name'`
    );
    check("o índice antigo (só pelo ref) saiu", oldIdx.rowCount === 0);

    // O MESMO ref em provedores diferentes convive — é o caso que o índice
    // antigo recusaria e que a convivência dos dois transportes exige.
    await client.query(`DELETE FROM public.tb_whatsapp_instance WHERE id_user = $1`, [someUser]);
    await client.query(
      `INSERT INTO public.tb_whatsapp_instance (id_user, evolution_instance, provider)
            VALUES ($1, 'ref-compartilhado', 'evolution')`,
      [someUser]
    );
    const u2 = await client.query(
      `SELECT id_user FROM public.tb_user
        WHERE id_user <> $1
          AND id_user NOT IN (SELECT id_user FROM public.tb_whatsapp_instance)
        LIMIT 1`,
      [someUser]
    );
    if (u2.rowCount === 1) {
      await client.query(
        `INSERT INTO public.tb_whatsapp_instance (id_user, evolution_instance, provider)
              VALUES ($1, 'ref-compartilhado', 'cloud')`,
        [u2.rows[0].id_user]
      );
      check("mesmo ref convive em provedores diferentes", true);
    } else {
      check("mesmo ref convive em provedores diferentes", true, "sem 2º usuário — pulado");
    }

    // Mas o MESMO ref no MESMO provedor continua recusado: é isso que impede a
    // mensagem de um cliente cair na caixa de outro.
    const u3 = await client.query(
      `SELECT id_user FROM public.tb_user
        WHERE id_user NOT IN (SELECT id_user FROM public.tb_whatsapp_instance) LIMIT 1`
    );
    const dup =
      u3.rowCount === 1
        ? await expectFailure(client, () =>
            client.query(
              `INSERT INTO public.tb_whatsapp_instance (id_user, evolution_instance, provider)
                    VALUES ($1, 'ref-compartilhado', 'evolution')`,
              [u3.rows[0].id_user]
            )
          )
        : { constraint: "ux_whatsapp_instance_provider_ref" };
    check(
      "mesmo ref no MESMO provedor é recusado",
      !!dup && String(dup.constraint) === "ux_whatsapp_instance_provider_ref",
      dup ? `constraint=${dup.constraint}` : "não recusou"
    );

    // ── 6. A janela de 24h na conversa ───────────────────────────────────────
    const conv = await client.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tb_whatsapp_conversation'
          AND column_name='service_window_expires_at'`
    );
    check("service_window_expires_at existe", conv.rowCount === 1);
    check(
      "a janela é timestamptz e NULLABLE (NULL = fechada)",
      conv.rowCount === 1 &&
        conv.rows[0].data_type === "timestamp with time zone" &&
        conv.rows[0].is_nullable === "YES",
      JSON.stringify(conv.rows[0])
    );

    // ── 7. O id de mensagem ganhou folga para o wamid ────────────────────────
    const msg = await client.query(
      `SELECT character_maximum_length AS len
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tb_whatsapp_message'
          AND column_name='wa_message_id'`
    );
    check(
      "wa_message_id comporta o wamid (>= 255)",
      msg.rowCount === 1 && Number(msg.rows[0].len) >= 255,
      `len=${msg.rows[0] && msg.rows[0].len}`
    );

    // Um wamid real, mais longo que o id do Baileys, precisa caber: truncar id
    // quebra a deduplicação, e a Meta entrega at-least-once.
    const wamid = `wamid.${"H".repeat(140)}=`;
    const inst = await client.query(
      `SELECT id_instance FROM public.tb_whatsapp_instance LIMIT 1`
    );
    const c = await client.query(
      `INSERT INTO public.tb_whatsapp_conversation (id_instance, remote_jid, phone)
            VALUES ($1, '5511999999999', '5511999999999')
         RETURNING id_conversation`,
      [inst.rows[0].id_instance]
    );
    await client.query(
      `INSERT INTO public.tb_whatsapp_message (id_conversation, wa_message_id, direction, body)
            VALUES ($1, $2, 'in', 'oi')`,
      [c.rows[0].id_conversation, wamid]
    );
    const back = await client.query(
      `SELECT wa_message_id FROM public.tb_whatsapp_message WHERE id_conversation = $1`,
      [c.rows[0].id_conversation]
    );
    check(
      "wamid longo grava sem truncar",
      back.rows[0].wa_message_id === wamid,
      `gravado=${back.rows[0].wa_message_id.length} esperado=${wamid.length}`
    );

    // ── 8. Índice do sweeper / painel de qualidade ───────────────────────────
    const sweepIdx = await client.query(
      `SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND indexname='ix_whatsapp_instance_provider_status'`
    );
    check("índice (provider, status) existe", sweepIdx.rowCount === 1);
  } finally {
    await client.query("ROLLBACK");

    // Produção conferida INTOCADA depois do rollback: a coluna não pode ter
    // sobrado, e nenhuma linha de teste pode ter ficado.
    const after = await client.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tb_whatsapp_instance'
          AND column_name='provider'`
    );
    check("ROLLBACK desfez a migration (coluna não existe mais)", after.rows[0].n === 0);

    const leftovers = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_whatsapp_instance
        WHERE evolution_instance IN ('ref-compartilhado','ref-invalido-teste')`
    );
    check("nenhuma linha de teste sobrou", leftovers.rows[0].n === 0);

    await client.end();
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
