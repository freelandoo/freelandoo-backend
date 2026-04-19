class AuthStorage {
  static async findUserIdByEmail(client, email) {
    const r = await client.query(
      "SELECT id_user FROM tb_user WHERE LOWER(TRIM(email)) = $1 LIMIT 1",
      [email]
    );
    return r.rowCount ? r.rows[0].id_user : null;
  }

  static async createUser(
    client,
    { nome, email, senhaHash, data_nascimento, sexo, ativo }
  ) {
    const r = await client.query(
      `
      INSERT INTO tb_user
        (nome, email, senha, data_nascimento, sexo, ativo)
      VALUES
        ($1, $2, $3, $4, $5, $6)
      RETURNING
        id_user, nome, email, created_at
      `,
      [nome, email, senhaHash, data_nascimento, sexo, ativo]
    );
    return r.rows[0];
  }

  static async findUserAuthByEmail(db, email) {
    const r = await db.query(
      `
      SELECT 
        id_user,
        nome,
        email,
        senha,
        ativo
      FROM tb_user
      WHERE LOWER(TRIM(email)) = $1
      LIMIT 1
      `,
      [email]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async createActivationToken(client, { id_user, token, expiresAt }) {
    await client.query(
      `
      INSERT INTO tb_user_activation (id_user, token, expires_at)
      VALUES ($1, $2, $3)
      `,
      [id_user, token, expiresAt]
    );
  }

  static async findValidActivationByToken(client, token) {
    const r = await client.query(
      `
      SELECT id_activation, id_user
      FROM tb_user_activation
      WHERE token = $1
        AND used = false
        AND expires_at > now()
      LIMIT 1
      `,
      [token]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async setUserActive(client, id_user) {
    await client.query(`UPDATE tb_user SET ativo = true WHERE id_user = $1`, [
      id_user,
    ]);
  }

  static async markActivationUsed(client, id_activation) {
    await client.query(
      `UPDATE tb_user_activation SET used = true WHERE id_activation = $1`,
      [id_activation]
    );
  }

  static async findUserBasicByEmail(client, email) {
    const r = await client.query(
      `SELECT id_user, nome, email FROM tb_user WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
      [email]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async createPasswordResetToken(client, { id_user, token, expiresAt }) {
    await client.query(
      `
      INSERT INTO tb_user_password_reset (id_user, token, expires_at)
      VALUES ($1, $2, $3)
      `,
      [id_user, token, expiresAt]
    );
  }

  static async findValidPasswordResetByToken(client, token) {
    const r = await client.query(
      `
      SELECT id_reset, id_user
      FROM tb_user_password_reset
      WHERE token = $1
        AND used = false
        AND expires_at > now()
      LIMIT 1
      `,
      [token]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async updateUserPassword(client, id_user, senhaHash) {
    await client.query(`UPDATE tb_user SET senha = $1 WHERE id_user = $2`, [
      senhaHash,
      id_user,
    ]);
  }

  static async markPasswordResetUsed(client, id_reset) {
    await client.query(
      `UPDATE tb_user_password_reset SET used = true WHERE id_reset = $1`,
      [id_reset]
    );
  }

  static async deleteUserStatus(conn, { id_user, id_status }) {
    await conn.query(
      `
    DELETE FROM public.tb_user_status
    WHERE id_user = $1 AND id_status = $2
    `,
      [id_user, id_status]
    );
  }

  static async insertUserStatus(
    conn,
    { id_user, id_status, created_by = null }
  ) {
    await conn.query(
      `
    INSERT INTO public.tb_user_status (id_user, id_status, created_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (id_user, id_status) DO NOTHING
    `,
      [id_user, id_status, created_by]
    );
  }
}

module.exports = AuthStorage;
