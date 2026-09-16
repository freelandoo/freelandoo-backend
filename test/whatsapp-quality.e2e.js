// test/whatsapp-quality.e2e.js
// W6 — a saúde do número, contra o banco de VERDADE.
//
// `npm run test:whatsapp-quality`
//
// ─── POR QUE ISTO PODE RODAR CONTRA PRODUÇÃO ────────────────────────────────
//
// Tudo aqui acontece dentro de UMA transação que termina em ROLLBACK, e não
// existe um `COMMIT` neste arquivo. É a mesma disciplina das outras suítes de
// migration da casa, e é ela que permite exercitar o CHECK REAL da
// `tb_notification` — que é justamente o que não dá para simular: um CHECK
// reescrito com nome errado deixa o antigo valendo em paralelo, e o sintoma é
// um INSERT que só falha em produção, no dia do primeiro alerta.
//
// Os dois últimos casos conferem, DEPOIS do rollback, que nada sobrou.

const { Pool } = require("pg");
require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const WhatsappStorage = require("../src/storages/WhatsappStorage");

const MIGRATION = path.join(
  __dirname,
  "..",
  "src",
  "databases",
  "migrations",
  "246_whatsapp_quality_alert.sql"
);

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  // ⚠️ O harness RECUSA função: `check("x", async () => ...)` passaria sempre
  // (função é truthy) e imprimiria sucesso sem ter conferido nada. Este guard
  // existe porque o defeito já apareceu numa suíte da casa.
  if (typeof ok === "function") {
    fail++;
    console.log(`  X ${name} — check() recebeu uma função, não um booleano`);
    return;
  }
  if (ok) {
    pass++;
    console.log(`  OK  ${name}`);
  } else {
    fail++;
    console.log(`  X   ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const url = String(process.env.DATABASE_URL || "").replace(/[?&]sslmode=[^&]*/, "");
  if (!url) {
    console.error("DATABASE_URL ausente.");
    process.exit(1);
  }
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const pool = new Pool({ connectionString: `${url}?sslmode=no-verify` });
  const c = await pool.connect();

  // O estado ANTES da transação — o ponto de retorno que o ROLLBACK tem que
  // devolver.
  //
  // ⚠️ Medir isto é o que impede a asserção final de envelhecer. Ela nasceu
  // exigindo que o tipo NÃO existisse depois do rollback, e isso deixou de ser
  // verdade no dia em que a própria mig 246 foi para produção: lá o tipo passou
  // a existir legitimamente, aplicado no boot, e o teste começou a acusar o
  // mundo correto como defeito. A pergunta que não envelhece é "o rollback me
  // devolveu ao ponto de partida?".
  const hadTypeBefore = (
    await c.query(
      "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'tb_notification_type_chk'"
    )
  ).rows[0].d.includes("whatsapp_quality_alert");

  console.log("\nW6 — qualidade do número (transação com ROLLBACK)");
  console.log("-".repeat(58));
  await c.query("BEGIN");

  try {
    // ── 1. A migration ────────────────────────────────────────────────────
    const sql = fs.readFileSync(MIGRATION, "utf8");
    await c.query(sql);
    check("migration 246 aplica", true);
    await c.query(sql);
    check("migration 246 e idempotente (2a passada)", true);

    const def = await c.query(
      "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'tb_notification_type_chk'"
    );
    check("o CHECK continua com o MESMO nome", def.rowCount === 1, `encontrei ${def.rowCount}`);

    const body = def.rows[0].d;
    check("o tipo novo entrou", body.includes("whatsapp_quality_alert"));
    check(
      "e e SUPERSET — os antigos continuam valendo",
      ["like_received", "condo_dispute_decided", "residence_ended", "live_gift_received"].every((t) =>
        body.includes(t)
      )
    );

    const dup = await c.query(
      `SELECT COUNT(*)::int n FROM pg_constraint
        WHERE conrelid = 'public.tb_notification'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%like_received%'`
    );
    check("nao ha CHECK duplicado sobre type", dup.rows[0].n === 1, `n=${dup.rows[0].n}`);

    // ── 2. Um usuário e uma instância de teste ────────────────────────────
    const u = await c.query(
      `INSERT INTO public.tb_user (nome, email, username, senha, ativo, data_nascimento, cpf)
            VALUES ('QA Qualidade', 'qa-quality-w6@example.invalid', 'qa_quality_w6', 'x', TRUE, '1990-01-01', '00000000191')
         RETURNING id_user`
    );
    const userId = u.rows[0].id_user;

    const inst = await c.query(
      `INSERT INTO public.tb_whatsapp_instance (id_user, evolution_instance, provider, status, connected_number)
            VALUES ($1, '999000111222333', 'cloud', 'connected', '5511988887777')
         RETURNING id_instance`,
      [userId]
    );
    const instanceId = inst.rows[0].id_instance;

    // ── 3. Achar a instância PELO NÚMERO ──────────────────────────────────
    const exact = await WhatsappStorage.getInstanceByNumber(c, "cloud", "5511988887777");
    check("acha pelo numero exato", !!exact && exact.id_instance === instanceId);

    const formatted = await WhatsappStorage.getInstanceByNumber(c, "cloud", "+55 11 98888-7777");
    check(
      "acha com o numero FORMATADO como a Meta manda",
      !!formatted && formatted.id_instance === instanceId
    );

    // O nono dígito brasileiro: a Meta ora manda com, ora sem.
    const noNine = await WhatsappStorage.getInstanceByNumber(c, "cloud", "551188887777");
    check("acha sem o nono digito (fallback pelos 8 finais)", !!noNine && noNine.id_instance === instanceId);

    const other = await WhatsappStorage.getInstanceByNumber(c, "cloud", "5511999990000");
    check("numero de fora NAO e atribuido a ninguem", other === null);

    const wrongProvider = await WhatsappStorage.getInstanceByNumber(c, "evolution", "5511988887777");
    check("provedor errado nao casa", wrongProvider === null);

    // Ambiguidade: dois números com o mesmo final não podem decidir nada.
    const u2 = await c.query(
      `INSERT INTO public.tb_user (nome, email, username, senha, ativo, data_nascimento, cpf)
            VALUES ('QA Qualidade 2', 'qa-quality-w6b@example.invalid', 'qa_quality_w6b', 'x', TRUE, '1990-01-01', '00000000272')
         RETURNING id_user`
    );
    await c.query(
      `INSERT INTO public.tb_whatsapp_instance (id_user, evolution_instance, provider, status, connected_number)
            VALUES ($1, '999000111222444', 'cloud', 'connected', '5521988887777')`,
      [u2.rows[0].id_user]
    );
    const ambiguous = await WhatsappStorage.getInstanceByNumber(c, "cloud", "551188887777");
    check(
      "dois numeros com o mesmo final: NAO decide (o aviso iria para a pessoa errada)",
      ambiguous === null
    );

    // ── 4. Gravar a saúde ─────────────────────────────────────────────────
    await WhatsappStorage.setQuality(c, instanceId, { rating: "GREEN", status: "CONNECTED" });
    let row = (
      await c.query("SELECT * FROM public.tb_whatsapp_instance WHERE id_instance = $1", [instanceId])
    ).rows[0];
    check("grava rating e status", row.quality_rating === "GREEN" && row.number_status === "CONNECTED");
    check("carimba quando foi a ultima noticia", !!row.quality_checked_at);

    // O webhook de qualidade manda status SEM rating: o rating não pode sumir.
    await WhatsappStorage.setQuality(c, instanceId, { rating: null, status: "FLAGGED" });
    row = (
      await c.query("SELECT * FROM public.tb_whatsapp_instance WHERE id_instance = $1", [instanceId])
    ).rows[0];
    check(
      "null NAO apaga o rating ja conhecido (o webhook nao manda rating)",
      row.quality_rating === "GREEN" && row.number_status === "FLAGGED"
    );

    // ── 5. A notificação que a migration destrava ─────────────────────────
    const n = await c.query(
      `INSERT INTO public.tb_notification (id_recipient_user, type, entity_type, entity_id, payload)
            VALUES ($1, 'whatsapp_quality_alert', 'whatsapp_instance', $2, '{"event":"FLAGGED"}'::jsonb)
         RETURNING id_notification`,
      [userId, instanceId]
    );
    check("a notificacao de qualidade e aceita pelo CHECK", n.rowCount === 1);

    let refused = false;
    try {
      await c.query("SAVEPOINT s1");
      await c.query(
        `INSERT INTO public.tb_notification (id_recipient_user, type, payload)
              VALUES ($1, 'whatsapp_tipo_inventado', '{}'::jsonb)`,
        [userId]
      );
      await c.query("RELEASE SAVEPOINT s1");
    } catch (e) {
      refused = String(e.message).includes("tb_notification_type_chk");
      await c.query("ROLLBACK TO SAVEPOINT s1");
    }
    check("tipo inventado e recusado PELO NOME da constraint", refused);

    // ── 6. O painel do admin ──────────────────────────────────────────────
    const list = await WhatsappStorage.listForAdmin(c, { limit: 50 });
    const mine = list.find((r) => r.id_instance === instanceId);
    check("o painel lista o numero", !!mine);
    check("e diz de QUEM ele e", !!mine && mine.username === "qa_quality_w6");

    await WhatsappStorage.setQuality(c, instanceId, { rating: "RED", status: null });
    const ordered = await WhatsappStorage.listForAdmin(c, { limit: 50 });
    check(
      "quem esta VERMELHO aparece primeiro",
      ordered.length > 0 && ordered[0].quality_rating === "RED",
      `primeiro veio ${ordered[0] && ordered[0].quality_rating}`
    );
  } catch (e) {
    fail++;
    console.log(`  X   ERRO: ${e.message}`);
  }

  await c.query("ROLLBACK");

  // ── 7. Produção intocada ────────────────────────────────────────────────
  const left = await c.query(
    "SELECT COUNT(*)::int n FROM public.tb_user WHERE email LIKE 'qa-quality-w6%'"
  );
  check("depois do ROLLBACK nao sobrou usuario de teste", left.rows[0].n === 0, `n=${left.rows[0].n}`);

  const chk = await c.query(
    "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'tb_notification_type_chk'"
  );
  check(
    "e o CHECK de producao voltou ao estado anterior",
    chk.rowCount === 1 && chk.rows[0].d.includes("whatsapp_quality_alert") === hadTypeBefore,
    `antes=${hadTypeBefore} depois=${chk.rows[0].d.includes("whatsapp_quality_alert")}`
  );

  c.release();
  await pool.end();

  console.log("-".repeat(58));
  console.log(`  ${pass} passaram, ${fail} falharam\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
