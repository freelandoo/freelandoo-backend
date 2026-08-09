// test/territory.e2e.js — Subsistema 2: árvore território → endereço → unidade.
//
//   npm run test:territory
//
// Pré-requisito: Postgres de TESTE (a suíte RECUSA hosts que pareçam produção).
//   docker run -d --name fl-test-pg -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=freelandoo_test -p 55432:5432 postgres:16-alpine
//
// O ViaCEP é STUBADO: a suíte não toca a rede. Isso não é só velocidade — é o
// que torna determinístico o teste de DEGRADAÇÃO (serviço fora do ar), que é
// justamente o caminho que não dá para ensaiar contra o serviço real.
//
// O que ela cobre, chamando service e storage direto (sem HTTP):
//   1. o SQL da mig 202 — CHECK de CEP sobre CHAR(8), o índice de expressão
//      COALESCE(id_block,0) e a função fl_norm_token;
//   2. get-or-create convergente: mesma residência escrita N vezes = 1 linha;
//   3. normalização: grafias diferentes do mesmo complemento caem na mesma
//      unidade, e do mesmo bairro no mesmo território;
//   4. degradação do ViaCEP: fora do ar não trava a entrada e não inventa
//      território;
//   5. planta do condomínio: idempotente e discriminada por bloco;
//   6. fusão de territórios duplicados sem órfão.

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

// ─── stub do ViaCEP ────────────────────────────────────────────────────────
// Precisa acontecer ANTES de requerer o TerritoryService: ele desestrutura
// `lookupZipcode` no topo do módulo, então trocar a propriedade depois não teria
// efeito. O wrapper delega a uma variável mutável para cada teste escolher a
// resposta (ou a ausência dela).
const viacep = require("../src/integrations/viacep/lookup");
let cepFixtures = {};
let cepCalls = 0;
let cepDown = false;
viacep.lookupZipcode = async (raw) => {
  cepCalls += 1;
  if (cepDown) return null;
  const digits = String(raw || "").replace(/\D/g, "");
  return cepFixtures[digits] || null;
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

  const TerritoryService = require("../src/services/TerritoryService");
  const TerritoryStorage = require("../src/storages/TerritoryStorage");
  const CommunityStorage = require("../src/storages/CommunityStorage");
  const pool = require("../src/databases");

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const stamp = Date.now();
  const mk = (s) => `${s}_${stamp}`;

  // CEPs de teste com prefixo próprio do stamp seria ideal, mas CEP é CHAR(8)
  // numérico; usamos uma faixa fixa e limpamos tudo no fim.
  const CEP_A = "01310100"; // bairro normal
  const CEP_B = "01310200"; // mesmo bairro, grafia diferente
  const CEP_SMALL = "78999000"; // cidade pequena: ViaCEP sem bairro
  const CEP_DOWN = "99999000"; // nunca resolvido
  const CEP_404 = "00000001"; // ViaCEP nega

  cepFixtures = {
    [CEP_A]: {
      cep: CEP_A,
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    },
    [CEP_B]: {
      cep: CEP_B,
      logradouro: "Rua Frei Caneca",
      // Mesma vizinhança em OUTRA grafia — é isto que fl_norm_city precisa
      // colapsar, senão a base de bairros duplica sozinha.
      bairro: "BELA VISTA",
      localidade: "Sao Paulo",
      uf: "SP",
    },
    [CEP_SMALL]: {
      cep: CEP_SMALL,
      logradouro: "",
      bairro: "",
      localidade: "Vila Bela da Santíssima Trindade",
      uf: "MT",
    },
  };

  // ── limpeza defensiva de execuções anteriores ────────────────────────────
  const CEPS = [CEP_A, CEP_B, CEP_SMALL, CEP_DOWN, CEP_404];
  async function wipe() {
    await db.query(
      `DELETE FROM public.tb_residence_unit u
        USING public.tb_address a
        WHERE a.id_address = u.id_address AND a.cep = ANY($1::bpchar[])`,
      [CEPS]
    );
    await db.query(`DELETE FROM public.tb_address WHERE cep = ANY($1::bpchar[])`, [CEPS]);
    await db.query(`DELETE FROM public.tb_cep_cache WHERE cep = ANY($1::bpchar[])`, [CEPS]);
    await db.query(
      `DELETE FROM public.tb_territory
        WHERE municipio_norm IN ('sao paulo', 'vila bela da santissima trindade')
          AND bairro_norm IN ('bela vista', 'cidade inteira', 'bairro fantasma')`
    );
  }
  await wipe();

  // ═══ 1. SQL da migration 202 ═══════════════════════════════════════════
  console.log("\n━━━ 1. SQL da mig 202 ━━━");

  const norm = async (v) => {
    const r = await db.query(`SELECT fl_norm_token($1) AS n`, [v]);
    return r.rows[0].n;
  };

  const n1 = await norm("Apto 45");
  const n2 = await norm("apto45");
  const n3 = await norm("APTO-45");
  const n4 = await norm("  Ap. 45  ");
  const n5 = await norm("Bloco Ç 3");
  check("fl_norm_token colapsa caixa, espaço e pontuação", () => {
    assert.strictEqual(n1, "apto45");
    assert.strictEqual(n2, "apto45");
    assert.strictEqual(n3, "apto45");
  });
  check("fl_norm_token remove ponto e espaço de borda", () => {
    assert.strictEqual(n4, "ap45");
  });
  check("fl_norm_token remove acento (herdado de fl_norm_city)", () => {
    assert.strictEqual(n5, "blococ3");
  });
  const nEmpty = await norm(null);
  check("fl_norm_token de NULL é string vazia (a 'casa')", () => {
    assert.strictEqual(nEmpty, "");
  });

  // O CHECK de CEP sobre CHAR(8): o tipo PADDA com espaço, então um CEP curto
  // poderia passar despercebido se o regex fosse aplicado à string preenchida.
  const { rows: terrSeed } = await db.query(
    `INSERT INTO public.tb_territory
       (uf, municipio_norm, municipio_label, bairro_norm, bairro_label)
     VALUES ('SP', 'sao paulo', 'São Paulo', 'bairro fantasma', 'Bairro Fantasma')
     RETURNING id_territory`
  );
  const seedTerritory = terrSeed[0].id_territory;

  async function tryCep(value) {
    try {
      await db.query(
        `INSERT INTO public.tb_address (id_territory, cep, numero, numero_norm)
              VALUES ($1, $2, '1', '1')`,
        [seedTerritory, value]
      );
      await db.query(`DELETE FROM public.tb_address WHERE cep = $1`, [value]);
      return "aceito";
    } catch (err) {
      return err.code === "23514" ? "recusado" : `erro:${err.code}`;
    }
  }

  const cep7 = await tryCep("1234567");
  const cep8 = await tryCep("12345678");
  const cepAlpha = await tryCep("1234567a");
  check("CHECK recusa CEP de 7 dígitos apesar do padding do CHAR(8)", () => {
    assert.strictEqual(cep7, "recusado");
  });
  check("CHECK aceita CEP de 8 dígitos", () => {
    assert.strictEqual(cep8, "aceito");
  });
  check("CHECK recusa CEP com letra", () => {
    assert.strictEqual(cepAlpha, "recusado");
  });

  // ═══ 2. resolveResidence: a árvore inteira ═════════════════════════════
  console.log("\n━━━ 2. resolução de residência ━━━");

  const r1 = await TerritoryService.resolveResidence({
    cep: "01310-100",
    numero: "1578",
    complemento: "Apto 45",
  });

  check("CEP com máscara resolve território, endereço e unidade", () => {
    assert.strictEqual(r1.verified, true);
    assert.ok(r1.territory?.id_territory);
    assert.ok(r1.address?.id_address);
    assert.ok(r1.unit?.id_unit);
  });
  check("território sai do ViaCEP com a grafia dos Correios", () => {
    assert.strictEqual(r1.territory.bairro_label, "Bela Vista");
    assert.strictEqual(r1.territory.uf, "SP");
    assert.strictEqual(r1.territory.is_city_wide, false);
  });
  const addrCols = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tb_address'`
  );
  check("logradouro volta para exibição mas não existe coluna para ele (D4)", () => {
    assert.strictEqual(r1.logradouro, "Avenida Paulista");
    const names = addrCols.rows.map((c) => c.column_name);
    assert.strictEqual(names.includes("logradouro"), false);
    assert.strictEqual(names.includes("rua"), false);
  });

  const callsBefore = cepCalls;
  const r2 = await TerritoryService.resolveResidence({
    cep: CEP_A,
    numero: "1578",
    complemento: "apto45",
  });
  check("segunda chamada não bate no ViaCEP (cache fresco)", () => {
    assert.strictEqual(cepCalls, callsBefore);
  });
  check("mesma residência converge para a MESMA unidade (get-or-create)", () => {
    assert.strictEqual(String(r2.unit.id_unit), String(r1.unit.id_unit));
    assert.strictEqual(String(r2.address.id_address), String(r1.address.id_address));
  });

  const r3 = await TerritoryService.resolveResidence({
    cep: CEP_A,
    numero: " 1578 ",
    complemento: "APTO-45",
  });
  check("grafia diferente do complemento NÃO cria unidade nova (fl_norm_token)", () => {
    assert.strictEqual(String(r3.unit.id_unit), String(r1.unit.id_unit));
  });
  check("número com espaço de borda NÃO cria endereço novo", () => {
    assert.strictEqual(String(r3.address.id_address), String(r1.address.id_address));
  });

  const r4 = await TerritoryService.resolveResidence({
    cep: CEP_A,
    numero: "1578",
    complemento: "Apto 46",
  });
  check("complemento diferente cria unidade nova no MESMO endereço", () => {
    assert.notStrictEqual(String(r4.unit.id_unit), String(r1.unit.id_unit));
    assert.strictEqual(String(r4.address.id_address), String(r1.address.id_address));
  });

  const rHouse = await TerritoryService.resolveResidence({
    cep: CEP_A,
    numero: "1600",
    complemento: null,
  });
  const rHouse2 = await TerritoryService.resolveResidence({
    cep: CEP_A,
    numero: "1600",
    complemento: "   ",
  });
  check("casa (sem complemento) vira unidade única de label vazio", () => {
    assert.strictEqual(rHouse.unit.label, null);
    assert.strictEqual(rHouse.unit.label_norm, "");
    assert.strictEqual(String(rHouse2.unit.id_unit), String(rHouse.unit.id_unit));
  });

  const rB = await TerritoryService.resolveResidence({ cep: CEP_B, numero: "10" });
  check("mesmo bairro em OUTRA grafia cai no mesmo território (fl_norm_city)", () => {
    assert.strictEqual(
      String(rB.territory.id_territory),
      String(r1.territory.id_territory)
    );
  });
  check("endereço de outro CEP é linha distinta", () => {
    assert.notStrictEqual(String(rB.address.id_address), String(r1.address.id_address));
  });

  const rSmall = await TerritoryService.resolveResidence({ cep: CEP_SMALL, numero: "50" });
  check("cidade sem bairro no CEP vira território abrangente (§6.4)", () => {
    assert.strictEqual(rSmall.verified, true);
    assert.strictEqual(rSmall.territory.is_city_wide, true);
    assert.strictEqual(rSmall.territory.bairro_label, "Cidade inteira");
  });

  // ═══ 3. entrada inválida e degradação ══════════════════════════════════
  console.log("\n━━━ 3. entrada inválida e degradação ━━━");

  const bad = await TerritoryService.resolveResidence({ cep: "123", numero: "1" });
  check("CEP curto é recusado com 400", () => {
    assert.strictEqual(bad.statusCode, 400);
  });
  const noNum = await TerritoryService.resolveResidence({ cep: CEP_A, numero: "  " });
  check("número vazio é recusado com 400", () => {
    assert.strictEqual(noNum.statusCode, 400);
  });

  const { rows: before } = await db.query(`SELECT COUNT(*)::int AS n FROM public.tb_territory`);
  cepDown = true;
  const down = await TerritoryService.resolveResidence({ cep: CEP_DOWN, numero: "1" });
  const { rows: after } = await db.query(`SELECT COUNT(*)::int AS n FROM public.tb_territory`);
  check("ViaCEP fora do ar não trava: devolve não-verificado em vez de erro", () => {
    assert.strictEqual(down.verified, false);
    assert.strictEqual(down.reason, "cep_service_unavailable");
    assert.strictEqual(down.statusCode, undefined);
  });
  check("ViaCEP fora do ar NÃO inventa território", () => {
    assert.strictEqual(after[0].n, before[0].n);
  });

  // Cache velho + serviço fora: o cache vence, porque travar a entrada é pior
  // que um bairro possivelmente desatualizado.
  await db.query(
    `UPDATE public.tb_cep_cache SET fetched_at = NOW() - INTERVAL '400 days' WHERE cep = $1`,
    [CEP_A]
  );
  const stale = await TerritoryService.resolveResidence({ cep: CEP_A, numero: "1578" });
  check("cache vencido + ViaCEP fora ainda resolve (degradação)", () => {
    assert.strictEqual(stale.verified, true);
    assert.strictEqual(String(stale.address.id_address), String(r1.address.id_address));
  });
  cepDown = false;

  await TerritoryStorage.putCachedCep(pool, { cep: CEP_404, not_found: true });
  const notFound = await TerritoryService.resolveResidence({ cep: CEP_404, numero: "1" });
  check("CEP negado pelo ViaCEP responde 400 sem criar nada", () => {
    assert.strictEqual(notFound.statusCode, 400);
    assert.match(notFound.error, /não encontrado/i);
  });

  // ═══ 4. planta do condomínio ═══════════════════════════════════════════
  console.log("\n━━━ 4. planta do condomínio ━━━");

  const grid = TerritoryService.buildUnitGrid({ floors: 3, perFloor: 4 });
  check("grade gera numeração brasileira (101..304)", () => {
    assert.strictEqual(grid.length, 12);
    assert.strictEqual(grid[0].label, "101");
    assert.strictEqual(grid[11].label, "304");
  });

  const condoAddr = await TerritoryStorage.getOrCreateAddress(pool, {
    id_territory: r1.territory.id_territory,
    cep: CEP_A,
    numero: "2000",
  });

  const gen1 = await TerritoryService.generateCondoUnits({
    id_address: condoAddr.id_address,
    floors: 3,
    perFloor: 4,
  });
  const gen2 = await TerritoryService.generateCondoUnits({
    id_address: condoAddr.id_address,
    floors: 3,
    perFloor: 4,
  });
  check("geração da planta cria a grade inteira", () => {
    assert.strictEqual(gen1.requested, 12);
    assert.strictEqual(gen1.created, 12);
  });
  check("gerar de novo não duplica (ON CONFLICT do índice de expressão)", () => {
    assert.strictEqual(gen2.created, 0);
  });

  // Mesmo label em blocos diferentes: é o COALESCE(id_block,0) do índice que
  // precisa discriminar. Se ele não casasse, isto estouraria unique violation.
  const { rows: machines } = await db.query(
    `SELECT id_machine FROM public.tb_machine ORDER BY id_machine LIMIT 1`
  );
  const { rows: users } = await db.query(
    `INSERT INTO public.tb_user (nome, email, senha, username, ativo)
          VALUES ('Sindico', $1, 'x', $2, TRUE) RETURNING id_user`,
    [`${mk("sindico")}@ex.com`, mk("sindico")]
  );
  const owner = users[0].id_user;
  const condoProfile = await CommunityStorage.createCommunity(pool, {
    id_user: owner,
    id_machine: machines[0].id_machine,
    display_name: mk("Condo Territorio"),
    bio: null,
    avatar_url: null,
    theme: null,
    kind: "condo",
    address: {
      street: "Avenida Paulista",
      number: "2000",
      complement: null,
      neighborhood: "Bela Vista",
      cep: CEP_A,
      estado: "SP",
      municipio: "São Paulo",
    },
  });
  const { rows: blocks } = await db.query(
    `INSERT INTO public.tb_condo_block (id_condo, name)
          VALUES ($1, 'Torre A'), ($1, 'Torre B')
       RETURNING id_block`,
    [condoProfile.id_profile]
  );
  const blockIds = blocks.map((b) => Number(b.id_block));

  const genBlocks = await TerritoryService.generateCondoUnits({
    id_address: condoAddr.id_address,
    floors: 2,
    perFloor: 2,
    blockIds,
  });
  check("mesmo número em torres diferentes coexiste (COALESCE(id_block,0))", () => {
    assert.strictEqual(genBlocks.requested, 8);
    assert.strictEqual(genBlocks.created, 8);
  });

  const { rows: dupCheck } = await db.query(
    `SELECT COUNT(*)::int AS n FROM public.tb_residence_unit
      WHERE id_address = $1 AND label_norm = '101'`,
    [condoAddr.id_address]
  );
  check("o '101' existe uma vez sem bloco e uma por torre", () => {
    assert.strictEqual(dupCheck[0].n, 3);
  });

  const genAgain = await TerritoryService.generateCondoUnits({
    id_address: condoAddr.id_address,
    floors: 2,
    perFloor: 2,
    blockIds,
  });
  check("regerar com blocos também é idempotente", () => {
    assert.strictEqual(genAgain.created, 0);
  });

  const huge = await TerritoryService.generateCondoUnits({
    id_address: condoAddr.id_address,
    floors: 200,
    perFloor: 50,
    blockIds,
  });
  check("planta grande demais é recusada em vez de travar o banco", () => {
    assert.strictEqual(huge.statusCode, 400);
  });

  // Unidade criada sob demanda por morador de bairro convive com a gerada, e o
  // endereço que vira condomínio ADOTA a que já existia (não duplica).
  const claimed = await TerritoryStorage.getOrCreateUnit(pool, {
    id_address: condoAddr.id_address,
    label: "101",
    source: "claimed",
  });
  check("unidade reivindicada casa com a gerada em vez de duplicar", () => {
    assert.strictEqual(claimed.source, "generated");
  });

  // Apagar uma torre leva as unidades dela junto. Com a FK em SET NULL (como
  // nasceu), o "101 da Torre A" virava "101 sem bloco" — que já existe — e o
  // DELETE inteiro estourava violação de unicidade: o gestor via erro ao apagar
  // uma torre criada por engano.
  const { rows: beforeDrop } = await db.query(
    `SELECT COUNT(*)::int AS n FROM public.tb_residence_unit WHERE id_address = $1`,
    [condoAddr.id_address]
  );
  let blockDropError = null;
  try {
    await db.query(`DELETE FROM public.tb_condo_block WHERE id_block = $1`, [blockIds[0]]);
  } catch (err) {
    blockDropError = err.message;
  }
  const { rows: afterDrop } = await db.query(
    `SELECT COUNT(*)::int AS n FROM public.tb_residence_unit WHERE id_address = $1`,
    [condoAddr.id_address]
  );
  check("apagar uma torre não estoura unicidade", () => {
    assert.strictEqual(blockDropError, null);
  });
  check("apagar a torre leva as unidades dela junto (4 a menos)", () => {
    assert.strictEqual(beforeDrop[0].n - afterDrop[0].n, 4);
  });
  check("as unidades sem bloco sobrevivem à queda da torre", () => {
    assert.ok(afterDrop[0].n >= 12);
  });

  // ═══ 5. fusão de territórios ═══════════════════════════════════════════
  console.log("\n━━━ 5. curadoria: fusão ━━━");

  const merged = await TerritoryStorage.mergeTerritory(pool, {
    from_id: seedTerritory,
    into_id: r1.territory.id_territory,
  });
  check("fusão marca o território antigo como merged", () => {
    assert.ok(merged);
    assert.strictEqual(String(merged.merged_into), String(r1.territory.id_territory));
  });
  const resolvedOld = await TerritoryStorage.getOrCreateTerritory(pool, {
    uf: "SP",
    municipio: "São Paulo",
    bairro: "Bairro Fantasma",
  });
  check("cadastro na grafia antiga cai no território vencedor", () => {
    assert.strictEqual(
      String(resolvedOld.id_territory),
      String(r1.territory.id_territory)
    );
  });
  const { rows: orphans } = await db.query(
    `SELECT COUNT(*)::int AS n FROM public.tb_address WHERE id_territory = $1`,
    [seedTerritory]
  );
  check("fusão não deixa endereço órfão apontando para território morto", () => {
    assert.strictEqual(orphans[0].n, 0);
  });
  const cityList = await TerritoryStorage.listByCity(pool, {
    uf: "SP",
    municipio: "Sao Paulo",
  });
  check("território fundido some da listagem da cidade", () => {
    const ids = cityList.map((t) => String(t.id_territory));
    assert.strictEqual(ids.includes(String(seedTerritory)), false);
    assert.ok(ids.includes(String(r1.territory.id_territory)));
  });

  // ─── limpeza ─────────────────────────────────────────────────────────────
  await db.query(`DELETE FROM public.tb_profile WHERE id_profile = $1`, [
    condoProfile.id_profile,
  ]);
  await db.query(`DELETE FROM public.tb_user WHERE id_user = $1`, [owner]);
  await wipe();
  await db.query(
    `DELETE FROM public.tb_territory WHERE id_territory = ANY($1::bigint[])`,
    [[seedTerritory, r1.territory.id_territory, rSmall.territory.id_territory]]
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
