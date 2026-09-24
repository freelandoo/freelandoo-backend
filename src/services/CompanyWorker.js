// src/services/CompanyWorker.js
// O worker da fila de prospecção (mig 254): descobre e enriquece FORA da
// requisição HTTP.
//
// ⚠️ É AQUI QUE A FEATURE GANHA VIDA, e a falha mais silenciosa dela é
// esquecer `CompanyWorker.start()` no `index.js`: nada quebra, nenhum teste
// fica vermelho, os trabalhos se acumulam em `pending` e a tela fica
// eternamente dizendo "procurando". Mesma armadilha que o `AiReplyWorker` já
// documentou.
//
// ⚠️ POR QUE NÃO FAZER ISTO DENTRO DA ROTA. Uma varredura do Overpass numa
// cidade grande leva dezenas de segundos e um crawl leva segundos por página.
// Dentro de uma requisição, isso é uma ampulheta que estoura o timeout do proxy
// da Vercel antes de terminar — e o trabalho seria perdido no meio, tendo já
// gastado a chamada ao serviço de terceiro.

// ⚠️ ESTE SERVICE FALA SÓ COM O BANCO FRIO. Ele mexe apenas no catálogo
// (tb_company*), que saiu do banco da plataforma para não disputar o cache
// de 128 MB com tb_user/tb_profile/feed. Sem DATABASE_URL_COLD este require
// devolve o MESMO pool de sempre, então nada muda até a variável existir.
const pool = require("../databases/cold");
const CompanyJobStorage = require("../storages/CompanyJobStorage");
const CompanyStorage = require("../storages/CompanyStorage");
const CompanyIngestService = require("./CompanyIngestService");
const providers = require("../integrations/companyProvider");
const osm = require("../integrations/companyProvider/osm");
const cnpjProvider = require("../integrations/companyProvider/cnpj");
const website = require("../integrations/companyProvider/website");
const FeatureFlagService = require("./FeatureFlagService");
const { createLogger } = require("../utils/logger");

const log = createLogger("CompanyWorker");

const TICK_MS = Number(process.env.PROSPECT_WORKER_TICK_MS) || 20_000;
const MAINTENANCE_MS = 60 * 60 * 1000;
/** Quantos trabalhos por tique. Pequeno: cada um é rede lenta de terceiro. */
const BATCH = Number(process.env.PROSPECT_WORKER_BATCH) || 2;
const MAX_ATTEMPTS = 4;

let tickTimer = null;
let maintenanceTimer = null;
let running = false;

/** Backoff: 2min → 8min → 32min. Nunca imediato — a falha costuma ser do outro lado. */
function backoffFor(attempts) {
  const minutes = Math.min(120, 2 * 4 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + minutes * 60 * 1000);
}

class CompanyWorker {
  /**
   * DESCOBERTA: (categoria, uf, cidade) → empresas.
   *
   * ⚠️ A ÁREA DO OSM É RESOLVIDA UMA VEZ E CACHEADA PARA SEMPRE. O polígono de
   * um município não muda, e o Nominatim tem política de 1 requisição por
   * segundo — resolver a cada busca nos tiraria dele.
   */
  static async runDiscover(job) {
    const { category, uf, city } = job.payload || {};
    if (!category || !uf || !city) return { status: "skipped", skip_reason: "payload_incompleto" };
    if (!osm.isConfigured()) return { status: "skipped", skip_reason: "osm_desligado" };

    let area = await CompanyStorage.getAreaCache(pool, uf, city);
    if (!area) {
      const resolved = await osm.resolveAreaId({ uf, city });
      await CompanyStorage.setAreaCache(pool, {
        uf,
        city,
        osm_area_id: resolved?.osm_area_id ?? null,
        display_name: resolved?.display_name ?? null,
      });
      area = await CompanyStorage.getAreaCache(pool, uf, city);
    }
    // ⚠️ LINHA COM `osm_area_id` NULO É "PROCUREI E NÃO ACHEI", não "não
    // procurei". Sem essa distinção a plataforma re-consultaria o geocoder a
    // cada busca para uma cidade que ele não conhece.
    if (!area?.osm_area_id) {
      return { status: "skipped", skip_reason: "cidade_nao_encontrada_no_osm" };
    }

    const settings = await CompanyStorage.getSettings(pool);
    const drafts = await osm.discover({
      areaId: area.osm_area_id,
      category,
      limit: settings?.discover_max_results || 400,
    });
    if (!drafts.length) {
      return { status: "done", result: { found: 0, created: 0, updated: 0 } };
    }

    const ingested = await CompanyIngestService.ingestMany(drafts, "osm", {
      id_profile: job.id_profile,
    });

    // A cidade/UF do pedido preenchem quem chegou do OSM sem `addr:city` — é
    // o caso COMUM (o mapeador marcou o ponto, não o endereço), e sem isto a
    // empresa descoberta não apareceria no filtro por cidade que a descobriu.
    await pool.query(
      `UPDATE public.tb_company
          SET city = COALESCE(city, $2), city_norm = COALESCE(city_norm, $3),
              uf = COALESCE(uf, $4), updated_at = NOW()
        WHERE id_company = ANY($1::uuid[])`,
      [
        ingested.ids,
        city,
        require("../utils/companyNormalize").normalizeCity(city),
        String(uf).toUpperCase().slice(0, 2),
      ]
    );

    return {
      status: "done",
      result: { found: drafts.length, ...ingested, ids: undefined },
    };
  }

  /**
   * ENRIQUECIMENTO de UMA empresa.
   *
   * ⚠️ A ORDEM É SITE → CNPJ, e ela é a feature: o CNPJ quase nunca é
   * conhecido no começo (a API da Receita é endereçada POR CNPJ, não por nome),
   * e quem costuma trazê-lo é o RODAPÉ DO SITE. Rodar o CNPJ primeiro
   * desperdiçaria a etapa em 90% das empresas.
   */
  static async runEnrich(job, { doWebsite, doCnpj }) {
    const company = await CompanyStorage.getById(pool, job.id_company);
    if (!company) return { status: "skipped", skip_reason: "empresa_nao_encontrada" };
    if (company.suppressed_at) return { status: "skipped", skip_reason: "suprimida" };

    const touched = [];
    const done = [];
    let current = company;

    if (doWebsite && website.isConfigured() && (current.domain || current.website)) {
      const settings = await CompanyStorage.getSettings(pool);
      const draft = await website.enrich(current, { maxPages: settings?.crawl_max_pages || 6 });
      if (draft?.blocked) {
        done.push({ source: "website", blocked: draft.blocked });
      } else if (draft) {
        const conn = await pool.connect();
        try {
          const r = await CompanyIngestService.applyFields(conn, current, draft, "website");
          current = r.company;
          done.push({ source: "website", changed: r.changed });
        } finally {
          conn.release();
        }
      }
      touched.push("website");
    }

    if (doCnpj && cnpjProvider.isConfigured() && current.cnpj) {
      const draft = await cnpjProvider.enrich(current);
      if (draft) {
        const conn = await pool.connect();
        try {
          const r = await CompanyIngestService.applyFields(conn, current, draft, "cnpj");
          current = r.company;
          done.push({ source: "cnpj", changed: r.changed });
        } finally {
          conn.release();
        }
      }
      touched.push("cnpj");
    }

    // ⚠️ `partial` É INFORMAÇÃO, NÃO FALHA. Uma empresa sem site não tem como
    // ser enriquecida por ele — marcá-la `done` faria a tela prometer que já
    // se sabe tudo; marcá-la `failed` a mandaria de volta para a fila para
    // tentar de novo o que nunca vai existir.
    const status = done.length ? (done.length >= 2 ? "done" : "partial") : "partial";
    await CompanyIngestService.rescore(pool, current.id_company, { status, touched });

    return { status: "done", result: { sources: done, enrichment: status } };
  }

  static async processJob(job) {
    try {
      if (job.kind === "discover") return await this.runDiscover(job);
      if (job.kind === "enrich_website") {
        return await this.runEnrich(job, { doWebsite: true, doCnpj: false });
      }
      if (job.kind === "enrich_cnpj") {
        return await this.runEnrich(job, { doWebsite: false, doCnpj: true });
      }
      if (job.kind === "enrich_all") {
        return await this.runEnrich(job, { doWebsite: true, doCnpj: true });
      }
      return { status: "skipped", skip_reason: "kind_desconhecido" };
    } catch (err) {
      // Erro marcado como `retryable` pelo provider (429, por exemplo) volta
      // para a fila; o resto é decidido pelo contador de tentativas.
      const retryable = !!err?.retryable || job.attempts < MAX_ATTEMPTS;
      return {
        status: retryable && job.attempts < MAX_ATTEMPTS ? "pending" : "failed",
        last_error: `${err?.name || "Error"}: ${err?.message || ""}`.slice(0, 500),
        next_attempt_at: backoffFor(job.attempts),
      };
    }
  }

  static async tick() {
    if (running) return;
    running = true;
    try {
      // ⚠️ A FLAG É FAIL-CLOSED AQUI, ao contrário do `requireFeature` das
      // rotas. Lá o fail-open é certo (erro de infra não pode derrubar uma
      // tela); aqui ele mandaria a plataforma continuar batendo em serviços de
      // terceiro depois de alguém ter desligado o interruptor exatamente para
      // isso parar.
      let enabled = false;
      try {
        enabled = await FeatureFlagService.isEnabled("prospeccao");
      } catch {
        enabled = false;
      }
      if (!enabled) return;

      const jobs = await CompanyJobStorage.claimDue(pool, BATCH);
      for (const job of jobs) {
        const outcome = await this.processJob(job);
        await CompanyJobStorage.finish(pool, job.id_job, {
          status: outcome.status,
          result: outcome.result,
          skip_reason: outcome.skip_reason,
          last_error: outcome.last_error,
          next_attempt_at: outcome.next_attempt_at,
        });
        log.info("job.finished", {
          id_job: job.id_job,
          kind: job.kind,
          status: outcome.status,
          skip_reason: outcome.skip_reason,
        });
      }
    } catch (err) {
      log.error("tick.error", { message: err?.message });
    } finally {
      running = false;
    }
  }

  static async maintenance() {
    try {
      const requeued = await CompanyJobStorage.requeueStuck(pool, 20);
      const purged = await CompanyJobStorage.purgeOld(pool, 30);
      if (requeued || purged) log.info("maintenance", { requeued, purged });
    } catch (err) {
      log.error("maintenance.error", { message: err?.message });
    }
  }

  static start() {
    if (tickTimer) return;
    log.info("start", {
      tick_ms: TICK_MS,
      batch: BATCH,
      providers: providers.listProviders(),
    });
    // O primeiro tique espera: no boot o processo ainda está subindo migrations
    // e conexões, e uma varredura do Overpass no primeiro segundo disputaria
    // tudo isso.
    setTimeout(() => this.tick(), 45 * 1000);
    tickTimer = setInterval(() => this.tick(), TICK_MS);
    maintenanceTimer = setInterval(() => this.maintenance(), MAINTENANCE_MS);
    setTimeout(() => this.maintenance(), 11 * 60 * 1000);
  }

  static stop() {
    if (tickTimer) clearInterval(tickTimer);
    if (maintenanceTimer) clearInterval(maintenanceTimer);
    tickTimer = null;
    maintenanceTimer = null;
  }
}

module.exports = CompanyWorker;
