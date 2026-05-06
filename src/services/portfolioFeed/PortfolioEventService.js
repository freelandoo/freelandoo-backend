const PortfolioEventStorage = require("../../storages/PortfolioEventStorage");
const { createLogger, runWithLogs } = require("../../utils/logger");

const log = createLogger("PortfolioEventService");

const ALLOWED_EVENTS = new Set([
  "impression",
  "like",
  "unlike",
  "share",
  "profile_click",
  "whatsapp_click",
  "social_click",
  "view_more_caption",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATE_RE = /^[A-Z]{2}$/;
const SESSION_MAX_LEN = 64;
const CITY_MAX_LEN = 120;
const METADATA_MAX_BYTES = 2048;

function asInt(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function asTrimmedString(v, maxLen) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

function normalizeFilters(raw) {
  if (!raw || typeof raw !== "object") return {};
  const state = asTrimmedString(raw.state, 2);
  return {
    machine_id:    asInt(raw.machine_id),
    profession_id: asInt(raw.profession_id),
    city:          asTrimmedString(raw.city, CITY_MAX_LEN),
    state:         state && STATE_RE.test(state.toUpperCase())
      ? state.toUpperCase()
      : null,
  };
}

function normalizeMetadata(raw) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  let json;
  try {
    json = JSON.stringify(raw);
  } catch {
    return null;
  }
  if (Buffer.byteLength(json, "utf8") > METADATA_MAX_BYTES) return null;
  return raw;
}

class PortfolioEventService {
  static async record({ db, payload, viewer }) {
    return runWithLogs(
      log,
      "record",
      () => ({
        post_id: payload?.post_id,
        event_type: payload?.event_type,
        session: payload?.session_id ? "yes" : "no",
        viewer: viewer?.id_user ? "auth" : "anon",
      }),
      async () => {
        const post_id = asTrimmedString(payload?.post_id, 64);
        const event_type = asTrimmedString(payload?.event_type, 30);
        const session_id = asTrimmedString(payload?.session_id, SESSION_MAX_LEN);

        if (!post_id || !UUID_RE.test(post_id)) {
          return { status: 400, body: { error: "post_id inválido" } };
        }
        if (!event_type || !ALLOWED_EVENTS.has(event_type)) {
          return { status: 400, body: { error: "event_type inválido" } };
        }

        const filters = normalizeFilters(payload?.filters);
        const metadata = normalizeMetadata(payload?.metadata);

        const result = await PortfolioEventStorage.recordEvent(db, {
          id_portfolio_item: post_id,
          event_type,
          session_id,
          id_user: viewer?.id_user || null,
          filters,
          metadata,
        });

        if (!result.ok && result.reason === "post_not_found") {
          return { status: 404, body: { error: "post não encontrado" } };
        }

        return {
          status: 202,
          body: { ok: true, counted: !!result.counted },
        };
      }
    );
  }
}

module.exports = PortfolioEventService;
module.exports.ALLOWED_EVENTS = ALLOWED_EVENTS;
