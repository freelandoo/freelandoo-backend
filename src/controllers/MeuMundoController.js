const { buildDemoNeighborhood } = require("../utils/meuMundoDemo");

// Bairro demonstrativo da área administrativa. Sem banco nesta etapa: a
// definição é montada em memória e nada é gravado.
async function adminNeighborhood(_req, res) {
  res.set("Cache-Control", "no-store");
  return res.json(buildDemoNeighborhood());
}

module.exports = { adminNeighborhood };
