// src/storages/BusinessIndicatorsStorage.js
//
// As consultas dos INDICADORES DO NEGÓCIO (mig 235).
//
// ─── O FUSO É UM SÓ, E ELE É DE SÃO PAULO ───────────────────────────────────
//
// Todo número desta tela é "por dia", e cinco fontes diferentes respondem à
// mesma pergunta. Se cada uma escolhesse o próprio fuso, o gráfico mostraria a
// visita de sexta à noite no sábado e a mensagem da mesma hora na sexta — duas
// curvas que não se encontram, sem erro nenhum aparecer. `TZ` é a constante que
// as amarra, e é o mesmo fuso com que a mig 235 grava o contador do site.
//
// ⚠️ CADA CONSULTA TEM DOIS CORTES DE DATA, e eles NÃO são redundantes:
//   • o WHERE compara a coluna `timestamptz` com um instante (`$n::date AT TIME
//     ZONE ...`), que é a forma que o índice sabe usar;
//   • o GROUP BY converte para o dia LOCAL, que é o balde que a tela desenha.
// Fazer o WHERE também pela conversão desligaria o índice numa tabela de
// mensagens que cresce para sempre.

const TZ = "America/Sao_Paulo";

/**
 * O que conta como AGENDAMENTO de verdade (2026-09-25).
 *
 * `pending_payment` e `expired` são checkouts abertos e abandonados — a
 * pessoa escolheu um horário e não pagou. Contá-los faria o painel anunciar
 * agenda cheia num dia em que ninguém marcou nada. `confirmed` cobre o pago e o
 * "pagar no balcão" (mig 244); `completed` e `no_show` já passaram pela agenda.
 * O cancelado é contado à parte, porque também é informação.
 */
const VALID_BOOKING = `b.status IN ('confirmed', 'completed', 'no_show')`;

/** O dia local, no formato que o resto da casa fala. */
const LOCAL_DAY = `(NOW() AT TIME ZONE '${TZ}')::date`;
/** Um `timestamptz` a partir do dia local — o corte sargable do WHERE. */
const DAY_START = (p) => `(${p}::date AT TIME ZONE '${TZ}')`;
/** O dia local de uma coluna `timestamptz` — o balde do GROUP BY. */
const DAY_OF = (col) => `((${col} AT TIME ZONE '${TZ}')::date)`;

class BusinessIndicatorsStorage {
  /**
   * Hoje, em São Paulo. É daqui que o service conta a janela para trás.
   *
   * ⚠️ `::text` e não a data crua: o driver converte `date` para um `Date` de
   * JavaScript à meia-noite do fuso de QUEM RODA O NODE — o servidor está em
   * UTC, então a data voltaria deslocada um dia ao ser formatada. Todo dia
   * neste módulo é uma string `AAAA-MM-DD`, do banco até a tela.
   */
  static async today(conn) {
    const r = await conn.query(`SELECT ${LOCAL_DAY}::text AS day`);
    return r.rows[0].day;
  }

  // ───────────────────────── o site (mig 235) ───────────────────────────────

  /**
   * Soma 1 ao contador do dia.
   *
   * ⚠️ O `EXISTS` é a trava desta porta, e ela roda na MESMA instrução: quem
   * chama é um POST anônimo, e sem ele qualquer um escreveria linhas para
   * qualquer UUID — inflando o painel de um negócio que nunca soube. Só conta
   * comunidade de NEGÓCIO com site PUBLICADO, que é a única que tem um site
   * para alguém visitar.
   *
   * Uma instrução só também significa uma ida ao banco por evento: conferir
   * antes com um SELECT dobraria o custo da porta mais chamada da feature.
   *
   * Devolve `true` quando gravou — é o que deixa a rota recusar um id que não é
   * de site nenhum sem uma segunda consulta.
   */
  static async recordSiteEvent(conn, id_profile, kind) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_site_event_daily (id_profile, day, kind, events)
       SELECT p.id_profile, ${LOCAL_DAY}, $2::varchar, 1
         FROM public.tb_profile p
        WHERE p.id_profile = $1
          AND p.is_community = TRUE
          AND p.deleted_at IS NULL
          AND p.community_kind = 'common'
          AND EXISTS (SELECT 1
                        FROM public.tb_community_site cs
                       WHERE cs.id_profile = p.id_profile
                         AND cs.is_published = TRUE)
       ON CONFLICT (id_profile, day, kind) DO UPDATE
          SET events = public.tb_community_site_event_daily.events + 1,
              updated_at = NOW()
       RETURNING events`,
      [id_profile, kind]
    );
    return r.rowCount > 0;
  }

  /** As linhas do período, cruas: um registro por (dia, tipo). */
  static async siteEvents(conn, id_profile, since_day) {
    const r = await conn.query(
      `SELECT day::text AS day, kind, events
         FROM public.tb_community_site_event_daily
        WHERE id_profile = $1
          AND day >= $2::date
        ORDER BY day`,
      [id_profile, since_day]
    );
    return r.rows;
  }

  // ───────────────────────────── leads ──────────────────────────────────────

  /**
   * Leads do WhatsApp: o que CHEGOU no número do líder (mig 223).
   *
   * ⚠️ GRUPO NÃO É LEAD, e é por isso que `is_group = FALSE` está aqui. O
   * WhatsApp de quem trabalha também tem o grupo da família e o do condomínio;
   * contá-los faria o indicador subir num domingo em que ninguém procurou o
   * negócio — e número que sobe sozinho é número que se aprende a ignorar.
   *
   * ⚠️ SÓ `direction = 'in'`. A conversa guarda os dois lados (o eco do que a
   * pessoa responde pelo próprio celular entra como 'out'), e somar tudo faria
   * o líder gerar os próprios leads ao responder.
   *
   * Devolve DUAS contagens de propósito: `people` (conversas distintas) é
   * quanta gente procurou, `messages` é quanto se falou. Uma só responderia
   * metade da pergunta — dez mensagens de um cliente não são dez clientes.
   *
   * ⚠️ O `ROLLUP` devolve, além dos dias, UMA linha com `day = NULL`: o total
   * da janela. Ela não é um luxo — PESSOA NÃO SE SOMA POR DIA. Quem escreveu
   * segunda e quarta é uma pessoa só, e somar a série diria duas. O distinto
   * da janela inteira só pode ser contado pelo banco, e o ROLLUP o traz na
   * mesma varredura, sem uma segunda consulta.
   */
  static async whatsappLeads(conn, id_user, since_day) {
    const r = await conn.query(
      `SELECT ${DAY_OF("m.sent_at")}::text            AS day,
              COUNT(DISTINCT c.id_conversation)::int  AS people,
              COUNT(*)::int                           AS messages
         FROM public.tb_whatsapp_message m
         JOIN public.tb_whatsapp_conversation c ON c.id_conversation = m.id_conversation
         JOIN public.tb_whatsapp_instance i     ON i.id_instance = c.id_instance
        WHERE i.id_user = $1
          AND c.is_group = FALSE
          AND m.direction = 'in'
          AND m.sent_at >= ${DAY_START("$2")}
        GROUP BY ROLLUP(${DAY_OF("m.sent_at")})
        ORDER BY 1 NULLS FIRST`,
      [id_user, since_day]
    );
    return r.rows;
  }

  /**
   * Leads da O.S.: o que o CLIENTE escreveu nas solicitações que os perfis
   * desta conta atenderam — serviço (mig 023) e produto (135) juntos.
   *
   * ⚠️ SÓ O LADO *PRO*. A aba Solicitações mostra quatro listas, e duas delas
   * são a conta como COMPRADORA (`/me/chats`). Somá-las transformaria em lead
   * a mensagem que um fornecedor mandou PARA o líder — lead ao contrário.
   *
   * ⚠️ `sender = 'USER'` é a outra metade da mesma regra: a coluna diz de que
   * lado da conversa veio a linha, e sem o filtro a resposta do próprio líder
   * contaria como procura.
   *
   * As duas fontes entram num UNION ALL e não em duas consultas porque o que a
   * tela mostra é UM número de O.S.: separá-las aqui obrigaria quem lê a somar,
   * e somar em dois lugares é como os dois passam a discordar.
   */
  static async osLeads(conn, id_user, since_day) {
    const r = await conn.query(
      `WITH msgs AS (
         SELECT sm.created_at, r.id_response::text AS thread
           FROM public.tb_service_request_message sm
           JOIN public.tb_service_request_response r ON r.id_response = sm.id_response
           JOIN public.tb_profile p ON p.id_profile = r.id_profile
          WHERE p.id_user = $1
            AND sm.sender = 'USER'
            AND sm.created_at >= ${DAY_START("$2")}
          UNION ALL
         SELECT pm.created_at, pr.id_response::text AS thread
           FROM public.tb_product_request_message pm
           JOIN public.tb_product_request_response pr ON pr.id_response = pm.id_response
          WHERE pr.id_seller_user = $1
            AND pm.sender = 'USER'
            AND pm.created_at >= ${DAY_START("$2")}
       )
       SELECT ${DAY_OF("created_at")}::text   AS day,
              COUNT(DISTINCT thread)::int     AS people,
              COUNT(*)::int                   AS messages
         FROM msgs
        GROUP BY ROLLUP(${DAY_OF("created_at")})
        ORDER BY 1 NULLS FIRST`,
      [id_user, since_day]
    );
    return r.rows;
  }

  // ────────────────────── agendamento e faturamento ─────────────────────────

  /**
   * Os agendamentos que nasceram NESTE site (a coluna da mig 227).
   *
   * É o elo que fecha o funil: visualização → clique → agendamento. Um
   * agendamento feito pelo perfil do profissional, fora do site, tem
   * `id_origin_community` nulo e fica de fora — não foi este negócio que o
   * trouxe, e contá-lo faria a conversão do site subir sozinha.
   *
   * `paid` é a régua do dinheiro (`payment_status`), não do status da agenda:
   * um agendamento cancelado depois de pago FOI faturado, e um confirmado sem
   * pagamento não foi.
   */
  static async bookingsByOrigin(conn, id_profile, since_day) {
    const r = await conn.query(
      `SELECT ${DAY_OF("b.created_at")}::text AS day,
              COUNT(*)::int                   AS bookings,
              COUNT(*) FILTER (WHERE ${VALID_BOOKING})::int AS valid,
              COUNT(*) FILTER (WHERE b.payment_status = 'paid')::int AS paid,
              COALESCE(SUM(b.deposit_amount)
                FILTER (WHERE b.payment_status = 'paid'), 0)::bigint AS gross_cents,
              COALESCE(SUM(b.professional_amount)
                FILTER (WHERE b.payment_status = 'paid'), 0)::bigint AS net_cents
         FROM public.tb_profile_bookings b
        WHERE b.id_origin_community = $1
          AND b.created_at >= ${DAY_START("$2")}
        GROUP BY 1
        ORDER BY 1`,
      [id_profile, since_day]
    );
    return r.rows;
  }

  /**
   * Mensalidade de membros (mig 173) — a outra receita que é DESTA comunidade.
   *
   * `revertido` fica de fora: é o estorno, e faturamento estornado não é
   * faturamento. Os outros três estados entram porque o dinheiro entrou — o
   * que muda entre eles é quando ele fica disponível para saque, que é
   * pergunta da Carteira, não daqui.
   */
  static async membershipRevenue(conn, id_profile, since_day) {
    const r = await conn.query(
      `SELECT ${DAY_OF("created_at")}::text AS day,
              COUNT(*)::int                 AS payments,
              COALESCE(SUM(gross_cents), 0)::bigint AS gross_cents,
              COALESCE(SUM(net_cents), 0)::bigint   AS net_cents
         FROM public.tb_community_member_payment
        WHERE id_community_profile = $1
          AND status <> 'revertido'
          AND created_at >= ${DAY_START("$2")}
        GROUP BY 1
        ORDER BY 1`,
      [id_profile, since_day]
    );
    return r.rows;
  }

  /**
   * Os agendamentos da EQUIPE, por dia de criação — o total do negócio, e não
   * só o que veio pelo site.
   *
   * A equipe é o líder mais quem ele promoveu (mig 221), e o agendamento é
   * achado pelo DONO da agenda (`profile_owner_user_id`): a agenda é da conta
   * (mig 190), então o cliente pode ter marcado por qualquer perfil da pessoa.
   * O `OR id_origin_community` segura o que veio pelo site de alguém que já
   * saiu da equipe — ele foi trazido por este negócio.
   *
   * ⚠️ Escopo "equipe", não "negócio": quem atende em dois negócios tem a mesma
   * agenda nos dois, e a tela diz isso (como diz dos leads).
   */
  static async teamBookingsDaily(conn, userIds, id_profile, since_day) {
    const r = await conn.query(
      `SELECT ${DAY_OF("b.created_at")}::text AS day,
              COUNT(*) FILTER (WHERE ${VALID_BOOKING})::int AS valid,
              COUNT(*) FILTER (WHERE b.status = 'canceled')::int  AS canceled,
              COUNT(*) FILTER (WHERE b.status = 'no_show')::int   AS no_show
         FROM public.tb_profile_bookings b
        WHERE (b.profile_owner_user_id = ANY($1::uuid[]) OR b.id_origin_community = $2)
          AND b.created_at >= ${DAY_START("$3")}
        GROUP BY 1
        ORDER BY 1`,
      [userIds, id_profile, since_day]
    );
    return r.rows;
  }

  /**
   * O MAPA DOS HORÁRIOS: quantos agendamentos caem em cada (dia da semana,
   * hora) — é daqui que saem os "melhores horários".
   *
   * Conta a hora MARCADA (`booking_date` + `start_time`), não a hora em que o
   * cliente apertou o botão: a pergunta é "quando a cadeira enche", e o
   * clique às 23h de um horário para terça 10h é um agendamento das 10h.
   * O recorte é pela data marcada dentro da janela, até hoje.
   *
   * `ISODOW`: 1 = segunda … 7 = domingo.
   */
  static async teamBookingHeat(conn, userIds, id_profile, since_day, until_day) {
    const r = await conn.query(
      `SELECT EXTRACT(ISODOW FROM b.booking_date)::int AS dow,
              EXTRACT(HOUR FROM b.start_time)::int     AS hour,
              COUNT(*)::int                            AS bookings
         FROM public.tb_profile_bookings b
        WHERE (b.profile_owner_user_id = ANY($1::uuid[]) OR b.id_origin_community = $2)
          AND ${VALID_BOOKING}
          AND b.booking_date >= $3::date
          AND b.booking_date <= $4::date
        GROUP BY 1, 2`,
      [userIds, id_profile, since_day, until_day]
    );
    return r.rows;
  }

  /**
   * A COMUNIDADE: quantos membros, quantos chegaram, quantos estão vivos.
   *
   * "Ativo" é quem APARECEU na plataforma na janela (`tb_user.last_seen_at`,
   * mig 228, batida de 5 min) — e "participou" é quem PUBLICOU no mural desta
   * comunidade (post ou recado, mig 160/162). São duas perguntas: a primeira diz
   * se o membro ainda existe, a segunda se esta comunidade o faz falar.
   *
   * `since` e `prev` na mesma consulta: os novos do período anterior são o
   * que dá sentido à seta de "subiu/desceu".
   */
  static async members(conn, id_profile, since_day, prev_day) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE m.joined_at >= ${DAY_START("$2")})::int AS new_now,
              COUNT(*) FILTER (WHERE m.joined_at >= ${DAY_START("$3")}
                                 AND m.joined_at <  ${DAY_START("$2")})::int AS new_prev,
              COUNT(*) FILTER (WHERE u.last_seen_at >= ${DAY_START("$2")})::int AS active,
              (SELECT COUNT(DISTINCT f.id_author_user)::int
                 FROM public.tb_community_feed_item f
                WHERE f.id_community_profile = $1
                  AND f.id_author_user IS NOT NULL
                  AND f.created_at >= ${DAY_START("$2")}) AS participants
         FROM public.tb_community_member m
         JOIN public.tb_user u ON u.id_user = m.id_user
        WHERE m.id_community_profile = $1`,
      [id_profile, since_day, prev_day]
    );
    return r.rows[0] || { total: 0, new_now: 0, new_prev: 0, active: 0, participants: 0 };
  }

  /** Quem entrou, por dia — a curva de crescimento da comunidade. */
  static async memberJoinsDaily(conn, id_profile, since_day) {
    const r = await conn.query(
      `SELECT ${DAY_OF("joined_at")}::text AS day, COUNT(*)::int AS joins
         FROM public.tb_community_member
        WHERE id_community_profile = $1
          AND joined_at >= ${DAY_START("$2")}
        GROUP BY 1`,
      [id_profile, since_day]
    );
    return r.rows;
  }

  /**
   * O WhatsApp está ligado? A tela precisa separar "ninguém te procurou" de
   * "você não conectou o número" — o primeiro é um resultado, o segundo é uma
   * pendência, e um zero cru diria os dois ao mesmo tempo.
   */
  static async whatsappStatus(conn, id_user) {
    const r = await conn.query(
      `SELECT status
         FROM public.tb_whatsapp_instance
        WHERE id_user = $1
        LIMIT 1`,
      [id_user]
    );
    return r.rowCount ? r.rows[0].status : null;
  }
}

module.exports = BusinessIndicatorsStorage;
