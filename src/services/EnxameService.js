const pool = require("../databases");
const EnxameStorage = require("../storages/EnxameStorage");

class ServiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function listPublicEnxames() {
  const enxames = await EnxameStorage.listEnxamesWithCategories(pool, {
    include_inactive: false,
  });
  return { enxames };
}

async function listAllEnxames() {
  const enxames = await EnxameStorage.listEnxamesWithCategories(pool, {
    include_inactive: true,
  });
  return { enxames };
}

async function listCategoriesOfEnxame(id_enxame, { include_inactive = false } = {}) {
  if (!id_enxame) throw new ServiceError("id_enxame obrigatório", 400);
  const enxame = await EnxameStorage.getEnxameById(pool, id_enxame);
  if (!enxame) throw new ServiceError("Enxame não encontrado", 404);
  const categories = await EnxameStorage.listCategoriesByEnxame(pool, id_enxame, {
    include_inactive,
  });
  return { enxame, categories };
}

// ─────────────────── Admin ───────────────────
async function setEnxameStatus(actor, id_enxame, { is_active, reason }) {
  const before = await EnxameStorage.getEnxameById(pool, id_enxame);
  if (!before) throw new ServiceError("Enxame não encontrado", 404);

  const after = await EnxameStorage.updateEnxameStatus(pool, {
    id_enxame,
    is_active: !!is_active,
  });

  await EnxameStorage.writeAudit(pool, {
    entity: "enxame",
    entity_id: id_enxame,
    action: is_active ? "enable" : "disable",
    before_state: before,
    after_state: after,
    reason: reason || null,
    actor_user_id: actor.id_user,
  });

  return after;
}

async function updateEnxame(actor, id_enxame, body) {
  const before = await EnxameStorage.getEnxameById(pool, id_enxame);
  if (!before) throw new ServiceError("Enxame não encontrado", 404);

  const fields = {};
  if (body.name != null) fields.name = String(body.name).trim();
  if (body.display_order != null) fields.display_order = Number(body.display_order);
  for (const k of ["color_from", "color_to", "color_glow", "color_ring", "color_accent", "color_text", "icon_name"]) {
    if (body[k] != null) fields[k] = String(body[k]);
  }
  if (body.description !== undefined) {
    fields.description = body.description == null ? null : String(body.description).trim() || null;
  }

  const after = await EnxameStorage.updateEnxame(pool, { id_enxame, fields });

  await EnxameStorage.writeAudit(pool, {
    entity: "enxame",
    entity_id: id_enxame,
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

async function createEnxame(actor, body) {
  const name = String(body?.name || "").trim();
  if (!name) throw new ServiceError("name obrigatório", 400);

  let slug = String(body?.slug || "").trim() || slugify(name);
  slug = slugify(slug);
  if (!slug) throw new ServiceError("slug inválido", 400);

  const existing = await EnxameStorage.getEnxameBySlug(pool, slug);
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

  const row = await EnxameStorage.createEnxame(pool, { fields });

  await EnxameStorage.writeAudit(pool, {
    entity: "enxame",
    entity_id: row.id_machine,
    action: "create",
    after_state: row,
    actor_user_id: actor.id_user,
  });

  return row;
}

async function deleteEnxame(actor, id_enxame, { reason } = {}) {
  const before = await EnxameStorage.getEnxameById(pool, id_enxame);
  if (!before) throw new ServiceError("Enxame não encontrado", 404);

  const deleted = await EnxameStorage.deleteEnxame(pool, id_enxame);

  await EnxameStorage.writeAudit(pool, {
    entity: "enxame",
    entity_id: id_enxame,
    action: "delete",
    before_state: before,
    after_state: null,
    reason: reason || null,
    actor_user_id: actor.id_user,
  });

  return deleted;
}

async function addCategory(actor, id_enxame, { desc_category }) {
  if (!desc_category || typeof desc_category !== "string" || !desc_category.trim()) {
    throw new ServiceError("desc_category obrigatório", 400);
  }
  const enxame = await EnxameStorage.getEnxameById(pool, id_enxame);
  if (!enxame) throw new ServiceError("Enxame não encontrado", 404);

  const { row, created } = await EnxameStorage.addCategoryToEnxame(pool, {
    id_enxame,
    desc_category: desc_category.trim(),
  });

  await EnxameStorage.writeAudit(pool, {
    entity: "category",
    entity_id: row.id_category,
    action: created ? "create" : "reassign",
    after_state: row,
    actor_user_id: actor.id_user,
  });

  return row;
}

async function updateCategory(actor, id_category, body) {
  const before = await EnxameStorage.getCategoryById(pool, id_category);
  if (!before) throw new ServiceError("Profissão não encontrada", 404);

  const fields = {};
  if (body.desc_category != null) {
    const s = String(body.desc_category).trim();
    if (!s) throw new ServiceError("desc_category não pode ficar vazio", 400);
    fields.desc_category = s;
  }
  if (body.is_active != null) fields.is_active = !!body.is_active;
  if (body.id_enxame !== undefined) {
    if (body.id_enxame === null) {
      fields.id_machine = null;
    } else {
      const m = await EnxameStorage.getEnxameById(pool, Number(body.id_enxame));
      if (!m) throw new ServiceError("Enxame destino não encontrado", 404);
      fields.id_machine = m.id_machine;
    }
  }

  const after = await EnxameStorage.updateCategory(pool, { id_category, fields });

  await EnxameStorage.writeAudit(pool, {
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
  listPublicEnxames,
  listAllEnxames,
  listCategoriesOfEnxame,
  // admin
  setEnxameStatus,
  updateEnxame,
  createEnxame,
  deleteEnxame,
  addCategory,
  updateCategory,
};
