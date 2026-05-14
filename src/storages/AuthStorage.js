class AuthStorage {
  static async findUserIdByEmail(client, email) {
    const r = await client.query(
      "SELECT id_user FROM tb_user WHERE LOWER(TRIM(email)) = $1 LIMIT 1",
      [email]
    );
    return r.rowCount ? r.rows[0].id_user : null;
  }

  static async findUserIdByUsername(client, username) {
    const r = await client.query(
      "SELECT id_user FROM tb_user WHERE LOWER(username) = $1 LIMIT 1",
      [username]
    );
    return r.rowCount ? r.rows[0].id_user : null;
  }

  static async createUser(
    client,
    { nome, username, email, senhaHash, data_nascimento, sexo, estado, municipio, ativo }
  ) {
    const r = await client.query(
      `
      INSERT INTO tb_user
        (nome, username, email, senha, data_nascimento, sexo, estado, municipio, ativo)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING
        id_user, nome, username, email, estado, municipio, created_at
      `,
      [nome, username, email, senhaHash, data_nascimento, sexo, estado, municipio, ativo]
    );
    const user = r.rows[0];
    await this.ensureUserAccountProfile(client, user.id_user, nome);
    return user;
  }

  /**
   * Garante que existe um perfil-fantasma (is_user_account=TRUE) para o usuário.
   * Idempotente — usa UNIQUE PARTIAL INDEX uq_tb_profile_user_account.
   * Reaproveita endpoints de portfólio sem precisar de subperfil profissional.
   * Trigger fn_user_account_profile_defaults força as flags corretas.
   */
  static async ensureUserAccountProfile(client, id_user, display_name) {
    await client.query(
      `
      INSERT INTO public.tb_profile
        (id_user, id_category, display_name, is_active, is_visible,
         is_user_account, feed_visible, showcase_visible, ranking_visible)
      SELECT
        $1::uuid,
        COALESCE((SELECT id_category FROM public.tb_category ORDER BY id_category LIMIT 1), 1),
        $2,
        TRUE,
        FALSE,
        TRUE,
        TRUE,
        FALSE,
        FALSE
      WHERE NOT EXISTS (
        SELECT 1 FROM public.tb_profile
         WHERE id_user = $1 AND is_user_account = TRUE
      )
      `,
      [id_user, display_name || "Conta"]
    );
  }

  static async findUserByGoogleSub(db, googleSub) {
    const r = await db.query(
      `SELECT id_user, nome, email, ativo, google_sub
         FROM tb_user
        WHERE google_sub = $1
        LIMIT 1`,
      [googleSub]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async findUserForGoogleByEmail(db, email) {
    const r = await db.query(
      `SELECT id_user, nome, email, ativo, google_sub
         FROM tb_user
        WHERE LOWER(TRIM(email)) = $1
        LIMIT 1`,
      [email]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async linkGoogleSub(db, id_user, googleSub) {
    await db.query(
      `UPDATE tb_user SET google_sub = $2, ativo = TRUE WHERE id_user = $1`,
      [id_user, googleSub]
    );
  }

  static async createGoogleUser(client, { nome, username, email, googleSub }) {
    const r = await client.query(
      `
      INSERT INTO tb_user
        (nome, username, email, ativo, google_sub)
      VALUES
        ($1, $2, $3, TRUE, $4)
      RETURNING id_user, nome, username, email, ativo
      `,
      [nome, username, email, googleSub]
    );
    const user = r.rows[0];
    await this.ensureUserAccountProfile(client, user.id_user, nome);
    return user;
  }

  static async generateUniqueUsernameFromEmail(client, email) {
    const base = String(email || "")
      .split("@")[0]
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9_.-]+/g, "")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, 24) || "user";

    let candidate = base;
    let suffix = 0;
    while (true) {
      const taken = await this.findUserIdByUsername(client, candidate);
      if (!taken) return candidate;
      suffix += 1;
      candidate = `${base.slice(0, 24 - String(suffix).length)}${suffix}`.slice(0, 30);
      if (suffix > 9999) {
        candidate = `${base.slice(0, 20)}${Math.floor(Math.random() * 100000)}`.slice(0, 30);
        return candidate;
      }
    }
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
