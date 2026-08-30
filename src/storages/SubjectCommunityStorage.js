// src/storages/SubjectCommunityStorage.js
// SQL puro das modalidades cujo assunto é uma coisa (mig 210): pet, carro e
// games. Só o que é PRÓPRIO delas mora aqui — o perfil-comunidade em si
// continua sendo criado pelo CommunityStorage, que é quem sabe fazer slug,
// região e liderança.

class SubjectCommunityStorage {
  // ─── Catálogo de raças ──────────────────────────────────────────────────────
  static async listBreeds(conn, species = null) {
    const params = [];
    let filter = "";
    if (species) {
      params.push(species);
      filter = ` AND species = $${params.length}`;
    }
    const r = await conn.query(
      `SELECT id_breed, species, slug, label, is_mixed
         FROM public.tb_pet_breed
        WHERE is_active = TRUE${filter}
        -- Vira-lata primeiro: é o caso mais comum do Brasil e não pode ficar
        -- no meio de uma lista alfabética de 35 raças.
        ORDER BY is_mixed DESC, label ASC`,
      params
    );
    return r.rows;
  }

  static async getBreed(conn, { id_breed, species, slug }) {
    if (id_breed) {
      const r = await conn.query(
        `SELECT id_breed, species, slug, label, is_mixed
           FROM public.tb_pet_breed
          WHERE id_breed = $1 AND is_active = TRUE
          LIMIT 1`,
        [id_breed]
      );
      return r.rowCount ? r.rows[0] : null;
    }
    if (species && slug) {
      const r = await conn.query(
        `SELECT id_breed, species, slug, label, is_mixed
           FROM public.tb_pet_breed
          WHERE species = $1 AND slug = $2 AND is_active = TRUE
          LIMIT 1`,
        [species, slug]
      );
      return r.rowCount ? r.rows[0] : null;
    }
    return null;
  }

  // ─── Pet ────────────────────────────────────────────────────────────────────
  static async createPet(conn, id_profile, pet) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_pet
         (id_profile, species, id_breed, breed_label, is_mixed, birth_year)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id_profile, species, id_breed, breed_label, is_mixed, birth_year`,
      [
        id_profile,
        pet.species,
        pet.id_breed ?? null,
        pet.breed_label ?? null,
        !!pet.is_mixed,
        pet.birth_year ?? null,
      ]
    );
    return r.rows[0];
  }

  // ─── Games ──────────────────────────────────────────────────────────────────
  static async createGame(conn, id_profile, game) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_game
         (id_profile, platform, game_title, gamertag)
       VALUES ($1, $2, $3, $4)
       RETURNING id_profile, platform, game_title, gamertag`,
      [id_profile, game.platform, game.game_title, game.gamertag ?? null]
    );
    return r.rows[0];
  }

  // ─── Carro ──────────────────────────────────────────────────────────────────
  /**
   * Get-or-create do modelo no catálogo local.
   *
   * O `::text` explícito nos parâmetros não é decoração: o mesmo parâmetro
   * aparece na coluna (varchar) e no ON CONFLICT, e sem o cast o Postgres já
   * devolveu 42P08 nesta base (armadilha paga nas migs 202-204).
   */
  static async getOrCreateCarModel(conn, model) {
    const r = await conn.query(
      `INSERT INTO public.tb_car_model
         (brand_code, brand_label, model_code, model_label, source)
       VALUES ($1::text, $2::text, $3::text, $4::text, $5::text)
       ON CONFLICT (brand_code, model_code) DO UPDATE
          SET brand_label = EXCLUDED.brand_label,
              model_label = EXCLUDED.model_label
       RETURNING id_car_model, brand_code, brand_label, model_code, model_label, source`,
      [
        model.brand_code,
        model.brand_label,
        model.model_code,
        model.model_label,
        model.source || "fipe",
      ]
    );
    return r.rows[0];
  }

  /** A comunidade daquele modelo, se alguém já a fundou. */
  static async findCarCommunity(conn, id_car_model) {
    const r = await conn.query(
      `SELECT p.id_profile, p.display_name, p.avatar_url, p.id_leader_user,
              cm.brand_label, cm.model_label
         FROM public.tb_profile p
         JOIN public.tb_car_model cm ON cm.id_car_model = p.id_car_model
        WHERE p.id_car_model = $1
          AND p.community_kind = 'car'
          AND p.deleted_at IS NULL
        LIMIT 1`,
      [id_car_model]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async attachCarModel(conn, id_profile, id_car_model) {
    await conn.query(
      `UPDATE public.tb_profile
          SET id_car_model = $2, updated_at = NOW()
        WHERE id_profile = $1`,
      [id_profile, id_car_model]
    );
  }

  // ─── Leitura ────────────────────────────────────────────────────────────────
  /**
   * Detalhe do assunto de uma comunidade — raça do pet, modelo do carro, jogo.
   * Um método só para as três: a página é a mesma casca, e quem a monta não
   * deveria precisar saber de qual tabela veio o rótulo.
   */
  static async getSubject(conn, id_profile, kind) {
    if (kind === "pet") {
      const r = await conn.query(
        `SELECT species, id_breed, breed_label, is_mixed, birth_year
           FROM public.tb_community_pet WHERE id_profile = $1 LIMIT 1`,
        [id_profile]
      );
      return r.rowCount ? { kind: "pet", ...r.rows[0] } : null;
    }
    if (kind === "games") {
      const r = await conn.query(
        `SELECT platform, game_title, gamertag
           FROM public.tb_community_game WHERE id_profile = $1 LIMIT 1`,
        [id_profile]
      );
      return r.rowCount ? { kind: "games", ...r.rows[0] } : null;
    }
    if (kind === "car") {
      const r = await conn.query(
        `SELECT cm.id_car_model, cm.brand_code, cm.brand_label,
                cm.model_code, cm.model_label
           FROM public.tb_profile p
           JOIN public.tb_car_model cm ON cm.id_car_model = p.id_car_model
          WHERE p.id_profile = $1
          LIMIT 1`,
        [id_profile]
      );
      return r.rowCount ? { kind: "car", ...r.rows[0] } : null;
    }
    return null;
  }

  /**
   * Os espaços do usuário, agrupados por modalidade — o que o menu da foto de
   * perfil mostra. Uma query só de propósito: o menu abre com um clique e não
   * pode disparar seis requisições para saber o que oferecer.
   *
   * Traz TODA comunidade em que a pessoa está (qualquer papel), com o rótulo do
   * assunto quando existe. Academia não entra aqui: ela é entidade própria
   * (tb_academy) e o service a agrega por cima.
   */
  static async listMySpaces(conn, id_user) {
    const r = await conn.query(
      `SELECT p.id_profile,
              p.display_name,
              p.avatar_url,
              p.community_kind AS kind,
              p.community_privacy AS privacy,
              m.role,
              COALESCE(
                pet.breed_label,
                cm.model_label,
                g.game_title
              ) AS subject_label,
              pet.species        AS pet_species,
              g.platform         AS game_platform,
              cm.brand_label     AS car_brand_label
         FROM public.tb_community_member m
         JOIN public.tb_profile p ON p.id_profile = m.id_community_profile
         LEFT JOIN public.tb_community_pet  pet ON pet.id_profile = p.id_profile
         LEFT JOIN public.tb_community_game g   ON g.id_profile   = p.id_profile
         LEFT JOIN public.tb_car_model      cm  ON cm.id_car_model = p.id_car_model
        WHERE m.id_user = $1
          AND p.is_community = TRUE
          AND p.deleted_at IS NULL
        ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'vice' THEN 1 ELSE 2 END,
                 m.joined_at ASC`,
      [id_user]
    );
    return r.rows;
  }
}

module.exports = SubjectCommunityStorage;
