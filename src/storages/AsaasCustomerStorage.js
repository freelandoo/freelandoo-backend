// src/storages/AsaasCustomerStorage.js
// SQL do vínculo conta ↔ cliente no Asaas (mig 236).

class AsaasCustomerStorage {
  /** O que o Asaas exige para criar um cliente: nome e CPF. */
  static async getPayerIdentity(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT id_user, nome, email, cpf, asaas_customer_id
         FROM public.tb_user
        WHERE id_user = $1
        LIMIT 1`,
      [id_user]
    );
    return rows[0] || null;
  }

  /**
   * Carimba o id do cliente — e SÓ enquanto a coluna estiver vazia.
   *
   * ⚠️ A guarda `IS NULL` é o que transforma uma corrida em no-op: dois
   * checkouts simultâneos da mesma conta podem ambos criar o cliente no Asaas,
   * e sem ela o segundo sobrescreveria o primeiro — deixando um cliente órfão
   * lá dentro com cobranças penduradas nele que ninguém mais consegue achar.
   *
   * Devolve `null` quando alguém chegou antes; quem chamou relê a linha e usa
   * o id do vencedor.
   */
  static async attachCustomerId(conn, id_user, asaas_customer_id) {
    const { rows } = await conn.query(
      `UPDATE public.tb_user
          SET asaas_customer_id = $2
        WHERE id_user = $1
          AND asaas_customer_id IS NULL
        RETURNING id_user, asaas_customer_id`,
      [id_user, asaas_customer_id]
    );
    return rows[0] || null;
  }
}

module.exports = AsaasCustomerStorage;
