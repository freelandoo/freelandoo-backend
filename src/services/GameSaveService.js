// src/services/GameSaveService.js — 5 slots de save do EVO Brazil por conta (mig 279).
const GameSaveStorage = require("../storages/GameSaveStorage");
const { parseSlot, validateSave } = require("../utils/gameSave");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("GameSaveService");
const SLOT_INVALIDO = { error: "Slot inválido (1 a 5).", statusCode: 400 };

class GameSaveService {
  static async list(id_user) {
    return runWithLogs(log, "list", () => ({ id_user }), async () => {
      return { saves: await GameSaveStorage.list(id_user) };
    });
  }

  static async get(id_user, rawSlot) {
    const slot = parseSlot(rawSlot);
    if (!slot) return SLOT_INVALIDO;
    return runWithLogs(log, "get", () => ({ id_user, slot }), async () => {
      const save = await GameSaveStorage.get(id_user, slot);
      if (!save) return { error: "Slot vazio.", statusCode: 404 };
      return { save };
    });
  }

  static async put(id_user, rawSlot, body) {
    const slot = parseSlot(rawSlot);
    if (!slot) return SLOT_INVALIDO;
    const v = validateSave(body);
    if (v.error) return { error: v.error, statusCode: 400 };
    return runWithLogs(log, "put", () => ({ id_user, slot }), async () => {
      return { save: await GameSaveStorage.put(id_user, slot, v) };
    });
  }

  static async remove(id_user, rawSlot) {
    const slot = parseSlot(rawSlot);
    if (!slot) return SLOT_INVALIDO;
    return runWithLogs(log, "remove", () => ({ id_user, slot }), async () => {
      return { removed: await GameSaveStorage.remove(id_user, slot) };
    });
  }
}

module.exports = GameSaveService;
