// src/realtime/meuMundoLastPlace.js — MEU MUNDO 3D: voltar onde parou (mig 463, 21/11).
//
// As salas anotam aqui o lugar de quem está nelas (ao entrar, a cada ~10 s e ao sair); a fila guarda só a
// ÚLTIMA anotação de cada pessoa (a ordem é a das chamadas, síncrona — quem trocou de sala fica com a sala nova)
// e grava em lote ~2 s depois. Ler (`get`) olha primeiro a fila (ainda não gravada) e depois o banco: sobrevive
// a deploy e não tem prazo.
//
// place = { scene: "nb"|"house"|"center", nbId?, houseId?, x, z, facing, floor?, layout }

const pool = require("../databases");
const Storage = require("../storages/MeuMundoLastPlaceStorage");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundoLastPlace");
const FLUSH_MS = 2000;
const pending = new Map(); // userId → place
let timer = null;
let flushing = null;

function note(userId, place) {
  if (!userId || !place || !Number.isFinite(place.x) || !Number.isFinite(place.z)) return;
  pending.set(userId, { ...place });
  if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, FLUSH_MS);
    if (timer.unref) timer.unref();
  }
}

async function flush() {
  if (flushing) await flushing.catch(() => {});
  if (!pending.size) return;
  const list = [...pending.entries()];
  pending.clear();
  flushing = Storage.saveMany(pool, list)
    .catch((err) => {
      // Falhou: devolve à fila o que ninguém anotou de novo nesse meio-tempo.
      for (const [u, p] of list) if (!pending.has(u)) pending.set(u, p);
      log.warn("flush_fail", { message: err.message, n: list.length });
    })
    .finally(() => {
      flushing = null;
    });
  await flushing;
}

async function get(userId) {
  const p = pending.get(userId);
  if (p) return { ...p };
  try {
    return await Storage.get(pool, userId);
  } catch (err) {
    log.warn("get_fail", { message: err.message });
    return null;
  }
}

// Só para a suíte.
function _reset() {
  pending.clear();
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { note, get, flush, _reset };
