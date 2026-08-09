// test/residence.e2e.js — Subsistema 3: vínculo, reconhecimento, contestação.
//
//   npm run test:residence
//
// Pré-requisito: Postgres de TESTE (a suíte RECUSA hosts que pareçam produção).
//
// O ViaCEP é stubado (mesma razão do territory.e2e.js: determinismo, e o teste
// de degradação não existe contra o serviço real).
//
// O que ela cobre:
//   1. degrau 0 — unidade vazia reconhece na hora;
//   2. degrau 1 — unidade ocupada vira pendência e o co-morador decide;
//   3. degrau 2 — o sweeper rebaixa para "não reconhecido" sem recusar;
//   4. degrau 3 — contestação marca divergência e NÃO remove ninguém (§7.1);
//   5. degrau 4 — comprovante decidido pelo admin da plataforma;
//   6. quem pode julgar: forasteiro não, não-reconhecido não, menor não,
//      ninguém sobre si mesmo;
//   7. D15 — menor herda a residência do responsável, com permissão parental,
//      não aparece na lista de vizinhos e sai junto quando o responsável sai;
//   8. teto anti-oráculo e conta bloqueada;
//   9. os cinco sinais antifraude territoriais e a regra "nenhum sozinho
//      cruza o limiar".

require("dotenv").config();

const assert = require("node:assert");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Client } = require("pg");

const DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:test@127.0.0.1:55432/freelandoo_test";

if (/railway|rlwy\.net|proxy\.rlwy/i.test(DB_URL)) {
  console.error("[guard] TEST_DATABASE_URL parece produção (railway). Abortando.");
  process.exit(1);
}
process.env.DATABASE_URL = DB_URL;

const viacep = require("../src/integrations/viacep/lookup");
const CEP = "01310100";
const CEP2 = "04538133";
viacep.lookupZipcode = async (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits === CEP) {
    return {
      cep: CEP,
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    };
  }
  if (digits === CEP2) {
    return {
      cep: CEP2,
      logradouro: "Avenida Brigadeiro Faria Lima",
      bairro: "Itaim Bibi",
      localidade: "São Paulo",
      uf: "SP",
    };
  }
  return null;
};

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

async function main() {
  console.log("━━━ migrations ━━━");
  execFileSync(process.execPath, ["run-migrations.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: "inherit",
  });

  const ResidenceService = require("../src/services/ResidenceService");
  const ResidenceStorage = require("../src/storages/ResidenceStorage");
  const { evaluate, needsReview, WEIGHTS } = require("../src/utils/fraudScore");
  const pool = require("../src/databases");

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const stamp = Date.now();
  const mk = (s) => `${s}_${stamp}`;
  const created = [];

  async function mkUser(tag, { birthdate = "1990-01-01" } = {}) {
    const r = await db.query(
      `INSERT INTO public.tb_user (nome, email, senha, username, ativo, data_nascimento)
            VALUES ($1, $2, 'x', $3, TRUE, $4)
         RETURNING id_user`,
      [`User ${tag}`, `${mk(tag)}@ex.com`, mk(tag), birthdate]
    );
    created.push(r.rows[0].id_user);
    return r.rows[0].id_user;
  }

  const ana = await mkUser("ana");
  const bruno = await mkUser("bruno");
  const carla = await mkUser("carla");
  const davi = await mkUser("davi");

  // ═══ 1. degraus 0 e 1 ═════════════════════════════════════════════════
  console.log("\n━━━ 1. degraus 0 e 1 ━━━");

  const r1 = await ResidenceService.claim({
    id_user: ana,
    cep: CEP,
    numero: "1578",
    complemento: "Apto 45",
  });
  check("unidade vazia reconhece na hora (degrau 0)", () => {
    assert.strictEqual(r1.residence.status, "recognized");
    assert.ok(r1.residence.recognized_at);
  });
  check("reconhecimento automático não inventa quem reconheceu", () => {
    assert.strictEqual(r1.residence.recognized_by, null);
  });

  const idUnit = r1.residence.id_unit;

  const r2 = await ResidenceService.claim({
    id_user: bruno,
    cep: CEP,
    numero: "1578",
    complemento: "apto 45",
  });
  check("unidade ocupada vira pendência (degrau 1)", () => {
    assert.strictEqual(r2.residence.status, "pending");
    assert.strictEqual(String(r2.residence.id_unit), String(idUnit));
    assert.ok(r2.residence.pending_until);
  });

  const pendAna = await ResidenceService.listPending(ana);
  check("a pendência aparece para o morador da unidade", () => {
    const ids = pendAna.pending.map((p) => String(p.id_residence));
    assert.ok(ids.includes(String(r2.residence.id_residence)));
  });
  const pendCarla = await ResidenceService.listPending(carla);
  check("a pendência NÃO aparece para quem não mora ali", () => {
    assert.strictEqual(pendCarla.pending.length, 0);
  });

  // ═══ 2. quem pode julgar ══════════════════════════════════════════════
  console.log("\n━━━ 2. quem pode julgar ━━━");

  const byOutsider = await ResidenceService.recognize({
    id_residence: r2.residence.id_residence,
    id_user: carla,
  });
  check("forasteiro não reconhece", () => {
    assert.strictEqual(byOutsider.statusCode, 403);
  });
  const bySelf = await ResidenceService.recognize({
    id_residence: r2.residence.id_residence,
    id_user: bruno,
  });
  check("ninguém reconhece a si mesmo", () => {
    assert.strictEqual(bySelf.statusCode, 403);
  });

  const ok = await ResidenceService.recognize({
    id_residence: r2.residence.id_residence,
    id_user: ana,
  });
  check("co-morador reconhecido reconhece (degrau 1 resolvido)", () => {
    assert.strictEqual(ok.residence.status, "recognized");
    assert.strictEqual(String(ok.residence.recognized_by), String(ana));
  });

  // ═══ 3. degrau 2 — o silêncio ═════════════════════════════════════════
  console.log("\n━━━ 3. degrau 2: o silêncio ━━━");

  const r3 = await ResidenceService.claim({
    id_user: carla,
    cep: CEP,
    numero: "1578",
    complemento: "Apto 45",
  });
  await db.query(
    `UPDATE public.tb_residence_member SET pending_until = NOW() - INTERVAL '1 day'
      WHERE id_residence = $1`,
    [r3.residence.id_residence]
  );
  const swept = await ResidenceService.sweepExpiredClaims();
  const afterSweep = await ResidenceStorage.getById(pool, r3.residence.id_residence);
  check("pendência vencida é rebaixada pelo sweeper", () => {
    assert.ok(swept >= 1);
    assert.strictEqual(afterSweep.status, "unrecognized");
  });
  check("rebaixar NÃO é recusar: o vínculo continua vivo", () => {
    assert.strictEqual(afterSweep.ended_at, null);
  });

  const naoRecJulga = await ResidenceService.recognize({
    id_residence: r2.residence.id_residence,
    id_user: carla,
  });
  check("morador não reconhecido não julga ninguém", () => {
    assert.strictEqual(naoRecJulga.statusCode, 403);
  });

  const lateOk = await ResidenceService.recognize({
    id_residence: r3.residence.id_residence,
    id_user: ana,
  });
  check("não reconhecido ainda pode ser reconhecido depois", () => {
    assert.strictEqual(lateOk.residence.status, "recognized");
  });

  // ═══ 4. degrau 3 — contestação ════════════════════════════════════════
  console.log("\n━━━ 4. degrau 3: contestação ━━━");

  const r4 = await ResidenceService.claim({
    id_user: davi,
    cep: CEP,
    numero: "1578",
    complemento: "Apto 45",
  });
  const contested = await ResidenceService.contest({
    id_residence: r4.residence.id_residence,
    id_user: ana,
    reason: "Não conheço essa pessoa",
  });
  check("contestação marca divergência", () => {
    assert.strictEqual(contested.residence.status, "contested");
  });
  check("contestação NÃO remove o contestado (§7.1)", () => {
    assert.strictEqual(contested.residence.ended_at, null);
  });

  const anaAfter = await ResidenceStorage.getActiveForUserInUnit(pool, {
    id_unit: idUnit,
    id_user: ana,
  });
  const brunoAfter = await ResidenceStorage.getActiveForUserInUnit(pool, {
    id_unit: idUnit,
    id_user: ana,
  });
  check("contestação não mexe em NENHUM morador existente", () => {
    assert.strictEqual(anaAfter.status, "recognized");
    assert.strictEqual(brunoAfter.status, "recognized");
  });

  const votes = await ResidenceStorage.listVotes(pool, r4.residence.id_residence);
  check("o motivo da contestação fica visível para quem decide (§7.3)", () => {
    assert.strictEqual(votes.length, 1);
    assert.strictEqual(votes[0].action, "contest");
    assert.match(votes[0].reason, /Não conheço/);
  });

  // Mudar de ideia atualiza o voto em vez de empilhar outro.
  await ResidenceService.recognize({
    id_residence: r4.residence.id_residence,
    id_user: ana,
  });
  const votes2 = await ResidenceStorage.listVotes(pool, r4.residence.id_residence);
  check("vizinho que muda de ideia tem UM voto, não dois", () => {
    assert.strictEqual(votes2.length, 1);
    assert.strictEqual(votes2[0].action, "recognize");
  });

  // ═══ 5. degrau 4 — comprovante ════════════════════════════════════════
  console.log("\n━━━ 5. degrau 4: comprovante ━━━");

  const eva = await mkUser("eva");
  const r5 = await ResidenceService.claim({
    id_user: eva,
    cep: CEP,
    numero: "1578",
    complemento: "Apto 45",
  });
  await ResidenceService.contest({
    id_residence: r5.residence.id_residence,
    id_user: ana,
    reason: "suspeita",
  });

  const alheio = await ResidenceService.submitProof({
    id_residence: r5.residence.id_residence,
    id_user: bruno,
    storage_key: "residence-proofs/x.jpg",
  });
  check("ninguém envia comprovante do vínculo alheio", () => {
    assert.strictEqual(alheio.statusCode, 403);
  });

  const proof = await ResidenceService.submitProof({
    id_residence: r5.residence.id_residence,
    id_user: eva,
    storage_key: "residence-proofs/eva.jpg",
  });
  check("comprovante entra na fila do admin", () => {
    assert.strictEqual(proof.proof.status, "pending");
  });

  const proof2 = await ResidenceService.submitProof({
    id_residence: r5.residence.id_residence,
    id_user: eva,
    storage_key: "residence-proofs/eva2.jpg",
  });
  const queue = await ResidenceService.listProofQueue({});
  check("reenviar substitui em vez de empilhar", () => {
    const mine = queue.proofs.filter(
      (p) => String(p.id_residence) === String(r5.residence.id_residence)
    );
    assert.strictEqual(mine.length, 1);
    assert.strictEqual(String(mine[0].id_proof), String(proof2.proof.id_proof));
  });

  const admin = await mkUser("admin");
  const decided = await ResidenceService.decideProof({
    id_proof: proof2.proof.id_proof,
    status: "approved",
    note: "conta de luz confere",
    admin_user_id: admin,
  });
  const evaLink = await ResidenceStorage.getById(pool, r5.residence.id_residence);
  check("comprovante aprovado reconhece o vínculo", () => {
    assert.strictEqual(decided.proof.status, "approved");
    assert.strictEqual(evaLink.status, "recognized");
  });
  check("o arquivo ganha prazo de expurgo (§7.2)", () => {
    assert.ok(decided.proof.purge_after);
  });
  const again = await ResidenceService.decideProof({
    id_proof: proof2.proof.id_proof,
    status: "rejected",
    admin_user_id: admin,
  });
  check("comprovante já decidido não é redecidido", () => {
    assert.strictEqual(again.statusCode, 404);
  });

  // Recusa é o ÚNICO caminho para alguém perder a residência sem pedir.
  const fabio = await mkUser("fabio");
  const r6 = await ResidenceService.claim({
    id_user: fabio,
    cep: CEP,
    numero: "1578",
    complemento: "Apto 45",
  });
  const p6 = await ResidenceService.submitProof({
    id_residence: r6.residence.id_residence,
    id_user: fabio,
    storage_key: "residence-proofs/fabio.jpg",
  });
  await ResidenceService.decideProof({
    id_proof: p6.proof.id_proof,
    status: "rejected",
    note: "documento de outro endereço",
    admin_user_id: admin,
  });
  const fabioLink = await ResidenceStorage.getById(pool, r6.residence.id_residence);
  check("comprovante recusado encerra o vínculo COM motivo gravado", () => {
    assert.strictEqual(fabioLink.status, "ended");
    assert.strictEqual(fabioLink.end_reason, "rejected");
    assert.ok(fabioLink.ended_at);
  });

  // ═══ 6. menores (D15 / §7.4) ══════════════════════════════════════════
  console.log("\n━━━ 6. contas supervisionadas ━━━");

  const gabi = await mkUser("gabi", { birthdate: "2014-05-10" });
  // A minoridade mora na flag denormalizada de tb_user — é o que
  // utils/supervision lê. Marcar só o vínculo deixaria a conta passando por
  // adulta em todos os guards.
  await db.query(
    `UPDATE public.tb_user SET is_minor = TRUE, responsible_user_id = $2
      WHERE id_user = $1`,
    [gabi, ana]
  );
  await db.query(
    `INSERT INTO public.supervised_accounts (responsible_user_id, minor_user_id, status)
          VALUES ($1, $2, 'active')`,
    [ana, gabi]
  );
  await db.query(
    `INSERT INTO public.minor_permissions (minor_user_id) VALUES ($1)
     ON CONFLICT (minor_user_id) DO NOTHING`,
    [gabi]
  );

  const minorClaim = await ResidenceService.claim({
    id_user: gabi,
    cep: CEP,
    numero: "1578",
    complemento: "Apto 45",
  });
  check("menor NÃO reivindica residência (D15)", () => {
    assert.strictEqual(minorClaim.statusCode, 403);
  });

  const semPerm = await ResidenceService.syncMinors({ id_user: ana, id_unit: idUnit });
  check("sem permissão parental o menor não é vinculado (default FALSE)", () => {
    assert.strictEqual(semPerm, 0);
  });

  await db.query(
    `UPDATE public.minor_permissions SET can_join_territorial = TRUE WHERE minor_user_id = $1`,
    [gabi]
  );
  const comPerm = await ResidenceService.syncMinors({ id_user: ana, id_unit: idUnit });
  const gabiLink = await ResidenceStorage.getActiveForUserInUnit(pool, {
    id_unit: idUnit,
    id_user: gabi,
  });
  check("com permissão, o menor HERDA a residência do responsável", () => {
    assert.strictEqual(comPerm, 1);
    assert.strictEqual(gabiLink.status, "recognized");
    assert.strictEqual(String(gabiLink.derived_from), String(ana));
  });

  const vizinhos = await ResidenceService.listNeighbors({ id_unit: idUnit, id_user: bruno });
  check("menor NÃO aparece na lista de vizinhos (bloqueio duro 1)", () => {
    const ids = vizinhos.neighbors.map((n) => String(n.id_user));
    assert.strictEqual(ids.includes(String(gabi)), false);
    assert.ok(ids.includes(String(ana)));
  });
  const vizinhosResp = await ResidenceService.listNeighbors({ id_unit: idUnit, id_user: ana });
  check("o responsável continua vendo o próprio menor", () => {
    const ids = vizinhosResp.neighbors.map((n) => String(n.id_user));
    assert.ok(ids.includes(String(gabi)));
  });

  const minorJudge = await ResidenceService.contest({
    id_residence: r2.residence.id_residence,
    id_user: gabi,
  });
  check("menor não reconhece nem contesta ninguém (bloqueio duro 4)", () => {
    assert.strictEqual(minorJudge.statusCode, 403);
  });

  const outsiderList = await ResidenceService.listNeighbors({
    id_unit: idUnit,
    id_user: (await mkUser("intruso")),
  });
  check("forasteiro não vê a lista de moradores", () => {
    assert.strictEqual(outsiderList.statusCode, 403);
  });

  // Saída do responsável leva o menor junto — ele não escolheu nada.
  const saiu = await ResidenceService.leave({
    id_residence: (await ResidenceStorage.getActiveForUserInUnit(pool, {
      id_unit: idUnit,
      id_user: ana,
    })).id_residence,
    id_user: ana,
  });
  const gabiDepois = await ResidenceStorage.getActiveForUserInUnit(pool, {
    id_unit: idUnit,
    id_user: gabi,
  });
  check("responsável sai e o menor sai junto (cascata do D15)", () => {
    assert.strictEqual(saiu.derived_ended, 1);
    assert.strictEqual(gabiDepois, null);
  });
  const anaHist = await db.query(
    `SELECT status, end_reason FROM public.tb_residence_member
      WHERE id_user = $1 AND id_unit = $2 ORDER BY id_residence DESC LIMIT 1`,
    [ana, idUnit]
  );
  check("sair grava histórico com motivo em vez de apagar (resolve C7)", () => {
    assert.strictEqual(anaHist.rows[0].status, "ended");
    assert.strictEqual(anaHist.rows[0].end_reason, "left");
  });

  // ═══ 7. tetos e bloqueio ══════════════════════════════════════════════
  console.log("\n━━━ 7. tetos e conta bloqueada ━━━");

  const hugo = await mkUser("hugo");
  for (const n of ["10", "20", "30"]) {
    await ResidenceService.claim({ id_user: hugo, cep: CEP2, numero: n });
  }
  const quarta = await ResidenceService.claim({ id_user: hugo, cep: CEP2, numero: "40" });
  check("teto de 3 reivindicações por dia (anti-oráculo do §11)", () => {
    assert.strictEqual(quarta.statusCode, 429);
  });

  const ivo = await mkUser("ivo");
  await db.query(`UPDATE public.tb_user SET blocked_at = NOW() WHERE id_user = $1`, [ivo]);
  const bloqueado = await ResidenceService.claim({ id_user: ivo, cep: CEP, numero: "99" });
  check("conta bloqueada não reivindica residência (§10)", () => {
    assert.strictEqual(bloqueado.statusCode, 403);
  });

  const semCep = await ResidenceService.claim({ id_user: carla, cep: "00000000", numero: "1" });
  check("CEP que o ViaCEP não resolve não cria nada", () => {
    assert.ok(semCep.statusCode >= 400);
  });

  // ═══ 8. antifraude territorial ════════════════════════════════════════
  console.log("\n━━━ 8. sinais antifraude ━━━");

  const facts = await ResidenceStorage.getFraudFacts(pool, hugo);
  check("churn e hopping são contados por endereço/território distintos", () => {
    assert.strictEqual(facts.residence_changes, 3);
    assert.strictEqual(facts.territorial_joins, 1);
  });
  // Ana contestou duas pessoas, mas voltou atrás com uma. O contador enxerga
  // UMA — quem muda de ideia deixa de carregar o sinal, senão "serial
  // contester" puniria alguém que corrigiu o próprio erro.
  const factsAna = await ResidenceStorage.getFraudFacts(pool, ana);
  check("contestação revogada deixa de contar contra quem contestou", () => {
    assert.strictEqual(factsAna.contests_made, 1);
  });

  check("nenhum sinal territorial cruza o limiar sozinho (calibração §10)", () => {
    for (const code of [
      "residence_churn",
      "contested_claim",
      "serial_contester",
      "territory_hopping",
      "overcrowded_unit",
    ]) {
      assert.ok(WEIGHTS[code] > 0, `${code} sem peso`);
      assert.strictEqual(
        needsReview(WEIGHTS[code]),
        false,
        `${code} abriria revisão sozinho`
      );
    }
  });
  check("combinação de sinais territoriais abre revisão", () => {
    const { score } = evaluate({
      nome: "Fulano de Tal",
      residence_changes: 4,
      contested_claims: 1,
      max_unit_occupants: 12,
    });
    assert.ok(needsReview(score), `score ${score} deveria abrir revisão`);
  });
  check("morador comum não gera sinal nenhum", () => {
    const { score, reasons } = evaluate({
      nome: "Maria Silva",
      residence_changes: 1,
      contested_claims: 0,
      contests_made: 0,
      territorial_joins: 1,
      max_unit_occupants: 4,
    });
    assert.strictEqual(reasons.length, 0);
    assert.strictEqual(score, 0);
  });
  check("família grande não dispara overcrowded_unit", () => {
    const { reasons } = evaluate({ nome: "Maria Silva", max_unit_occupants: 8 });
    assert.strictEqual(reasons.length, 0);
  });

  // ─── limpeza ─────────────────────────────────────────────────────────────
  await db.query(`DELETE FROM public.tb_user WHERE id_user = ANY($1::uuid[])`, [created]);
  await db.query(
    `DELETE FROM public.tb_address WHERE cep = ANY($1::bpchar[])`,
    [[CEP, CEP2]]
  );
  await db.query(
    `DELETE FROM public.tb_cep_cache WHERE cep = ANY($1::bpchar[])`,
    [[CEP, CEP2]]
  );
  await db.query(
    `DELETE FROM public.tb_territory
      WHERE municipio_norm = 'sao paulo' AND bairro_norm IN ('bela vista', 'itaim bibi')`
  );
  await db.end();
  await pool.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n━━━ RESULTADO ━━━\n  ${results.length - failed.length}/${results.length} OK`);
  if (failed.length) {
    for (const f of failed) console.log(`  ✗ ${f.name}: ${f.err}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
