// src/services/ResidenceService.js
// Vínculo de morador: reivindicação, reconhecimento, contestação, comprovante.
// Subsistema 3 do desenho macro (spec §7).
//
// A tese do subsistema, em uma frase: **a máquina garante o ONDE, as pessoas
// garantem o QUEM**. O ViaCEP (mig 202) prova que o endereço existe e a que
// bairro pertence; que VOCÊ mora ali só os vizinhos sabem. Por isso não existe
// aqui nenhuma tentativa de "validar residência" — existe um processo social
// com quatro degraus e um invariante:
//
//   NENHUM DEGRAU REMOVE MORADOR EXISTENTE AUTOMATICAMENTE (§7.1).
//
// Isso inverte o condomínio de hoje, onde aprovar uma reivindicação transfere a
// titularidade e o morador anterior perde a unidade em silêncio. Remoção passa
// a exigir decisão humana explícita, com motivo gravado.

const pool = require("../databases");
const ResidenceStorage = require("../storages/ResidenceStorage");
const TerritoryService = require("./TerritoryService");
const NotificationService = require("./NotificationService");
const FraudService = require("./FraudService");
const { isMinorUser, hasMinorPermission } = require("../utils/supervision");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ResidenceService");

// Degrau 2: silêncio dos co-moradores por 7 dias.
const RECOGNITION_WINDOW_DAYS = 7;

// Teto anti-oráculo (§11): reivindicar é uma sonda barata para descobrir se uma
// unidade está ocupada. O teto não elimina o vazamento — o TEMPO até a
// resolução ainda distingue os casos — mas transforma varredura em custo.
const MAX_CLAIMS_PER_DAY = 3;

class ResidenceService {
  /**
   * O caminho principal. CEP + número (+ complemento) → árvore (mig 202) →
   * vínculo no degrau certo.
   *
   * Degrau 0 (unidade vazia) → reconhecido na hora, sem fricção: é o caso
   * comum, e cobrar aprovação de quem chega numa casa vazia seria fricção sem
   * ninguém do outro lado para aprovar.
   */
  static async claim({ id_user, cep, numero, complemento = null }, conn = pool) {
    return runWithLogs(
      log,
      "claim",
      // §11: CEP, número e complemento NUNCA entram em log. Só o suficiente
      // para achar o problema depois.
      () => ({ id_user }),
      async () => {
        if (!id_user) return { error: "Não autenticado.", statusCode: 401 };

        const blocked = await this._assertNotBlocked(id_user, conn);
        if (blocked) return blocked;

        // D15: o menor não reivindica — herda do responsável. Recusar aqui é o
        // que garante que nenhuma criança entre na fila de reivindicação, que
        // nenhum vizinho a conteste e que a plataforma não colete endereço de
        // menor.
        if (await isMinorUser(id_user, conn)) {
          return {
            error:
              "Conta supervisionada não declara endereço: a residência vem do responsável.",
            statusCode: 403,
          };
        }

        const claimsToday = await ResidenceStorage.countClaimsToday(conn, id_user);
        if (claimsToday >= MAX_CLAIMS_PER_DAY) {
          return {
            error: "Muitas reivindicações de residência hoje. Tente amanhã.",
            statusCode: 429,
          };
        }

        const resolved = await TerritoryService.resolveResidence(
          { cep, numero, complemento },
          conn
        );
        if (resolved?.error) return resolved;
        if (!resolved?.verified) {
          // ViaCEP fora do ar e sem cache (§6.4): não inventamos território, e
          // também não travamos a pessoa — ela tenta de novo.
          return {
            error: "Não foi possível confirmar o endereço agora. Tente novamente em instantes.",
            statusCode: 503,
            reason: resolved?.reason || "unverified",
          };
        }

        const link = await this._linkUser(conn, {
          id_unit: resolved.unit.id_unit,
          id_user,
        });

        // Fire-and-forget: nem o antifraude nem a cascata de menores podem
        // derrubar uma reivindicação legítima.
        this._afterClaim(id_user, resolved.unit.id_unit, link).catch(() => {});

        return {
          residence: link,
          territory: resolved.territory,
          unit: { id_unit: resolved.unit.id_unit, label: resolved.unit.label },
          logradouro: resolved.logradouro,
        };
      }
    );
  }

  /**
   * Cria o vínculo no degrau certo. Roda com a unidade TRAVADA porque a decisão
   * depende da AUSÊNCIA de co-moradores: sem o lock, duas pessoas reivindicando
   * uma unidade vazia no mesmo instante virariam duas "primeiras", ambas
   * reconhecidas sem ninguém ter reconhecido nada.
   */
  static async _linkUser(conn, { id_unit, id_user, derived_from = null }) {
    // Só abre transação própria quando recebeu o pool: se já veio um client de
    // transação de fora, o lock tem que valer na transação DE QUEM CHAMOU.
    const useTx = conn === pool;
    const client = useTx ? await pool.connect() : conn;
    try {
      if (useTx) await client.query("BEGIN");
      await ResidenceStorage.lockUnit(client, id_unit);

      const existing = await ResidenceStorage.getActiveForUserInUnit(client, {
        id_unit,
        id_user,
      });
      if (existing) {
        if (useTx) await client.query("COMMIT");
        return existing;
      }

      const neighbors = await ResidenceStorage.listRecognizedInUnit(client, id_unit, {
        exclude_user: id_user,
      });

      // Vínculo derivado (menor) segue o do responsável: ele não passa por
      // reconhecimento porque não é ele quem está afirmando morar ali.
      const isEmpty = neighbors.length === 0;
      const status = derived_from !== null || isEmpty ? "recognized" : "pending";
      const pendingUntil =
        status === "pending"
          ? new Date(Date.now() + RECOGNITION_WINDOW_DAYS * 24 * 60 * 60 * 1000)
          : null;

      const link = await ResidenceStorage.createLink(client, {
        id_unit,
        id_user,
        status,
        pending_until: pendingUntil,
        derived_from,
      });

      if (useTx) await client.query("COMMIT");

      if (status === "pending") {
        this._notifyNeighbors(neighbors, { link, id_user }).catch(() => {});
      }
      return link;
    } catch (err) {
      if (useTx) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* conexão pode estar inutilizável */
        }
      }
      throw err;
    } finally {
      if (useTx) client.release();
    }
  }

  /**
   * Reconhecer. Só morador reconhecido da MESMA unidade pode — é o que dá peso
   * ao ato: quem reconhece está dizendo "essa pessoa mora comigo".
   */
  static async recognize({ id_residence, id_user }, conn = pool) {
    return runWithLogs(log, "recognize", () => ({ id_residence, id_user }), async () => {
      const target = await ResidenceStorage.getById(conn, id_residence);
      if (!target || target.ended_at) {
        return { error: "Vínculo não encontrado.", statusCode: 404 };
      }
      const guard = await this._assertCanJudge(conn, { target, id_user });
      if (guard) return guard;

      await ResidenceStorage.upsertVote(conn, {
        id_residence,
        id_user,
        action: "recognize",
      });

      // Um reconhecimento basta (§7, degrau 1). Exigir unanimidade daria a
      // qualquer vizinho um veto silencioso — que é justamente o que a
      // contestação explícita existe para evitar.
      const updated = await ResidenceStorage.setStatus(conn, id_residence, "recognized", {
        recognized_by: id_user,
      });

      NotificationService.notifyResidenceRecognized({
        recipient_user_id: target.id_user,
        actor_user_id: id_user,
        id_residence,
      }).catch(() => {});

      return { residence: updated };
    });
  }

  /**
   * Contestar. NÃO remove ninguém (§7.3) — marca divergência e chama decisão
   * humana. Contestação em série vira sinal antifraude, e o histórico fica
   * visível para quem decide, senão contestar seria arma sem custo.
   */
  static async contest({ id_residence, id_user, reason = null }, conn = pool) {
    return runWithLogs(log, "contest", () => ({ id_residence, id_user }), async () => {
      const target = await ResidenceStorage.getById(conn, id_residence);
      if (!target || target.ended_at) {
        return { error: "Vínculo não encontrado.", statusCode: 404 };
      }
      const guard = await this._assertCanJudge(conn, { target, id_user });
      if (guard) return guard;

      const note = typeof reason === "string" ? reason.trim().slice(0, 500) : null;
      await ResidenceStorage.upsertVote(conn, {
        id_residence,
        id_user,
        action: "contest",
        reason: note,
      });
      const updated = await ResidenceStorage.setStatus(conn, id_residence, "contested");

      NotificationService.notifyResidenceContested({
        recipient_user_id: target.id_user,
        actor_user_id: id_user,
        id_residence,
      }).catch(() => {});

      // O sinal é do CONTESTADO e do CONTESTANTE: um pode estar mentindo, o
      // outro pode estar usando contestação como arma. Os dois pontuam baixo e
      // nenhum bloqueia nada — quem decide é o humano no painel.
      FraudService.evaluateResidence(target.id_user).catch(() => {});
      FraudService.evaluateResidence(id_user).catch(() => {});

      return { residence: updated };
    });
  }

  /** Meus vínculos. */
  static async listMine(id_user, conn = pool) {
    if (!id_user) return { error: "Não autenticado.", statusCode: 401 };
    const rows = await ResidenceStorage.listForUser(conn, id_user);
    return { residences: rows };
  }

  /** O que ESTE morador pode julgar. */
  static async listPending(id_user, conn = pool) {
    if (!id_user) return { error: "Não autenticado.", statusCode: 401 };
    const rows = await ResidenceStorage.listPendingForJudge(conn, id_user);
    return { pending: rows };
  }

  /**
   * Vizinhos da unidade. Menor NÃO aparece para outros moradores (§7.4,
   * bloqueio duro 1): impede que os adultos do prédio descubram que há uma
   * criança na unidade X. O gestor e o próprio responsável continuam vendo.
   */
  static async listNeighbors({ id_unit, id_user }, conn = pool) {
    if (!id_user) return { error: "Não autenticado.", statusCode: 401 };
    const mine = await ResidenceStorage.getActiveForUserInUnit(conn, { id_unit, id_user });
    if (!mine || mine.status !== "recognized") {
      return { error: "Somente moradores reconhecidos veem esta lista.", statusCode: 403 };
    }
    const rows = await ResidenceStorage.listInUnit(conn, id_unit);
    const visible = rows.filter(
      (r) =>
        !r.is_minor ||
        String(r.id_user) === String(id_user) ||
        String(r.derived_from || "") === String(id_user)
    );
    return { neighbors: visible };
  }

  /**
   * Sair. Saída é SEMPRE livre (D7: o que a carência restringe é a próxima
   * entrada, nunca a saída). Os menores que dependem deste vínculo saem junto.
   */
  static async leave({ id_residence, id_user, reason = "left" }, conn = pool) {
    return runWithLogs(log, "leave", () => ({ id_residence, id_user }), async () => {
      const link = await ResidenceStorage.getById(conn, id_residence);
      if (!link || link.ended_at) {
        return { error: "Vínculo não encontrado.", statusCode: 404 };
      }
      if (String(link.id_user) !== String(id_user)) {
        return { error: "Este vínculo não é seu.", statusCode: 403 };
      }
      const allowed = new Set(["left", "moved"]);
      const end = allowed.has(reason) ? reason : "left";

      const ended = await ResidenceStorage.endLink(conn, id_residence, {
        reason: end,
        by_user: id_user,
      });
      const derived = await ResidenceStorage.endDerivedLinks(conn, {
        id_unit: link.id_unit,
        responsible: id_user,
      });
      return { residence: ended, derived_ended: derived.length };
    });
  }

  /**
   * Vincula os menores supervisionados a esta unidade (D15). Chamado quando o
   * responsável vira morador reconhecido.
   *
   * Silencioso por design: falta de permissão parental não é erro, é o default
   * (`can_join_territorial` nasce FALSE) — o menor pede, o responsável libera.
   */
  static async syncMinors({ id_user, id_unit }, conn = pool) {
    try {
      const minors = await conn.query(
        `SELECT minor_user_id FROM public.supervised_accounts
          WHERE responsible_user_id = $1 AND status = 'active'`,
        [id_user]
      );
      let linked = 0;
      for (const row of minors.rows) {
        const ok = await hasMinorPermission(
          row.minor_user_id,
          "can_join_territorial",
          conn
        );
        if (!ok) continue;
        await this._linkUser(conn, {
          id_unit,
          id_user: row.minor_user_id,
          derived_from: id_user,
        });
        linked += 1;
      }
      return linked;
    } catch (err) {
      log.warn("syncMinors.fail", { id_user, error: err?.message });
      return 0;
    }
  }

  /* ------------------------------ comprovante ----------------------------- */

  /**
   * Envio do comprovante. Quem LÊ é o admin da plataforma (D13) — o gestor de
   * bairro é um vizinho, e entregar a ele a conta de luz alheia transformaria a
   * governança local em coleta de documentos.
   */
  static async submitProof({ id_residence, id_user, storage_key }, conn = pool) {
    return runWithLogs(log, "submitProof", () => ({ id_residence, id_user }), async () => {
      const link = await ResidenceStorage.getById(conn, id_residence);
      if (!link || link.ended_at) {
        return { error: "Vínculo não encontrado.", statusCode: 404 };
      }
      if (String(link.id_user) !== String(id_user)) {
        return { error: "Este vínculo não é seu.", statusCode: 403 };
      }
      if (!storage_key) return { error: "Envie o arquivo.", statusCode: 400 };

      const proof = await ResidenceStorage.createProof(conn, {
        id_residence,
        storage_key,
      });
      return { proof: { id_proof: proof.id_proof, status: proof.status } };
    });
  }

  /** Fila do admin da plataforma. */
  static async listProofQueue({ status = "pending", page = 1, per_page = 50 }, conn = pool) {
    const limit = Math.min(Number(per_page) || 50, 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
    const rows = await ResidenceStorage.listProofQueue(conn, { status, limit, offset });
    return { proofs: rows };
  }

  /**
   * Veredito do admin. Aprovar reconhece o vínculo; recusar ENCERRA com motivo
   * — e é este o único caminho pelo qual alguém perde a residência sem ter
   * pedido para sair (§7.1: decisão humana explícita, motivo gravado).
   */
  static async decideProof({ id_proof, status, note, admin_user_id }, conn = pool) {
    return runWithLogs(log, "decideProof", () => ({ id_proof, status }), async () => {
      if (!["approved", "rejected"].includes(status)) {
        return { error: "Decisão inválida.", statusCode: 400 };
      }
      const proof = await ResidenceStorage.decideProof(conn, {
        id_proof,
        status,
        note,
        reviewed_by: admin_user_id,
      });
      if (!proof) return { error: "Comprovante não encontrado ou já decidido.", statusCode: 404 };

      const link = await ResidenceStorage.getById(conn, proof.id_residence);
      if (link && !link.ended_at) {
        if (status === "approved") {
          await ResidenceStorage.setStatus(conn, link.id_residence, "recognized", {
            recognized_by: admin_user_id,
          });
          this.syncMinors({ id_user: link.id_user, id_unit: link.id_unit }, conn).catch(
            () => {}
          );
        } else {
          await ResidenceStorage.endLink(conn, link.id_residence, {
            reason: "rejected",
            by_user: admin_user_id,
          });
        }
        NotificationService.notifyResidenceProofDecided({
          recipient_user_id: link.id_user,
          actor_user_id: admin_user_id,
          id_residence: link.id_residence,
          approved: status === "approved",
        }).catch(() => {});
      }
      return { proof };
    });
  }

  /* -------------------------------- sweeper ------------------------------- */

  /**
   * Degrau 2. Roda no boot e a cada 6h: pendente que estourou 7 dias vira NÃO
   * RECONHECIDO — que não é recusa. A pessoa lê o feed, não publica, não vota,
   * não vê vizinhos, e qualquer co-morador ainda pode reconhecê-la depois.
   */
  static async sweepExpiredClaims() {
    try {
      const rows = await ResidenceStorage.sweepExpiredPending(pool);
      if (rows.length) {
        log.info("residence.sweep", { downgraded: rows.length });
      }
      return rows.length;
    } catch (err) {
      log.error("sweepExpiredClaims.fail", { error: err?.message });
      return 0;
    }
  }

  static startSweeper() {
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    this.sweepExpiredClaims().catch(() => {});
    const timer = setInterval(() => {
      this.sweepExpiredClaims().catch(() => {});
    }, SIX_HOURS);
    if (typeof timer.unref === "function") timer.unref();
    return timer;
  }

  /* -------------------------------- internos ------------------------------ */

  static async _assertNotBlocked(id_user, conn) {
    // §10: usuário já bloqueado no painel não reivindica residência.
    const r = await conn.query(
      `SELECT blocked_at FROM public.tb_user WHERE id_user = $1 LIMIT 1`,
      [id_user]
    );
    if (r.rowCount && r.rows[0].blocked_at) {
      return { error: "Conta bloqueada.", statusCode: 403 };
    }
    return null;
  }

  /**
   * Quem pode reconhecer/contestar: morador RECONHECIDO da mesma unidade,
   * maior de idade, e nunca sobre si mesmo.
   */
  static async _assertCanJudge(conn, { target, id_user }) {
    if (String(target.id_user) === String(id_user)) {
      return { error: "Ninguém reconhece a si mesmo.", statusCode: 403 };
    }
    // §7.4, bloqueio duro 4: decidir quem mora onde não é papel de menor.
    if (await isMinorUser(id_user, conn)) {
      return { error: "Conta supervisionada não decide reivindicação.", statusCode: 403 };
    }
    const mine = await ResidenceStorage.getActiveForUserInUnit(conn, {
      id_unit: target.id_unit,
      id_user,
    });
    if (!mine || mine.status !== "recognized") {
      return {
        error: "Somente moradores reconhecidos desta unidade podem decidir.",
        statusCode: 403,
      };
    }
    if (!["pending", "unrecognized", "contested"].includes(target.status)) {
      return { error: "Este vínculo não está em julgamento.", statusCode: 409 };
    }
    return null;
  }

  static async _notifyNeighbors(neighbors, { link, id_user }) {
    for (const n of neighbors) {
      // §11: o corpo da notificação nunca cita endereço nem unidade de
      // terceiro. Quem recebe já sabe onde mora; o que ele precisa saber é que
      // alguém está dizendo morar com ele.
      await NotificationService.notifyResidenceClaimPending({
        recipient_user_id: n.id_user,
        actor_user_id: id_user,
        id_residence: link.id_residence,
      }).catch(() => {});
    }
  }

  static async _afterClaim(id_user, id_unit, link) {
    if (link?.status === "recognized") {
      await this.syncMinors({ id_user, id_unit });
    }
    await FraudService.evaluateResidence(id_user);
  }
}

module.exports = ResidenceService;
