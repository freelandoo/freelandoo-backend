// src/utils/bankCategoryMap.js
//
// Categoria da Malvo (catálogo de 130, id de 8 dígitos em 3 níveis) → categoria
// da Vida Financeira (presets da mig 138).
//
// ⚠️ SEMPRE PELO `categoryId`, NUNCA PELO NOME: a doc da Malvo avisa que o
// texto pode mudar; o id é o contrato.
//
// ⚠️ O QUE NÃO ENTRA (skip) é tão importante quanto o mapa — entrar daria um
// gasto ou uma receita que não existiu:
//   04xxxxxx  transferência entre contas da MESMA pessoa (sai de um banco e
//             entra no outro: contaria duas vezes);
//   05090000  pagamento da fatura do cartão (as compras do cartão já entram
//             pela conta do cartão: pagar a fatura seria o mesmo gasto de novo);
//   0301–0305 aplicação/resgate de investimento (dinheiro mudando de lugar,
//             não gasto nem renda). Proventos (0306) entram como renda.
//
// O que não tem par fica com o nome da própria Malvo (que já é em português) —
// é melhor que "Outros" para quem lê o extrato.

const SKIP_PREFIXES = ["04", "05090000", "030100", "030200", "030300", "030400", "030500"];

// Do mais específico para o mais geral: o primeiro prefixo que casar vence.
const MAP = [
  ["01010000", "Salário"],
  ["01020000", "Aposentadoria"],
  ["01030000", "Vendas"],
  ["0306", "Renda de investimentos"],
  ["01", "Outras receitas"],
  ["02", "Financiamento"],
  ["10", "Mercado"],
  ["11", "Bar / Restaurante"],
  ["19", "Transporte"],
  ["18", "Farmácia"],
  ["21", "Lazer"],
  ["20", "Seguro"],
  ["09", "Streaming"],
  ["16", "Tarifas bancárias"],
  ["15", "Impostos"],
  ["17", "Moradia"],
  ["08", "Compras"],
  ["12", "Viagens"],
  ["13", "Doações"],
  ["14", "Apostas"],
  ["07", "Serviços"],
  ["05", "Transferências"],
];

/**
 * @param {{ categoryId?: string|null, category?: string|null }} tx
 * @returns {{ skip: true } | { skip: false, label: string }}
 */
function mapBankCategory(tx) {
  const id = String(tx?.categoryId || "");
  if (id && SKIP_PREFIXES.some((p) => id.startsWith(p))) return { skip: true };
  if (id) {
    for (const [prefix, label] of MAP) if (id.startsWith(prefix)) return { skip: false, label };
  }
  const own = String(tx?.category || "").trim().slice(0, 60);
  return { skip: false, label: own || "Outros" };
}

module.exports = { mapBankCategory };
