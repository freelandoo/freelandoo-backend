const pool = require("../databases");
const MachineStorage = require("../storages/MachineStorage");

class ServiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function listPublicMachines() {
  const machines = await MachineStorage.listMachinesWithCategories(pool, {
    include_inactive: false,
  });
  return { machines };
}

async function listAllMachines() {
  const machines = await MachineStorage.listMachinesWithCategories(pool, {
    include_inactive: true,
  });
  return { machines };
}

async function listCategoriesOfMachine(id_machine, { include_inactive = false } = {}) {
  if (!id_machine) throw new ServiceError("id_machine obrigatório", 400);
  const machine = await MachineStorage.getMachineById(pool, id_machine);
  if (!machine) throw new ServiceError("Máquina não encontrada", 404);
  const categories = await MachineStorage.listCategoriesByMachine(pool, id_machine, {
    include_inactive,
  });
  return { machine, categories };
}

// ─────────────────── Admin ───────────────────
async function setMachineStatus(actor, id_machine, { is_active, reason }) {
  const before = await MachineStorage.getMachineById(pool, id_machine);
  if (!before) throw new ServiceError("Máquina não encontrada", 404);

  const after = await MachineStorage.updateMachineStatus(pool, {
    id_machine,
    is_active: !!is_active,
  });

  await MachineStorage.writeAudit(pool, {
    entity: "machine",
    entity_id: id_machine,
    action: is_active ? "enable" : "disable",
    before_state: before,
    after_state: after,
    reason: reason || null,
    actor_user_id: actor.id_user,
  });

  return after;
}

async function updateMachine(actor, id_machine, body) {
  const before = await MachineStorage.getMachineById(pool, id_machine);
  if (!before) throw new ServiceError("Máquina não encontrada", 404);

  const fields = {};
  if (body.name != null) fields.name = String(body.name).trim();
  if (body.display_order != null) fields.display_order = Number(body.display_order);
  for (const k of ["color_from", "color_to", "color_glow", "color_ring", "color_accent", "color_text", "icon_name"]) {
    if (body[k] != null) fields[k] = String(body[k]);
  }
  if (body.description !== undefined) {
    fields.description = body.description == null ? null : String(body.description).trim() || null;
  }

  const after = await MachineStorage.updateMachine(pool, { id_machine, fields });

  await MachineStorage.writeAudit(pool, {
    entity: "machine",
    entity_id: id_machine,
    action: "update",
    before_state: before,
    after_state: after,
    actor_user_id: actor.id_user,
  });

  return after;
}

function slugify(input) {
  return String(input || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

async function createMachine(actor, body) {
  const name = String(body?.name || "").trim();
  if (!name) throw new ServiceError("name obrigatório", 400);

  let slug = String(body?.slug || "").trim() || slugify(name);
  slug = slugify(slug);
  if (!slug) throw new ServiceError("slug inválido", 400);

  const existing = await MachineStorage.getMachineBySlug(pool, slug);
  if (existing) throw new ServiceError("Slug já existe", 409);

  const fields = {
    slug,
    name,
    display_order: Number.isFinite(Number(body?.display_order))
      ? Number(body.display_order)
      : 99,
    is_active: body?.is_active === false ? false : true,
  };
  for (const k of ["color_from", "color_to", "color_glow", "color_ring", "color_accent", "color_text", "icon_name"]) {
    if (body?.[k] != null) fields[k] = String(body[k]);
  }
  if (body?.description != null) {
    const d = String(body.description).trim();
    if (d) fields.description = d;
  }

  const row = await MachineStorage.createMachine(pool, { fields });

  await MachineStorage.writeAudit(pool, {
    entity: "machine",
    entity_id: row.id_machine,
    action: "create",
    after_state: row,
    actor_user_id: actor.id_user,
  });

  return row;
}

async function deleteMachine(actor, id_machine, { reason } = {}) {
  const before = await MachineStorage.getMachineById(pool, id_machine);
  if (!before) throw new ServiceError("Máquina não encontrada", 404);

  const deleted = await MachineStorage.deleteMachine(pool, id_machine);

  await MachineStorage.writeAudit(pool, {
    entity: "machine",
    entity_id: id_machine,
    action: "delete",
    before_state: before,
    after_state: null,
    reason: reason || null,
    actor_user_id: actor.id_user,
  });

  return deleted;
}

async function addCategory(actor, id_machine, { desc_category }) {
  if (!desc_category || typeof desc_category !== "string" || !desc_category.trim()) {
    throw new ServiceError("desc_category obrigatório", 400);
  }
  const machine = await MachineStorage.getMachineById(pool, id_machine);
  if (!machine) throw new ServiceError("Máquina não encontrada", 404);

  const { row, created } = await MachineStorage.addCategoryToMachine(pool, {
    id_machine,
    desc_category: desc_category.trim(),
  });

  await MachineStorage.writeAudit(pool, {
    entity: "category",
    entity_id: row.id_category,
    action: created ? "create" : "reassign",
    after_state: row,
    actor_user_id: actor.id_user,
  });

  return row;
}

async function updateCategory(actor, id_category, body) {
  const before = await MachineStorage.getCategoryById(pool, id_category);
  if (!before) throw new ServiceError("Profissão não encontrada", 404);

  const fields = {};
  if (body.desc_category != null) {
    const s = String(body.desc_category).trim();
    if (!s) throw new ServiceError("desc_category não pode ficar vazio", 400);
    fields.desc_category = s;
  }
  if (body.is_active != null) fields.is_active = !!body.is_active;
  if (body.id_machine !== undefined) {
    if (body.id_machine === null) {
      fields.id_machine = null;
    } else {
      const m = await MachineStorage.getMachineById(pool, Number(body.id_machine));
      if (!m) throw new ServiceError("Máquina destino não encontrada", 404);
      fields.id_machine = m.id_machine;
    }
  }

  const after = await MachineStorage.updateCategory(pool, { id_category, fields });

  await MachineStorage.writeAudit(pool, {
    entity: "category",
    entity_id: id_category,
    action: "update",
    before_state: before,
    after_state: after,
    actor_user_id: actor.id_user,
  });

  return after;
}

module.exports = {
  ServiceError,
  listPublicMachines,
  listAllMachines,
  listCategoriesOfMachine,
  // admin
  setMachineStatus,
  updateMachine,
  createMachine,
  deleteMachine,
  addCategory,
  updateCategory,
};
