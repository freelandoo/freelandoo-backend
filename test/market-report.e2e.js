/**
 * RELATÓRIO DE MERCADO LOCAL — contra o Postgres dentro de transação com
 * ROLLBACK. Seguro para produção PORQUE NÃO EXISTE `COMMIT` NESTE ARQUIVO.
 *
 *   node test/market-report.e2e.js
 *
 * Semeia preços conhecidos num perfil de barbeiro real e confere que a mediana
 * do relatório é a mediana de verdade (calculada aqui, à parte), nos recortes
 * cidade / região / estado / país / comunidade — e que o preço "sob orçamento",
 * o inativo e o zero ficam de fora.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const BE = path.join(__dirname, "..");
const Storage = require(path.join(BE, "src/storages/MarketReportStorage"));
const { parseRequest, levelOf } = require(path.join(BE, "src/utils/marketReport"));

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond === true) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? " -> " + extra : "")); }
}
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = (s.length - 1) / 2;
  return Math.round((s[Math.floor(m)] + s[Math.ceil(m)]) / 2);
}

(async () => {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete("sslmode");
  const c = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");
  try {
    await c.query(fs.readFileSync(path.join(BE, "src/databases/migrations/269_market_report.sql"), "utf8"));
    const flag = (await c.query(`SELECT is_enabled FROM public.tb_feature_flag WHERE flag_key='mercado_local'`)).rows[0];
    check("flag mercado_local nasce ligada", flag?.is_enabled === true);

    // Um perfil de verdade com profissão declarada, estado e cidade.
    const prof = (
      await c.query(
        `SELECT p.id_profile, p.id_user, p.id_category, p.estado, p.municipio, p.id_region
           FROM public.tb_profile p
          WHERE p.deleted_at IS NULL AND COALESCE(p.is_community,FALSE)=FALSE
            AND p.id_category IS NOT NULL AND p.estado ~ '^[A-Z]{2}$' AND p.municipio IS NOT NULL
            AND p.id_region IS NOT NULL
            AND NOT (p.is_user_account AND p.taxonomy_declared_at IS NULL)
          LIMIT 1`
      )
    ).rows[0];
    check("há um perfil com profissão e lugar para semear", !!prof);

    const tag = "zz teste mercado " + Date.now();
    const ins = (name, price, extra = "") =>
      c.query(
        `INSERT INTO public.tb_profile_service (id_profile, name, price_amount${extra ? ", " + extra.split("=")[0] : ""})
         VALUES ($1, $2, $3${extra ? ", " + extra.split("=")[1] : ""})`,
        [prof.id_profile, name, price]
      );
    await ins(tag, 3000);
    await ins(tag, 4000);
    await ins(tag, 7000);
    await ins(tag, 99900, "price_on_request=TRUE"); // sob orçamento: fora
    await ins(tag, 0); // zero: fora
    await c.query(
      `INSERT INTO public.tb_profile_service (id_profile, name, price_amount, is_active) VALUES ($1,$2,$3,FALSE)`,
      [prof.id_profile, tag, 88800]
    ); // inativo: fora

    const base = { kind: "service", id_category: String(prof.id_category), q: tag };
    const levels = {
      city: { ...base, uf: prof.estado, municipio: prof.municipio },
      region: { ...base, id_region: String(prof.id_region) },
      state: { ...base, uf: prof.estado },
      country: base,
    };
    for (const [lv, q] of Object.entries(levels)) {
      const req = parseRequest(q);
      check(`recorte ${lv} é reconhecido`, levelOf(req) === lv);
      const s = await Storage.stats(c, req, { level: lv, ...req });
      check(`${lv}: conta só os 3 preços de verdade`, s.count === 3, JSON.stringify(s));
      check(`${lv}: mediana = 4000 (e não a média, 4667)`, s.median === 4000 && s.avg === 4667, JSON.stringify(s));
      check(`${lv}: mínimo e máximo`, s.min === 3000 && s.max === 7000);
    }

    // Por item: o mesmo nome agrupado, com grafia diferente.
    await ins(tag.toUpperCase() + "  ", 5000);
    const reqItems = parseRequest(levels.country);
    const items = await Storage.items(c, reqItems, { level: "country", ...reqItems });
    const it = items[0];
    check("por item: grafias diferentes viram um item só", items.length === 1 && it.count === 4, JSON.stringify(items));
    check("por item: mediana de [3000,4000,5000,7000] = 4500", it.median === median([3000, 4000, 5000, 7000]));

    const hist = await Storage.histogram(c, reqItems, { level: "country", ...reqItems });
    check("histograma soma o total", hist.reduce((a, b) => a + b.count, 0) === 4, JSON.stringify(hist));

    // Recorte de comunidade: uma comunidade de que o dono do perfil é membro.
    let com = (
      await c.query(
        `SELECT cm.id_community_profile FROM public.tb_community_member cm
           JOIN public.tb_profile p ON p.id_profile = cm.id_community_profile AND p.deleted_at IS NULL
          WHERE cm.id_user = $1 LIMIT 1`,
        [prof.id_user]
      )
    ).rows[0];
    if (!com) {
      // Sem comunidade de verdade: entra numa, DENTRO da transação.
      const any = (
        await c.query(`SELECT id_profile FROM public.tb_profile WHERE is_community = TRUE AND deleted_at IS NULL LIMIT 1`)
      ).rows[0];
      if (any) {
        await c.query(
          `INSERT INTO public.tb_community_member (id_community_profile, id_user, role) VALUES ($1, $2, 'member')`,
          [any.id_profile, prof.id_user]
        );
        com = { id_community_profile: any.id_profile };
      }
    }
    if (com) {
      const rq = parseRequest({ ...base, id_community: com.id_community_profile });
      const s = await Storage.stats(c, rq, { level: "community", ...rq });
      check("comunidade: os preços dos membros entram", s.count === 4, JSON.stringify(s));
    } else {
      console.log("  --  (sem comunidade para o dono deste perfil; recorte de comunidade pulado)");
    }

    // Os outros tipos rodam (sem erro de SQL).
    for (const q of [
      { kind: "product", uf: prof.estado },
      { kind: "listing", listing_kind: "service" },
      { kind: "listing", listing_kind: "product", uf: prof.estado, municipio: prof.municipio },
    ]) {
      const rq = parseRequest(q);
      const s = await Storage.stats(c, rq, { level: levelOf(rq), ...rq });
      check(`tipo ${q.kind}/${q.listing_kind || ""} roda`, Number.isInteger(s.count));
    }
  } catch (err) {
    fail++;
    console.log("FAIL  erro inesperado -> " + (err.stack || err.message));
  } finally {
    await c.query("ROLLBACK");
  }
  const left = (await c.query(`SELECT COUNT(*)::int n FROM public.tb_profile_service WHERE name ILIKE 'zz teste mercado%'`)).rows[0].n;
  check("PRODUÇÃO INTOCADA: nenhum serviço de teste ficou", left === 0);
  await c.end();
  console.log(`\n${pass}/${pass + fail} checks`);
  process.exit(fail ? 1 : 0);
})();
