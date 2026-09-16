// src/storages/WhatsappStorage.js
// SQL puro do WhatsApp do usuário (mig 223): a instância, as conversas e as
// mensagens.
//
// ─── A REGRA QUE ATRAVESSA O ARQUIVO INTEIRO ────────────────────────────────
//
// NENHUMA leitura de conversa ou mensagem aceita só o id dela: todas sobem até
// `tb_whatsapp_instance.id_user` e recebem o usuário como parâmetro. A caixa é
// de UMA pessoa e carrega conversa de terceiros que nunca ouviram falar da
// Freelandoo — um SELECT por id solto aqui seria a caixa de entrada de qualquer
// um servida a quem adivinhasse um UUID.
//
// ─── DEDUPE É DO BANCO, NÃO DO CÓDIGO ───────────────────────────────────────
//
// A Evolution reentrega o webhook quando a resposta demora, e o que sai daqui
// volta como eco do próprio WhatsApp. `insertMessage` usa ON CONFLICT DO
// NOTHING sobre `ux_whatsapp_message_wa_id` e devolve `null` quando a mensagem
// já existia — quem chama distingue "gravei" de "já tinha" pelo retorno, e não
// por um SELECT antes (que perderia a corrida entre duas entregas simultâneas).

class WhatsappStorage {
  /* ─────────────────────────────── instância ────────────────────────────── */

  static async getInstanceByUser(conn, id_user) {
    const r = await conn.query(
      `SELECT id_instance, id_user, provider, evolution_instance, waba_id,
              status, connected_number, quality_rating, number_status,
              last_state_at, last_seen_at, disconnect_reason, created_at
         FROM public.tb_whatsapp_instance
        WHERE id_user = $1
        LIMIT 1`,
      [id_user]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Pelo nome da instância — a CHAVE DE ROTEAMENTO do webhook. É esta consulta
   * que responde "de quem é esta mensagem?", e por isso ela devolve o `id_user`
   * junto: sem ele o evento não teria dono e a única saída seria adivinhar.
   */
  static async getInstanceByName(conn, evolution_instance) {
    const r = await conn.query(
      `SELECT id_instance, id_user, provider, evolution_instance, waba_id,
              status, connected_number
         FROM public.tb_whatsapp_instance
        WHERE evolution_instance = $1
        LIMIT 1`,
      [evolution_instance]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Busca a instância pelo par (provedor, referência) — a chave REAL desde a
   * mig 240.
   *
   * ⚠️ Não é o mesmo que `getInstanceByName`, e a diferença é de segurança.
   * Aquele consulta só `evolution_instance`, herdado de quando havia um
   * provedor só. Os dois espaços de id são diferentes — um nome derivado do
   * id_user × um `phone_number_id` numérico da Meta — e uma colisão entre eles
   * seria resolvida para a linha errada: a conversa de um cliente entregue na
   * caixa de outro, que é a falha que a mig 223 inteira existe para impedir.
   *
   * Todo webhook resolve o dono POR AQUI, passando o provedor de quem o chamou.
   */
  /**
   * Aponta a linha da pessoa para um número da Cloud API.
   *
   * ⚠️ É UM `UPDATE` NA LINHA EXISTENTE, e isso não é otimização — é o que
   * salva o histórico. As conversas pendem de `id_instance` com `ON DELETE
   * CASCADE`, e só existe UMA linha por usuário (`ux_whatsapp_instance_user`).
   * Apagar a linha da Evolution para inserir a da Cloud levaria junto TODA a
   * caixa de entrada da pessoa — sem erro, sem aviso, e sem volta. Por isso o
   * `ON CONFLICT (id_user) DO UPDATE`: o `id_instance` é preservado e as
   * conversas seguem penduradas nele, agora sob o provedor novo.
   *
   * Nasce em `connecting`: o número existe no WABA mas ainda não foi
   * confirmado por código. Quem promove para `connected` é o `confirmCode`.
   */
  static async upsertCloudInstance(conn, id_user, { ref, waba_id, number }) {
    const r = await conn.query(
      `INSERT INTO public.tb_whatsapp_instance
              (id_user, provider, evolution_instance, waba_id, status, connected_number)
            VALUES ($1, 'cloud', $2, NULLIF($3, ''), 'connecting', NULLIF($4, ''))
       ON CONFLICT (id_user) DO UPDATE
          SET provider           = 'cloud',
              evolution_instance = EXCLUDED.evolution_instance,
              waba_id            = EXCLUDED.waba_id,
              status             = 'connecting',
              connected_number   = EXCLUDED.connected_number,
              last_state_at      = NOW()
         RETURNING id_instance, id_user, provider, evolution_instance, waba_id,
                   status, connected_number`,
      [id_user, ref, waba_id || "", String(number || "").replace(/\D/g, "")]
    );
    return r.rows[0];
  }

  static async getInstanceByRef(conn, provider, evolution_instance) {
    const r = await conn.query(
      `SELECT id_instance, id_user, provider, evolution_instance, waba_id,
              status, connected_number
         FROM public.tb_whatsapp_instance
        WHERE provider = $1 AND evolution_instance = $2
        LIMIT 1`,
      [provider, evolution_instance]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Acha a instância PELO NÚMERO — o caminho dos eventos do W6.
   *
   * ⚠️ Os webhooks de qualidade e de conta NÃO trazem `phone_number_id`, só o
   * número em texto. Por isso a comparação é sobre DÍGITOS dos dois lados: o
   * que está gravado veio do cadastro (`5511968128174`) e o que chega pode vir
   * formatado (`+55 11 96812-8174`).
   *
   * ⚠️ O FALLBACK PELOS 8 ÚLTIMOS DÍGITOS existe por causa do nono dígito
   * brasileiro: a Meta devolve o número ora com ele, ora sem, e um match exato
   * perderia o evento silenciosamente — que é o pior resultado possível, porque
   * o sintoma é "o painel nunca mostra qualidade" sem um erro sequer.
   *
   * ⚠️ E o fallback só decide quando a resposta é ÚNICA. Dois números com o
   * mesmo final atribuiriam o apuro de um ao outro, e o aviso iria para a
   * pessoa errada. Ambíguo devolve `null`: ignorar é melhor que acusar quem não
   * fez nada.
   */
  static async getInstanceByNumber(conn, provider, digits) {
    const clean = String(digits || "").replace(/\D/g, "");
    if (!clean) return null;

    const exact = await conn.query(
      `SELECT id_instance, id_user, provider, evolution_instance, waba_id,
              status, connected_number, quality_rating, number_status
         FROM public.tb_whatsapp_instance
        WHERE provider = $1
          AND regexp_replace(COALESCE(connected_number, ''), '[^0-9]', '', 'g') = $2
        LIMIT 1`,
      [provider, clean]
    );
    if (exact.rowCount) return exact.rows[0];

    const tail = clean.slice(-8);
    if (tail.length < 8) return null;

    const loose = await conn.query(
      `SELECT id_instance, id_user, provider, evolution_instance, waba_id,
              status, connected_number, quality_rating, number_status
         FROM public.tb_whatsapp_instance
        WHERE provider = $1
          AND regexp_replace(COALESCE(connected_number, ''), '[^0-9]', '', 'g') LIKE $2
        LIMIT 2`,
      [provider, `%${tail}`]
    );
    return loose.rowCount === 1 ? loose.rows[0] : null;
  }

  /**
   * Grava o que se sabe sobre a saúde do número (colunas da mig 240).
   *
   * ⚠️ `null` NÃO SOBRESCREVE, e é o coração deste método: as duas fontes sabem
   * coisas diferentes. O webhook de qualidade afirma o STATUS e não manda
   * rating nenhum; o GET do número afirma os dois. Gravando `null` por cima, um
   * evento de webhook APAGARIA o rating que o GET tinha trazido, e o painel
   * ficaria vazio logo depois de um problema — exatamente quando ele importa.
   *
   * `quality_checked_at` é sempre carimbado: saber QUANDO foi a última notícia
   * é o que distingue "o número está bem" de "ninguém olha para ele há meses".
   */
  static async setQuality(conn, id_instance, { rating = null, status = null } = {}) {
    const r = await conn.query(
      `UPDATE public.tb_whatsapp_instance
          SET quality_rating    = COALESCE($2, quality_rating),
              number_status     = COALESCE($3, number_status),
              quality_checked_at = NOW()
        WHERE id_instance = $1
        RETURNING id_instance, id_user, connected_number, quality_rating, number_status`,
      [id_instance, rating, status]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * A lista do painel de admin. Traz o dono junto porque a pergunta que o
   * painel responde é "de QUEM é o número que está degradando" — sem isso
   * sobra um telefone solto e a conversa não acontece.
   *
   * Ordenada por gravidade, não por data: quem está vermelho tem que aparecer
   * primeiro mesmo que o evento seja antigo.
   */
  static async listForAdmin(conn, { limit = 200 } = {}) {
    const r = await conn.query(
      `SELECT i.id_instance, i.id_user, i.provider, i.evolution_instance,
              i.waba_id, i.status, i.connected_number, i.quality_rating,
              i.number_status, i.quality_checked_at, i.last_seen_at,
              i.created_at, u.username, u.nome AS user_name, u.email
         FROM public.tb_whatsapp_instance i
         JOIN public.tb_user u ON u.id_user = i.id_user
        ORDER BY CASE UPPER(COALESCE(i.quality_rating, ''))
                   WHEN 'RED' THEN 0
                   WHEN 'YELLOW' THEN 1
                   WHEN 'GREEN' THEN 3
                   ELSE 2
                 END,
                 i.created_at DESC
        LIMIT $1`,
      [limit]
    );
    return r.rows;
  }

  /**
   * Cria ou reaproveita a linha da pessoa. Idempotente pelo mesmo motivo que
   * `createInstance` da Evolution é: a tela chama isto toda vez que alguém pede
   * um QR, inclusive na reconexão.
   *
   * ⚠️ O UPDATE do conflito NÃO toca `status` nem `connected_number`: pedir um
   * QR novo não é perder a sessão que ainda pode estar de pé.
   */
  static async ensureInstance(conn, id_user, evolution_instance) {
    const r = await conn.query(
      `INSERT INTO public.tb_whatsapp_instance (id_user, evolution_instance)
            VALUES ($1, $2)
       ON CONFLICT (id_user)
       DO UPDATE SET evolution_instance = EXCLUDED.evolution_instance
         RETURNING id_instance, id_user, provider, evolution_instance, waba_id,
                   status, connected_number, last_state_at, created_at`,
      [id_user, evolution_instance]
    );
    return r.rows[0];
  }

  /**
   * Status da sessão. `connected_number` tem TRÊS intenções e por isso não é um
   * parâmetro simples:
   *   undefined → não mexe (o estado veio de uma fonte que não conhece o número)
   *   null      → limpa (desconectou)
   *   string    → grava
   */
  static async setInstanceStatus(conn, evolution_instance, status, connected_number, reason) {
    const touchNumber = connected_number !== undefined;
    // ⚠️ `clearReason` é calculado AQUI e não com `$2 = 'connected'` dentro do
    // CASE. O mesmo parâmetro usado numa coluna (varchar) e comparado com um
    // literal (text) faz o Postgres deduzir dois tipos para ele e recusar a
    // query inteira com 42P08 — a armadilha que as migs 202–204 já pagaram três
    // vezes. Este caso foi pego pela suíte, não pela produção.
    const clearReason = status === "connected";
    const r = await conn.query(
      `UPDATE public.tb_whatsapp_instance
          SET status = $2,
              connected_number = CASE WHEN $3::boolean THEN $4::varchar ELSE connected_number END,
              -- O motivo só vale enquanto está desligado: reconectar limpa,
              -- senão a tela continuaria explicando um corte já desfeito.
              disconnect_reason = CASE
                WHEN $6::boolean THEN NULL
                WHEN $5::varchar IS NOT NULL THEN $5::varchar
                ELSE disconnect_reason
              END,
              last_state_at = NOW()
        WHERE evolution_instance = $1
        RETURNING id_instance, id_user, provider, evolution_instance, waba_id,
                  status, connected_number, disconnect_reason`,
      [
        evolution_instance,
        status,
        touchNumber,
        touchNumber ? connected_number : null,
        reason || null,
        clearReason,
      ]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Marca que o DONO usou a caixa. Chamada nas leituras da aba.
   *
   * ⚠️ O `AND last_seen_at < NOW() - INTERVAL '1 hour'` não é economia de
   * escrita à toa: sem ele, cada abertura de conversa e cada volta do status
   * escreveria uma linha, e a tabela viraria um log de cliques. Uma hora de
   * resolução é folgada para uma janela medida em dias.
   */
  static async touchSeen(conn, id_user) {
    await conn.query(
      `UPDATE public.tb_whatsapp_instance
          SET last_seen_at = NOW()
        WHERE id_user = $1
          AND last_seen_at < NOW() - INTERVAL '1 hour'`,
      [id_user]
    );
  }

  /**
   * As sessões de pé que o dono não visita há mais de `days` dias.
   *
   * Só `status = 'connected'`: quem já está desligado não tem sessão custando
   * memória, e varrê-lo seria pedir um logout à Evolution para nada.
   */
  static async listIdleInstances(conn, days, limit = 200) {
    const r = await conn.query(
      `SELECT id_instance, id_user, provider, evolution_instance, last_seen_at
         FROM public.tb_whatsapp_instance
        WHERE status = 'connected'
          AND last_seen_at < NOW() - ($1 || ' days')::interval
        ORDER BY last_seen_at ASC
        LIMIT $2`,
      [String(days), limit]
    );
    return r.rows;
  }

  /* ─────────────────────────────── conversas ────────────────────────────── */

  /**
   * Garante a conversa daquele endereço. O `push_name` é atualizado quando
   * chega um valor melhor (COALESCE + NULLIF): o WhatsApp às vezes manda a
   * mensagem sem o nome de perfil, e sobrescrever com vazio faria o título da
   * conversa sumir no meio do papo.
   *
   * Em grupo quem chama passa `push_name` vazio de propósito — ali o nome do
   * evento é de quem escreveu, não do grupo.
   */
  static async ensureConversation(conn, { id_instance, remote_jid, phone, push_name, is_group }) {
    const r = await conn.query(
      `INSERT INTO public.tb_whatsapp_conversation
              (id_instance, remote_jid, phone, push_name, is_group)
            VALUES ($1, $2, $3, NULLIF($4, ''), $5)
       ON CONFLICT (id_instance, remote_jid)
       DO UPDATE SET push_name = COALESCE(NULLIF(EXCLUDED.push_name, ''),
                                          public.tb_whatsapp_conversation.push_name)
         RETURNING id_conversation, id_instance, remote_jid, phone, push_name, is_group,
                   unread_count, last_message_at, last_message_preview`,
      [id_instance, remote_jid, phone || "", push_name || "", !!is_group]
    );
    return r.rows[0];
  }

  static async listConversations(conn, id_user, { limit = 40, offset = 0, search = "" } = {}) {
    const params = [id_user, limit, offset];
    let filter = "";
    if (search) {
      params.push(`%${search}%`);
      filter = ` AND (c.push_name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`;
    }
    const r = await conn.query(
      `SELECT c.id_conversation, c.remote_jid, c.phone, c.push_name, c.is_group,
              c.unread_count, c.last_message_at, c.last_message_preview,
              -- A janela de 24h da Cloud API. Vem na LISTA, e não só ao abrir a
              -- conversa, porque a tela precisa saber antes de a pessoa clicar
              -- se aquela conversa ainda aceita resposta.
              c.service_window_expires_at
         FROM public.tb_whatsapp_conversation c
         JOIN public.tb_whatsapp_instance i ON i.id_instance = c.id_instance
        WHERE i.id_user = $1${filter}
        ORDER BY c.last_message_at DESC
        LIMIT $2 OFFSET $3`,
      params
    );
    return r.rows;
  }

  /** Conversa + dono. O `id_user` no WHERE é o guard, não um filtro de conforto. */
  static async getConversation(conn, id_user, id_conversation) {
    const r = await conn.query(
      `SELECT c.id_conversation, c.id_instance, c.remote_jid, c.phone, c.push_name,
              c.is_group, c.unread_count, c.last_message_at,
              c.last_message_preview, c.service_window_expires_at,
              i.provider, i.evolution_instance, i.waba_id,
              i.status AS instance_status
         FROM public.tb_whatsapp_conversation c
         JOIN public.tb_whatsapp_instance i ON i.id_instance = c.id_instance
        WHERE c.id_conversation = $1 AND i.id_user = $2
        LIMIT 1`,
      [id_conversation, id_user]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Move a conversa para o topo e guarda a prévia. `inc_unread` só é verdade
   * para o que CHEGA — o eco do que a própria pessoa mandou pelo celular dela
   * não pode acender um "não lida" contra ela mesma.
   */
  static async touchConversation(
    conn,
    id_conversation,
    { preview, sent_at, inc_unread, service_window_expires_at = null }
  ) {
    await conn.query(
      `UPDATE public.tb_whatsapp_conversation
          SET last_message_preview = LEFT($2, 300),
              -- GREATEST: o webhook pode reentregar fora de ordem, e uma
              -- mensagem antiga não pode puxar a conversa para trás na lista.
              last_message_at = GREATEST(last_message_at, $3::timestamptz),
              unread_count = unread_count + CASE WHEN $4::boolean THEN 1 ELSE 0 END,
              -- A janela de 24h da Cloud API (mig 240). GREATEST resolve as
              -- DUAS coisas de uma vez, e por uma propriedade do Postgres que
              -- vale a pena saber: ele IGNORA NULL na lista.
              --
              --   • Evolution passa NULL e a coluna fica intocada — lá a janela
              --     não existe, e zerá-la faria a tela recusar um envio que o
              --     provedor aceitaria;
              --   • reentrega fora de ordem não ENCURTA a janela: uma mensagem
              --     antiga reentregue traria um vencimento menor, e sem o
              --     GREATEST ela fecharia uma janela que ainda está de pé.
              service_window_expires_at =
                GREATEST(service_window_expires_at, $5::timestamptz)
        WHERE id_conversation = $1`,
      [
        id_conversation,
        String(preview || ""),
        sent_at,
        !!inc_unread,
        service_window_expires_at,
      ]
    );
  }

  static async markRead(conn, id_user, id_conversation) {
    const r = await conn.query(
      `UPDATE public.tb_whatsapp_conversation c
          SET unread_count = 0
         FROM public.tb_whatsapp_instance i
        WHERE c.id_instance = i.id_instance
          AND c.id_conversation = $1
          AND i.id_user = $2
        RETURNING c.id_conversation`,
      [id_conversation, id_user]
    );
    return r.rowCount > 0;
  }

  static async unreadTotal(conn, id_user) {
    const r = await conn.query(
      `SELECT COALESCE(SUM(c.unread_count), 0)::int AS total
         FROM public.tb_whatsapp_conversation c
         JOIN public.tb_whatsapp_instance i ON i.id_instance = c.id_instance
        WHERE i.id_user = $1`,
      [id_user]
    );
    return r.rows[0].total;
  }

  /* ─────────────────────────────── mensagens ────────────────────────────── */

  /** `null` quando a mensagem já existia (eco ou reentrega) — não é erro. */
  static async insertMessage(
    conn,
    { id_conversation, wa_message_id, direction, sender_label, body, media_type, sent_at }
  ) {
    const r = await conn.query(
      `INSERT INTO public.tb_whatsapp_message
              (id_conversation, wa_message_id, direction, sender_label, body, media_type, sent_at)
            VALUES ($1, NULLIF($2, ''), $3, NULLIF($4, ''), $5, $6, $7)
       ON CONFLICT (id_conversation, wa_message_id) WHERE wa_message_id IS NOT NULL
       DO NOTHING
         RETURNING id_message, wa_message_id, direction, sender_label, body, media_type, sent_at`,
      [
        id_conversation,
        wa_message_id || "",
        direction,
        sender_label || "",
        String(body || ""),
        media_type || "text",
        sent_at,
      ]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Página da conversa, da mais nova para a mais velha (é assim que se pagina
   * um chat), invertida no fim para a tela desenhar na ordem de leitura.
   */
  static async listMessages(conn, id_conversation, { limit = 50, before = null } = {}) {
    const params = [id_conversation, limit];
    let cursor = "";
    if (before) {
      params.push(before);
      cursor = ` AND sent_at < $${params.length}`;
    }
    const r = await conn.query(
      `SELECT id_message, wa_message_id, direction, sender_label, body, media_type, sent_at
         FROM public.tb_whatsapp_message
        WHERE id_conversation = $1${cursor}
        ORDER BY sent_at DESC
        LIMIT $2`,
      params
    );
    return r.rows.reverse();
  }

  /** Uma mensagem específica, com o dono junto — usada para baixar a mídia. */
  static async getMessage(conn, id_user, id_message) {
    const r = await conn.query(
      `SELECT m.id_message, m.wa_message_id, m.media_type, m.body,
              c.id_conversation, i.provider, i.evolution_instance, i.waba_id
         FROM public.tb_whatsapp_message m
         JOIN public.tb_whatsapp_conversation c ON c.id_conversation = m.id_conversation
         JOIN public.tb_whatsapp_instance i ON i.id_instance = c.id_instance
        WHERE m.id_message = $1 AND i.id_user = $2
        LIMIT 1`,
      [id_message, id_user]
    );
    return r.rowCount ? r.rows[0] : null;
  }
}

module.exports = WhatsappStorage;
