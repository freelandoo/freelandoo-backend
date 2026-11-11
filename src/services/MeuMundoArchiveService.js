// src/services/MeuMundoArchiveService.js — MEU MUNDO 3D, lore v2 F5: o Arquivo e os vídeos.
//
// Arquivo: a cada leitura o servidor confere o que a pessoa já destravou
// (capítulos em tb_mm_quest, monstros vencidos em tb_mm_receipt) e grava as
// entradas novas em tb_mm_archive (ON CONFLICT: idempotente). Ler = `read_at`,
// que é o que o check archive:<id> da missão lê. Não dá prêmio: sem withLife.
// Vídeos: o admin sobe o arquivo (R2) por capítulo/personagem; o jogo recebe
// a lista junto com o Arquivo. Sem vídeo, o jogo mostra imagem + texto.

const pool = require("../databases");
const A = require("../utils/meuMundoArchive");
const PlaceService = require("./MeuMundoPlaceService");
const { ensureFileBuffer, hasUpload } = require("../utils/mediaProcessing");
const uploadMeuMundoVideoToR2 = require("../integrations/r2/uploadMeuMundoVideo");

const ERRORS = {
  unknown: ["Texto do Arquivo desconhecido", 404],
  locked: ["Esse texto do Arquivo ainda está trancado", 409],
  slot: ["Esse vídeo não tem lugar no jogo", 404],
  empty: ["Envie o vídeo ou a imagem", 400],
  far: ["Esse texto só se abre no lugar dele", 409],
};
const fail = (code) => {
  const [error, statusCode] = ERRORS[code];
  return { error, statusCode, code };
};

/** Destrava o que a pessoa já alcançou (idempotente) e devolve as linhas dela. */
async function sync(c, idUser) {
  const q = await c.query(`SELECT quest_id, step, done_at FROM tb_mm_quest WHERE id_user = $1`, [idUser]);
  const chapters = new Map(q.rows.map((r) => [r.quest_id, { step: Number(r.step) || 0, done: !!r.done_at }]));
  const w = await c.query(
    `SELECT DISTINCT result->>'kind' AS kind FROM tb_mm_receipt
      WHERE id_user = $1 AND source = 'fight' AND (result->>'win')::boolean AND NOT (result->>'abandoned')::boolean
        AND COALESCE(result->>'origin', '') <> 'tutorial'`,
    [idUser]
  );
  const ids = A.unlockedIds(chapters, new Set(w.rows.map((r) => r.kind)));
  if (ids.length) await c.query(`INSERT INTO tb_mm_archive (id_user, entry_id) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [idUser, ids]);
  const r = await c.query(`SELECT entry_id, unlocked_at, read_at FROM tb_mm_archive WHERE id_user = $1`, [idUser]);
  return new Map(r.rows.map((x) => [x.entry_id, x]));
}

async function videos(c) {
  const r = await c.query(`SELECT kind, ref, video_url, poster_url, updated_at FROM tb_mm_video`);
  const out = { chapter: {}, character: {} };
  for (const x of r.rows) if (out[x.kind]) out[x.kind][x.ref] = { video: x.video_url, poster: x.poster_url, at: x.updated_at };
  return out;
}

/** O que a tela recebe: todas as entradas (trancada não traz data) e os vídeos. */
async function view(c, idUser) {
  const rows = await sync(c, idUser);
  return {
    entries: A.ENTRIES.map((e) => {
      const r = rows.get(e.id);
      return { id: e.id, chapter: e.chapter, unlocked: !!r, unlockedAt: r ? r.unlocked_at : null, readAt: r ? r.read_at : null, at: e.at || null };
    }),
    videos: await videos(c),
  };
}

class MeuMundoArchiveService {
  /** GET /archive */
  static async get(idUser, db = pool) {
    return view(db, idUser);
  }

  /** POST /archive/read { id } — abriu o texto: grava a primeira leitura. */
  static async read(idUser, body = {}, db = pool) {
    const id = String(body.id || "");
    if (!A.ENTRY_BY_ID.has(id)) return fail("unknown");
    const rows = await sync(db, idUser);
    if (!rows.has(id)) return fail("locked");
    // C3: texto que mora num lugar (o livro do Ninho) só se lê a primeira vez LÁ —
    // a última visita gravada pela sala (o aparelho não diz onde está). Depois, em qualquer lugar.
    const e = A.ENTRY_BY_ID.get(id);
    if (e.at && !rows.get(id).read_at && !(await PlaceService.isAt(db, idUser, e.at))) return fail("far");
    await db.query(`UPDATE tb_mm_archive SET read_at = COALESCE(read_at, NOW()) WHERE id_user = $1 AND entry_id = $2`, [idUser, id]);
    return view(db, idUser);
  }

  /** GET /videos — os lugares de vídeo e o que já foi enviado (tela do admin). */
  static async listVideos(db = pool) {
    return { slots: A.VIDEO_SLOTS, videos: await videos(db) };
  }

  /** POST /videos/:kind/:ref (multipart video/poster) — sobe para o R2 e grava. */
  static async upload(idUser, kind, ref, files = {}, db = pool) {
    if (!A.isVideoSlot(kind, ref)) return fail("slot");
    const video = files.video && files.video[0];
    const poster = files.poster && files.poster[0];
    if (!hasUpload(video) && !hasUpload(poster)) return fail("empty");
    const urls = {};
    for (const [field, file] of [["video", video], ["poster", poster]]) {
      if (!hasUpload(file)) continue;
      await ensureFileBuffer(file);
      urls[field] = (await uploadMeuMundoVideoToR2({ kind, ref, file })).url;
    }
    await db.query(
      `INSERT INTO tb_mm_video (kind, ref, video_url, poster_url, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (kind, ref) DO UPDATE SET
         video_url = COALESCE(EXCLUDED.video_url, tb_mm_video.video_url),
         poster_url = COALESCE(EXCLUDED.poster_url, tb_mm_video.poster_url),
         updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
      [kind, ref, urls.video || null, urls.poster || null, idUser]
    );
    return MeuMundoArchiveService.listVideos(db);
  }

  /** POST /videos/:kind/:ref/clear { what: "video" | "poster" | "all" } — o jogo volta à imagem + texto. */
  static async clear(kind, ref, body = {}, db = pool) {
    if (!A.isVideoSlot(kind, ref)) return fail("slot");
    const what = ["video", "poster"].includes(body.what) ? body.what : "all";
    if (what === "all") await db.query(`DELETE FROM tb_mm_video WHERE kind = $1 AND ref = $2`, [kind, ref]);
    else await db.query(`UPDATE tb_mm_video SET ${what === "video" ? "video_url" : "poster_url"} = NULL, updated_at = NOW() WHERE kind = $1 AND ref = $2`, [kind, ref]);
    return MeuMundoArchiveService.listVideos(db);
  }
}

module.exports = MeuMundoArchiveService;
