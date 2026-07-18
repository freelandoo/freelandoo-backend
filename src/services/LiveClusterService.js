// src/services/LiveClusterService.js
// Clusters de Live (sala de comando de lives sincronizadas, mig 185).
// Admin: CRUD de cluster/membros/botões + Iniciar/Encerrar + disparo de sinais.
// Membro: lista os próprios clusters e lê o detalhe (lobby).
// Push em tempo real via socket.io room `cluster:<id>` (ver realtime/socket.js):
//   cluster:start   -> todos os membros conectados iniciam a live juntos
//   cluster:end     -> todos encerram juntos
//   cluster:signal  -> botão grande (label+cor) ou caixa de texto na tela de todos
const pool = require("../databases");
const LiveClusterStorage = require("../storages/LiveClusterStorage");
const realtime = require("../realtime/socket");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("LiveClusterService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COLOR_RE = /^#[0-9a-f]{3,8}$/i;
const MAX_NAME = 80;
const MAX_LABEL = 40;
const MAX_TEXT = 280;

// Botões padrão de todo cluster novo (pedido do Alex: start/sim verdes,
// stop/não rosas — grandes na tela de todos).
const DEFAULT_BUTTONS = [
  { label: "START", color: "#22c55e", sort_order: 1 },
  { label: "STOP", color: "#ec4899", sort_order: 2 },
  { label: "SIM", color: "#22c55e", sort_order: 3 },
  { label: "NÃO", color: "#ec4899", sort_order: 4 },
];

function normalizeName(value) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.slice(0, MAX_NAME);
}

function mapCluster(row) {
  if (!row) return null;
  return {
    id_live_cluster: row.id_live_cluster,
    name: row.name,
    status: row.status,
    started_at: row.started_at,
    is_active: row.is_active,
    member_count: row.member_count,
    created_at: row.created_at,
  };
}

class LiveClusterService {
  // ── Admin ──────────────────────────────────────────────────────────────────

  static async adminList() {
    return runWithLogs(log, "adminList", () => ({}), async () => {
      const rows = await LiveClusterStorage.listClusters(pool);
      return { clusters: rows.map(mapCluster) };
    });
  }

  static async adminCreate(user, body = {}) {
    return runWithLogs(
      log,
      "adminCreate",
      () => ({ id_user: user?.id_user }),
      async () => {
        const name = normalizeName(body?.name);
        if (!name) return { error: "Nome do cluster é obrigatório" };
        const cluster = await LiveClusterStorage.createCluster(pool, {
          name,
          created_by: user.id_user,
        });
        // Seed dos botões padrão (START/STOP/SIM/NÃO).
        for (const btn of DEFAULT_BUTTONS) {
          await LiveClusterStorage.createButton(pool, {
            id_live_cluster: cluster.id_live_cluster,
            ...btn,
          });
        }
        return { cluster: mapCluster(cluster) };
      }
    );
  }

  static async adminUpdate(params = {}, body = {}) {
    return runWithLogs(
      log,
      "adminUpdate",
      () => ({ id_live_cluster: params?.id_live_cluster }),
      async () => {
        const id = params?.id_live_cluster;
        if (!id || !UUID_RE.test(id)) return { error: "id_live_cluster inválido" };
        const patch = {};
        if (body?.name != null) {
          const name = normalizeName(body.name);
          if (!name) return { error: "Nome do cluster é obrigatório" };
          patch.name = name;
        }
        if (body?.is_active != null) patch.is_active = !!body.is_active;
        const cluster = await LiveClusterStorage.updateCluster(pool, id, patch);
        if (!cluster) return { error: "Cluster não encontrado" };
        return { cluster: mapCluster(cluster) };
      }
    );
  }

  static async adminDelete(params = {}) {
    return runWithLogs(
      log,
      "adminDelete",
      () => ({ id_live_cluster: params?.id_live_cluster }),
      async () => {
        const id = params?.id_live_cluster;
        if (!id || !UUID_RE.test(id)) return { error: "id_live_cluster inválido" };
        const ok = await LiveClusterStorage.deleteCluster(pool, id);
        if (!ok) return { error: "Cluster não encontrado" };
        // Quem estiver na sala volta pro estado vazio.
        realtime.emitToClusterRoom(id, "cluster:end", { id_live_cluster: id, reason: "deleted" });
        return { deleted: true };
      }
    );
  }

  static async adminDetail(params = {}) {
    return runWithLogs(
      log,
      "adminDetail",
      () => ({ id_live_cluster: params?.id_live_cluster }),
      async () => {
        const id = params?.id_live_cluster;
        if (!id || !UUID_RE.test(id)) return { error: "id_live_cluster inválido" };
        const cluster = await LiveClusterStorage.getClusterById(pool, id);
        if (!cluster) return { error: "Cluster não encontrado" };
        const [members, buttons] = await Promise.all([
          LiveClusterStorage.listMembers(pool, id),
          LiveClusterStorage.listButtons(pool, id),
        ]);
        return { cluster: mapCluster(cluster), members, buttons };
      }
    );
  }

  static async adminAddMember(params = {}, body = {}) {
    return runWithLogs(
      log,
      "adminAddMember",
      () => ({ id_live_cluster: params?.id_live_cluster, username: body?.username }),
      async () => {
        const id = params?.id_live_cluster;
        if (!id || !UUID_RE.test(id)) return { error: "id_live_cluster inválido" };
        const cluster = await LiveClusterStorage.getClusterById(pool, id);
        if (!cluster) return { error: "Cluster não encontrado" };
        const username = String(body?.username || "").trim().replace(/^@/, "");
        if (!username) return { error: "Informe o @username do usuário" };
        const target = await LiveClusterStorage.findUserByUsername(pool, username);
        if (!target) return { error: "Usuário não encontrado" };
        await LiveClusterStorage.addMember(pool, {
          id_live_cluster: id,
          id_user: target.id_user,
        });
        realtime.emitToClusterRoom(id, "cluster:members:changed", { id_live_cluster: id });
        const members = await LiveClusterStorage.listMembers(pool, id);
        return { members };
      }
    );
  }

  static async adminRemoveMember(params = {}) {
    return runWithLogs(
      log,
      "adminRemoveMember",
      () => ({ id_live_cluster: params?.id_live_cluster, id_user: params?.id_user }),
      async () => {
        const id = params?.id_live_cluster;
        const id_user = params?.id_user;
        if (!id || !UUID_RE.test(id)) return { error: "id_live_cluster inválido" };
        if (!id_user || !UUID_RE.test(id_user)) return { error: "id_user inválido" };
        const ok = await LiveClusterStorage.removeMember(pool, {
          id_live_cluster: id,
          id_user,
        });
        if (!ok) return { error: "Membro não encontrado" };
        realtime.emitToClusterRoom(id, "cluster:members:changed", { id_live_cluster: id });
        const members = await LiveClusterStorage.listMembers(pool, id);
        return { members };
      }
    );
  }

  static async adminCreateButton(params = {}, body = {}) {
    return runWithLogs(
      log,
      "adminCreateButton",
      () => ({ id_live_cluster: params?.id_live_cluster }),
      async () => {
        const id = params?.id_live_cluster;
        if (!id || !UUID_RE.test(id)) return { error: "id_live_cluster inválido" };
        const cluster = await LiveClusterStorage.getClusterById(pool, id);
        if (!cluster) return { error: "Cluster não encontrado" };
        const label = String(body?.label || "").trim().slice(0, MAX_LABEL);
        if (!label) return { error: "Texto do botão é obrigatório" };
        const color = COLOR_RE.test(String(body?.color || "")) ? body.color : "#22c55e";
        const sort_order = Number.isInteger(Number(body?.sort_order))
          ? Number(body.sort_order)
          : 0;
        const button = await LiveClusterStorage.createButton(pool, {
          id_live_cluster: id,
          label,
          color,
          sort_order,
        });
        return { button };
      }
    );
  }

  static async adminUpdateButton(params = {}, body = {}) {
    return runWithLogs(
      log,
      "adminUpdateButton",
      () => ({ id_live_cluster: params?.id_live_cluster, id_button: params?.id_button }),
      async () => {
        const id = params?.id_live_cluster;
        const id_button = params?.id_button;
        if (!id || !UUID_RE.test(id)) return { error: "id_live_cluster inválido" };
        if (!id_button || !UUID_RE.test(id_button)) return { error: "id_button inválido" };
        const patch = {};
        if (body?.label != null) {
          const label = String(body.label).trim().slice(0, MAX_LABEL);
          if (!label) return { error: "Texto do botão é obrigatório" };
          patch.label = label;
        }
        if (body?.color != null) {
          if (!COLOR_RE.test(String(body.color))) return { error: "Cor inválida (use hex #rrggbb)" };
          patch.color = body.color;
        }
        if (body?.sort_order != null) patch.sort_order = Number(body.sort_order) || 0;
        if (body?.is_active != null) patch.is_active = !!body.is_active;
        const button = await LiveClusterStorage.updateButton(pool, {
          id_live_cluster: id,
          id_button,
          ...patch,
        });
        if (!button) return { error: "Botão não encontrado" };
        return { button };
      }
    );
  }

  static async adminDeleteButton(params = {}) {
    return runWithLogs(
      log,
      "adminDeleteButton",
      () => ({ id_live_cluster: params?.id_live_cluster, id_button: params?.id_button }),
      async () => {
        const id = params?.id_live_cluster;
        const id_button = params?.id_button;
        if (!id || !UUID_RE.test(id)) return { error: "id_live_cluster inválido" };
        if (!id_button || !UUID_RE.test(id_button)) return { error: "id_button inválido" };
        const ok = await LiveClusterStorage.deleteButton(pool, {
          id_live_cluster: id,
          id_button,
        });
        if (!ok) return { error: "Botão não encontrado" };
        return { deleted: true };
      }
    );
  }

  // Iniciar: todos os membros conectados começam a live na mesma hora.
  static async adminStart(params = {}) {
    return runWithLogs(
      log,
      "adminStart",
      () => ({ id_live_cluster: params?.id_live_cluster }),
      async () => {
        const id = params?.id_live_cluster;
        if (!id || !UUID_RE.test(id)) return { error: "id_live_cluster inválido" };
        const cluster = await LiveClusterStorage.getClusterById(pool, id);
        if (!cluster) return { error: "Cluster não encontrado" };
        if (!cluster.is_active) return { error: "Cluster desativado" };
        const updated = await LiveClusterStorage.setStatus(pool, id, { status: "started" });
        if (!updated) return { error: "O cluster já está iniciado" };
        realtime.emitToClusterRoom(id, "cluster:start", {
          id_live_cluster: id,
          started_at: updated.started_at,
        });
        return { cluster: mapCluster({ ...cluster, ...updated }) };
      }
    );
  }

  static async adminEnd(params = {}) {
    return runWithLogs(
      log,
      "adminEnd",
      () => ({ id_live_cluster: params?.id_live_cluster }),
      async () => {
        const id = params?.id_live_cluster;
        if (!id || !UUID_RE.test(id)) return { error: "id_live_cluster inválido" };
        const cluster = await LiveClusterStorage.getClusterById(pool, id);
        if (!cluster) return { error: "Cluster não encontrado" };
        const updated = await LiveClusterStorage.setStatus(pool, id, { status: "idle" });
        if (!updated) return { error: "O cluster não está iniciado" };
        realtime.emitToClusterRoom(id, "cluster:end", {
          id_live_cluster: id,
          reason: "ended",
        });
        return { cluster: mapCluster({ ...cluster, ...updated }) };
      }
    );
  }

  // Sinal: botão grande (kind='button') ou caixa de texto (kind='text').
  // Efêmero — só passa pelo socket, nada persiste.
  static async adminSignal(user, params = {}, body = {}) {
    return runWithLogs(
      log,
      "adminSignal",
      () => ({ id_live_cluster: params?.id_live_cluster, kind: body?.kind }),
      async () => {
        const id = params?.id_live_cluster;
        if (!id || !UUID_RE.test(id)) return { error: "id_live_cluster inválido" };
        const cluster = await LiveClusterStorage.getClusterById(pool, id);
        if (!cluster) return { error: "Cluster não encontrado" };

        const kind = body?.kind;
        let signal = null;
        if (kind === "button") {
          const id_button = body?.id_button;
          if (!id_button || !UUID_RE.test(id_button)) return { error: "id_button inválido" };
          const button = await LiveClusterStorage.getButtonById(pool, {
            id_live_cluster: id,
            id_button,
          });
          if (!button || !button.is_active) return { error: "Botão não encontrado" };
          signal = {
            kind: "button",
            id_button: button.id_button,
            label: button.label,
            color: button.color,
          };
        } else if (kind === "text") {
          const text = String(body?.text || "").trim().slice(0, MAX_TEXT);
          if (!text) return { error: "Texto é obrigatório" };
          signal = { kind: "text", text };
        } else {
          return { error: "kind inválido (button|text)" };
        }

        realtime.emitToClusterRoom(id, "cluster:signal", {
          id_live_cluster: id,
          ...signal,
          // id único do disparo: o mesmo botão apertado 2x re-anima na tela.
          signal_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          at: new Date().toISOString(),
        });
        return { sent: true, signal };
      }
    );
  }

  // ── Membro ─────────────────────────────────────────────────────────────────

  static async listMine(user) {
    return runWithLogs(
      log,
      "listMine",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const rows = await LiveClusterStorage.listClustersForUser(pool, user.id_user);
        return { clusters: rows.map(mapCluster) };
      }
    );
  }

  // Detalhe pro lobby do membro: cluster + botões ativos (pra pré-carregar as
  // cores dos sinais) + lista de membros (quem faz parte).
  static async memberDetail(user, params = {}) {
    return runWithLogs(
      log,
      "memberDetail",
      () => ({ id_user: user?.id_user, id_live_cluster: params?.id_live_cluster }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id = params?.id_live_cluster;
        if (!id || !UUID_RE.test(id)) return { error: "id_live_cluster inválido" };
        const cluster = await LiveClusterStorage.getClusterById(pool, id);
        if (!cluster || !cluster.is_active) return { error: "Cluster não encontrado" };
        const allowed = await LiveClusterStorage.canAccessCluster(pool, {
          id_live_cluster: id,
          id_user: user.id_user,
        });
        if (!allowed) {
          return { error: "Você não faz parte deste cluster", statusCode: 403 };
        }
        const [members, buttons] = await Promise.all([
          LiveClusterStorage.listMembers(pool, id),
          LiveClusterStorage.listButtons(pool, id, { onlyActive: true }),
        ]);
        return { cluster: mapCluster(cluster), members, buttons };
      }
    );
  }
}

module.exports = LiveClusterService;
