// src/utils/fraudScore.js
// Motor de pontuação antifraude — 100% offline, custo zero (decisão do Alex,
// 2026-08-08: nada de bureau pago nesta fase).
//
// REGRA DE OURO: nenhum sinal daqui bloqueia ninguém. O score só decide se o
// caso entra na FILA DE REVISÃO HUMANA (tb_fraud_review). Quem bloqueia é o
// administrador, no painel, depois de olhar. Isso é deliberado: todos os
// sinais abaixo são heurísticas com falso-positivo conhecido (quem se mudou de
// estado, quem usa e-mail corporativo raro, família no mesmo Wi-Fi).
//
// Fonte única dos pesos. Mexer aqui muda o comportamento do painel inteiro.

const { compareRegion } = require("./cpfRegion");

// A partir deste score o caso entra na fila. Calibrado pra que UM sinal fraco
// sozinho (ex.: só a região do CPF) NÃO abra revisão — precisa de combinação.
const REVIEW_THRESHOLD = 30;

const WEIGHTS = {
  cpf_region_mismatch: 10, // fraco de propósito: mudar de estado é normal
  disposable_email: 25,
  suspicious_name: 20,
  shared_ip: 20, // 3+ contas no mesmo IP (histórico)
  burst_signup: 30, // 3+ contas no mesmo IP em 1 hora
  payout_cpf_mismatch: 40, // CPF do destino de repasse ≠ CPF da conta
  payout_cnpj: 15, // destino em CNPJ: titularidade não verificável offline

  // Territoriais (mig 203 / §10 do desenho de comunidades territoriais).
  // CALIBRAÇÃO OBRIGATÓRIA: nenhum deles cruza o limiar de 30 sozinho. Família
  // dividindo casa é normal, mudar de cidade é normal, república de estudantes
  // é normal — é a COMBINAÇÃO que merece um olho humano, nunca o sinal isolado.
  residence_churn: 20, // troca de endereço acima do normal na janela
  contested_claim: 25, // reivindicação contestada por co-morador
  serial_contester: 25, // contesta muita gente (contestação usada como arma)
  territory_hopping: 15, // entra em várias comunidades territoriais na janela
  overcrowded_unit: 20, // número implausível de moradores na mesma unidade
};

// Janelas das heurísticas de velocity.
const SHARED_IP_MIN_ACCOUNTS = 3;
const BURST_WINDOW_MINUTES = 60;
const BURST_MIN_ACCOUNTS = 3;

// Janelas das heurísticas territoriais. Os mínimos são altos de propósito: o
// caso legítimo de cada uma é comum demais para punir o primeiro evento.
const RESIDENCE_WINDOW_DAYS = 90;
const RESIDENCE_CHURN_MIN = 3; // 3 endereços em 90 dias
const SERIAL_CONTESTER_MIN = 3; // contestou 3 pessoas na janela
const TERRITORY_HOPPING_MIN = 3; // 3 territórios distintos na janela
// República de estudantes cabe folgado; 10 adultos declarando a MESMA unidade
// já não é moradia, é fábrica de conta.
const OVERCROWDED_UNIT_MIN = 10;

// Domínios descartáveis mais comuns. Lista curta e conservadora de propósito:
// um domínio legítimo marcado aqui gera falso-positivo em cadeia. Ampliar só
// com caso real observado no painel.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "10minutemail.com", "20minutemail.com", "33mail.com", "anonaddy.com",
  "burnermail.io", "dispostable.com", "emailondeck.com", "fakeinbox.com",
  "getairmail.com", "getnada.com", "guerrillamail.com", "guerrillamail.info",
  "harakirimail.com", "inboxbear.com", "mail-temp.com", "mail7.io",
  "mailcatch.com", "maildrop.cc", "mailinator.com", "mailnesia.com",
  "mintemail.com", "mohmal.com", "moakt.com", "mytemp.email",
  "sharklasers.com", "spam4.me", "spambog.com", "spamgourmet.com",
  "temp-mail.io", "temp-mail.org", "tempail.com", "tempinbox.com",
  "tempmail.com", "tempmail.net", "tempmailo.com", "throwawaymail.com",
  "trashmail.com", "trashmail.de", "yopmail.com", "yopmail.net",
]);

function isDisposableEmailDomain(domain) {
  const d = String(domain || "").trim().toLowerCase();
  if (!d) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(d);
}

/**
 * Heurística de nome "que não parece nome". Conservadora: só dispara em coisa
 * claramente sintética. Nome de uma palavra NÃO conta sozinho (existe gente
 * com registro de um nome só e muita gente digita só o primeiro nome).
 * @returns {string[]} lista de motivos ("digits", "repeated", "too_short",
 *   "keyboard_mash", "single_char_words"); vazia quando o nome parece normal.
 */
function nameAnomalies(nome) {
  const raw = String(nome || "").trim();
  const reasons = [];
  if (!raw) return ["too_short"];

  if (/\d/.test(raw)) reasons.push("digits");
  // 3+ vezes o MESMO caractere seguido ("aaaa", "xxx") — não existe em nome real.
  if (/(.)\1{2,}/i.test(raw)) reasons.push("repeated");
  if (raw.replace(/\s/g, "").length < 3) reasons.push("too_short");

  const words = raw.split(/\s+/).filter(Boolean);
  // Várias "palavras" de 1 letra: "a b c".
  if (words.length >= 2 && words.every((w) => w.length === 1)) {
    reasons.push("single_char_words");
  }
  // Palavra longa sem nenhuma vogal ("hjkghjk") — teclado amassado.
  if (words.some((w) => w.length >= 5 && !/[aeiouáéíóúâêôãõà]/i.test(w))) {
    reasons.push("keyboard_mash");
  }
  return reasons;
}

/**
 * Monta a lista de motivos e o score de um usuário.
 *
 * @param {object} facts Fatos já coletados pelo storage (nada de I/O aqui —
 *   esta função é pura, o que a torna testável e re-executável sobre um caso
 *   antigo sem tocar no banco).
 * @param {string} facts.nome
 * @param {string|null} facts.cpf
 * @param {string|null} facts.uf UF declarada (tb_profile do perfil-conta)
 * @param {string|null} facts.email_domain
 * @param {number} facts.accounts_same_ip contas que nasceram no mesmo IP (inclui a própria)
 * @param {number} facts.accounts_same_ip_1h idem, na última hora
 * @param {"match"|"mismatch"|"unknown"|null} [facts.payout_cpf] destino de repasse
 * @param {boolean} [facts.payout_is_cnpj]
 * @returns {{score:number, reasons:Array<{code:string,weight:number,detail:string}>}}
 */
function evaluate(facts) {
  const reasons = [];
  const add = (code, detail) =>
    reasons.push({ code, weight: WEIGHTS[code] || 0, detail });

  const region = compareRegion(facts.cpf, facts.uf);
  if (region === "mismatch") {
    add(
      "cpf_region_mismatch",
      `CPF emitido em outra região fiscal (declarou ${String(facts.uf).toUpperCase()})`,
    );
  }

  if (isDisposableEmailDomain(facts.email_domain)) {
    add("disposable_email", `Domínio descartável: ${facts.email_domain}`);
  }

  const nameIssues = nameAnomalies(facts.nome);
  if (nameIssues.length > 0) {
    add("suspicious_name", `Nome atípico (${nameIssues.join(", ")})`);
  }

  const sameIp = Number(facts.accounts_same_ip || 0);
  if (sameIp >= SHARED_IP_MIN_ACCOUNTS) {
    add("shared_ip", `${sameIp} contas criadas do mesmo IP`);
  }

  const burst = Number(facts.accounts_same_ip_1h || 0);
  if (burst >= BURST_MIN_ACCOUNTS) {
    add(
      "burst_signup",
      `${burst} contas do mesmo IP em ${BURST_WINDOW_MINUTES} min`,
    );
  }

  if (facts.payout_cpf === "mismatch") {
    add("payout_cpf_mismatch", "CPF do destino de repasse ≠ CPF da conta");
  }
  if (facts.payout_is_cnpj) {
    add("payout_cnpj", "Destino de repasse em CNPJ (titularidade não verificável)");
  }

  // ─── territoriais ───────────────────────────────────────────────────────
  // Ausentes do objeto de fatos = não avaliados. É o que permite o painel
  // continuar pontuando cadastro sem saber nada de residência.
  const churn = Number(facts.residence_changes || 0);
  if (churn >= RESIDENCE_CHURN_MIN) {
    add(
      "residence_churn",
      `${churn} endereços declarados em ${RESIDENCE_WINDOW_DAYS} dias`,
    );
  }

  const contested = Number(facts.contested_claims || 0);
  if (contested > 0) {
    add(
      "contested_claim",
      `${contested} reivindicação(ões) de residência contestada(s) por co-morador`,
    );
  }

  const contestsMade = Number(facts.contests_made || 0);
  if (contestsMade >= SERIAL_CONTESTER_MIN) {
    add(
      "serial_contester",
      `Contestou ${contestsMade} pessoas em ${RESIDENCE_WINDOW_DAYS} dias`,
    );
  }

  const hops = Number(facts.territorial_joins || 0);
  if (hops >= TERRITORY_HOPPING_MIN) {
    add(
      "territory_hopping",
      `${hops} territórios distintos em ${RESIDENCE_WINDOW_DAYS} dias`,
    );
  }

  const occupants = Number(facts.max_unit_occupants || 0);
  if (occupants >= OVERCROWDED_UNIT_MIN) {
    add("overcrowded_unit", `${occupants} moradores declarados na mesma unidade`);
  }

  const score = reasons.reduce((sum, r) => sum + r.weight, 0);
  return { score, reasons };
}

/** O caso merece fila de revisão humana? */
function needsReview(score) {
  return Number(score || 0) >= REVIEW_THRESHOLD;
}

module.exports = {
  REVIEW_THRESHOLD,
  WEIGHTS,
  SHARED_IP_MIN_ACCOUNTS,
  BURST_WINDOW_MINUTES,
  BURST_MIN_ACCOUNTS,
  RESIDENCE_WINDOW_DAYS,
  RESIDENCE_CHURN_MIN,
  SERIAL_CONTESTER_MIN,
  TERRITORY_HOPPING_MIN,
  OVERCROWDED_UNIT_MIN,
  DISPOSABLE_EMAIL_DOMAINS,
  isDisposableEmailDomain,
  nameAnomalies,
  evaluate,
  needsReview,
};
