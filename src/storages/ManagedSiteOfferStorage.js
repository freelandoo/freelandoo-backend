// src/storages/ManagedSiteOfferStorage.js
// A OFERTA DO SITE PRONTO (mig 242).
//
// O site que nós escrevemos e deixamos reservado para uma comunidade, esperando
// o cliente aceitar. Enquanto ele não aceita, ISTO NÃO É O SITE DELE: nada aqui
// é lido por rota pública nenhuma, e o endereço continua desenhando o que
// desenhava.
//
// ⚠️ QUEM COPIA DAQUI PARA `tb_community_site` É O ACEITE, e o conteúdo que ele
// copia veio de uma porta de admin. É essa separação que mantém as três travas
// da mig 241 inteiras — ver o cabeçalho de `utils/managedSite.js`.

const COLS = `id_offer, id_profile, template, template_data, note, status,
              created_by_user, created_at, updated_at, decided_at`;

class ManagedSiteOfferStorage {
  /** A oferta viva de uma comunidade, se houver. No máximo uma (índice parcial). */
  static async getPending(conn, id_profile) {
    const r = await conn.query(
      `SELECT ${COLS}
         FROM public.tb_managed_site_offer
        WHERE id_profile = $1 AND status = 'pending'
        LIMIT 1`,
      [id_profile]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * A oferta que o cliente está aceitando — pinada no id que ele viu.
   *
   * ⚠️ O `id_profile` entra no WHERE junto do id: sem ele, um id de oferta de
   * OUTRA comunidade aplicaria o site de um cliente no endereço de outro. O id
   * chega pelo corpo da requisição, e corpo é o que o cliente afirma.
   *
   * `status = 'pending'` fecha a última porta: oferta já aceita ou retirada não
   * volta a ser aplicada por um clique atrasado numa aba esquecida aberta.
   */
  static async getPendingById(conn, id_profile, id_offer) {
    const r = await conn.query(
      `SELECT ${COLS}
         FROM public.tb_managed_site_offer
        WHERE id_offer = $1 AND id_profile = $2 AND status = 'pending'
        LIMIT 1`,
      [id_offer, id_profile]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /** A oferta aplicada hoje — é ela que o cliente reabre ao devolver o site. */
  static async getAccepted(conn, id_profile) {
    const r = await conn.query(
      `SELECT ${COLS}
         FROM public.tb_managed_site_offer
        WHERE id_profile = $1 AND status = 'accepted'
        ORDER BY decided_at DESC NULLS LAST
        LIMIT 1`,
      [id_profile]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * O histórico de uma comunidade — o que o painel de admin mostra.
   *
   * Sem `template_data`: a lista mostra o que foi oferecido e quando, e trazer
   * o documento inteiro de cada revisão faria uma tela de resumo transferir
   * centenas de KB para escrever quatro datas.
   */
  static async listForProfile(conn, id_profile, limit = 20) {
    const r = await conn.query(
      `SELECT o.id_offer, o.template, o.note, o.status, o.created_at,
              o.updated_at, o.decided_at, u.username AS created_by_username
         FROM public.tb_managed_site_offer o
         LEFT JOIN public.tb_user u ON u.id_user = o.created_by_user
        WHERE o.id_profile = $1
        ORDER BY o.created_at DESC
        LIMIT $2`,
      [id_profile, limit]
    );
    return r.rows;
  }

  /**
   * Retira a pendente (se houver) e grava a oferta nova, num gesto só.
   *
   * ⚠️ OS DOIS PASSOS VÃO NA MESMA TRANSAÇÃO por causa do índice parcial: entre
   * o UPDATE e o INSERT existe um instante em que duas ofertas seriam
   * 'pending', e é exatamente o que o índice recusa. Fora de transação, a
   * revisão falharia — e falharia depois de já ter retirado a anterior,
   * deixando o cliente sem oferta nenhuma.
   *
   * `conn` PRECISA ser um cliente em transação; quem chama abre a dele.
   */
  static async create(conn, { id_profile, template, templateData, note, createdBy }) {
    await conn.query(
      `UPDATE public.tb_managed_site_offer
          SET status = 'withdrawn', decided_at = NOW(), updated_at = NOW()
        WHERE id_profile = $1 AND status = 'pending'`,
      [id_profile]
    );
    const r = await conn.query(
      `INSERT INTO public.tb_managed_site_offer
              (id_profile, template, template_data, note, created_by_user)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       RETURNING ${COLS}`,
      [id_profile, template, JSON.stringify(templateData || {}), note || null, createdBy || null]
    );
    return r.rows[0];
  }

  /** Marca a decisão. Só sai de 'pending' — o WHERE é o que torna o aceite único. */
  static async decide(conn, id_offer, status) {
    const r = await conn.query(
      `UPDATE public.tb_managed_site_offer
          SET status = $2, decided_at = NOW(), updated_at = NOW()
        WHERE id_offer = $1 AND status = 'pending'
       RETURNING ${COLS}`,
      [id_offer, status]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Devolve uma oferta aceita para a fila — é o que acontece quando o cliente
   * devolve o site ao construtor.
   *
   * ⚠️ NÃO é um "desfazer": o conteúdo continua aqui exatamente como foi
   * escrito, e é isso que permite ao cliente experimentar o site pronto e
   * voltar atrás sem perder o produto que pagou. Sem isto, devolver apagaria o
   * `template_data` da linha do site (é o que `setManaged` faz) e o único jeito
   * de recuperá-lo seria pedir para a gente montar de novo.
   *
   * Só reabre se NÃO houver pendente: a pendente é mais nova e é a que vale.
   * O índice parcial recusaria a segunda de qualquer forma — o WHERE aqui faz
   * a recusa ser um silêncio previsto, e não um 23505 no meio de uma devolução.
   */
  static async reopen(conn, id_offer) {
    const r = await conn.query(
      `UPDATE public.tb_managed_site_offer o
          SET status = 'pending', decided_at = NULL, updated_at = NOW()
        WHERE o.id_offer = $1
          AND o.status = 'accepted'
          AND NOT EXISTS (
                SELECT 1 FROM public.tb_managed_site_offer p
                 WHERE p.id_profile = o.id_profile AND p.status = 'pending'
              )
       RETURNING ${COLS}`,
      [id_offer]
    );
    return r.rowCount ? r.rows[0] : null;
  }
}

module.exports = ManagedSiteOfferStorage;
