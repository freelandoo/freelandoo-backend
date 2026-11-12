#!/usr/bin/env node
// scripts/mm-item-audit.js — trilha E, fatia E21: AUDITORIA do livro de itens × saldo da pilha.
//
//   node scripts/mm-item-audit.js                 todas as contas (banco do DATABASE_URL)
//   node scripts/mm-item-audit.js --user <uuid>   uma conta
//   node scripts/mm-item-audit.js --json          saída em JSON
//   node scripts/mm-item-audit.js --prod          banco remoto (o prodGuard exige a flag)
//
// Toda mexida em pilha passa por GearStore.addStack, que grava tb_mm_item_ledger (mig 446) com o saldo
// depois dela. A auditoria confere, por (conta, item): soma dos deltas do livro = qty da pilha = saldo
// da última linha do livro. Pilha antiga ainda não materializada (sem linha nenhuma no livro) é contada
// à parte (o `prepare` abre o livro na primeira operação da conta). Só lê: nada é corrigido.
// Sai com código 1 se achar divergência.
"use strict";

require("dotenv").config();

const args = process.argv.slice(2);
const userIdx = args.indexOf("--user");
const user = userIdx >= 0 ? args[userIdx + 1] : null;
const asJson = args.includes("--json");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Divergências (puro SQL; recebe um cliente/pool `pg`). */
async function audit(db, { idUser = null } = {}) {
  const r = await db.query(
    `WITH led AS (
       SELECT id_user, item_id, SUM(delta)::bigint AS total,
              (ARRAY_AGG(balance ORDER BY id DESC))[1] AS last_balance, COUNT(*)::int AS lines
         FROM tb_mm_item_ledger
        WHERE ($1::uuid IS NULL OR id_user = $1::uuid)
        GROUP BY id_user, item_id
     ), stk AS (
       SELECT id_user, item_id, qty FROM tb_mm_gear WHERE ($1::uuid IS NULL OR id_user = $1::uuid)
     )
     SELECT COALESCE(l.id_user, s.id_user) AS id_user, COALESCE(l.item_id, s.item_id) AS item_id,
            COALESCE(s.qty, 0) AS qty, l.total, l.last_balance, COALESCE(l.lines, 0) AS lines
       FROM led l FULL OUTER JOIN stk s ON s.id_user = l.id_user AND s.item_id = l.item_id`,
    [idUser]
  );
  const bad = [];
  let unopened = 0;
  let checked = 0;
  for (const x of r.rows) {
    if (!x.lines) {
      if (Number(x.qty) > 0) unopened++;
      continue;
    }
    checked++;
    const total = Number(x.total), qty = Number(x.qty), last = Number(x.last_balance);
    if (total !== qty || last !== qty) bad.push({ idUser: x.id_user, item: x.item_id, qty, ledger: total, lastBalance: last });
  }
  return { checked, unopened, bad };
}

async function main() {
  if (user && !UUID.test(user)) {
    console.error("--user precisa de um UUID");
    process.exit(2);
  }
  const pool = require("../src/databases");
  try {
    const out = await audit(pool, { idUser: user });
    if (asJson) console.log(JSON.stringify(out, null, 2));
    else {
      console.log(`pilhas conferidas: ${out.checked} · pilhas antigas sem livro (abrem no próximo prepare): ${out.unopened}`);
      if (!out.bad.length) console.log("livro × saldo: tudo bate.");
      for (const b of out.bad) console.log(`DIVERGE ${b.idUser} ${b.item}: pilha ${b.qty} · soma do livro ${b.ledger} · último saldo ${b.lastBalance}`);
    }
    process.exitCode = out.bad.length ? 1 : 0;
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { audit };
