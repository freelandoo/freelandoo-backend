require("dotenv").config();

const app = require("./src/app");
const realtime = require("./src/realtime/socket");
const { createLogger } = require("./src/utils/logger");

const bootLog = createLogger("boot");

// Migrations rodam automaticamente no boot via `prestart` (run-migrations.js),
// antes deste processo subir. Não há endpoint HTTP de migration.

// porta vinda do .env ou fallback
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  bootLog.info("server.listen", { port: PORT });

  // Realtime (socket.io) — autenticado por JWT, attach no mesmo HTTP server.
  // Endpoint: /realtime. Eventos: conversation:message, notification:new,
  // nav-counts:changed. Frontend conecta via wss://<railway-host>/realtime.
  realtime.init(server);

  // F4.S1 — worker de mídia (fork): todo ffmpeg/sharp pesado roda fora deste
  // processo, com fila (concorrência 1) + status em media_jobs. Se o worker
  // cair, re-forka com backoff e os uploads caem pro processamento inline.
  const { startMediaWorker } = require("./src/utils/mediaJobs");
  startMediaWorker();

  // Painel de Arquitetura: carrega o manifesto (scan carimbado com git) para
  // dentro de arch_functions. Idempotente, preserva curadoria do admin e nunca
  // derruba o boot. No-op se o manifesto ainda não existe.
  const ArchitectureService = require("./src/services/ArchitectureService");
  setTimeout(() => ArchitectureService.syncOnBoot(), 5 * 1000);

  // Retenção dos logs de rota (arch_route_logs): purga > 30 dias. Roda 6 min
  // após o boot e a cada 24h, pra tabela não crescer indefinidamente.
  const ARCH_LOG_RETENTION_DAYS = Number(process.env.ARCH_LOG_RETENTION_DAYS) || 30;
  const tickArchLogRetention = async () => {
    try {
      const result = await ArchitectureService.purgeLogs(ARCH_LOG_RETENTION_DAYS);
      if (result?.purged) bootLog.info("arch_logs.purged", result);
    } catch (err) {
      bootLog.error("arch_logs.retention_error", { message: err.message });
    }
  };
  setTimeout(tickArchLogRetention, 6 * 60 * 1000);
  setInterval(tickArchLogRetention, 24 * 60 * 60 * 1000);

  // Scheduler do ranking: checa e recalcula a cada 2 horas.
  const pool = require("./src/databases");
  const RankingStorage = require("./src/storages/RankingStorage");
  const SellerBalanceStorage = require("./src/storages/SellerBalanceStorage");
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const tickRanking = async () => {
    try {
      const result = await RankingStorage.runScheduledRecalculate(pool);
      if (!result.skipped) bootLog.info("ranking.auto_recalculated", result);
    } catch (err) {
      bootLog.error("ranking.scheduler_error", { message: err.message });
    }
  };
  // Primeira checagem 2 min após o boot, depois a cada 2 horas.
  setTimeout(tickRanking, 2 * 60 * 1000);
  setInterval(tickRanking, TWO_HOURS);

  // Job CDC: libera saldos do vendedor cujo holdback de 8 dias venceu.
  const tickSellerBalances = async () => {
    try {
      const rows = await SellerBalanceStorage.releaseDue(pool);
      if (rows.length) bootLog.info("seller_balance.released", { count: rows.length });
    } catch (err) {
      bootLog.error("seller_balance.scheduler_error", { message: err.message });
    }
  };
  setTimeout(tickSellerBalances, 3 * 60 * 1000);
  setInterval(tickSellerBalances, TWO_HOURS);

  // Job CDC: libera payouts de booking (agendamentos) E os splits de clan
  // (serviço/curso) após o holdback de 8 dias. O releaseDue de clan existia mas
  // nunca era agendado — o Saldo dos membros ficava preso em "aguardando"
  // (projeto PayDebug, D2).
  const BookingPayoutStorage = require("./src/storages/BookingPayoutStorage");
  const ClanPayoutStorage = require("./src/storages/ClanPayoutStorage");
  const BookingPayoutService = require("./src/services/BookingPayoutService");
  const tickBookingPayouts = async () => {
    try {
      const rows = await BookingPayoutStorage.releaseDue(pool);
      if (rows.length) bootLog.info("booking_payouts.released", { count: rows.length });
    } catch (err) {
      bootLog.error("booking_payouts.scheduler_error", { message: err.message });
    }
    try {
      const clanRows = await ClanPayoutStorage.releaseDue(pool);
      if (clanRows.length) bootLog.info("clan_payouts.released", { count: clanRows.length });
    } catch (err) {
      bootLog.error("clan_payouts.scheduler_error", { message: err.message });
    }
    try {
      const recon = await BookingPayoutService.reconcileMissing();
      if (recon?.created) bootLog.info("booking_payouts.reconciled", recon);
    } catch (err) {
      bootLog.error("booking_payouts.reconcile_error", { message: err.message });
    }
  };
  setTimeout(tickBookingPayouts, 5 * 60 * 1000);
  setInterval(tickBookingPayouts, TWO_HOURS);

  // Job: expira bookings pending_payment abandonados (checkout nunca pago) para
  // liberar o horário da agenda. Janela generosa (env, default 24h) por causa
  // do Pix — o sinal preciso é o checkout.session.expired no webhook; este é a
  // rede de segurança. Roda 6 min após boot e a cada 2h (projeto PayDebug, D2).
  const BookingStorage = require("./src/storages/BookingStorage");
  const BOOKING_EXPIRE_MIN = Number(process.env.BOOKING_PENDING_EXPIRE_MIN) || 1440;
  const tickExpireBookings = async () => {
    try {
      const rows = await BookingStorage.expireStaleBookings(pool, BOOKING_EXPIRE_MIN);
      if (rows.length) bootLog.info("bookings.expired", { count: rows.length });
    } catch (err) {
      bootLog.error("bookings.expire_scheduler_error", { message: err.message });
    }
  };
  setTimeout(tickExpireBookings, 6 * 60 * 1000);
  setInterval(tickExpireBookings, TWO_HOURS);

  // Job: lembrete de horário (anti-no-show). Varre bookings confirmados dentro
  // da janela de antecedência do subperfil (reminder_hours_before, default 24h)
  // ainda sem lembrete e dispara e-mail ao cliente com link de confirmação.
  // Roda 8 min após boot e a cada 30 min.
  const BookingReminderService = require("./src/services/BookingReminderService");
  const tickBookingReminders = async () => {
    try {
      const result = await BookingReminderService.runDue();
      if (result?.sent || result?.skipped) bootLog.info("booking_reminders.run", result);
    } catch (err) {
      bootLog.error("booking_reminders.scheduler_error", { message: err.message });
    }
  };
  setTimeout(tickBookingReminders, 8 * 60 * 1000);
  setInterval(tickBookingReminders, 30 * 60 * 1000);

  // Job: reconciliação de pagamentos — para webhooks perdidos, cruza pendentes
  // antigos com o estado real da session no Stripe e re-entrega os que já foram
  // pagos. Roda 7 min após boot e a cada 2h (projeto PayDebug, D6).
  const PaymentReconciliationService = require("./src/services/PaymentReconciliationService");
  const tickPaymentReconcile = async () => {
    try {
      const result = await PaymentReconciliationService.run();
      if (result?.recovered) bootLog.info("payments.reconciled", result);
    } catch (err) {
      bootLog.error("payments.reconcile_scheduler_error", { message: err.message });
    }
  };
  setTimeout(tickPaymentReconcile, 7 * 60 * 1000);
  setInterval(tickPaymentReconcile, TWO_HOURS);

  // Job: compra etiqueta no Melhor Envio para pedidos pagos cuja compra
  // inicial (no webhook) falhou. Roda 4 min após boot e a cada 30 min.
  const ProfileProductOrderService = require("./src/services/ProfileProductOrderService");
  const HALF_HOUR = 30 * 60 * 1000;
  const tickLabels = async () => {
    try {
      const result = await ProfileProductOrderService.processPendingLabels();
      if (result.processed) bootLog.info("labels.retry", result);
    } catch (err) {
      bootLog.error("labels.scheduler_error", { message: err.message });
    }
  };
  setTimeout(tickLabels, 4 * 60 * 1000);
  setInterval(tickLabels, HALF_HOUR);

  // Snapshot de mercado (Wallet): puxa ações/cotações de fontes externas
  // (brapi.dev + CoinGecko) e guarda em tb_market_snapshot. Roda NO BACKEND
  // pra que o Vercel só leia o cache — nunca chame API externa por request.
  // 1 min após boot, depois a cada 15 min.
  const MarketService = require("./src/services/MarketService");
  const FIFTEEN_MIN = 15 * 60 * 1000;
  const tickMarket = async () => {
    try {
      const result = await MarketService.refresh();
      if (result?.updated) bootLog.info("market.refreshed", result);
    } catch (err) {
      bootLog.error("market.scheduler_error", { message: err.message });
    }
  };
  setTimeout(tickMarket, 20 * 1000);
  setInterval(tickMarket, FIFTEEN_MIN);

  // Manchetes de economia/política (Wallet): RSS público (InfoMoney/G1), sem
  // chave. Roda 2 min após boot, depois a cada 30 min. Purga > 7 dias.
  const NewsService = require("./src/services/NewsService");
  const tickNews = async () => {
    try {
      const result = await NewsService.refresh();
      if (result?.upserted) bootLog.info("market_news.refreshed", result);
    } catch (err) {
      bootLog.error("market_news.scheduler_error", { message: err.message });
    }
  };
  setTimeout(tickNews, 25 * 1000);
  setInterval(tickNews, HALF_HOUR);

  // Job diário: reseta histórico do Chat ao Vivo (Global + Máquinas) toda
  // meia-noite de São Paulo. Apaga tb_chat_message, tb_chat_report,
  // tb_chat_moderation_result e tb_chat_presence. Mantém salas, settings
  // e reputação por usuário. Não há objetos em R2 — chat ao vivo é texto-only.
  // Job: retenção da ferramenta /comprimir. Apaga objetos de temp-compress/ no
  // R2 com mais de 3h — rede de segurança caso o lifecycle do bucket não esteja
  // configurado ou só expire por dia. Roda 10 min após boot e a cada 1h.
  const presignCompress = require("./src/integrations/r2/presignCompressUpload");
  const tickCompressSweep = async () => {
    try {
      const result = await presignCompress.sweepExpired();
      if (result?.deleted) bootLog.info("compress.swept", result);
    } catch (err) {
      bootLog.error("compress.sweep_error", { message: err.message });
    }
  };
  setTimeout(tickCompressSweep, 10 * 60 * 1000);
  setInterval(tickCompressSweep, 60 * 60 * 1000);

  const ChatStorage = require("./src/storages/ChatStorage");
  const SP_TZ = "America/Sao_Paulo";
  const msUntilNextMidnightSP = () => {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: SP_TZ,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
    const secSinceMidnight = get("hour") * 3600 + get("minute") * 60 + get("second");
    let ms = (86400 - secSinceMidnight) * 1000;
    // Buffer mínimo de 30s pra evitar laço apertado se relógio bater 00:00 exato
    if (ms < 30_000) ms += 86_400_000;
    return ms;
  };
  const tickChatDailyReset = async () => {
    try {
      const counts = await ChatStorage.dailyReset(pool);
      bootLog.info("chat.daily_reset", counts);
    } catch (err) {
      bootLog.error("chat.daily_reset_error", { message: err.message });
    } finally {
      // Reagenda sempre — mesmo em caso de erro, tenta de novo amanhã.
      setTimeout(tickChatDailyReset, msUntilNextMidnightSP());
    }
  };
  setTimeout(tickChatDailyReset, msUntilNextMidnightSP());
  bootLog.info("chat.daily_reset_scheduled", {
    next_run_ms: msUntilNextMidnightSP(),
    tz: SP_TZ,
  });
});

// Slice 7 (vídeo de curso): uploads até 100MB podem demorar minutos em
// conexões lentas. Padrão do Node é 0 (sem timeout) em versões recentes
// mas Express historicamente coloca 120s. Subimos explicitamente para
// 15 min e desativamos requestTimeout para o body parse não cortar no meio.
// Railway tem proxy próprio (~5min) — quando virar gargalo, migrar para
// worker queue / upload direto R2 (presigned).
server.requestTimeout = 0;
server.headersTimeout = 16 * 60 * 1000;
server.keepAliveTimeout = 15 * 60 * 1000;
server.timeout = 15 * 60 * 1000;
