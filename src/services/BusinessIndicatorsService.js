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

  /** O painel inteiro: leads, site, agendamentos e faturamento. */
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
        const today = await BusinessIndicatorsStorage.today(pool);
        const since = shiftDay(today, days - 1);

        // As cinco fontes são independentes: em série, a tela esperaria a soma
        // dos cinco tempos para mostrar um painel só.
        const [siteRows, waRows, osRows, bookRows, memberRows, waStatus] =
          await Promise.all([
            BusinessIndicatorsStorage.siteEvents(pool, id_profile, since),
            BusinessIndicatorsStorage.whatsappLeads(pool, id_user, since),
            BusinessIndicatorsStorage.osLeads(pool, id_user, since),
            BusinessIndicatorsStorage.bookingsByOrigin(pool, id_profile, since),
            BusinessIndicatorsStorage.membershipRevenue(pool, id_profile, since),
            BusinessIndicatorsStorage.whatsappStatus(pool, id_user),
          ]);

        // O contador do site vem por (dia, tipo) — vira um objeto por dia.
        const site = new Map();
        for (const r of siteRows) {
          const cur = site.get(r.day) || { view: 0, booking_click: 0, whatsapp_click: 0 };
          cur[r.kind] = int(r.events);
          site.set(r.day, cur);
        }

        // ⚠️ A LINHA DO ROLLUP (`day = null`) É O TOTAL DA JANELA, e ela sai
        // da série antes de tudo: deixá-la lá viraria um ponto extra no
        // gráfico, com o valor do período inteiro, ao lado dos dias.
        const waTotal = takeRollup(waRows);
        const osTotal = takeRollup(osRows);

        const wa = byDay(waRows);
        const os = byDay(osRows);
        const book = byDay(bookRows);
        const mem = byDay(memberRows);

        // ⚠️ A SÉRIE TEM TODOS OS DIAS, inclusive os vazios. Devolver só os
        // dias com movimento faria o gráfico encostar as barras umas nas
        // outras e desenhar uma semana cheia onde houve dois dias de procura.
        const series = dayRange(today, days).map((day) => {
          const s = site.get(day) || {};
          const w = wa.get(day) || {};
          const o = os.get(day) || {};
          const b = book.get(day) || {};
          const m = mem.get(day) || {};
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
            revenue_cents: int(b.net_cents) + int(m.net_cents),
          };
        });

        const sum = (key) => series.reduce((acc, d) => acc + d[key], 0);

        const bookingsTotal = bookRows.reduce((a, r) => a + int(r.bookings), 0);
        const bookingsPaid = bookRows.reduce((a, r) => a + int(r.paid), 0);
        const bookingGross = bookRows.reduce((a, r) => a + int(r.gross_cents), 0);
        const bookingNet = bookRows.reduce((a, r) => a + int(r.net_cents), 0);
        const memberGross = memberRows.reduce((a, r) => a + int(r.gross_cents), 0);
        const memberNet = memberRows.reduce((a, r) => a + int(r.net_cents), 0);
        const memberPayments = memberRows.reduce((a, r) => a + int(r.payments), 0);

        const waMessages = int(waTotal.messages);
        const osMessages = int(osTotal.messages);
        const waPeople = int(waTotal.people);
        const osPeople = int(osTotal.people);
        const views = sum("views");
        const bookingClicks = sum("booking_clicks");
        const whatsappClicks = sum("whatsapp_clicks");

        return {
          range: { days, since, until: today, windows: WINDOWS },

          leads: {
            // ⚠️ `scope: "account"` é a etiqueta que impede a tela de mentir:
            // estes dois blocos são do TELEFONE e da CAIXA da pessoa, não desta
            // comunidade (ver o cabeçalho do arquivo).
            scope: "account",
            // O NÚMERO GRANDE É GENTE, não mensagem: cinco mensagens de um
            // cliente são um lead, e é `people` que responde "quantos me
            // procuraram". As mensagens ficam ao lado, como volume de conversa.
            //
            // Os dois canais são somados sem cruzar: quem mandou zap E abriu
            // uma O.S. conta duas vezes. Cruzá-los não é possível — a mensagem
            // do WhatsApp chega de um telefone, não de uma conta daqui — e a
            // tela mostra a quebra por canal justamente para que o total nunca
            // precise ser lido como "pessoas diferentes".
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

          site: {
            scope: "community",
            views,
            booking_clicks: bookingClicks,
            whatsapp_clicks: whatsappClicks,
          },

          bookings: {
            scope: "community",
            total: bookingsTotal,
            paid: bookingsPaid,
          },

          revenue: {
            scope: "community",
            // O que a PLATAFORMA processou para este negócio. Não é o
            // faturamento da empresa: o sinal do agendamento é uma parte do
            // preço (o resto é pago no balcão) e a venda feita fora daqui não
            // passa por nós. A tela diz isso — prometer "faturamento total"
            // seria a mentira mais fácil deste painel.
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
