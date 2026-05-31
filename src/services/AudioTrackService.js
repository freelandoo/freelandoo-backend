const pool = require("../databases");
const AudioTrackStorage = require("../storages/AudioTrackStorage");
const { uploadAudioFile, uploadAudioCover, publicUrl } = require("../integrations/r2/uploadAudioTrack");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("AudioTrackService");

function clampInt(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

function sanitizeText(value, maxLen) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return maxLen ? s.slice(0, maxLen) : s;
}

function toPublic(track) {
  if (!track) return track;
  return {
    ...track,
    audio_url: publicUrl(track.storage_key),
    cover_url: publicUrl(track.cover_key),
  };
}

function parseBool(v, fallback = true) {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

class AudioTrackService {
  // ---------- Público (picker do composer) ----------
  static listPublic({ q = null } = {}) {
    return runWithLogs(log, "listPublic", () => ({ q }), async () => {
      const rows = await AudioTrackStorage.list(pool, { onlyActive: true, q: sanitizeText(q), limit: 100 });
      return { tracks: rows.map(toPublic) };
    });
  }

  // ---------- Admin ----------
  static adminList({ q = null } = {}) {
    return runWithLogs(log, "adminList", () => ({ q }), async () => {
      const rows = await AudioTrackStorage.list(pool, { q: sanitizeText(q) });
      return { tracks: rows.map(toPublic) };
    });
  }

  static adminGet(id) {
    return runWithLogs(log, "adminGet", () => ({ id }), async () => {
      if (!id) return { error: "id obrigatório" };
      const track = await AudioTrackStorage.getById(pool, id);
      if (!track) return { error: "Faixa não encontrada" };
      return { track: toPublic(track) };
    });
  }

  static adminCreate(body, files) {
    return runWithLogs(log, "adminCreate", () => ({ title: body?.title }), async () => {
      const title = sanitizeText(body?.title, 160);
      if (!title) return { error: "Título é obrigatório" };
      const audioFile = files?.audio?.[0];
      if (!audioFile) return { error: "Arquivo de áudio é obrigatório" };

      const { storage_key } = await uploadAudioFile(audioFile);
      let cover_key = null;
      if (files?.cover?.[0]) {
        ({ cover_key } = await uploadAudioCover(files.cover[0]));
      }
      const track = await AudioTrackStorage.create(pool, {
        title,
        artist: sanitizeText(body?.artist, 160),
        storage_key,
        cover_key,
        duration_ms: clampInt(body?.duration_ms, { max: 3_600_000 }),
        sort_order: clampInt(body?.sort_order),
        is_active: parseBool(body?.is_active, true),
      });
      return { track: toPublic(track) };
    });
  }

  static adminUpdate(id, body, files) {
    return runWithLogs(log, "adminUpdate", () => ({ id }), async () => {
      if (!id) return { error: "id obrigatório" };
      const existing = await AudioTrackStorage.getById(pool, id);
      if (!existing) return { error: "Faixa não encontrada" };

      const patch = {};
      if (body?.title !== undefined) {
        const t = sanitizeText(body.title, 160);
        if (!t) return { error: "Título é obrigatório" };
        patch.title = t;
      }
      if (body?.artist !== undefined) patch.artist = sanitizeText(body.artist, 160);
      if (body?.duration_ms !== undefined) patch.duration_ms = clampInt(body.duration_ms, { max: 3_600_000 });
      if (body?.sort_order !== undefined) patch.sort_order = clampInt(body.sort_order);
      if (body?.is_active !== undefined) patch.is_active = parseBool(body.is_active);
      if (files?.cover?.[0]) {
        const { cover_key } = await uploadAudioCover(files.cover[0]);
        patch.cover_key = cover_key;
      }
      const track = await AudioTrackStorage.update(pool, id, patch);
      return { track: toPublic(track) };
    });
  }

  static adminRemove(id) {
    return runWithLogs(log, "adminRemove", () => ({ id }), async () => {
      if (!id) return { error: "id obrigatório" };
      const ok = await AudioTrackStorage.remove(pool, id);
      if (!ok) return { error: "Faixa não encontrada" };
      return { ok: true };
    });
  }
}

module.exports = AudioTrackService;
