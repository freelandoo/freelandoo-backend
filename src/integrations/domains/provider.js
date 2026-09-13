// src/integrations/domains/provider.js
// Adaptador do provedor que emite o certificado TLS do domínio próprio.
//
// POR QUE UM ADAPTADOR EM VEZ DE CHAMAR A VERCEL DIRETO:
// o resto da feature (reivindicar, provar posse por TXT, rotear por Host,
// mostrar no painel) não depende de QUEM emite o certificado. Amarrar tudo à
// Vercel deixaria a entrega inteira parada esperando uma decisão de plano — e
// trocar para Cloudflare for SaaS depois obrigaria a reescrever o fluxo.
//
// Então o provedor é uma peça substituível com duas implementações:
//
//   manual  (padrão) — a plataforma faz TUDO menos o último passo: valida o
//                      domínio, prova a posse, deixa o registro pronto e mostra
//                      no painel de admin o que falta. Alguém adiciona o
//                      domínio no painel da Vercel e marca como ativo.
//                      Funciona HOJE, sem env nenhuma, sem cartão.
//
//   vercel          — liga sozinho quando VERCEL_API_TOKEN e VERCEL_PROJECT_ID
//                      existem. Aí o domínio é adicionado ao projeto por API e
//                      a Vercel emite o certificado.
//
// Escolher o provedor é olhar as variáveis de ambiente, não uma flag: uma flag
// ligada sem as credenciais deixaria a fila de domínios travada em silêncio.

const { createLogger } = require("../../utils/logger");

const log = createLogger("domains.provider");

const VERCEL_API = "https://api.vercel.com";

/** Sem credencial, não há automação — e isso é um estado normal, não um erro. */
function resolveProviderName() {
  if (process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID) return "vercel";
  return "manual";
}

/**
 * Modo manual: não fala com ninguém.
 *
 * Devolve `pending_manual` de propósito, e NÃO `active`: dizer que está no ar
 * sem certificado emitido faria o painel mentir para o dono do domínio, que
 * abriria o endereço e veria erro de segurança sem entender por quê.
 */
const manualProvider = {
  name: "manual",
  async addDomain(domain) {
    log.info("manual.add", { domain });
    return {
      ok: true,
      state: {
        mode: "manual",
        note: "Adicione este domínio ao projeto no painel do provedor e marque como ativo.",
        requested_at: new Date().toISOString(),
      },
      active: false,
    };
  },
  async checkDomain(domain) {
    return { ok: true, state: { mode: "manual" }, active: false, domain };
  },
  // Sem credencial não há a quem perguntar: a tela mostra só o TXT de posse.
  async dnsRecords() {
    return null;
  },
  async removeDomain(domain) {
    log.info("manual.remove", { domain });
    return { ok: true };
  },
};

async function vercelFetch(path, init = {}) {
  const teamId = process.env.VERCEL_TEAM_ID;
  const sep = path.includes("?") ? "&" : "?";
  const url = `${VERCEL_API}${path}${teamId ? `${sep}teamId=${encodeURIComponent(teamId)}` : ""}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, ok: res.ok, body };
}

/**
 * Cache dos valores recomendados pela Vercel.
 *
 * Eles são da CONTA, não de cada domínio: o IP do ápice e o CNAME
 * (`<hash>.vercel-dns-017.com`) são os mesmos para todos os domínios do
 * projeto. Sem cache, cada abertura do painel de endereço custaria uma ida à
 * API da Vercel para redesenhar três linhas que não mudam.
 */
let recommendedCache = { at: 0, value: null };
const RECOMMENDED_TTL_MS = 60 * 60 * 1000;

/** Tira o ponto final do FQDN — painel de DNS quase sempre quer sem. */
function trimDot(value) {
  return String(value || "").replace(/\.+$/, "");
}

/**
 * O primeiro registro de cada família, em ordem de preferência da própria
 * Vercel (`rank` 1 é o que ela recomenda hoje; os demais são legado que ela
 * mantém aceitando). Pegar o rank mais baixo é o que evita cravarmos um IP
 * antigo no código e mandarmos o cliente apontar para o lugar errado.
 */
function pickRecommended(config) {
  const byRank = (list) =>
    (Array.isArray(list) ? [...list] : []).sort((a, b) => (a?.rank ?? 99) - (b?.rank ?? 99))[0];

  const ipv4 = byRank(config?.recommendedIPv4);
  const cname = byRank(config?.recommendedCNAME);

  const a = (ipv4?.value || []).map(trimDot).filter(Boolean);
  return {
    a,
    cname: trimDot(cname?.value) || null,
  };
}

async function fetchDomainConfig(domain) {
  const r = await vercelFetch(`/v6/domains/${encodeURIComponent(domain)}/config`);
  return r.ok ? r.body : null;
}

/**
 * Um domínio do projeto que já esteja configurado, para servir de referência.
 *
 * Existe porque `/config` responde 404 para domínio que a conta ainda não
 * conhece — e é exatamente esse o caso do domínio recém-reivindicado, que é
 * quando a pessoa mais precisa saber o que colar no registrador. Como os
 * valores recomendados são da conta, perguntar por um domínio que já está lá
 * dá a MESMA resposta sem precisar registrar nada antes da hora.
 */
async function referenceDomainName() {
  const projectId = encodeURIComponent(process.env.VERCEL_PROJECT_ID);
  const r = await vercelFetch(`/v9/projects/${projectId}/domains?limit=50`);
  if (!r.ok) return null;
  const list = Array.isArray(r.body?.domains) ? r.body.domains : [];
  const pick = list.find((d) => d?.verified && d?.name && !d.name.endsWith(".vercel.app"));
  return pick?.name || null;
}

const vercelProvider = {
  name: "vercel",

  async addDomain(domain) {
    const projectId = encodeURIComponent(process.env.VERCEL_PROJECT_ID);
    const r = await vercelFetch(`/v10/projects/${projectId}/domains`, {
      method: "POST",
      body: JSON.stringify({ name: domain }),
    });

    // 409 = o domínio JÁ está no projeto. Para nós isso é sucesso, não conflito:
    // o estado desejado (domínio presente) é exatamente o que já existe, e
    // tratar como erro deixaria um domínio funcionando preso em 'error' para
    // sempre depois de qualquer reprocessamento.
    const alreadyThere = r.status === 409;
    if (!r.ok && !alreadyThere) {
      log.warn("vercel.add.failed", { domain, status: r.status });
      return {
        ok: false,
        error: r.body?.error?.message || `Falha ao registrar o domínio (${r.status}).`,
        state: { mode: "vercel", status: r.status, error: r.body?.error || null },
        active: false,
      };
    }

    const verified = alreadyThere ? true : !!r.body?.verified;
    return {
      ok: true,
      state: {
        mode: "vercel",
        added_at: new Date().toISOString(),
        verified,
        already_present: alreadyThere,
      },
      active: verified,
    };
  },

  async checkDomain(domain) {
    const projectId = encodeURIComponent(process.env.VERCEL_PROJECT_ID);
    const r = await vercelFetch(
      `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}`
    );
    if (!r.ok) {
      return {
        ok: false,
        error: r.body?.error?.message || `Domínio não encontrado no provedor (${r.status}).`,
        state: { mode: "vercel", status: r.status },
        active: false,
      };
    }
    // `verified` do provedor significa "o DNS aponta para cá e o certificado
    // saiu". É o único sinal que autoriza dizer ao dono que o site está no ar.
    const verified = !!r.body?.verified;
    return {
      ok: true,
      state: { mode: "vercel", verified, checked_at: new Date().toISOString() },
      active: verified,
    };
  },


  /**
   * Os registros que o dono precisa criar no registrador dele.
   *
   * ⚠️ NUNCA devolver isto de uma constante escrita à mão. O IP do ápice e o
   * CNAME mudaram de valor na Vercel e o CNAME é específico da conta — um
   * literal no código manda o cliente apontar o domínio para um endereço que
   * não é o nosso, e o sintoma disso é o site "no ar" servindo a página de
   * outra pessoa (ou um 404 que ninguém sabe explicar).
   */
  async dnsRecords(domain) {
    const fresh = Date.now() - recommendedCache.at < RECOMMENDED_TTL_MS;
    if (fresh && recommendedCache.value) {
      // O `misconfigured` é do domínio e não entra no cache da conta: ele muda
      // no minuto em que a pessoa cria o registro, que é justamente o que a
      // tela precisa refletir.
      const own = await fetchDomainConfig(domain);
      return { ...recommendedCache.value, misconfigured: own?.misconfigured ?? null };
    }

    let config = await fetchDomainConfig(domain);
    const misconfigured = config?.misconfigured ?? null;

    // Domínio ainda desconhecido da conta: os valores recomendados vêm de um
    // domínio que já está lá.
    if (!config?.recommendedIPv4 && !config?.recommendedCNAME) {
      const ref = await referenceDomainName();
      config = ref ? await fetchDomainConfig(ref) : null;
    }
    if (!config) return null;

    const picked = pickRecommended(config);
    if (!picked.a.length && !picked.cname) return null;

    recommendedCache = { at: Date.now(), value: picked };
    return { ...picked, misconfigured };
  },

  async removeDomain(domain) {
    const projectId = encodeURIComponent(process.env.VERCEL_PROJECT_ID);
    const r = await vercelFetch(
      `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}`,
      { method: "DELETE" }
    );
    // 404 ao remover é sucesso: o objetivo é "não estar lá".
    return { ok: r.ok || r.status === 404 };
  },
};

function getProvider() {
  return resolveProviderName() === "vercel" ? vercelProvider : manualProvider;
}

module.exports = { getProvider, resolveProviderName };
