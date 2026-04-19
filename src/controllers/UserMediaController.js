const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../services/r2Client");
const pool = require("../databases");

class UserMediaController {
  static async listMyMedia(req, res) {
    const { id_user } = req.user;

    const result = await pool.query(
      `
        SELECT
          id_media,
          title,
          description,
          media_url,
          media_type,
          external_link,
          position,
          created_at
        FROM tb_user_media
        WHERE id_user = $1
        ORDER BY position ASC, created_at DESC
        `,
      [id_user]
    );

    return res.json(result.rows);
  }

  static async listUserMedia(req, res) {
    const { id } = req.params;

    const result = await pool.query(
      `
        SELECT
          id_media,
          title,
          description,
          media_url,
          media_type,
          external_link,
          position,
          created_at
        FROM tb_user_media
        WHERE id_user = $1
        ORDER BY position ASC, created_at DESC
        `,
      [id]
    );

    return res.json(result.rows);
  }

  static async createMedia(req, res) {
    const { id_user } = req.user;
    const {
      title,
      description,
      media_url,
      media_type,
      external_link,
      position,
    } = req.body;

    if (!title || !media_url || !media_type) {
      return res.status(400).json({
        error: "title, media_url e media_type são obrigatórios",
      });
    }

    if (!["image", "video"].includes(media_type)) {
      return res.status(400).json({
        error: "media_type deve ser image ou video",
      });
    }

    const result = await pool.query(
      `
        INSERT INTO tb_user_media
        (
          id_user,
          title,
          description,
          media_url,
          media_type,
          external_link,
          position
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        `,
      [
        id_user,
        title,
        description || null,
        media_url,
        media_type,
        external_link || null,
        position || 0,
      ]
    );

    return res.status(201).json(result.rows[0]);
  }

  static async updateMedia(req, res) {
    const { id_user } = req.user;
    const { id_media } = req.params;
    const {
      title,
      description,
      media_url,
      media_type,
      external_link,
      position,
    } = req.body;

    const fields = [];
    const values = [];
    let index = 1;

    if (title) {
      fields.push(`title = $${index++}`);
      values.push(title);
    }
    if (description !== undefined) {
      fields.push(`description = $${index++}`);
      values.push(description);
    }
    if (media_url) {
      fields.push(`media_url = $${index++}`);
      values.push(media_url);
    }
    if (media_type) {
      if (!["image", "video"].includes(media_type)) {
        return res.status(400).json({
          error: "media_type deve ser image ou video",
        });
      }
      fields.push(`media_type = $${index++}`);
      values.push(media_type);
    }
    if (external_link !== undefined) {
      fields.push(`external_link = $${index++}`);
      values.push(external_link);
    }
    if (position !== undefined) {
      fields.push(`position = $${index++}`);
      values.push(position);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "Nenhum campo para atualizar" });
    }

    values.push(id_media);
    values.push(id_user);

    const query = `
        UPDATE tb_user_media
        SET ${fields.join(", ")}
        WHERE id_media = $${index++}
          AND id_user = $${index}
        RETURNING *
      `;

    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Mídia não encontrada ou não pertence ao usuário",
      });
    }

    return res.json(result.rows[0]);
  }

  static async deleteMedia(req, res) {
    const { id_user } = req.user;
    const { id_media } = req.params;

    const result = await pool.query(
      `
        DELETE FROM tb_user_media
        WHERE id_media = $1
          AND id_user = $2
        RETURNING id_media
        `,
      [id_media, id_user]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Mídia não encontrada ou não pertence ao usuário",
      });
    }

    return res.json({ success: true });
  }

  static async uploadMedia(req, res) {
    const { id_user } = req.user;

    if (!req.file) {
      return res.status(400).json({ error: "Arquivo não enviado" });
    }

    const media_type = req.file.mimetype.startsWith("image/")
      ? "image"
      : "video";

    const fileExt = req.file.originalname.split(".").pop();
    const fileName = `user-${id_user}/${media_type}/${crypto.randomUUID()}.${fileExt}`;

    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: fileName,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    const media_url = `${process.env.R2_PUBLIC_URL}/${fileName}`;

    return res.status(201).json({
      media_url,
      media_type,
      original_name: req.file.originalname,
    });
  }
}

module.exports = UserMediaController;
