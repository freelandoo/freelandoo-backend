// src/services/BusinessIndicatorsService.js
//
// OS INDICADORES DO NEGÓCIO (mig 235) — o painel do pill "Indicadores".
//
// Pedido do Alex (2026-09-10): leads (WhatsApp + O.S.), visualizações do site,
// cliques no botão de agendamento e faturamento, "tudo lá" numa tela só dentro
// do negócio.
//
// ─── O QUE ESTE ARQUIVO É: UM JUNTADOR, NÃO UMA FONTE ───────────────────────
//
// Nenhum número aqui é calculado por uma régua nova. Lead é a mensagem que já
// está na caixa; faturamento é o pagamento que já está na tabela de
// agendamentos e na de mensalidades. Este service só recorta o período, junta
// as cinco fontes no MESMO eixo de dias e responde. É de propósito: uma
// "tabela de indicadores" com os totais copiados seria a segunda verdade de
// sempre, e o dia em que um estorno mexesse numa e não na outra o painel
// mentiria sem errar.
//
// ─── ⚠️ O QUE É DA COMUNIDADE E O QUE É DA CONTA — a distinção que a tela
//     PRECISA declarar em voz alta ───────────────────────────────────────────
//
// O site, os agendamentos com origem e as mensalidades são DESTA comunidade:
// cada linha carrega o `id_profile` dela.
//
// O WhatsApp e a caixa de O.S. NÃO SÃO. A instância do WhatsApp pende do
// `id_user` (mig 223) e a O.S. pende dos perfis da conta — é um número de
// telefone e uma caixa de entrada por PESSOA, não por negócio. Quem tiver dois
// negócios verá o MESMO total de leads nos dois painéis, porque é o mesmo
// telefone tocando.
//
// Isso não é um defeito a consertar aqui: separar leads por negócio exigiria
// que a mensagem soubesse de qual site ela veio, e a mensagem do WhatsApp
// chega sem essa informação (é a pessoa digitando no aparelho dela). O que não
// se pode fazer é apresentar o número como se fosse do negócio — por isso a
// resposta carrega `scope: "account"` nos dois blocos, e a tela escreve de onde
// eles vêm. Número honesto e explicado vale mais do que número inventado.

const pool = require("../databases");
const CommunityStorage = require("../storages/CommunityStorage");
const BusinessIndicatorsStorage = require("../storages/BusinessIndicatorsStorage");
const CommunityProfessionalStorage = require("../storages/CommunityProfessionalStorage");
const WalletFinanceStorage = require("../storages/WalletFinanceStorage");
const { isSiteEventKind } = require("../utils/siteEvents");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("BusinessIndicatorsService");

/**
 * As janelas que o painel oferece.
 *
 * Lista FECHADA e não um número livre: `days` decide quantos pontos a série
 * devolve, e um `?days=100000` faria o servidor montar (e mandar pela rede)
 * cem mil objetos por causa de um parâmetro de querystring.
 */
const WINDOWS = Object.freeze([7, 30, 90]);
const DEFAULT_WINDOW = 30;

function normalizeDays(raw) {
  const n = Number(raw);
  return WINDOWS.includes(n) ? n : DEFAULT_WINDOW;
}

/** `AAAA-MM-DD` menos N dias, sem passar por fuso nenhum. */
function shiftDay(day, minus) {
  const [y, m, d] = String(day).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - minus);
  return dt.toISOString().slice(0, 10);
}

/** Os dias da janela, do mais antigo ao de hoje. Sem buracos. */
function dayRange(today, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(shiftDay(today, i));
  return out;
}

/** Uma lista de linhas `{day, ...}` virando mapa por dia. */
function byDay(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (r.day == null) continue;
    map.set(String(r.day), r);
  }
  return map;
}

/**
 * Tira da lista a linha de total do `GROUP BY ROLLUP` (a que tem `day` nulo).
 *
 * ⚠️ Ela existe porque PESSOA NÃO SE SOMA POR DIA: quem escreveu segunda e
 * quarta é uma pessoa só, e somar a série diria duas. Quem conta o distinto da
 * janela é o banco — ver `BusinessIndicatorsStorage.whatsappLeads`.
 *
 * Sem nenhuma mensagem no período a consulta não devolve nem a linha do total
 * (não há grupo nenhum a somar), e o zero vem daqui.
 */
function takeRollup(rows) {
  const total = (rows || []).find((r) => r.day == null);
  return total || { people: 0, messages: 0 };
}

const int = (v) => Number(v || 0);

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Os lançamentos DO NEGÓCIO (mig 261) espalhados pelos dias de [`from`, `to`].
 *
 * O avulso tem data própria. O recorrente é um valor POR MÊS a partir de
 * `start_ym`, que cai no dia do vencimento — e o dia 31 num mês de 30 cai no
 * último dia do mês, não some.
 *
 * Devolve o mapa por dia, o custo/entrada FIXO do mês (a soma dos recorrentes
 * ativos, que é a conta que o dono faz de cabeça: "tenho R$ X de custo fixo")
 * e a quebra dos custos por categoria.
 */
function expandFinance(rows, from, to) {
  const byDay = new Map();
  const occurrences = [];
  const add = (day, entry) => {
    if (day < from || day > to) return;
    const cur = byDay.get(day) || { in: 0, out: 0 };
    const cents = int(entry.amount_cents);
    if (entry.direction === "in") cur.in += cents;
    else cur.out += cents;
    byDay.set(day, cur);
    occurrences.push({ day, entry, cents });
  };

  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  let fixedOut = 0;
  let fixedIn = 0;

  for (const e of rows || []) {
    if (e.recurrence === "oneoff") {
      if (e.entry_date) add(String(e.entry_date).slice(0, 10), e);
      continue;
    }
    if (e.direction === "out") fixedOut += int(e.amount_cents);
    else fixedIn += int(e.amount_cents);
    let y = fy;
    let m = fm;
    while (y < ty || (y === ty && m <= tm)) {
      if (y * 100 + m >= int(e.start_ym)) {
        const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const d = Math.min(Math.max(int(e.due_day) || 1, 1), last);
        add(`${y}-${pad2(m)}-${pad2(d)}`, e);
      }
      if (m === 12) {
        y += 1;
        m = 1;
      } else {
        m += 1;
      }
    }
  }

  return {
    byDay,
    fixedOut,
    fixedIn,
    /** Os custos da janela por categoria (ou título), maiores primeiro. */
    topCosts(since, until) {
      const acc = new Map();
      for (const o of occurrences) {
        if (o.entry.direction !== "out" || o.day < since || o.day > until) continue;
        const label = o.entry.category || o.entry.title || "—";
        acc.set(label, (acc.get(label) || 0) + o.cents);
      }
      return [...acc.entries()]
        .map(([label, cents]) => ({ label, cents }))
        .sort((a, b) => b.cents - a.cents)
        .slice(0, 6);
    },
  };
}

/**
 * Quem vê os indicadores é o LÍDER, e só na comunidade de NEGÓCIO.
 *
 * Líder e não vice nem admin da comunidade: aqui saem faturamento e quantas
 * pessoas procuraram o dono — é a mesma régua do site (`CommunitySiteService`),
 * pela mesma razão. E só `common` porque o pet, o carro e o condomínio não
 * vendem nada: um painel de faturamento neles mediria o vazio.
 */
async function assertBusinessLeader(user, id_profile) {
  const id_user = user?.id_user;
  if (!id_user) return { error: "Usuário não autenticado", statusCode: 401 };
  const community = await CommunityStorage.getById(pool, id_profile);
  if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };
  if (community.kind !== "common") {
    return {
      error: "Indicadores são uma função da comunidade de negócio.",
      statusCode: 403,
    };
  }
  if (String(community.id_leader_user) !== String(id_user)) {
    return { error: "Apenas o líder vê os indicadores.", statusCode: 403 };
  }
  return { community };
}

module.exports = class BusinessIndicatorsService {
  /**
   * O registro que o site publicado manda — porta ANÔNIMA.
   *
   * Ela é chamada por quem visita o site de qualquer comunidade, sem sessão:
   * quem valida o alvo é o próprio INSERT (ver `recordSiteEvent`), que só grava
   * para comunidade de negócio com site publicado.
   *
   * ⚠️ A RESPOSTA É SEMPRE 204, inclusive quando nada foi gravado. Esta porta
   * fala com o navegador de um visitante, não com o dono: dizer "esse id não
   * tem site" transformaria o contador numa forma de descobrir quais
   * comunidades têm site publicado, uma a uma. E, do lado de quem chama, não há
   * nada a fazer com o erro — é um beacon, não uma operação.
   */
  static async recordSiteEvent(id_profile, kind) {
    if (!id_profile || !isSiteEventKind(kind)) return { noContent: true };
    return runWithLogs(
      log,
      "site_event.record",
      () => ({ id_profile, kind }),
      async () => {
        try {
          await BusinessIndicatorsStorage.recordSiteEvent(pool, id_profile, kind);
        } catch (err) {
          // Um contador que derruba a resposta é pior do que um contador que
          // perde uma linha. O erro fica no log; o visitante nunca sabe.
          log.warn("site_event.failed", { id_profile, kind, message: err.message });
        }
        return { noContent: true };
      }
    );
  }

  /**
   * O painel inteiro (reformulado em 2026-09-25): o resultado (receita × custo ×
   * lucro), o funil do site, a agenda da equipe com os melhores horários, a
   * comunidade e os leads — cada bloco com o período ANTERIOR ao lado, que é o
   * que transforma um número em "subiu" ou "caiu".
   */
  static async getIndicators(user, id_profile, rawDays) {
    const guard = await assertBusinessLeader(user, id_profile);
    if (guard.error) return guard;

    const days = normalizeDays(rawDays);
    const id_user = user.id_user;

    return runWithLogs(
      log,
      "indicators.get",
      () => ({ id_profile, id_user, days }),
      async () => {
        const S = BusinessIndicatorsStorage;
        const today = await S.today(pool);
        const since = shiftDay(today, days - 1);
        // A janela anterior, do mesmo tamanho, encostada nesta.
        const prevSince = shiftDay(today, 2 * days - 1);
        const prevUntil = shiftDay(today, days);
        const inPrev = (day) => day >= prevSince && day <= prevUntil;
        const inNow = (day) => day >= since;

        // A equipe: o líder + quem ele promoveu (mig 221). Sem repetir.
        const promoted = await CommunityProfessionalStorage.list(pool, id_profile);
        const teamIds = [...new Set([String(id_user), ...promoted.map((p) => String(p.id_user))])];

        // Tudo independente: em série a tela esperaria a soma dos tempos.
        const [
          siteRows,
          waRows,
          osRows,
          bookRows,
          memberRows,
          waStatus,
          teamRows,
          heatRows,
          members,
          joinRows,
          finRows,
        ] = await Promise.all([
          S.siteEvents(pool, id_profile, prevSince),
          S.whatsappLeads(pool, id_user, since),
          S.osLeads(pool, id_user, since),
          S.bookingsByOrigin(pool, id_profile, prevSince),
          S.membershipRevenue(pool, id_profile, prevSince),
          S.whatsappStatus(pool, id_user),
          S.teamBookingsDaily(pool, teamIds, id_profile, prevSince),
          S.teamBookingHeat(pool, teamIds, id_profile, since, today),
          S.members(pool, id_profile, since, prevSince),
          S.memberJoinsDaily(pool, id_profile, since),
          WalletFinanceStorage.businessEntries(pool, id_profile, { since: prevSince, until: today }),
        ]);

        // O contador do site vem por (dia, tipo) — vira um objeto por dia.
        const site = new Map();
        for (const r of siteRows) {
          const cur = site.get(r.day) || { view: 0, booking_click: 0, whatsapp_click: 0 };
          cur[r.kind] = int(r.events);
          site.set(r.day, cur);
        }

        // ⚠️ A LINHA DO ROLLUP (`day = null`) É O TOTAL DA JANELA, e ela sai
        // da série antes de tudo (ver `takeRollup`).
        const waTotal = takeRollup(waRows);
        const osTotal = takeRollup(osRows);

        const wa = byDay(waRows);
        const os = byDay(osRows);
        const book = byDay(bookRows);
        const mem = byDay(memberRows);
        const team = byDay(teamRows);
        const joins = byDay(joinRows);
        const fin = expandFinance(finRows, prevSince, today);

        /** Um dia inteiro, de todas as fontes — serve às duas janelas. */
        const dayPoint = (day) => {
          const s = site.get(day) || {};
          const w = wa.get(day) || {};
          const o = os.get(day) || {};
          const b = book.get(day) || {};
          const m = mem.get(day) || {};
          const tb = team.get(day) || {};
          const f = fin.byDay.get(day) || { in: 0, out: 0 };
          const platform = int(b.net_cents) + int(m.net_cents);
          const revenue = platform + f.in;
          return {
            day,
            views: int(s.view),
            booking_clicks: int(s.booking_click),
            whatsapp_clicks: int(s.whatsapp_click),
            whatsapp_people: int(w.people),
            whatsapp_messages: int(w.messages),
            os_people: int(o.people),
            os_messages: int(o.messages),
            bookings: int(b.bookings),
            site_bookings: int(b.valid),
            team_bookings: int(tb.valid),
            new_members: int((joins.get(day) || {}).joins),
            platform_revenue_cents: platform,
            manual_in_cents: f.in,
            revenue_cents: revenue,
            cost_cents: f.out,
            profit_cents: revenue - f.out,
          };
        };

        // ⚠️ A SÉRIE TEM TODOS OS DIAS, inclusive os vazios — senão o gráfico
        // encosta as barras e desenha uma semana cheia onde houve dois dias.
        const series = dayRange(today, days).map(dayPoint);
        const prevSeries = dayRange(prevUntil, days).map(dayPoint);

        const sum = (list, key) => list.reduce((acc, d) => acc + d[key], 0);

        // Os totais que ficam fora da série por dia.
        const nowRows = bookRows.filter((r) => inNow(String(r.day)));
        const memNowRows = memberRows.filter((r) => inNow(String(r.day)));
        const teamNow = teamRows.filter((r) => inNow(String(r.day)));

        const bookingsTotal = nowRows.reduce((a, r) => a + int(r.bookings), 0);
        const bookingsPaid = nowRows.reduce((a, r) => a + int(r.paid), 0);
        const siteValid = nowRows.reduce((a, r) => a + int(r.valid), 0);
        const bookingGross = nowRows.reduce((a, r) => a + int(r.gross_cents), 0);
        const bookingNet = nowRows.reduce((a, r) => a + int(r.net_cents), 0);
        const memberGross = memNowRows.reduce((a, r) => a + int(r.gross_cents), 0);
        const memberNet = memNowRows.reduce((a, r) => a + int(r.net_cents), 0);
        const memberPayments = memNowRows.reduce((a, r) => a + int(r.payments), 0);

        const waMessages = int(waTotal.messages);
        const osMessages = int(osTotal.messages);
        const waPeople = int(waTotal.people);
        const osPeople = int(osTotal.people);

        const revenueNow = sum(series, "revenue_cents");
        const costNow = sum(series, "cost_cents");
        const revenuePrev = sum(prevSeries, "revenue_cents");
        const costPrev = sum(prevSeries, "cost_cents");
        const profitNow = revenueNow - costNow;

        // ── os horários ──
        const heat = heatRows.map((r) => ({
          dow: int(r.dow),
          hour: int(r.hour),
          bookings: int(r.bookings),
        }));
        const topSlots = [...heat]
          .sort((a, b) => b.bookings - a.bookings || a.dow - b.dow || a.hour - b.hour)
          .slice(0, 3);
        const argmax = (key) => {
          const acc = new Map();
          for (const h of heat) acc.set(h[key], (acc.get(h[key]) || 0) + h.bookings);
          let best = null;
          for (const [k, v] of acc) if (!best || v > best.bookings) best = { [key]: k, bookings: v };
          return best;
        };

        return {
          range: {
            days,
            since,
            until: today,
            prev_since: prevSince,
            prev_until: prevUntil,
            windows: WINDOWS,
          },

          // ─── O RESULTADO ─────────────────────────────────────────────────
          // ⚠️ A receita é o que passou pela plataforma (líquido) MAIS o que o
          // líder lançou como entrada DESTE negócio na Vida Financeira; o
          // custo é só o que ele marcou como deste negócio (mig 261). Nada da
          // vida pessoal entra aqui.
          finance: {
            revenue_cents: revenueNow,
            platform_revenue_cents: sum(series, "platform_revenue_cents"),
            manual_in_cents: sum(series, "manual_in_cents"),
            cost_cents: costNow,
            profit_cents: profitNow,
            // Sem receita não existe margem — "-100%" num negócio que ainda não
            // vendeu nada leria como desastre, quando é só começo.
            margin_pct: revenueNow > 0 ? Math.round((profitNow / revenueNow) * 100) : null,
            prev: {
              revenue_cents: revenuePrev,
              cost_cents: costPrev,
              profit_cents: revenuePrev - costPrev,
            },
            fixed_monthly_cost_cents: fin.fixedOut,
            fixed_monthly_income_cents: fin.fixedIn,
            top_costs: fin.topCosts(since, today),
            has_entries: finRows.length > 0,
          },

          // ─── O FUNIL DO SITE ─────────────────────────────────────────────
          site: {
            scope: "community",
            views: sum(series, "views"),
            booking_clicks: sum(series, "booking_clicks"),
            whatsapp_clicks: sum(series, "whatsapp_clicks"),
            bookings: siteValid,
            paid: bookingsPaid,
            prev: {
              views: sum(prevSeries, "views"),
              booking_clicks: sum(prevSeries, "booking_clicks"),
              bookings: sum(prevSeries, "site_bookings"),
            },
          },

          // ─── A AGENDA DA EQUIPE ──────────────────────────────────────────
          bookings: {
            // `total`/`paid` seguem sendo o que nasceu PELO site (compat).
            scope: "community",
            total: bookingsTotal,
            paid: bookingsPaid,
            team: {
              // ⚠️ Escopo "equipe": quem atende em dois negócios tem a mesma
              // agenda nos dois (a agenda é da conta, mig 190).
              scope: "team",
              people: teamIds.length,
              valid: teamNow.reduce((a, r) => a + int(r.valid), 0),
              canceled: teamNow.reduce((a, r) => a + int(r.canceled), 0),
              no_show: teamNow.reduce((a, r) => a + int(r.no_show), 0),
              prev_valid: teamRows
                .filter((r) => inPrev(String(r.day)))
                .reduce((a, r) => a + int(r.valid), 0),
            },
            heat,
            top_slots: topSlots,
            best_weekday: argmax("dow"),
            best_hour: argmax("hour"),
          },

          // ─── A COMUNIDADE ────────────────────────────────────────────────
          members: {
            total: int(members.total),
            new: int(members.new_now),
            new_prev: int(members.new_prev),
            active: int(members.active),
            participants: int(members.participants),
          },

          leads: {
            // ⚠️ `scope: "account"` é a etiqueta que impede a tela de mentir:
            // estes dois blocos são do TELEFONE e da CAIXA da pessoa, não desta
            // comunidade (ver o cabeçalho do arquivo).
            scope: "account",
            people: waPeople + osPeople,
            messages: waMessages + osMessages,
            whatsapp: {
              connected: waStatus === "connected",
              status: waStatus,
              people: waPeople,
              messages: waMessages,
            },
            os: { people: osPeople, messages: osMessages },
          },

          revenue: {
            scope: "community",
            gross_cents: bookingGross + memberGross,
            net_cents: bookingNet + memberNet,
            sources: {
              bookings: { count: bookingsPaid, gross_cents: bookingGross, net_cents: bookingNet },
              memberships: { count: memberPayments, gross_cents: memberGross, net_cents: memberNet },
            },
          },

          series,
        };
      }
    );
  }
};
