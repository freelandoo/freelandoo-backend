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
