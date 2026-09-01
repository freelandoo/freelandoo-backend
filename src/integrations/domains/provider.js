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
