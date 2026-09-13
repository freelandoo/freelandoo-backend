/**
 * Exercita a mig 244 contra o Postgres de PRODUÇÃO dentro de UMA transação que
 * termina em ROLLBACK. Não existe COMMIT neste arquivo — é isso que torna
 * seguro apontar para produção.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const BE = path.join(__dirname, "..");
const MIG = path.join(BE, "src/databases/migrations/244_booking_fee_and_onsite.sql");
const BookingStorage = require(path.join(BE, "src/storages/BookingStorage"));
const { professionalNet } = require(path.join(BE, "src/utils/bookingFee"));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond === true) { pass++; console.log("  ok  " + name); }
  else if (cond === false) { fail++; console.log("FAIL  " + name + (extra ? " -> " + extra : "")); }
  else { fail++; console.log("FAIL  " + name + " -> assercao nao-booleana (" + typeof cond + ")"); }
}

let antes = null;

(async () => {
  // Mesma normalização do app: o `sslmode=require` da URL sobrepõe o objeto
  // `ssl` do pg e derruba a conexão com certificado self-signed do proxy.
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete("sslmode");
  const c = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");
  try {
    antes = (await c.query(
      "SELECT service_fee_cents, stripe_fee_percent, is_active FROM public.tb_booking_fee_settings WHERE id = 1"
    )).rows[0];
    console.log("\n[producao, antes] tb_booking_fee_settings:", antes || "(sem linha)");
    const bookingsAntes = (await c.query("SELECT COUNT(*)::int n FROM public.tb_profile_bookings")).rows[0].n;
    console.log("[producao, antes] agendamentos:", bookingsAntes, "\n");

    const sql = fs.readFileSync(MIG, "utf8");
    await c.query(sql);
    console.log("-- 1a aplicacao --");

    const cfg = (await c.query(
      "SELECT service_fee_cents, stripe_fee_percent, is_active FROM public.tb_booking_fee_settings WHERE id = 1"
    )).rows[0];
    check("a taxa da plataforma passou a valer R$ 1,00", Number(cfg.service_fee_cents) === 100, JSON.stringify(cfg));
    check("o percentual e zero - R$ 1,00 fixo, sem parte escondida", Number(cfg.stripe_fee_percent) === 0);
    check("a linha esta ativa", cfg.is_active === true);

    const cols = (await c.query(
      `SELECT column_name, is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'tb_profile_bookings'
          AND column_name IN ('processor_fee_cents','processor_fee_source') ORDER BY column_name`
    )).rows;
    check("as duas colunas novas existem", cols.length === 2, JSON.stringify(cols));
    const fee = cols.find((r) => r.column_name === "processor_fee_cents");
    const src = cols.find((r) => r.column_name === "processor_fee_source");
    check("processor_fee_cents e NOT NULL", !!fee && fee.is_nullable === "NO");
    check("processor_fee_cents nasce em 0 - nunca NULL, que vira zero silencioso em JS",
      !!fee && String(fee.column_default).startsWith("0"));
    check("processor_fee_source e NOT NULL", !!src && src.is_nullable === "NO");

    const conNames = async () => (await c.query(
      "SELECT conname FROM pg_constraint WHERE conrelid = 'public.tb_profile_bookings'::regclass AND contype = 'c'"
    )).rows.map((r) => r.conname);
    const cons = await conNames();
    check("existe o CHECK de tarifa nao-negativa, pelo NOME",
      cons.includes("chk_booking_processor_fee_nonneg"), cons.join(","));
    check("existe o CHECK da origem da tarifa, pelo NOME", cons.includes("chk_booking_processor_fee_source"));
    check("existe UM E SO UM check de payment_status",
      cons.filter((n) => n === "tb_profile_bookings_payment_status_check").length === 1);

    const legado = (await c.query(
      "SELECT COUNT(*)::int n FROM public.tb_profile_bookings WHERE processor_fee_source = 'none'"
    )).rows[0].n;
    check("agendamento antigo virou 'none' - tarifa 0 FINAL, nao estimativa",
      legado === bookingsAntes, "none=" + legado + " de " + bookingsAntes);

    await c.query(sql);
    const cfg2 = (await c.query(
      "SELECT service_fee_cents FROM public.tb_booking_fee_settings WHERE id = 1"
    )).rows[0];
    const cons2 = await conNames();
    check("2a aplicacao nao muda a taxa", Number(cfg2.service_fee_cents) === 100);
    check("2a aplicacao nao duplica o CHECK de payment_status",
      cons2.filter((n) => n === "tb_profile_bookings_payment_status_check").length === 1);
    check("2a aplicacao nao duplica o CHECK da tarifa",
      cons2.filter((n) => n === "chk_booking_processor_fee_nonneg").length === 1);
    console.log("-- 2a aplicacao: idempotente --");

    const perfil = (await c.query(
      "SELECT id_profile, id_user FROM public.tb_profile WHERE deleted_at IS NULL LIMIT 1"
    )).rows[0];

    // ⚠️ CADA RESERVA EM UM HORÁRIO PRÓPRIO: existe `idx_booking_unique_active_slot`
    // (índice único parcial, mig 010) barrando duplo agendamento no mesmo slot —
    // e ele vale para `on_site` também, porque a condição é o STATUS não ser
    // cancelado/expirado, e a reserva de balcão nasce `confirmed`.
    let hora = 8;
    const novaReserva = async (payment_status, status, extra = {}) => {
      const h = String(hora++).padStart(2, "0");
      const r = await c.query(
        `INSERT INTO public.tb_profile_bookings
           (id_profile, profile_owner_user_id, client_name, client_email,
            booking_date, start_time, end_time, status, payment_status,
            deposit_amount, platform_fee_amount, professional_amount,
            processor_fee_cents, processor_fee_source)
         VALUES ($1,$2,'Teste','t@t.com','2099-01-01',$10,$11,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [perfil.id_profile, perfil.id_user, status, payment_status,
         extra.deposit ?? 0, extra.platform ?? 0, extra.professional ?? 0,
         extra.fee ?? 0, extra.src ?? "fallback", h + ":00", h + ":30"]
      );
      return r.rows[0];
    };

    for (const antigo of ["pending", "paid", "failed", "refunded", "canceled"]) {
      let ok = true;
      await c.query("SAVEPOINT s");
      try { await novaReserva(antigo, "confirmed"); await c.query("RELEASE SAVEPOINT s"); }
      catch { ok = false; await c.query("ROLLBACK TO SAVEPOINT s"); }
      check("o CHECK e SUPERSET: '" + antigo + "' continua valendo", ok);
    }

    let reservaBalcao = null, onSiteOk = true;
    try { reservaBalcao = await novaReserva("on_site", "confirmed"); }
    catch (e) { onSiteOk = false; console.log("   ", e.message); }
    check("'on_site' passou a ser aceito", onSiteOk);

    const recusa = async (nome, regex, fn) => {
      let bateu = false;
      await c.query("SAVEPOINT r");
      try { await fn(); await c.query("ROLLBACK TO SAVEPOINT r"); }
      catch (e) { bateu = regex.test(e.message); await c.query("ROLLBACK TO SAVEPOINT r"); }
      check(nome, bateu);
    };
    await recusa("valor de pagamento inventado e recusado PELO NOME do check",
      /payment_status_check/, () => novaReserva("qualquer_coisa", "confirmed"));
    await recusa("origem de tarifa inventada e recusada PELO NOME do check",
      /chk_booking_processor_fee_source/, () => novaReserva("paid", "confirmed", { src: "chute" }));
    await recusa("tarifa negativa e recusada PELO NOME do check",
      /chk_booking_processor_fee_nonneg/, () => novaReserva("paid", "confirmed", { fee: -1 }));

    const expirados = await BookingStorage.expireStaleBookings(c, 0);
    const balcaoDepois = (await c.query(
      "SELECT status, payment_status FROM public.tb_profile_bookings WHERE id = $1", [reservaBalcao.id]
    )).rows[0];
    check("o sweeper de pendentes NAO expira a reserva de balcao",
      balcaoDepois.status === "confirmed" && balcaoDepois.payment_status === "on_site",
      JSON.stringify(balcaoDepois));
    check("o sweeper devolveu a lista do que varreu", Array.isArray(expirados));

    const ativos = await BookingStorage.getActiveBookingsForDate(c, [perfil.id_profile], "2099-01-01");
    check("a reserva de balcao OCUPA o horario (nao e vaga livre)",
      ativos.some((b) => b.payment_status === "on_site"), JSON.stringify(ativos));

    const base = await novaReserva("pending", "pending_payment",
      { deposit: 4400, platform: 100, professional: 3731, fee: 169, src: "fallback" });
    const ajustado = await BookingStorage.applyProcessorFee(c, base.id, 220);
    check("a tarifa real substitui a estimativa", Number(ajustado.processor_fee_cents) === 220);
    check("a origem passa a dizer 'gateway'", ajustado.processor_fee_source === "gateway");
    check("o liquido cai exatamente o delta (169 -> 220 tira 51)",
      Number(ajustado.professional_amount) === 3731 - 51, String(ajustado.professional_amount));
    check("util e banco concordam no liquido",
      professionalNet({ chargeAmountCents: 4400, platformFeeCents: 100, processorFeeCents: 220,
        affiliateCommissionCents: 400 }) === Number(ajustado.professional_amount));

    const barato = await novaReserva("pending", "pending_payment",
      { deposit: 500, platform: 100, professional: 301, fee: 99, src: "fallback" });
    const zerado = await BookingStorage.applyProcessorFee(c, barato.id, 9000);
    check("tarifa absurda fixa o liquido em ZERO - nunca debito na carteira",
      Number(zerado.professional_amount) === 0, String(zerado.professional_amount));

  } catch (err) {
    fail++;
    console.log("\nERRO:", err.message);
  } finally {
    await c.query("ROLLBACK");
    const depois = (await c.query(
      "SELECT service_fee_cents FROM public.tb_booking_fee_settings WHERE id = 1"
    )).rows[0];
    const colDepois = (await c.query(
      `SELECT COUNT(*)::int n FROM information_schema.columns
        WHERE table_name='tb_profile_bookings' AND column_name='processor_fee_cents'`
    )).rows[0].n;
    console.log("\n[producao, depois do ROLLBACK] settings:", depois, "| coluna nova existe?", colDepois);
    check("PRODUCAO INTOCADA: a coluna nao ficou", colDepois === 0);
    check("PRODUCAO INTOCADA: a taxa nao mudou",
      Number(depois.service_fee_cents) === Number(antes.service_fee_cents));
    await c.end();
    console.log("\n" + pass + "/" + (pass + fail) + " checks");
    process.exit(fail ? 1 : 0);
  }
})();
