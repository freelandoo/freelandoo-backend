const crypto = require("crypto");
const LegalDocumentsStorage = require("../storages/LegalDocumentsStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("LegalDocumentsService");

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function isUuid(v) {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v
    )
  );
}

function normalizeType(t) {
  if (!t || typeof t !== "string") return null;
  return t.trim();
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

class LegalDocumentsService {
  static async list({ document_type, active } = {}) {
    return runWithLogs(
      log,
      "list",
      () => ({ hasDocumentType: !!document_type, active }),
      async () =>
        LegalDocumentsStorage.list({
          document_type: document_type ? normalizeType(document_type) : null,
          active: active ?? "true",
        })
    );
  }

  static async getById(id_legal_document) {
    return runWithLogs(
      log,
      "getById",
      () => ({ id_legal_document }),
      async () => {
        if (!isUuid(id_legal_document))
          throw httpError(400, "id_legal_document inválido");

        const doc = await LegalDocumentsStorage.getById(id_legal_document);
        if (!doc) throw httpError(404, "Documento não encontrado");

        return doc;
      }
    );
  }

  static async getActiveByType(document_type) {
    return runWithLogs(
      log,
      "getActiveByType",
      () => ({ document_type }),
      async () => {
        const type = normalizeType(document_type);
        if (!type) throw httpError(400, "document_type inválido");

        const doc = await LegalDocumentsStorage.getActiveByType(type);
        if (!doc) throw httpError(404, "Nenhum documento ativo para este tipo");

        return doc;
      }
    );
  }

  static async create({
    version,
    document_type,
    title,
    content,
    document_hash,
    created_by,
  }) {
    return runWithLogs(
      log,
      "create",
      () => ({ created_by, document_type }),
      async () => {
        if (!version || typeof version !== "string" || !version.trim())
          throw httpError(400, "version é obrigatória");
        const type = normalizeType(document_type);
        if (!type) throw httpError(400, "document_type é obrigatório");
        if (!title || typeof title !== "string" || !title.trim())
          throw httpError(400, "title é obrigatório");
        if (!content || typeof content !== "string" || !content.trim())
          throw httpError(400, "content é obrigatório");

        const hash =
          document_hash && String(document_hash).trim()
            ? String(document_hash).trim()
            : sha256(content);

        const existsByHash = await LegalDocumentsStorage.getByHash(hash);
        if (existsByHash)
          throw httpError(409, "Já existe um documento com este hash");

        const existsVersion = await LegalDocumentsStorage.getByTypeAndVersion(
          type,
          version.trim()
        );
        if (existsVersion)
          throw httpError(
            409,
            "Já existe esta version para este document_type"
          );

        return LegalDocumentsStorage.create({
          version: version.trim(),
          document_type: type,
          title: title.trim(),
          content,
          document_hash: hash,
          created_by,
        });
      }
    );
  }

  static async update({
    id_legal_document,
    version,
    document_type,
    title,
    content,
    document_hash,
    updated_by,
  }) {
    return runWithLogs(
      log,
      "update",
      () => ({ id_legal_document, updated_by }),
      async () => {
        if (!isUuid(id_legal_document))
          throw httpError(400, "id_legal_document inválido");

        const current = await LegalDocumentsStorage.getById(id_legal_document);
        if (!current) throw httpError(404, "Documento não encontrado");

        if (current.published_at || current.is_active) {
          throw httpError(
            409,
            "Documento já publicado/ativo. Crie uma nova versão em vez de editar."
          );
        }

        const patch = {};

        if (version !== undefined) {
          if (typeof version !== "string" || !version.trim())
            throw httpError(400, "version inválida");
          patch.version = version.trim();
        }

        if (document_type !== undefined) {
          const type = normalizeType(document_type);
          if (!type) throw httpError(400, "document_type inválido");
          patch.document_type = type;
        }

        if (title !== undefined) {
          if (typeof title !== "string" || !title.trim())
            throw httpError(400, "title inválido");
          patch.title = title.trim();
        }

        if (content !== undefined) {
          if (typeof content !== "string" || !content.trim())
            throw httpError(400, "content inválido");
          patch.content = content;
          if (document_hash === undefined) patch.document_hash = sha256(content);
        }

        if (document_hash !== undefined) {
          if (typeof document_hash !== "string" || !document_hash.trim())
            throw httpError(400, "document_hash inválido");
          patch.document_hash = document_hash.trim();
        }

        if (Object.keys(patch).length === 0)
          throw httpError(400, "Nada para atualizar");

        if (patch.document_hash) {
          const existsByHash = await LegalDocumentsStorage.getByHash(
            patch.document_hash
          );
          if (
            existsByHash &&
            existsByHash.id_legal_document !== id_legal_document
          ) {
            throw httpError(409, "Já existe um documento com este hash");
          }
        }

        const newType = patch.document_type ?? current.document_type;
        const newVersion = patch.version ?? current.version;
        const existsVersion = await LegalDocumentsStorage.getByTypeAndVersion(
          newType,
          newVersion
        );
        if (
          existsVersion &&
          existsVersion.id_legal_document !== id_legal_document
        ) {
          throw httpError(
            409,
            "Já existe esta version para este document_type"
          );
        }

        const updated = await LegalDocumentsStorage.update({
          id_legal_document,
          ...patch,
          updated_by,
        });

        return updated;
      }
    );
  }

  static async activate({ id_legal_document, published_by }) {
    return runWithLogs(
      log,
      "activate",
      () => ({ id_legal_document, published_by }),
      async () => {
        if (!isUuid(id_legal_document))
          throw httpError(400, "id_legal_document inválido");

        const doc = await LegalDocumentsStorage.getById(id_legal_document);
        if (!doc) throw httpError(404, "Documento não encontrado");

        return LegalDocumentsStorage.activate({
          id_legal_document,
          document_type: doc.document_type,
          published_by,
        });
      }
    );
  }

  static async deactivate({ id_legal_document, updated_by }) {
    return runWithLogs(
      log,
      "deactivate",
      () => ({ id_legal_document, updated_by }),
      async () => {
        if (!isUuid(id_legal_document))
          throw httpError(400, "id_legal_document inválido");

        const doc = await LegalDocumentsStorage.getById(id_legal_document);
        if (!doc) throw httpError(404, "Documento não encontrado");

        return LegalDocumentsStorage.deactivate({ id_legal_document, updated_by });
      }
    );
  }
}

module.exports = LegalDocumentsService;
