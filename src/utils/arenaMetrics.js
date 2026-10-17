/**
 * arenaMetrics.js — dicionário de métricas da Arena (Módulo 08) e a régua de
 * privacidade dos agregados. FONTE ÚNICA: a API serve este dicionário em
 * GET /arena/stats/meta e a interface desenha unidade, aditividade e
 * limitações a partir dele (nunca de textos copiados).
 *
 * Duas camadas de exposição (ver docs da Arena, MODULE_08_09_REPORT):
 *   public  — o que o JOGO já mostra ao vivo a qualquer jogador (contagens de
 *             checkpoint por poste/equipe em categoria NÃO sensível, liderança
 *             e apuração). Sem supressão extra; categoria sensível nunca entra.
 *   people  — o que conta PESSOAS (participantes únicos, online, ativos,
 *             presença, preferência declarada). Valor abaixo de MIN_COHORT é
 *             suprimido, com supressão COMPLEMENTAR para que o oculto não seja
 *             recuperado subtraindo os demais do total.
 */

const MIN_COHORT = 5;
/** Presença por trecho: célula com menos que isto (jogador·minuto) é suprimida. */
const MIN_CELL_PLAYER_MINUTES = 30;

const LIMITS = {
  hour: { maxBuckets: 168, stepMs: 3_600_000 },
  day: { maxBuckets: 92, stepMs: 86_400_000 },
};

const METRICS = [
  {
    key: "checkpoints",
    name: "Checkpoints aceitos",
    meaning: "Participações aceitas pelo backend (regra V1 do M07). Uma pessoa pode gerar várias: postes, categorias e horas diferentes.",
    unit: "checkpoints",
    source: "tb_arena_checkpoint (fatos)",
    formula: "COUNT(*) dos fatos com window_start no bucket",
    dimensions: ["environment", "category", "team", "post"],
    granularity: ["hour", "day"],
    additive: true,
    tier: "public",
    dedupe: "um fato por (conta, ambiente, poste, categoria, hora) pelo índice único; retry, shard e retransmissão não criam fato novo",
    limitations: ["categoria sensível nunca entra", "hora atual é parcial"],
  },
  {
    key: "participants",
    name: "Participantes únicos (checkpoint)",
    meaning: "Contas distintas com ao menos um checkpoint aceito no bucket.",
    unit: "contas",
    source: "tb_arena_checkpoint (fatos)",
    formula: "COUNT(DISTINCT id_user) no bucket e recorte",
    dimensions: ["environment", "category"],
    granularity: ["hour", "day"],
    additive: false,
    tier: "people",
    dedupe: "distinto por conta dentro do bucket; nunca somar buckets nem ambientes",
    limitations: ["fatos de contas excluídas ficam anônimos e NÃO entram (cobertura parcial)"],
  },
  {
    key: "online_avg",
    name: "Jogadores online (média)",
    meaning: "Média, nos minutos COBERTOS pela coleta, de contas controlando um avatar.",
    unit: "jogadores",
    source: "tb_arena_presence_sample + tb_arena_presence_beat",
    formula: "SUM(controlling) / minutos cobertos",
    dimensions: ["environment"],
    granularity: ["hour", "day"],
    additive: false,
    tier: "people",
    dedupe: "um controlador por conta (o servidor de jogo recusa a segunda aba); retomada não duplica",
    limitations: ["avatar parado aguardando retomada NÃO conta", "sem coleta antes do início da coleta", "não é população da UF"],
  },
  {
    key: "online_peak",
    name: "Jogadores online (pico)",
    meaning: "Maior número de contas controlando avatar num minuto coberto.",
    unit: "jogadores",
    source: "tb_arena_presence_sample",
    formula: "MAX por minuto de SUM(controlling)",
    dimensions: ["environment"],
    granularity: ["hour", "day"],
    additive: false,
    tier: "people",
    dedupe: "idem online_avg",
    limitations: ["minuto sem coleta não entra"],
  },
  {
    key: "resident_avg",
    name: "Avatares residentes (média)",
    meaning: "Avatares no mundo, incluindo os parados aguardando retomada. NÃO é 'ativos'.",
    unit: "avatares",
    source: "tb_arena_presence_sample",
    formula: "SUM(controlling + away) / minutos cobertos",
    dimensions: ["environment"],
    granularity: ["hour", "day"],
    additive: false,
    tier: "people",
    dedupe: "idem online_avg",
    limitations: ["inclui conexões caídas na janela de retomada"],
  },
  {
    key: "active_players",
    name: "Jogadores ativos no período",
    meaning: "Contas distintas vistas CONTROLANDO um avatar em pelo menos um minuto coberto do bucket.",
    unit: "contas",
    source: "tb_arena_presence_unique (consolidado) / tb_arena_presence_member (transitório)",
    formula: "COUNT(DISTINCT conta) no bucket",
    dimensions: ["environment"],
    granularity: ["hour", "day"],
    additive: false,
    tier: "people",
    dedupe: "distinto por conta entre abas, retomadas, shards e instâncias",
    limitations: ["bucket fechado sem consolidação em até 48 h fica sem dado", "nunca somar buckets"],
  },
  {
    key: "leading_now",
    name: "Postes liderados agora",
    meaning: "Disputas (poste × categoria) da hora ATUAL com líder único, por equipe.",
    unit: "postes",
    source: "tb_arena_territory_state (janela atual)",
    formula: "COUNT por leader_team_id com status = leader",
    dimensions: ["environment", "category", "team"],
    granularity: ["now"],
    additive: true,
    tier: "public",
    dedupe: "uma linha por disputa",
    limitations: ["estado parcial: a hora não terminou", "empate é estado próprio"],
  },
  {
    key: "hourly_wins",
    name: "Vitórias horárias",
    meaning: "Apurações finalizadas (M07) com liderança ÚNICA, por equipe. Não é tempo de domínio.",
    unit: "apurações",
    source: "tb_arena_territory_tally",
    formula: "COUNT por leader_team_id com status = leader",
    dimensions: ["environment", "category", "team"],
    granularity: ["hour", "day"],
    additive: true,
    tier: "public",
    dedupe: "uma apuração por disputa (chave primária)",
    limitations: ["empates contados à parte, sem meio ponto", "hora encerrada ainda não apurada aparece como atrasada"],
  },
  {
    key: "ties",
    name: "Empates",
    meaning: "Apurações finalizadas sem líder único.",
    unit: "apurações",
    source: "tb_arena_territory_tally",
    formula: "COUNT com status = tie",
    dimensions: ["environment", "category"],
    granularity: ["hour", "day"],
    additive: true,
    tier: "public",
    dedupe: "idem hourly_wins",
    limitations: [],
  },
  {
    key: "preference_declared",
    name: "Preferência declarada (estado atual)",
    meaning: "Contas com preferência VÁLIDA por equipe numa categoria não sensível, agora. Não é voto, não é participação e não tem histórico.",
    unit: "contas",
    source: "tb_arena_preference (M05)",
    formula: "COUNT por equipe das preferências válidas",
    dimensions: ["category", "team"],
    granularity: ["now"],
    additive: false,
    tier: "people",
    dedupe: "uma preferência por conta e categoria",
    limitations: ["só nacional (preferência não é da UF)", "categoria sensível nunca", "não existe série histórica"],
  },
];

const METRIC_KEYS = new Set(METRICS.map((m) => m.key));
const SERIES_METRICS = new Set(["checkpoints", "participants", "online_avg", "online_peak", "resident_avg", "active_players"]);
const PEOPLE = new Set(METRICS.filter((m) => m.tier === "people").map((m) => m.key));

/**
 * Supressão de um conjunto de células (ex.: as 27 UFs de um bucket).
 * Primária: 0 < valor < k. Complementar: se sobrou EXATAMENTE uma célula
 * suprimida e há um total publicado acima, a menor célula visível positiva
 * também é suprimida (desempate pela chave), para o total menos os visíveis
 * não revelar a oculta. Zero não é suprimido: "ninguém" não identifica ninguém.
 * Sem total publicado (ex.: preferência declarada), `complement: false`.
 * Devolve o Set de chaves suprimidas. Pura (testada em test/unit).
 */
function suppressCells(cells, k = MIN_COHORT, { complement = true } = {}) {
  const out = new Set();
  const entries = [...cells.entries()].filter(([, v]) => v !== null && v !== undefined);
  for (const [key, v] of entries) if (v > 0 && v < k) out.add(key);
  // Complemento só quando existe um total publicado do qual subtrair.
  if (complement && out.size === 1) {
    const visible = entries
      .filter(([key, v]) => !out.has(key) && v > 0)
      .sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0])));
    if (visible.length) out.add(visible[0][0]);
  }
  return out;
}

/** Valida e alinha [from, to) à granularidade (UTC). Devolve erro em texto. */
function parseRange(query, granularity) {
  const lim = LIMITS[granularity];
  if (!lim) return { error: "granularity" };
  const from = Date.parse(String(query?.from || ""));
  const to = Date.parse(String(query?.to || ""));
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { error: "from/to" };
  if (from % lim.stepMs !== 0 || to % lim.stepMs !== 0) return { error: "período desalinhado da granularidade (UTC)" };
  if (to <= from) return { error: "to <= from" };
  const buckets = (to - from) / lim.stepMs;
  if (buckets > lim.maxBuckets) return { error: `período maior que ${lim.maxBuckets} buckets` };
  if (from < Date.parse("2026-01-01T00:00:00Z")) return { error: "from antes do início da Arena" };
  return { from: new Date(from), to: new Date(to), buckets, stepMs: lim.stepMs };
}

module.exports = {
  MIN_COHORT,
  MIN_CELL_PLAYER_MINUTES,
  LIMITS,
  METRICS,
  METRIC_KEYS,
  SERIES_METRICS,
  PEOPLE,
  suppressCells,
  parseRange,
};
