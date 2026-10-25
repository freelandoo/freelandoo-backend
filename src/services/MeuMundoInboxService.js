// src/services/MeuMundoInboxService.js — MEU MUNDO 3D: sino e correio interno (mig 302, mm3d-30).
//
// Notificação = linha em tb_mm_notice (histórico do sino) + aviso pela sala
// em que a pessoa está (mensagem "notice", a conexão do jogo que já existe —
// sem polling). Sair da tela não marca como lida: só abrir/marcar.
// Correio = tb_mm_mail (presente, oficial, promoção, recibo); toda carta nasce
// com UMA notificação apontando para ela (abrir a carta lê as duas).
// Mensagens entre pessoas continuam nas conversas da Freelandoo (/conversations):
// a caixa do jogo só as lista, não guarda cópia.
//
// O resgate de presente mora no MeuMundoLifeService (precisa da transação da
// vida: geladeira, skins e moedas são travados juntos).

const pool = require("../databases");
const Inbox = require("../storages/MeuMundoInboxStorage");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const Life = require("../utils/meuMundoLife");
const Skins = require("../utils/meuMundoSkins");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.inbox");

const ERRORS = {
  notFound: ["Mensagem não encontrada", 404],
  kind: ["Tipo de mensagem inválido", 400],
  title: ["Título obrigatório (até 120 caracteres)", 400],
  body: ["Texto longo demais (até 2000 caracteres)", 400],
  gift: ["Presente inválido", 400],
  to: ["Destinatário não encontrado", 404],
};
const fail = (code) => {
  const [error, statusCode] = ERRORS[code] || ["Não foi possível", 400];
  return { error, statusCode, code };
};

// Prioridade da notificação (1 = mais urgente): a fila do cliente segue esta ordem.
const PRIORITY = { gift: 2, official: 3, promo: 5, receipt: 3 };
const NOTICE_KIND = { gift: "gift", official: "official", promo: "promo", receipt: "purchase" };

const idOk = (v) => /^\d{1,18}$/.test(String(v || ""));
const clampLimit = (v) => Math.min(50, Math.max(1, Number(v) || 30));

/** Leva a notificação nova ao cliente, se ele estiver numa sala (depois do COMMIT). */
function push(idUser, notice) {
  if (!notice) return;
  try {
    require("../realtime/meuMundo").pushNotice(idUser, notice);
  } catch (err) {
    log.warn("push_fail", { message: err.message });
  }
}

/** Presente aceito pelo correio: item do catálogo, skin ou moedas do jogo. */
function normalizeGift(raw) {
  if (!raw || typeof raw !== "object") return null;
  const qty = Number(raw.qty ?? 1);
  if (raw.type === "item") {
    const it = Life.ITEM_BY_ID.get(String(raw.id || ""));
    if (!it || !Number.isInteger(qty) || qty < 1 || qty > Life.FRIDGE.MAX_STACK) return null;
    return { type: "item", id: it.id, qty };
  }
  if (raw.type === "skin") {
    const sk = Skins.skinById(raw.id);
    if (!sk || sk.kind !== "skin") return null;
    return { type: "skin", id: sk.id, qty: 1 };
  }
  if (raw.type === "coins") {
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) return null;
    return { type: "coins", id: "coins", qty };
  }
  return null;
}

class MeuMundoInboxService {
  // ═══ SINO ═══

  static async notices(idUser, query = {}) {
    const filter = Inbox.NOTICE_FILTERS.includes(query.filter) ? query.filter : "all";
    const before = idOk(query.before) ? query.before : null;
    const [list, counts] = await Promise.all([
      Inbox.listNotices(pool, idUser, { filter, before, limit: clampLimit(query.limit) }),
      Inbox.counts(pool, idUser),
    ]);
    return { items: list.items, more: list.more, counts };
  }

  /**
   * Ao entrar no jogo: contadores + as poucas notificações frescas (últimos
   * 10 min) que ainda valem um card — nunca a fila do tempo offline.
   */
  static async summary(idUser) {
    const [counts, fresh] = await Promise.all([
      Inbox.counts(pool, idUser),
      Inbox.recentUnread(pool, idUser, Date.now() - 10 * 60_000, 2),
    ]);
    return { counts, fresh };
  }

  static async readNotices(idUser, body = {}) {
    let ids = "all";
    if (!body.all) {
      ids = (Array.isArray(body.ids) ? body.ids : []).filter(idOk).slice(0, 200);
      if (!ids.length) return { updated: 0, counts: await Inbox.counts(pool, idUser) };
    }
    const updated = await Inbox.readNotices(pool, idUser, ids);
    return { updated, counts: await Inbox.counts(pool, idUser) };
  }

  // ═══ CORREIO ═══

  static async mail(idUser, query = {}) {
    const tab = Inbox.MAIL_TABS.includes(query.tab) ? query.tab : "all";
    const before = idOk(query.before) ? query.before : null;
    const [list, counts] = await Promise.all([
      Inbox.listMail(pool, idUser, { tab, before, limit: clampLimit(query.limit) }),
      Inbox.counts(pool, idUser),
    ]);
    return { items: list.items, more: list.more, counts };
  }

  /** Abrir uma carta: devolve e marca como lida (ela e a notificação dela). */
  static async openMail(idUser, idMail) {
    if (!idOk(idMail)) return fail("notFound");
    const mail = await Inbox.getMail(pool, idUser, idMail);
    if (!mail) return fail("notFound");
    if (!mail.read) await Inbox.readMail(pool, idUser, idMail);
    return { mail: { ...mail, read: true }, counts: await Inbox.counts(pool, idUser) };
  }

  static async readAllMail(idUser) {
    await Inbox.readAllMail(pool, idUser);
    return { counts: await Inbox.counts(pool, idUser) };
  }

  static async prefs(idUser) {
    return { prefs: await Inbox.getPrefs(pool, idUser) };
  }

  static async setPrefs(idUser, body = {}) {
    await Inbox.setPrefs(pool, idUser, { promos: body.promos !== false });
    return { prefs: await Inbox.getPrefs(pool, idUser) };
  }

  /**
   * Grava carta + notificação dela na mesma transação (`db` = cliente já
   * em transação, ou o pool). Devolve a notificação para o push.
   */
  static async deliver(db, idUser, mail) {
    const row = await Inbox.insertMail(db, idUser, mail);
    if (!row) return null; // mesma dedupe_key: já entregue
    return Inbox.insertNotice(db, idUser, {
      kind: NOTICE_KIND[mail.kind],
      code: mail.kind === "receipt" ? mail.code || "receipt" : mail.kind,
      priority: PRIORITY[mail.kind] || 3,
      data: { title: mail.title, ...(mail.gift ? { gift: mail.gift } : {}), ...(mail.noticeData || {}) },
      mailId: row.id,
      dedupeKey: mail.dedupeKey ? `mail:${mail.dedupeKey}` : null,
    });
  }

  /**
   * Admin: comunicado, promoção ou presente para uma pessoa (@usuario) ou
   * para todos os jogadores (`to: "*"`). Promoção respeita a preferência.
   * O texto vem do admin e não é traduzido (conteúdo, como um post).
   */
  static async send(adminId, body = {}) {
    const kind = String(body.kind || "");
    if (!["official", "promo", "gift"].includes(kind)) return fail("kind");
    const title = String(body.title || "").trim();
    const text = String(body.body || "").trim();
    if (!title || title.length > 120) return fail("title");
    if (text.length > 2000) return fail("body");
    let gift = null;
    if (kind === "gift") {
      gift = normalizeGift(body.gift);
      if (!gift) return fail("gift");
    }
    let targets;
    if (String(body.to || "") === "*") {
      targets = await Inbox.players(pool, { promo: kind === "promo" });
    } else {
      const u = await MeuMundoStorage.findUserByUsername(pool, String(body.to || "").replace(/^@/, ""));
      if (!u) return fail("to");
      if (kind === "promo" && !(await Inbox.getPrefs(pool, u.id_user)).promos) return { sent: 0, skipped: 1 };
      targets = [u.id_user];
    }
    // Uma carta por pessoa; a chave de envio (opcional) torna o envio repetível sem duplicar.
    const sendKey = /^[A-Za-z0-9_-]{8,64}$/.test(String(body.key || "")) ? String(body.key) : null;
    let sent = 0;
    for (const idUser of targets) {
      const notice = await MeuMundoInboxService.deliver(pool, idUser, {
        kind,
        title,
        body: text,
        gift,
        createdBy: adminId,
        dedupeKey: sendKey ? `send:${sendKey}` : null,
        data: { from: "platform" },
      });
      if (notice) {
        sent += 1;
        push(idUser, notice);
      }
    }
    log.info("send", { kind, targets: targets.length, sent });
    return { sent };
  }

  /**
   * Situação de uma compra de Poléns que voltou do checkout para o jogo. Só
   * lê: quem credita é o confirmador oficial (webhook). Compra de outra
   * pessoa = "não encontrada" (o id da sessão não abre a compra alheia).
   */
  static async polensPurchase(idUser, rawSession) {
    const session = String(rawSession || "");
    if (!/^[A-Za-z0-9_.:-]{6,128}$/.test(session)) return fail("notFound");
    const PolenProductStorage = require("../storages/PolenProductStorage");
    const p = await PolenProductStorage.getPurchaseByStripeSession(pool, session);
    if (!p || String(p.user_id) !== String(idUser)) return fail("notFound");
    return { purchase: { status: p.status, polens: Number(p.polens_credited) || 0 } };
  }

  /**
   * Poléns creditados pelo confirmador oficial do pagamento (webhook do
   * Mercado Pago → PolenProductService). Recibo na caixa, uma vez por sessão
   * — o webhook pode chegar de novo (at-least-once) e não duplica.
   */
  static async polensCredited(idUser, { sessionId, polens, productName }) {
    try {
      const notice = await MeuMundoInboxService.deliver(pool, idUser, {
        kind: "receipt",
        code: "polens_credited",
        title: "Poléns creditados",
        body: "",
        data: { polens, product: productName || null, session: sessionId },
        noticeData: { polens },
        dedupeKey: `polens:${sessionId}`,
      });
      push(idUser, notice);
    } catch (err) {
      // O crédito já foi gravado; o recibo é só aviso. Nunca derruba o webhook.
      log.warn("polens_receipt_fail", { message: err.message });
    }
  }
}

MeuMundoInboxService.normalizeGift = normalizeGift;
MeuMundoInboxService.push = push;

module.exports = MeuMundoInboxService;
