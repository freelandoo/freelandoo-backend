// src/utils/accountingTax.js
//
// As contas do painel de Contabilidade (mig 277). Funções PURAS — sem banco,
// sem relógio implícito —, para que o unit test cubra a regra inteira.
//
// ⚠️ TUDO AQUI É ESTIMATIVA. O valor oficial de uma guia em atraso é o que o
// portal (PGDAS-D, Sicalc, e-CAC, prefeitura) devolve ao recalcular. A tela
// diz isso em voz alta; este arquivo existe para a pessoa saber a ORDEM de
// grandeza antes de abrir o portal, não para substituí-lo.

// ─── Simples Nacional (LC 123/2006, tabelas vigentes desde 2018) ─────────────
// Cada faixa: [teto da receita bruta 12 meses (R$), alíquota nominal, parcela
// a deduzir (R$)]. Em reais, não centavos: é a forma como a lei publica, e
// conferir contra o texto legal fica trivial.
const SIMPLES_TABLES = {
  I: [
    [180000, 0.04, 0],
    [360000, 0.073, 5940],
    [720000, 0.095, 13860],
    [1800000, 0.107, 22500],
    [3600000, 0.143, 87300],
    [4800000, 0.19, 378000],
  ],
  II: [
    [180000, 0.045, 0],
    [360000, 0.078, 5940],
    [720000, 0.1, 13860],
    [1800000, 0.112, 22500],
    [3600000, 0.147, 85500],
    [4800000, 0.3, 720000],
  ],
  III: [
    [180000, 0.06, 0],
    [360000, 0.112, 9360],
    [720000, 0.135, 17640],
    [1800000, 0.16, 35640],
    [3600000, 0.21, 125640],
    [4800000, 0.33, 648000],
  ],
  IV: [
    [180000, 0.045, 0],
    [360000, 0.09, 8100],
    [720000, 0.102, 12420],
    [1800000, 0.14, 39780],
    [3600000, 0.22, 183780],
    [4800000, 0.33, 828000],
  ],
  V: [
    [180000, 0.155, 0],
    [360000, 0.18, 4500],
    [720000, 0.195, 9900],
    [1800000, 0.205, 17100],
    [3600000, 0.23, 62100],
    [4800000, 0.305, 540000],
  ],
};

// Anexos aceitos na empresa. "III_V" = atividade sujeita ao Fator R: cai no
// III quando a folha (pró-labore incluído) é ≥ 28% da receita, senão no V.
const SIMPLES_ANEXOS = ["I", "II", "III", "IV", "V", "III_V"];
const FATOR_R_THRESHOLD = 0.28;
const SIMPLES_CEILING = 4800000;

/**
 * Alíquota efetiva do Simples: (RBT12 × nominal − dedução) / RBT12.
 * Sem receita nos 12 meses (empresa nova ou parada), a lei manda usar a
 * nominal da 1ª faixa — e é o que a fórmula daria no limite, sem dividir por 0.
 */
function effectiveRate(anexo, rbt12Reais) {
  const table = SIMPLES_TABLES[anexo];
  if (!table) return null;
  const rbt = Math.max(0, Number(rbt12Reais) || 0);
  if (rbt === 0) return { rate: table[0][1], bracket: 1, nominal: table[0][1], deduction: 0 };
  let idx = table.findIndex(([ceil]) => rbt <= ceil);
  if (idx === -1) idx = table.length - 1; // acima do teto: o Simples já não vale, mas não estoura
  const [, nominal, deduction] = table[idx];
  return {
    rate: (rbt * nominal - deduction) / rbt,
    bracket: idx + 1,
    nominal,
    deduction,
  };
}

/**
 * Estimativa do DAS de uma competência.
 *  - revenueMonthCents: faturamento do mês (base do DAS)
 *  - rbt12Cents: receita bruta dos 12 meses ANTERIORES (define a faixa)
 *  - payroll12Cents: folha dos 12 meses anteriores (pró-labore + salários), só p/ Fator R
 */
function estimateDas({ anexo, revenueMonthCents, rbt12Cents, payroll12Cents = 0 }) {
  if (!SIMPLES_ANEXOS.includes(anexo)) return { error: "Anexo do Simples inválido" };
  const revenue = Math.max(0, Number(revenueMonthCents) || 0);
  const rbt12 = Math.max(0, Number(rbt12Cents) || 0);
  const payroll = Math.max(0, Number(payroll12Cents) || 0);

  let applied = anexo;
  let fatorR = null;
  if (anexo === "III_V") {
    // Sem receita não há razão a calcular; a regra cai no V (o lado
    // conservador — erra para MAIS imposto, nunca para menos).
    fatorR = rbt12 > 0 ? payroll / rbt12 : 0;
    applied = fatorR >= FATOR_R_THRESHOLD ? "III" : "V";
  }

  const eff = effectiveRate(applied, rbt12 / 100);
  const das = Math.round(revenue * eff.rate);
  return {
    anexo_applied: applied,
    fator_r: fatorR,
    bracket: eff.bracket,
    nominal_rate: eff.nominal,
    effective_rate: eff.rate,
    revenue_cents: revenue,
    rbt12_cents: rbt12,
    das_cents: das,
    over_ceiling: rbt12 / 100 > SIMPLES_CEILING,
  };
}

// ─── Acréscimos de guia em atraso ────────────────────────────────────────────
// Regra federal (Lei 9.430/96, art. 61), que o Simples e a maior parte dos
// municípios (SP inclusive) espelham:
//  - multa de mora: 0,33% por dia de atraso, teto de 20%;
//  - juros: Selic acumulada do 1º dia do mês SEGUINTE ao vencimento até o mês
//    ANTERIOR ao pagamento, + 1% no mês do pagamento. Pago dentro do próprio
//    mês do vencimento, não há juros — só multa.
const FINE_PER_DAY = 0.0033;
const FINE_CAP = 0.2;
const PAYMENT_MONTH_INTEREST = 0.01;
// Selic mensal usada quando o admin não cadastrou o mês. Aproximação — e a
// resposta marca `estimated: true` sempre que ela entrou na conta.
const DEFAULT_SELIC_MONTHLY = 0.0115;

function parseDate(iso) {
  // "YYYY-MM-DD" em UTC ao meio-dia: imune a fuso e a horário de verão.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
}

function monthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * @param amountCents  valor principal da guia
 * @param dueDate      "YYYY-MM-DD"
 * @param payDate      "YYYY-MM-DD" (normalmente hoje)
 * @param selicByMonth { "YYYY-MM": taxa decimal (0.0115 = 1,15%) }
 */
function computeLateCharges({ amountCents, dueDate, payDate, selicByMonth = {}, defaultSelic = DEFAULT_SELIC_MONTHLY }) {
  const principal = Math.max(0, Math.round(Number(amountCents) || 0));
  const due = parseDate(dueDate);
  const pay = parseDate(payDate);
  if (!due || !pay) return { error: "Data inválida" };

  const days = Math.max(0, Math.round((pay - due) / 86400000));
  if (days === 0) {
    return {
      days_late: 0, fine_rate: 0, interest_rate: 0,
      fine_cents: 0, interest_cents: 0, total_cents: principal,
      principal_cents: principal, estimated: false, selic_months: [],
    };
  }

  const fineRate = Math.min(days * FINE_PER_DAY, FINE_CAP);

  let interestRate = 0;
  let estimated = false;
  const selicMonths = [];
  const dueMonth = monthKey(due);
  const payMonth = monthKey(pay);
  if (payMonth !== dueMonth) {
    // meses inteiros entre o vencimento e o pagamento, exclusive nas pontas
    const cursor = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 1, 12));
    while (monthKey(cursor) !== payMonth) {
      const key = monthKey(cursor);
      const known = selicByMonth[key];
      const rate = Number.isFinite(known) ? known : defaultSelic;
      if (!Number.isFinite(known)) estimated = true;
      selicMonths.push({ month: key, rate, estimated: !Number.isFinite(known) });
      interestRate += rate;
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    interestRate += PAYMENT_MONTH_INTEREST;
  }

  const fine = Math.round(principal * fineRate);
  const interest = Math.round(principal * interestRate);
  return {
    days_late: days,
    fine_rate: fineRate,
    interest_rate: interestRate,
    fine_cents: fine,
    interest_cents: interest,
    total_cents: principal + fine + interest,
    principal_cents: principal,
    estimated,
    selic_months: selicMonths,
  };
}

module.exports = {
  SIMPLES_TABLES,
  SIMPLES_ANEXOS,
  FATOR_R_THRESHOLD,
  DEFAULT_SELIC_MONTHLY,
  effectiveRate,
  estimateDas,
  computeLateCharges,
  parseDate,
  monthKey,
};
