// src/storages/ManagedSiteRequestStorage.js
// O PEDIDO DE SITE PRONTO (mig 243).
//
// O lado do CLIENTE da conversa que a mig 242 começou pelo nosso lado: ele
// aperta "Pedir site" e entra numa fila que só a plataforma lê. Nada aqui
// desenha nada — o pedido não carrega site, ele pede justamente o que ainda
// não existe.
//
// ⚠️ O PEDIDO SE FECHA QUANDO A OFERTA É CRIADA, na mesma transação
// (`ManagedSiteService.prepareOffer`). Fechar por um segundo clique deixaria a
// fila mostrando negócio já atendido; fechar antes da oferta existir apagaria
// o pedido se o INSERT dela falhasse.

const COLS = `id_request, id_profile, requested_by_user, note, status,
              created_at, updated_at, decided_at, decided_by_user`;

class ManagedSiteRequestStorage {
  /**
   * Existe um pedido esperando nesta comunidade?
   *
   * EXISTS, e não a linha: quem pergunta é o painel do cliente, para saber se
   * desenha o botão "Pedir site" ou o aviso de que o pedido já chegou. Mesma
   * disciplina do `hasPending` da oferta.
   */
  static async hasPending(conn, id_profile) {
    const r = await conn.query(
      `SELECT EXISTS (
                SELECT 1 FROM public.tb_managed_site_request
                 WHERE id_profile = $1 AND status = 'pending'
              ) AS has`,
      [id_profile]
    );
    return !!r.rows[0]?.has;
  }

  /** O pedido vivo desta comunidade, inteiro. */
  static async getPending(conn, id_profile) {
    const r = await conn.query(
      `SELECT ${COLS}
         FROM public.tb_managed_site_request
        WHERE id_profile = $1 AND status = 'pending'
        LIMIT 1`,
      [id_profile]
    );
    return r.rows[0] || null;
  }

  /**
   * Abre o pedido — ou devolve o que já estava aberto.
   *
   * ⚠️ `ON CONFLICT DO NOTHING` sobre o índice parcial, e o SELECT de resgate
   * logo abaixo: apertar duas vezes é o caso comum (ansiedade, dúvida se
   * funcionou), e o segundo clique tem que devolver "o seu pedido está na fila"
   * em vez de um 500 de violação de unicidade. A corrida entre duas abas cai no
   * mesmo caminho.
   *
   * ⚠️ NÃO atualiza a nota do pedido existente. A fila é lida por nós na ordem
   * de chegada, e reescrever o texto de um pedido que talvez já esteja aberto
   * na nossa tela trocaria o conteúdo debaixo de quem está lendo. Quem quer
   * dizer mais fala pelo suporte — e é conversa, não formulário.
   */
  static async open(conn, { id_profile, requestedBy, note }) {
    const r = await conn.query(
      `INSERT INTO public.tb_managed_site_request (id_profile, requested_by_user, note)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING ${COLS}`,
      [id_profile, requestedBy || null, note || null]
    );
    if (r.rows[0]) return { request: r.rows[0], created: true };

    const existing = await ManagedSiteRequestStorage.getPending(conn, id_profile);
    return { request: existing, created: false };
  }

  /**
   * A FILA — o que o painel da plataforma mostra.
   *
   * Mais ANTIGO primeiro: quem esperou mais é atendido antes. O JOIN traz o
   * nome do negócio e de quem pediu porque uma fila de UUIDs não é fila — para
   * saber de quem é cada linha seria preciso abrir uma por uma.
   *
   * `has_site` diz se aquele negócio já montou alguma coisa no construtor: é o
   * que decide se a conversão de canvas tem de onde partir, e é a primeira
   * coisa que se quer saber antes de abrir o caso.
   */
  static async listPending(conn, limit = 50) {
    const r = await conn.query(
      `SELECT rq.id_request,
              rq.id_profile,
              rq.note,
              rq.created_at,
              p.display_name        AS community_name,
              u.username            AS requested_by_username,
              (cs.id_profile IS NOT NULL)          AS has_site,
              COALESCE(cs.is_published, FALSE)     AS is_published,
              COALESCE(cs.managed_by_platform, FALSE) AS managed
         FROM public.tb_managed_site_request rq
         JOIN public.tb_profile p ON p.id_profile = rq.id_profile
         LEFT JOIN public.tb_user u ON u.id_user = rq.requested_by_user
         LEFT JOIN public.tb_community_site cs ON cs.id_profile = rq.id_profile
        WHERE rq.status = 'pending'
        ORDER BY rq.created_at ASC
        LIMIT $1`,
      [limit]
    );
    return r.rows;
  }

  /** Quantos esperam. É o número da bolinha, e ele não precisa das linhas. */
  static async countPending(conn) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_managed_site_request
        WHERE status = 'pending'`
    );
    return r.rows[0]?.n || 0;
  }

  /** O histórico de uma comunidade — o painel de admin mostra ao lado da oferta. */
  static async listForProfile(conn, id_profile, limit = 20) {
    const r = await conn.query(
      `SELECT rq.id_request, rq.id_profile, rq.note, rq.status,
              rq.created_at, rq.decided_at,
              u.username AS requested_by_username
         FROM public.tb_managed_site_request rq
         LEFT JOIN public.tb_user u ON u.id_user = rq.requested_by_user
        WHERE rq.id_profile = $1
        ORDER BY rq.created_at DESC
        LIMIT $2`,
      [id_profile, limit]
    );
    return r.rows;
  }

  /**
   * Fecha o pedido. Só sai de 'pending' — o WHERE é o que torna a decisão única
   * quando duas abas do admin apertam ao mesmo tempo.
   */
  static async decide(conn, id_request, status, decidedBy) {
    const r = await conn.query(
      `UPDATE public.tb_managed_site_request
          SET status = $2, decided_at = NOW(), updated_at = NOW(), decided_by_user = $3
        WHERE id_request = $1 AND status = 'pending'
       RETURNING ${COLS}`,
      [id_request, status, decidedBy || null]
    );
    return r.rows[0] || null;
  }

  /**
   * Fecha o pedido VIVO de uma comunidade, sem saber o id dele.
   *
   * É o que `prepareOffer` chama: quem reserva a oferta está respondendo ao
   * pedido daquele negócio, e não a um id que ele teria de carregar da tela até
   * o corpo da requisição. Devolve NULL quando não havia pedido — reservar sem
   * ninguém ter pedido é o caminho normal da venda ativa, não um erro.
   */
  static async answerPendingForProfile(conn, id_profile, decidedBy) {
    const r = await conn.query(
      `UPDATE public.tb_managed_site_request
          SET status = 'answered', decided_at = NOW(), updated_at = NOW(), decided_by_user = $2
        WHERE id_profile = $1 AND status = 'pending'
       RETURNING ${COLS}`,
      [id_profile, decidedBy || null]
    );
    return r.rows[0] || null;
  }
}

module.exports = ManagedSiteRequestStorage;
