// src/utils/meuMundoLife.js
//
// MEU MUNDO 3D — a VIDA do hóspede (mm3d-13). Fonte única das regras.
//
// ═══ COMO FUNCIONA ═══
// Simulação PREGUIÇOSA e DETERMINÍSTICA: nada roda em segundo plano. Quem lê
// ou age (MeuMundoLifeService) trava a linha do hóspede, chama
// `simulate(state, agora)` — que avança do `simAt` gravado até agora em
// passos de no máximo 15 min, quebrando exatamente nos limites (fim da
// atividade, fim de efeito, fim de janela de refeição, meia-noite) — aplica
// a ação e grava. Simular 10 h de uma vez dá o MESMO resultado que simular
// 10 vezes 1 h (o teste confere). Por isso deixar o personagem estudando e
// fechar o jogo funciona: ao voltar, as horas são contadas.
//
// ═══ RELÓGIO ═══
// O relógio do jogo é o de Brasília (UTC−3 fixo — o Brasil não tem horário
// de verão desde 2019), igual para todo mundo; 1 h de jogo = 1 h real. O fuso
// é do JOGO, não do aparelho nem do lugar: ninguém troca, e cada refeição tem
// id próprio (dia local do horário nominal + hora) — não há como duplicar.
// Refeições (2026-10-24, ver MEALS): 10, 14, 18 e 22 h, aceitas de 2 h antes
// até 2 h depois (inclusive); passou disso, 2 h de penalidade GRADUAL.
//
// ═══ UNIDADES ═══
// Vitais e fertilidade 0–100; inteligência, força e velocidade 0–1000 (ATTR). Taxas "por hora". Tempo em ms (epoch) nas
// fronteiras e em horas (dt) dentro do passo. Massa em kg, energia da comida
// em kcal. As regras por extenso estão no plano
// (MEU MUNDO 3D/planos/2026-10-20-mm3d-13-vida-do-hospede.md) e no REGISTRO.

const HOUR = 3600 * 1000;
const STEP_MS = 15 * 60 * 1000;
const MAX_CATCHUP_MS = 60 * 24 * HOUR; // além disso, o tempo passa sem simular

const DAY = 24 * HOUR;

const CLOCK = Object.freeze({
  OFFSET_MIN: -180, // America/Sao_Paulo
  MEALS: [10, 14, 18, 22],
});

// ═══ AGENDA DAS REFEIÇÕES (2026-10-24) ═══
// Cada refeição aceita comida de BEFORE_H antes a AFTER_H depois do horário
// (10 h: 08–12 h; 22 h: 20–24 h). A tolerância não pune. Terminada a
// tolerância sem a refeição quitada, PENALTY é aplicado aos poucos durante
// PENALTY_H (10 h: 12–14 h), pela fração exata do tempo — às 13 h vai metade,
// às 14 h vai tudo e para. Comer no atraso para o resto (proporcional ao
// crédito que faltava); o que já foi perdido não volta.
//  • Saciedade: no atraso a agenda SUBSTITUI o decaimento natural (vale o mais
//    forte dos dois, nunca a soma) — a mesma fome não é cobrada duas vezes.
//  • Saúde: a penalidade aguda não desce abaixo de HEALTH_FLOOR; dali para
//    baixo é a deterioração prolongada (EXPOSURE), que precisa de tempo.
//  • Crédito: cada item tem `meal` (1 = refeição inteira, fração = lanche,
//    0 = não conta — bebida não quita refeição). Porções se somam dentro da
//    mesma refeição até DONE_AT; a sobra NÃO vai para a próxima.
const MEALS = Object.freeze({
  HOURS: CLOCK.MEALS,
  BEFORE_H: 2,
  AFTER_H: 2,
  PENALTY_H: 2,
  PENALTY: Object.freeze({ satiety: 25, energy: 10, stress: 10, health: 10 }),
  HEALTH_FLOOR: 10,
  DONE_AT: 1,
});

// ═══ SONO ═══ — `awakeH` são as horas acordado (dormir desconta 3 h por
// hora; deitado acordado conta meia). Logout NÃO é dormir: o tempo segue.
const SLEEP = Object.freeze({
  WARN_H: 16, // aviso "Já estou há N horas acordado"
  STRESS_PER_H: 0.12, // estresse extra por hora acima de WARN_H
});

// ═══ EXPOSIÇÃO ACUMULADA ═══ — horas × gravidade (0–1) em que o hóspede
// esteve em estado crítico. Sobe enquanto dura, desce (RECOVER por hora) quando
// passa. É o que separa "um dia ruim" (recuperável) de negligência: o dano de
// fome prolongada, o desgaste da vida e as consequências de longo prazo saem
// daqui, nunca de um limiar cruzado uma vez. A simulação nunca reprocessa um
// intervalo (simAt), então nada é contado duas vezes.
const EXPOSURE = Object.freeze({
  KEYS: ["hunger", "sleep", "stress", "health"],
  RECOVER: Object.freeze({ hunger: 0.5, sleep: 0.5, stress: 0.4, health: 0.25 }),
  HOSPITAL_RECOVER: 3, // internado, a exposição desce 3× mais rápido (tratamento)
  STARVE_AFTER: 8, // horas-críticas de fome antes do dano de inanição
  STARVE_RAMP: 16,
});

// ═══ VIDA ═══ — orçamento de LIFE_DAYS dias equivalentes. Bem cuidado,
// cada dia real gasta 1 (vida nominal = 2 anos reais); em estado crítico o
// desgaste acelera (WEAR × gravidade). Idade cronológica = agora − born_at
// (não entra na conta: o desgaste basal JÁ é 1 dia por dia). Comida e sono
// reduzem o desgaste futuro, nunca devolvem o gasto.
const LIFE = Object.freeze({
  DAYS: 730,
  WEAR: Object.freeze({ hunger: 12, sleep: 10, stress: 6, health: 10 }),
  WARN_LEFT_DAYS: 30,
});

// ═══ FÔLEGO DE CORRIDA ═══ — segundos de corrida com o fôlego cheio e
// segundos para encher de novo, pela condição (a sala aplica; ver
// meuMundoMotion.js STAMINA). Energia geral ≠ fôlego: correr não gasta energia.
const STAMINA = Object.freeze({
  BASE_S: 45,
  SPEED_S: 0.06, // + segundos por ponto de velocidade (0–1000)
  MIN_S: 6,
  REFILL_S: 20,
});

// praying (mm3d-37d): rezar na igreja; jail (mm3d-37f): preso na delegacia —
// como o hospital, só a vida/o servidor põe alguém preso.
const ACTIVITIES = Object.freeze(["idle", "lying", "sleeping", "studying", "training", "working", "hospital", "praying", "jail"]);
// Horas que o jogador pode marcar em cada atividade (deitar sem hora = até levantar).
const ACTIVITY_HOURS = Object.freeze({
  studying: [1, 72],
  training: [1, 72],
  working: [1, 72],
  sleeping: [1, 16],
  lying: [1, 24],
  praying: [1, 3],
});

// Por hora: energia, saciedade, estresse e o multiplicador do gasto calórico.
const RATES = Object.freeze({
  idle: { energy: -4.5, satiety: -6.5, stress: -1, kcal: 1.3 },
  lying: { energy: 3, satiety: -5, stress: -4, kcal: 1.0 },
  sleeping: { energy: 12, satiety: -3, stress: -3.5, kcal: 0.9 },
  studying: { energy: -7, satiety: -6.5, stress: 2.2, kcal: 1.4 },
  training: { energy: -11, satiety: -10, stress: -2.5, kcal: 6.0 },
  working: { energy: -6.5, satiety: -7, stress: 3, kcal: 1.6 },
  hospital: { energy: 6, satiety: 0, stress: -2, kcal: 1.0 },
  // Rezar (mm3d-37d): o estresse cai rápido e o humor sobe (ver o humor).
  praying: { energy: -1.5, satiety: -4, stress: -15, kcal: 1.0 },
  // Preso (mm3d-37f): parado na cela, a cabeça pesa.
  jail: { energy: -3, satiety: -5, stress: 2, kcal: 1.0 },
});

const RULES = Object.freeze({
  BASE_KCAL_H: 70,
  // Na vida real 1 kg de gordura ≈ 7.700 kcal; no jogo o corpo responde 2×
  // mais rápido (uma semana de porcaria tem que aparecer).
  KCAL_PER_KG: 3850,
  FULL_SATIETY: 92, // acima disso a comida é recusada ("está cheio")
  COLLAPSE_AFTER_H: 6, // horas com energia zerada (sem estimulante) até desmaiar
  COLLAPSE_SLEEP_H: 8,
  HOSPITAL_AT: 15, // saúde
  DISCHARGE_AT: 60,
  DISCHARGE_MAX_TOX: 20,
  ADMIT_SEQUEL: 8, // vitalidade perdida por internação
  INFARCT_SEQUEL: 20,
  INFARCT_DAMAGE: 55,
  FATAL_VITALITY: 20, // internado com vitalidade ≤ isto não resiste
  START_COINS: 500,
  WORK_COINS_H: 14,
  // A7: as moedas do jogo são Esmeralda. O trabalho rende no máximo isto por
  // dia de Brasília (teto PRÓPRIO, separado do teto do engajamento). Conta de
  // hoje: 14/h × (0,6 + int/1000) × foco × ~6–8 h úteis ≈ 130–180. O admin
  // muda em emerald_settings.work_daily_cap (chega pela carteira: workCap).
  WORK_COINS_DAY: 150,
  // Recuperação de saúde por hora (só com fome, sono, estresse e toxicidade
  // sob controle); bem alimentado (saciedade > FED_AT e dieta ≥ 0) soma FED.
  // Dormir rende 3/h e o hospital também (pedido do Alex, 2026-10-26: doente
  // todo dia estava chato); multivitamínico ×MULTIVIT, com creatina junto
  // ×MULTIVIT_CREATINE. Comida natural (`heal`) devolve pontos na hora.
  RECOVERY: { idle: 0.25, lying: 0.4, sleeping: 3, hospital: 3, FED: 0.2, FED_AT: 40, MULTIVIT: 1.3, MULTIVIT_CREATINE: 1.7 },
  // Gordo (BODY.FAT_AT): todo dano à saúde pesa 1,2× (pedido do Alex, 2026-10-21).
  FAT_HEALTH_MUL: 1.2,
  // Saúde baixa pesa no resto (pedido do Alex, 2026-10-26: "não pode estar
  // disposto e sem estresse com a saúde grave"). Fator u = 0 com saúde ≥ FROM
  // e 1 com saúde ≤ FULL. Energia: teto 100 − ENERGY_CAP·u; estresse: piso
  // STRESS_FLOOR·u (até STRESS_MAX). Grave (< 35) = no máximo "Bem" e no
  // mínimo "Tenso". Sem gasto extra e com o gasto do dia encolhendo junto
  // com o teto: senão vira ciclo vicioso (energia zera → dano → saúde pior);
  // os limites nunca travam a recuperação (energia > 25 e estresse < 70).
  UNWELL: Object.freeze({ FROM: 60, FULL: 15, ENERGY_CAP: 60, STRESS_FLOOR: 72, STRESS_MAX: 60 }),
});

// ═══ GELADEIRA ═══ — estoque por pessoa (mig 301). O Mercado do STATUS
// compra para cá; comer é na geladeira da casa. Toda pessoa ganha STARTER
// uma vez (para a primeira refeição não depender de ir ao mercado).
const FRIDGE = Object.freeze({
  STARTER: Object.freeze({ prato_feito: 2, frango_salada: 1, iogurte_aveia: 2, bowl_frutas: 1, agua_coco: 2, cafe: 2 }),
  MAX_STACK: 99, // por item
  MAX_BUY: 10, // por compra
});

// ═══ CORPO ═══ — desde 2026-10-21 o tipo físico NÃO se escolhe: sai daqui.
// Todo hóspede nasce MUITO magro (~8–10% de gordura); a comida soma gordura
// (kcal), o gasto do dia tira, e só o TREINO soma massa magra. Comer sem
// atividade física só engorda. O avatar da sala e os retratos seguem
// `bodyHint` (a sala recebe pela vida — applyLife).
const BODY = Object.freeze({
  SLIM_BELOW: 13, // % de gordura
  FAT_AT: 25,
  STRONG_MAX_FAT: 20,
  STRONG_FFMI: 20, // massa magra / altura² (nasce ~16,5)
  STRONG_STRENGTH: 600,
});

// ═══ ATRIBUTOS (sem teto, regra do Alex em 2026-11-06) ═══ — progressão longa:
// com o ritmo máximo de todo dia, 800 leva ~1 ano e 900 ~2 anos.
//  • Ganho por hora ÚTIL = base × (1 − v/CURVE_AT)² × multiplicadores, nunca menos
//    que CURVE_MIN do base: depois de ~950 sobe devagar, mas não para.
//  • Só as primeiras USEFUL_H horas do dia rendem (o músculo/a cabeça precisa
//    recuperar); passando disso, OVER_FACTOR.
//  • Permanência: cada atributo guarda o maior valor já alcançado (`peaks`) e
//    nunca cai abaixo de FLOOR × pico; abaixo do pico ganha REGAIN× (memória).
//  • O hóspede nasce na casa das dezenas (15–35) — mig 298.
const ATTR = Object.freeze({
  // MAX é só a escala (salário, faixa da barra): não é teto
  MAX: 1000,
  CURVE_AT: 1100,
  CURVE_MIN: 0.02,
  // B10: trainAcc = o saco de pancada treina a acurácia (B7).
  GAIN_H: { studyInt: 1.6, trainStr: 2.0, trainSpd: 1.4, workInt: 0.2, trainAcc: 1.6 },
  USEFUL_H: { studying: 5, training: 4 },
  OVER_FACTOR: 0.05,
  REGAIN: 2,
  FLOOR: { intelligence: 0.9, strength: 0.6, speed: 0.6, dexterity: 0.6, accuracy: 0.6 },
  // Sem praticar, cai por dia (2026-11-03, pedido do Alex): força, velocidade
  // e destreza 5 pontos (até 60% do pico); inteligência 1 (até 90%). Só cai
  // depois de DECAY_AFTER_H sem praticar aquele atributo — quem treina todo
  // dia não perde nas horas em que não está treinando.
  // B7 (2026-11-08): acurácia segue a regra de força/velocidade/destreza.
  DECAY_DAY: { intelligence: 1, strength: 5, speed: 5, dexterity: 5, accuracy: 5 },
  DECAY_AFTER_H: 24,
  // mm3d-59: ORÇAMENTO DIÁRIO (pontos-base, ANTES da curva, dia de Brasília).
  // Todas as fontes do mesmo atributo (academia, universidade, minijogos,
  // lutas) gastam o mesmo saldo; os multiplicadores (disciplina, suplementos,
  // anabolizante, universidade) aumentam o base e por isso batem o teto antes,
  // nunca passam dele. Trocar de jogo/classe/skin ou reconectar não reinicia.
  BUDGET: { strength: 12, intelligence: 12, dexterity: 12, speed: 8, accuracy: 12 },
});
/** Os três que crescem com o adulto (+20%) e entram na régua do crescer. */
const TRAINED = Object.freeze(["intelligence", "strength", "speed"]);
/**
 * Os atributos de prática (mm3d-59: + destreza; B7, 2026-11-08: + ACURÁCIA). A acurácia nasce
 * em 0 e ainda nada a treina (o B10 faz o saco de pancada treiná-la); entra no Poder
 * (meuMundoPower.js). Não confundir com o rótulo "Acuracidade" que a tela dá à chave
 * `strength` desde 2026-11-06.
 */
const ATTRS = Object.freeze(["strength", "intelligence", "dexterity", "speed", "accuracy"]);
/** Destreza de quem nasce (e o backfill da mig 320): pela semente, sem sortear de novo. */
const birthDexterity = (seed) => 15 + (Math.abs(Number(seed) || 0) % 16);

// ═══ CRESCER (mm3d-58; regra nova do Alex em 2026-11-02) ═══ — o hóspede
// nasce JOVEM e vira ADULTO pelo que ele CONQUISTA, não só pelo tempo:
//  • idade mínima MIN_DAYS (1 mês de jogo: é quando o jovem termina de
//    crescer — 1,40 m → 1,70/1,65, ver meuMundoHeights.js GROW);
//  • e FORÇA e INTELIGÊNCIA subiram TARGET desde que nasceu (pelo pico: uma
//    semana parado não desfaz o caminho).
// O alvo é a MÉDIA entre o máximo do mês (tudo no talo: disciplina alta,
// whey + pré-treino + creatina + anabolizante, universidade + estimulante —
// força +502, inteligência +358) e o jogador bom sem suplemento (força +226,
// inteligência +261): força +350, inteligência +300. No talo, vira adulto com
// 1 mês; bom sem suplemento, ~55 dias; metade do treino, ~4 meses e meio —
// e quem é maltratado gasta a vida mais rápido (LIFE.WEAR) e pode morrer
// jovem. Virou adulto: +20% em cada atributo e saúde 100.
const GROWTH = Object.freeze({
  MIN_DAYS: 30,
  TARGET: Object.freeze({ strength: 350, intelligence: 300 }),
  /** Quem nasceu antes da regra nova: o ponto de partida (o hóspede nasce com 15–30). */
  LEGACY_BASE: 25,
  BONUS: 0.2,
});
const GROWN = Object.freeze(["strength", "intelligence"]);

// ═══ LUGARES (mm3d-37b) ═══ — treino e estudo só dentro do prédio do centro
// (pedido do Alex). A atividade guarda o lugar; a universidade cobra a hora de
// aula (moedas do jogo, na largada) e rende mais; biblioteca e escola são de
// graça. Trabalhar continua em qualquer lugar.
const PLACES = Object.freeze({
  training: Object.freeze(["academia"]),
  studying: Object.freeze(["universidade", "biblioteca", "escola"]),
  // mm3d-37d: rezar é na igreja.
  praying: Object.freeze(["igreja"]),
});
const PLACE_RULES = Object.freeze({
  academia: Object.freeze({ mul: 1, feeH: 0 }),
  universidade: Object.freeze({ mul: 1.5, feeH: 8 }),
  biblioteca: Object.freeze({ mul: 1, feeH: 0 }),
  escola: Object.freeze({ mul: 1, feeH: 0 }),
  igreja: Object.freeze({ mul: 1, feeH: 0 }),
});
// ═══ APARELHOS E CURSOS POR NÍVEL (B10, 2026-11-08; decisão pela recomendação da FILA) ═══
// Dentro do prédio a pessoa escolhe ONDE treina/estuda. Cada aparelho tem níveis
// travados pelo próprio atributo (só pega o nível com o mínimo) e rende mais por hora
// quanto mais alto (`mul` multiplica o ganho-base; o orçamento do dia continua igual,
// então quem treina pesado bate o teto antes — nunca passa dele).
//  • pesos   → força         · esteira → velocidade (velocidade máxima travada pela velocidade)
//  • saco    → velocidade + acurácia (um nível só; o atributo novo do B7)
//  • curso (universidade) e livro (biblioteca/escola) → inteligência; a escola vai até o nível 2
// Sem aparelho (servidor/tela antigos) = o treino de sempre (força + velocidade).
const TIER_MIN = Object.freeze([0, 150, 300, 500, 750]);
const TIER_MUL = Object.freeze([1, 1.15, 1.3, 1.45, 1.6]);
const STATIONS = Object.freeze({
  weights: Object.freeze({ kind: "training", attr: "strength", places: Object.freeze(["academia"]), maxTier: 5 }),
  treadmill: Object.freeze({ kind: "training", attr: "speed", places: Object.freeze(["academia"]), maxTier: 5 }),
  bag: Object.freeze({ kind: "training", attr: null, places: Object.freeze(["academia"]), maxTier: 1 }),
  course: Object.freeze({ kind: "studying", attr: "intelligence", places: Object.freeze(["universidade"]), maxTier: 5 }),
  book: Object.freeze({ kind: "studying", attr: "intelligence", places: Object.freeze(["biblioteca", "escola"]), maxTier: 5, placeMax: Object.freeze({ escola: 2 }) }),
});
/** "weights:3" → { id, tier }; inválido = null. */
function parseStation(raw) {
  const m = /^([a-z]+)(?::([1-9]))?$/.exec(String(raw || ""));
  if (!m || !STATIONS[m[1]]) return null;
  return { id: m[1], tier: m[2] ? Number(m[2]) : 1 };
}
/** Pode usar o aparelho/curso? Devolve o código do erro ou null. */
function stationBlock(s, kind, place, raw) {
  if (raw == null || raw === "") return null;
  const st = parseStation(raw);
  if (!st) return "station";
  const def = STATIONS[st.id];
  if (def.kind !== kind || !def.places.includes(place)) return "station";
  const max = Math.min(def.maxTier, (def.placeMax && def.placeMax[place]) || def.maxTier);
  if (st.tier > max) return "station";
  if (def.attr && (Number(s[def.attr]) || 0) < TIER_MIN[st.tier - 1]) return "tier";
  return null;
}
const stationMul = (st) => TIER_MUL[(st ? st.tier : 1) - 1] || 1;

// Cardápio dos restaurantes do centro (mm3d-37c): pede no balcão e come na
// hora (vale a refeição como qualquer prato). Comprar para a geladeira é só
// no supermercado.
const MENUS = Object.freeze({
  pizzaria: Object.freeze(["pizza", "refrigerante", "agua_coco"]),
  hamburgueria: Object.freeze(["hamburguer", "cachorro_quente", "coxinha", "refrigerante"]),
});
const MARKET_PLACE = "supermercado";

// ═══ CRIMES (mm3d-37f) ═══ — pedido do Alex: dirigir na praça e atropelar
// alguém levam à delegacia. A sala do centro vê o crime; aqui mora a pena.
//  - praça: a 1ª vez no dia é multa (até o que tiver); a reincidência, prisão;
//  - atropelamento: prisão.
// Preso = atividade "jail" por alguns MINUTOS (tempo de verdade), na cela;
// nada de estudar, treinar, trabalhar ou rezar até sair.
const CRIME = Object.freeze({ PLAZA_FINE: 50, PLAZA_JAIL_MIN: 15, HIT_JAIL_MIN: 30 });

// Lesão (efeito "injury", deixado pelo boxe antigo, mm3d-43): fora do
// hospital a saúde volta pela metade até ele vencer.
const INJURY_RECOVERY = 0.5;

/** Moedas para marcar `hours` de `kind` em `place` (0 = de graça). */
function placeFee(kind, place, hours) {
  if (!PLACES[kind] || !PLACE_RULES[place]) return 0;
  return Math.round(PLACE_RULES[place].feeH * Number(hours || 0));
}

// ═══ ROTINA ═══ — estudar/treinar/trabalhar por horas não é maratona: o
// hóspede dorme quando a energia acaba, descansa quando o estresse estoura e
// come nas janelas (comprando com as moedas do jogo), depois volta à tarefa.
const ROUTINE = Object.freeze({
  KINDS: ["studying", "training", "working"],
  SLEEP_AT_ENERGY: 12,
  SLEEP_H: 8,
  REST_AT_STRESS: 80,
  REST_H: 3,
  MIN_LEFT_H: 1, // com menos que isso sobrando, ele só termina
  // Bateu as horas úteis do dia (estudo/treino): descansa deitado até a hora
  // de dormir, dorme e retoma de manhã.
  BED_AT: 23,
  WAKE_AT: 7,
  MEALS: ["prato_integral", "prato_feito", "miojo"], // o melhor que a carteira paga
});

// Ritmo de caminhada pelo estado do corpo (a sala aplica; o cliente espelha
// em engine/motion.ts — paceSpeeds).
const PACE = Object.freeze({ NORMAL: 1, TIRED: 0.7, EXHAUSTED: 0.42 });

// ═══ CATÁLOGO ═══ — preços em moedas do jogo (não é Polén nem saldo).
// Saudável é caro, porcaria é barata (pedido do Alex).
// kcal, sat (saciedade), sugar/sodium 0–10, nutri −10…+10 (qualidade),
// protein (g), mood (prazer por 2 h), energy/stress instantâneos, tox
// (toxicidade), effect = [id, horas], meal = crédito de refeição (MEALS:
// 1 quita, fração é lanche, 0 não conta), heal = saúde na hora (comida
// natural, mais cara; nunca passa da vitalidade).
const I = (id, kind, name, price, o = {}) =>
  Object.freeze({ id, kind, name, price, currency: "coins", meal: 0, kcal: 0, sat: 0, sugar: 0, sodium: 0, nutri: 0, protein: 0, mood: 0, energy: 0, stress: 0, tox: 0, heal: 0, effect: null, ...o });

const ITEMS = Object.freeze([
  // Comida saudável (cara)
  I("salmao_legumes", "food", "Salmão grelhado com legumes", 75, { meal: 1, kcal: 520, sat: 45, sodium: 3, nutri: 10, protein: 38, mood: 6, heal: 3 }),
  I("frango_salada", "food", "Frango grelhado com salada", 55, { meal: 1, kcal: 430, sat: 40, sodium: 3, nutri: 9, protein: 40, mood: 4, heal: 3 }),
  I("prato_integral", "food", "Arroz integral, feijão, ovo e salada", 34, { meal: 1, kcal: 560, sat: 48, sodium: 3, nutri: 8, protein: 24, mood: 4 }),
  I("bowl_frutas", "food", "Bowl de frutas", 38, { meal: 0.5, kcal: 260, sat: 22, sugar: 4, nutri: 7, protein: 3, mood: 6, heal: 3 }),
  I("omelete_legumes", "food", "Omelete de legumes", 26, { meal: 0.8, kcal: 330, sat: 30, sodium: 3, nutri: 7, protein: 22, mood: 3 }),
  I("iogurte_aveia", "food", "Iogurte natural com aveia", 24, { meal: 0.5, kcal: 280, sat: 25, sugar: 2, nutri: 7, protein: 14, mood: 3 }),
  I("sopa_legumes", "food", "Sopa de legumes", 32, { meal: 0.7, kcal: 220, sat: 28, sodium: 4, nutri: 7, protein: 8, mood: 3, heal: 3 }),
  I("agua_coco", "drink", "Água de coco", 12, { meal: 0.1, kcal: 60, sat: 4, sugar: 2, nutri: 4, energy: 3 }),
  // Comida do dia a dia
  I("prato_feito", "food", "Prato feito (arroz, feijão, bife e fritas)", 18, { meal: 1, kcal: 850, sat: 50, sodium: 6, nutri: 1, protein: 32, mood: 7 }),
  // Porcaria (barata)
  I("hamburguer", "food", "Hambúrguer com fritas", 12, { meal: 1, kcal: 1100, sat: 45, sugar: 3, sodium: 8, nutri: -7, protein: 28, mood: 12 }),
  I("pizza", "food", "Pizza (3 fatias)", 10, { meal: 1, kcal: 900, sat: 40, sugar: 2, sodium: 8, nutri: -6, protein: 30, mood: 12 }),
  I("cachorro_quente", "food", "Cachorro-quente", 8, { meal: 0.7, kcal: 620, sat: 32, sugar: 2, sodium: 8, nutri: -6, protein: 16, mood: 9 }),
  I("coxinha", "food", "Coxinha", 5, { meal: 0.4, kcal: 380, sat: 20, sodium: 6, nutri: -6, protein: 9, mood: 8 }),
  I("chocolate", "food", "Barra de chocolate", 5, { meal: 0.2, kcal: 540, sat: 12, sugar: 9, nutri: -6, protein: 5, mood: 14 }),
  I("miojo", "food", "Miojo", 4, { meal: 0.6, kcal: 380, sat: 22, sodium: 10, nutri: -7, protein: 7, mood: 5 }),
  I("salgadinho", "food", "Salgadinho de pacote", 4, { meal: 0.2, kcal: 450, sat: 12, sodium: 9, nutri: -8, protein: 5, mood: 9 }),
  I("biscoito_recheado", "food", "Biscoito recheado", 3, { meal: 0.2, kcal: 480, sat: 12, sugar: 9, nutri: -8, protein: 4, mood: 10 }),
  I("refrigerante", "drink", "Refrigerante (lata)", 3, { kcal: 150, sat: 3, sugar: 10, nutri: -7, mood: 7, energy: 2 }),
  // Suplementos
  I("albumina", "supplement", "Albumina", 15, { meal: 0.2, kcal: 110, sat: 6, nutri: 3, protein: 25, effect: ["albumin", 4] }),
  I("whey", "supplement", "Whey protein", 45, { meal: 0.2, kcal: 130, sat: 8, sugar: 1, nutri: 4, protein: 25, effect: ["whey", 4] }),
  I("pre_treino", "supplement", "Pré-treino", 30, { energy: 15, tox: 5, effect: ["preworkout", 3] }),
  I("creatina", "supplement", "Creatina", 35, { nutri: 1, effect: ["creatine", 24] }),
  I("multivitaminico", "supplement", "Multivitamínico", 25, { nutri: 2, effect: ["multivit", 24] }),
  // Remédios
  // apresentação 05 (D9, 2026-11-11): Metformina e Losartana saíram junto com o diabetes e a
  // pressão alta (mig 443 devolve as moedas de quem tinha na despensa).
  I("calmante", "medicine", "Calmante", 25, { stress: -30, energy: -10, tox: 3, effect: ["calm", 8] }),
  // Estimulantes (para não dormir)
  I("cafe", "stimulant", "Café", 2, { kcal: 5, energy: 8, tox: 1, effect: ["coffee", 2] }),
  I("energetico", "stimulant", "Energético", 6, { kcal: 110, sugar: 7, energy: 15, tox: 4, mood: 4, effect: ["energy_drink", 3] }),
  I("estimulante", "stimulant", "Estimulante (cápsula)", 40, { energy: 35, tox: 22, stress: 5, effect: ["stim", 8] }),
  // Anabolizante
  I("anabolizante", "anabolic", "Anabolizante injetável", 120, { tox: 15, mood: 4, effect: ["anabolic", 7 * 24] }),
]);
const ITEM_BY_ID = new Map(ITEMS.map((it) => [it.id, it]));

// ═══ UTILIDADES ═══
const clamp = (v, lo = 0, hi = 100) => (v < lo ? lo : v > hi ? hi : v);
/** Quanto a saúde baixa pesa (0–1; ver RULES.UNWELL). */
const unwellOf = (s) => clamp((RULES.UNWELL.FROM - s.health) / (RULES.UNWELL.FROM - RULES.UNWELL.FULL), 0, 1);
/** Teto da energia e piso do estresse pela saúde. */
function applyUnwell(s) {
  const u = unwellOf(s);
  if (!u) return;
  const U = RULES.UNWELL;
  s.energy = Math.min(s.energy, 100 - U.ENERGY_CAP * u);
  s.stress = Math.max(s.stress, Math.min(U.STRESS_MAX, U.STRESS_FLOOR * u));
}
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

/** PRNG determinístico (mulberry32) — personalidade sai da semente. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Partes do relógio do jogo: dia (AAAA-MM-DD) e hora local (fracionária). */
function localParts(ms) {
  const d = new Date(ms + CLOCK.OFFSET_MIN * 60000);
  const day = d.toISOString().slice(0, 10);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600 + d.getUTCMilliseconds() / 3.6e6;
  return { day, hour };
}

/** Epoch da hora local `h` (0–24) do dia de `ms`. */
function atLocalHour(ms, h) {
  const off = CLOCK.OFFSET_MIN * 60000;
  const local = ms + off;
  const midnight = local - (((local % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR));
  return midnight + h * HOUR - off;
}

// ═══ REFEIÇÕES (instâncias) ═══
/**
 * As refeições de ontem, hoje e amanhã em volta de `ms`, em ordem. Cada uma:
 * id (dia local do horário nominal + hora), `at` (horário), `open` (aceita a
 * partir de), `tolEnd` (fim da tolerância, inclusive), `penEnd` (fim da
 * penalidade). A das 22 h atravessa a meia-noite com o id do dia em que abriu.
 */
function mealInstances(ms) {
  const out = [];
  for (const dd of [-1, 0, 1]) {
    const base = ms + dd * DAY;
    const day = localParts(base).day;
    MEALS.HOURS.forEach((h, i) => {
      const at = atLocalHour(base, h);
      out.push({
        id: `${day}@${h}`,
        i,
        h,
        day,
        at,
        open: at - MEALS.BEFORE_H * HOUR,
        tolEnd: at + MEALS.AFTER_H * HOUR,
        penEnd: at + (MEALS.AFTER_H + MEALS.PENALTY_H) * HOUR,
      });
    });
  }
  return out;
}

const mealCredit = (s, id) => (s.meals.log[id] ? s.meals.log[id].c : 0);
const mealDone = (s, id) => mealCredit(s, id) >= MEALS.DONE_AT - 1e-9;

/**
 * A refeição que um consumo em `ms` atende: a MAIS ANTIGA ainda pendente que
 * aceita comida agora (tolerância ou atraso). Às 12 h, a das 10 h vem antes
 * da das 14 h; encerrada a penalidade, a refeição não captura mais nada.
 */
function pendingMeal(s, ms) {
  for (const m of mealInstances(ms)) if (ms >= m.open && ms < m.penEnd && !mealDone(s, m.id)) return m;
  return null;
}

/** Refeição em atraso (penalidade correndo) em `ms` e a fração que ainda pesa (0–1). */
function latePenalty(s, ms) {
  for (const m of mealInstances(ms)) {
    if (ms >= m.tolEnd && ms < m.penEnd) {
      const f = 1 - Math.min(1, mealCredit(s, m.id) / MEALS.DONE_AT);
      return f > 1e-9 ? { meal: m, f } : null;
    }
  }
  return null;
}

/** Índice (0–3) da refeição cuja tolerância está aberta em `ms` (−1 = nenhuma; no limite vale a anterior). */
function mealWindowAt(ms) {
  const m = mealInstances(ms).find((x) => ms >= x.open && ms <= x.tolEnd);
  return m ? m.i : -1;
}

/** Próximo instante > ms em que alguma refeição abre, termina a tolerância ou a penalidade. */
function nextMealBoundary(ms) {
  let b = Infinity;
  for (const m of mealInstances(ms)) for (const x of [m.open, m.tolEnd, m.penEnd]) if (x > ms && x < b) b = x;
  return b;
}

/**
 * Estado antigo (mig 295: `meals = { day, eaten[4] }`) → registro por id. As
 * comidas de hoje marcadas viram refeição quitada; nada mais é inventado.
 * Também preenche exposição e desgaste de quem nasceu antes de 2026-10-24.
 */
function normalize(s) {
  if (!s.meals || !s.meals.log) {
    const old = s.meals || {};
    const log = {};
    if (old.day && Array.isArray(old.eaten)) old.eaten.forEach((e, i) => e && (log[`${old.day}@${MEALS.HOURS[i]}`] = { c: 1 }));
    s.meals = { log };
  }
  if (!s.exposure) s.exposure = { hunger: 0, sleep: 0, stress: 0, health: 0 };
  // mm3d-59: destreza (mig 320) e o orçamento do dia.
  if (!(s.dexterity >= 0)) s.dexterity = birthDexterity(s.seed);
  if (s.peaks && !(s.peaks.dexterity >= 0)) s.peaks.dexterity = s.dexterity;
  // B7 (mig 334): acurácia começa em 0 para todos.
  if (!(s.accuracy >= 0)) s.accuracy = 0;
  if (s.peaks && !(s.peaks.accuracy >= 0)) s.peaks.accuracy = s.accuracy;
  if (!s.budget || typeof s.budget !== "object" || !s.budget.days) s.budget = { days: {} };
  if (!(s.wearDays >= 0)) s.wearDays = 0;
  // mm3d-58: hóspede de antes começa a contar pelos dias já vividos.
  if (!s.growth) s.growth = { stage: "young", days: s.wearDays };
  // 2026-11-02: a idade conta do nascimento (from) e o caminho do jovem é medido
  // do ponto de partida (base). Quem é de antes da regra: nascimento = born_at
  // (ou os dias já vividos) e partida = o que o hóspede tem ao nascer.
  const g = s.growth;
  if (!(g.from > 0)) g.from = s.bornAt > 0 ? s.bornAt : s.simAt - (g.days || s.wearDays || 0) * 24 * HOUR;
  if (g.stage !== "adult" && !g.base && "days" in g) g.base = Object.fromEntries(GROWN.map((k) => [k, Math.min(GROWTH.LEGACY_BASE, s.peaks ? s.peaks[k] : s[k])]));
  return s;
}

const effectOn = (s, id, t) => s.effects.some((e) => e.id === id && e.until > t);

const fatPct = (s) => (100 * s.fatKg) / (s.fatKg + s.leanKg);
const weightKg = (s) => s.fatKg + s.leanKg;

function emptyDay(day) {
  return {
    day,
    hours: { idle: 0, lying: 0, sleeping: 0, studying: 0, training: 0, working: 0, hospital: 0, praying: 0, jail: 0 },
    mealsEaten: 0,
    mealsMissed: 0,
    healthy: 0,
    junk: 0,
    moodSum: 0,
    moodH: 0,
    minHealth: 100,
    maxStress: 0,
    coins: 0,
  };
}

// ═══ NASCIMENTO ═══
/** Um hóspede novo. `seed` inteiro (o serviço sorteia). */
function birth(seed, t) {
  const r = rng(seed);
  const p = {
    discipline: r2(r()),
    anxiety: r2(r()),
    optimism: r2(r()),
    appetite: r2(r()),
    resilience: r2(r()),
    metabolism: r2(r()),
  };
  const heightM = r2(1.68 + r() * 0.18);
  // Nasce muito magro (BODY): ~47–58 kg de massa magra e 8–10% de gordura.
  const leanKg = r2(22 * heightM * heightM * (0.74 + r() * 0.04));
  const fatKg = r2(leanKg * (0.085 + r() * 0.025));
  const s = {
    seed,
    personality: p,
    heightM,
    energy: 80,
    satiety: 60,
    mood: 65,
    stress: 20,
    health: 90,
    vitality: 100,
    fatKg,
    leanKg,
    diabetesRisk: r2(r() * 10),
    hasDiabetes: false,
    bpRisk: r2(r() * 10),
    hasHypertension: false,
    toxicity: 0,
    cardiac: 0,
    awakeH: 2,
    zeroEnergyH: 0,
    diet: 0,
    // Começa fraco na escala 0–1000 (decisão do Alex): o caminho é que é longo.
    intelligence: r2(15 + r() * 15),
    strength: r2(15 + r() * 15),
    speed: r2(20 + r() * 15),
    fertility: r2(70 + r() * 20),
    activity: { kind: "idle", startedAt: t, until: null, bed: null, resume: null },
    effects: [],
    peaks: null, // preenchido logo abaixo (maior valor já alcançado)
    meals: { log: {} },
    exposure: { hunger: 0, sleep: 0, stress: 0, health: 0 },
    wearDays: 0, // dias equivalentes de vida já gastos (LIFE)
    // GROWTH: a idade conta daqui; a partida (base) é marcada no 1º passo, já com a herança
    growth: { stage: "young", from: t },
    dayAcc: emptyDay(localParts(t).day),
    status: "alive",
    deathCause: null,
    diedAt: null,
    simAt: t,
  };
  s.dexterity = birthDexterity(seed);
  s.accuracy = 0;
  s.peaks = { intelligence: s.intelligence, strength: s.strength, speed: s.speed, dexterity: s.dexterity, accuracy: s.accuracy };
  s.budget = { days: {} };
  return s;
}

// ═══ MORTE: FUNERAL E HERANÇA (mm3d-34) ═══
// Regra do Alex: morrer de velhice é o fim natural — o novo hóspede herda 20%
// do maior valor que o antigo alcançou em cada atributo e a Freelandoo paga o
// funeral. Qualquer outra causa (doença, infarto, hospital) não deixa herança
// e o jogador paga o funeral (o que tiver, até o preço: a carteira não fica
// negativa e o jogo nunca trava por falta de moedas).
const AFTERLIFE = Object.freeze({ FUNERAL_COINS: 300, INHERIT: 0.2, NATURAL: "velhice" });

/** O que a morte deixa (null = vivo). `inherit` = valores que o novo hóspede recebe. */
function afterlife(s) {
  if (s.status !== "dead") return null;
  const natural = s.deathCause === AFTERLIFE.NATURAL;
  const peak = (k) => Math.max(s[k] || 0, (s.peaks && s.peaks[k]) || 0);
  return {
    natural,
    funeral: { coins: AFTERLIFE.FUNERAL_COINS, paidBy: natural ? "freelandoo" : "player" },
    inherit: natural ? Object.fromEntries(ATTRS.map((k) => [k, r2(AFTERLIFE.INHERIT * peak(k))])) : null,
  };
}

/** Novo hóspede com a herança: nunca abaixo do que ele já nasceria; vira o piso dele. */
function applyInheritance(n, inherit) {
  if (!inherit) return n;
  for (const k of ATTRS) {
    if (inherit[k] == null) continue;
    const v = Math.max(n[k], inherit[k] || 0);
    n[k] = v;
    n.peaks[k] = Math.max(n.peaks[k], v);
  }
  return n;
}

/** Vira adulto (GROWTH): +20% em cada atributo treinável e saúde 100. */
function growUp(s, t, events) {
  const before = Object.fromEntries(TRAINED.map((k) => [k, r2(s[k])]));
  for (const k of TRAINED) {
    s[k] = s[k] * (1 + GROWTH.BONUS);
    if (s[k] > s.peaks[k]) s.peaks[k] = s[k];
  }
  s.health = 100;
  s.growth = { stage: "adult", from: s.growth.from, at: t };
  events.push({ at: t, kind: "adult", data: { before, after: Object.fromEntries(TRAINED.map((k) => [k, r2(s[k])])) } });
}

/**
 * Quanto falta para virar adulto (GROWTH): idade, ganho de força e de
 * inteligência desde a partida (pelo pico) e o total 0–1 (média das três
 * partes, cada uma até 1 — só chega a 1 com as três completas).
 */
function growthProgress(s, t) {
  const g = s.growth;
  const ageDays = Math.max(0, (t - (g.from || t)) / (24 * HOUR));
  const base = g.base || {};
  const gained = Object.fromEntries(GROWN.map((k) => [k, Math.max(0, (s.peaks[k] || 0) - (base[k] ?? s.peaks[k] ?? 0))]));
  const parts = [Math.min(1, ageDays / GROWTH.MIN_DAYS), ...GROWN.map((k) => Math.min(1, gained[k] / GROWTH.TARGET[k]))];
  const pct = parts.reduce((a, b) => a + b, 0) / parts.length;
  return { ageDays, gained, pct, ready: g.stage !== "adult" && parts.every((p) => p >= 1) };
}

// ═══ ATRIBUTOS ═══
const attrFloor = (s, k) => ATTR.FLOOR[k] * s.peaks[k];

/** Horas do passo que ainda rendem hoje (as primeiras USEFUL_H do dia). */
function usefulHours(s, kind, dt) {
  const cap = ATTR.USEFUL_H[kind];
  if (!cap) return dt;
  const done = s.dayAcc.hours[kind] || 0;
  const full = Math.max(0, Math.min(dt, cap - done));
  return full + (dt - full) * ATTR.OVER_FACTOR;
}

/** Quanto do orçamento de `k` ainda resta no dia (Brasília) de `t`. */
function budgetLeft(s, k, t) {
  if (!s.budget || !s.budget.days) s.budget = { days: {} };
  const day = localParts(t).day;
  const used = (s.budget.days[day] && s.budget.days[day][k]) || 0;
  return Math.max(0, ATTR.BUDGET[k] - used);
}

/** Gasta `base` do orçamento de `k` no dia de `t` (só o que couber); devolve o gasto. */
function spendBudget(s, k, base, t) {
  const day = localParts(t).day;
  const take = Math.min(base, budgetLeft(s, k, t));
  if (take <= 0) return 0;
  const d = (s.budget.days[day] = s.budget.days[day] || {});
  d[k] = r4((d[k] || 0) + take);
  // guarda só hoje e ontem (uma partida que atravessou a meia-noite reparte entre os dois)
  const keep = Object.keys(s.budget.days).sort().slice(-2);
  for (const key of Object.keys(s.budget.days)) if (!keep.includes(key)) delete s.budget.days[key];
  return take;
}

/**
 * Soma `base` pontos-base (mm3d-59): primeiro passa pelo ORÇAMENTO do dia,
 * depois pela curva (uma vez); a memória (REGAIN×) vale só até o pico
 * anterior — o que passa do pico cresce no ritmo normal. Devolve o ganho real.
 */
/** Marca que o atributo foi praticado agora (zera a contagem para começar a cair). */
function practiced(s, k, t) {
  if (t == null) return;
  if (!s.practiced) s.practiced = {};
  s.practiced[k] = t;
}

function gain(s, k, base, t = s.simAt) {
  if (!(base > 0)) return 0;
  practiced(s, k, t);
  const b = t == null ? base : spendBudget(s, k, base, t);
  if (b <= 0) return 0;
  const v0 = s[k];
  const curve = Math.max(ATTR.CURVE_MIN, Math.pow(Math.max(0, 1 - v0 / ATTR.CURVE_AT), 2));
  let raw = b * curve;
  let v = v0;
  const peak = s.peaks[k] ?? v0;
  if (v < peak - 0.5) {
    const toPeak = peak - v;
    const fast = Math.min(toPeak, raw * ATTR.REGAIN);
    v += fast;
    raw -= fast / ATTR.REGAIN;
  }
  v += Math.max(0, raw);
  s[k] = Math.max(0, v);
  if (s[k] > (s.peaks[k] ?? 0)) s.peaks[k] = s[k];
  return s[k] - v0;
}

/**
 * mm3d-60k — DROP de atributo da luta (regra do Alex): o número que caiu É o
 * ganho. Não passa pelo orçamento do dia nem pela curva (quem limita é a
 * energia que a luta gasta). Atualiza o pico. Devolve o ganho real.
 */
function dropAttr(s, k, pts) {
  if (!(pts > 0) || !ATTRS.includes(k)) return 0;
  practiced(s, k, s.simAt);
  const v0 = s[k];
  s[k] = Math.max(0, v0 + pts);
  if (s[k] > (s.peaks[k] ?? 0)) s.peaks[k] = s[k];
  return s[k] - v0;
}

/** Idade (dias) desde o nascimento do hóspede e se já é adulto. */
function lifeStage(s, t) {
  const g = growthProgress(s, t);
  return { ageDays: g.ageDays, adult: !!(s.growth && s.growth.stage === "adult") };
}

function decay(s, k, dt, t) {
  if (!s.practiced) s.practiced = {};
  // sem registro (personagem de antes desta regra): a contagem começa agora
  if (!(s.practiced[k] > 0)) s.practiced[k] = t;
  if (t - s.practiced[k] < ATTR.DECAY_AFTER_H * HOUR) return;
  const floor = attrFloor(s, k);
  if (s[k] <= floor) return;
  s[k] = Math.max(floor, s[k] - (ATTR.DECAY_DAY[k] / 24) * dt);
}

// ═══ UM PASSO ═══
/** Gravidade (0–1) de cada estado crítico agora (EXPOSURE). */
function severity(s) {
  return {
    hunger: clamp((15 - s.satiety) / 15, 0, 1),
    sleep: clamp((s.awakeH - SLEEP.WARN_H) / 24, 0, 1),
    stress: clamp((s.stress - 70) / 30, 0, 1),
    health: clamp((40 - s.health) / 30, 0, 1),
  };
}

/**
 * Consequências de longo prazo pela exposição acumulada — todas com teto e
 * todas somem quando a exposição desce (cuidar de novo recupera). Regras
 * fictícias de jogo, não descrição médica.
 *  • apetite: fome prolongada faz a saciedade descer mais devagar (nunca impede comer);
 *  • metabolismo: o corpo gasta menos kcal (não mexe na saciedade: a agenda já cobra);
 *  • ansiedade: o estresse sobe mais fácil;
 *  • disciplina: estudo/treino rendem menos (o jogador continua no controle);
 *  • fertilidade: o alvo desce; resistência: menos fôlego de corrida.
 */
function longTerm(s) {
  const e = s.exposure;
  return {
    appetite: 1 - Math.min(0.25, e.hunger * 0.008),
    metabolism: 1 - Math.min(0.15, e.hunger * 0.005),
    anxiety: 1 + Math.min(0.3, (e.sleep + e.stress) * 0.01),
    discipline: 1 - Math.min(0.25, e.sleep * 0.01 + e.stress * 0.005),
    fertility: Math.min(25, 0.25 * (e.hunger + e.sleep + e.stress)),
    endurance: 1 - Math.min(0.4, (e.sleep + e.hunger + e.health) * 0.01),
  };
}

function admit(s, t, events, reason) {
  s.vitality = clamp(s.vitality - RULES.ADMIT_SEQUEL);
  if (s.vitality <= RULES.FATAL_VITALITY) return die(s, t, events, "complicacoes");
  s.activity = { kind: "hospital", startedAt: t, until: null, bed: null, resume: null };
  events.push({ at: t, kind: "hospital_in", data: { reason, health: r2(s.health) } });
}

function die(s, t, events, cause) {
  s.status = "dead";
  s.health = 0;
  s.deathCause = cause;
  s.diedAt = t;
  s.activity = { kind: "idle", startedAt: t, until: null, bed: null, resume: null };
  events.push({ at: t, kind: "death", data: { cause } });
}

function stepState(s, t, dt, events, out) {
  const p = s.personality;
  const kind = s.activity.kind;
  const stim = effectOn(s, "stim", t);
  const hospital = kind === "hospital";
  // Com estimulante não se dorme: fica deitado de olhos abertos.
  const eff = kind === "sleeping" && stim ? "lying" : kind;
  const rate = RATES[eff];
  const resting = eff === "sleeping" || eff === "lying" || hospital;
  // D9: diabetes e pressão alta saíram da regra; quem tinha fica curado aqui e na mig 443.
  s.hasDiabetes = false;
  s.hasHypertension = false;
  s.diabetesRisk = 0;
  s.bpRisk = 0;
  const fp = fatPct(s);
  // Refeição em atraso: fração da penalidade que ainda pesa (internado não paga).
  const late = hospital ? null : latePenalty(s, t);
  const pen = late ? late.f : 0;
  const perH = (k) => (MEALS.PENALTY[k] / MEALS.PENALTY_H) * pen;
  const sev = severity(s);
  const lt = longTerm(s);

  // Energia
  let de = rate.energy;
  if (de < 0) {
    de *= 1.1 - 0.2 * p.resilience;
    if (stim) de *= 0.5;
    else if (effectOn(s, "energy_drink", t) || effectOn(s, "coffee", t) || effectOn(s, "preworkout", t)) de *= 0.8;
    if (s.satiety <= 0 && !pen) de -= 2;
  }
  // Doente o tanque é menor (teto de applyUnwell) e o gasto encolhe junto:
  // a energia dura o mesmo dia — sem isso ele zerava à tarde e afundava.
  if (de < 0) de *= 1 - (RULES.UNWELL.ENERGY_CAP / 100) * unwellOf(s);
  de -= perH("energy");
  s.energy = clamp(s.energy + de * dt);

  // Saciedade (internado recebe soro: tende a 60)
  if (hospital) s.satiety += (60 - s.satiety) * Math.min(1, 0.5 * dt);
  else {
    let dsat = rate.satiety * (0.8 + 0.4 * p.appetite) * lt.appetite;
    // No atraso a agenda SUBSTITUI o decaimento natural: vale o mais forte.
    if (pen) dsat = Math.min(dsat, -perH("satiety"));
    s.satiety = clamp(s.satiety + dsat * dt);
  }

  // Horas acordado
  if (eff === "sleeping" || hospital) s.awakeH = Math.max(0, s.awakeH - 3 * dt);
  else s.awakeH += eff === "lying" ? 0.5 * dt : dt;
  // admin (testes): a energia não acaba nem no tempo fora do jogo — sem desmaio nem dano de exaustão
  if (s._admin && s.status === "alive") s.energy = 100;
  if (s.energy <= 0.01 && !resting && !stim) s.zeroEnergyH += dt;
  else s.zeroEnergyH = 0;

  // Corpo: gasto calórico contínuo (a comida soma na hora de comer)
  const burn = RULES.BASE_KCAL_H * (0.85 + 0.3 * p.metabolism) * Math.pow(weightKg(s) / 70, 0.75) * rate.kcal * lt.metabolism * dt;
  s.fatKg = clamp(s.fatKg - burn / RULES.KCAL_PER_KG, 2, 140);
  const anab = effectOn(s, "anabolic", t);
  const protein = effectOn(s, "whey", t) ? 1.4 : effectOn(s, "albumin", t) ? 1.25 : 1;
  if (kind === "training") s.leanKg += 0.004 * dt * protein * (anab ? 2 : 1) * (s.energy > 10 ? 1 : 0.3);
  if (s.satiety <= 0) s.leanKg -= 0.002 * dt;
  s.leanKg = clamp(s.leanKg, 38, 95);

  // Atributos (0–1000; ver ATTR)
  const focus = (s.energy < 20 ? 0.4 : 1) * (s.stress > 70 ? 0.6 : 1);
  const disc = (0.7 + 0.6 * p.discipline) * lt.discipline;
  const useful = usefulHours(s, kind, dt);
  const at = PLACE_RULES[s.activity.place]?.mul ?? 1;
  // B10: o aparelho/curso escolhido (sem = o de sempre) e o rendimento do nível
  const station = s.activity.station ? parseStation(s.activity.station) : null;
  const sm = stationMul(station);
  if (kind === "studying") gain(s, "intelligence", ATTR.GAIN_H.studyInt * useful * disc * focus * at * (stim ? 1.15 : 1) * sm, t);
  if (kind === "training") {
    const pre = effectOn(s, "preworkout", t) ? 1.15 : 1;
    const creat = effectOn(s, "creatine", t) ? 1.1 : 1;
    const prot = protein === 1.4 ? 1.25 : protein === 1.25 ? 1.15 : 1;
    const sid = station ? station.id : null;
    if (!sid || sid === "weights") gain(s, "strength", ATTR.GAIN_H.trainStr * useful * disc * focus * prot * pre * creat * (anab ? 2 : 1) * sm, t);
    if (!sid || sid === "treadmill") gain(s, "speed", ATTR.GAIN_H.trainSpd * useful * disc * focus * pre * sm, t);
    if (sid === "bag") {
      gain(s, "speed", ATTR.GAIN_H.trainSpd * 0.6 * useful * disc * focus * pre, t);
      gain(s, "accuracy", ATTR.GAIN_H.trainAcc * useful * disc * focus, t);
    }
  }
  if (kind === "working") {
    gain(s, "intelligence", ATTR.GAIN_H.workInt * dt * focus, t);
    const raw = RULES.WORK_COINS_H * dt * (0.6 + s.intelligence / ATTR.MAX) * focus;
    const cap = out.wallet && Number.isFinite(out.wallet.workCap) ? out.wallet.workCap : RULES.WORK_COINS_DAY;
    const coins = Math.max(0, Math.min(raw, cap - s.dayAcc.coins));
    out.coins += coins;
    out.earned += coins;
    s.dayAcc.coins += coins;
  }
  if (s.growth.stage !== "adult") {
    if (!s.growth.base) s.growth.base = Object.fromEntries(GROWN.map((k) => [k, r2(s.peaks[k])]));
    if (growthProgress(s, t).ready) growUp(s, t, events);
  }
  // Sem praticar, cai devagar — nunca abaixo do piso (fração do pico).
  if (kind === "studying" || kind === "working") practiced(s, "intelligence", t);
  else decay(s, "intelligence", dt, t);
  if (kind === "training") {
    practiced(s, "strength", t);
    practiced(s, "speed", t);
  } else {
    decay(s, "strength", dt, t);
    decay(s, "speed", dt, t);
  }
  // destreza sobe nos minijogos e nas lutas (recibos marcam a prática)
  decay(s, "dexterity", dt, t);
  // acurácia (B7): nada treina ainda; cai pela mesma regra quando o B10 a fizer subir
  decay(s, "accuracy", dt, t);

  // Estresse
  let ds = rate.stress;
  if (ds > 0) {
    ds *= (0.7 + 0.6 * p.anxiety) * lt.anxiety;
    if (effectOn(s, "calm", t)) ds *= 0.5;
  }
  if (s.awakeH > SLEEP.WARN_H) ds += (s.awakeH - SLEEP.WARN_H) * SLEEP.STRESS_PER_H;
  if (s.satiety <= 0 && !hospital && !pen) ds += 3;
  ds += perH("stress");
  if (s.energy <= 0.01 && stim) ds += 6;
  s.stress = clamp(s.stress + ds * dt);
  applyUnwell(s);

  // Toxicidade
  s.toxicity = Math.max(0, s.toxicity - 1.5 * dt * (hospital ? 3 : 1));

  // Coração
  let dc = -(eff === "sleeping" || hospital ? 0.8 : 0.3);
  if (stim) dc += 0.6;
  if (s.energy <= 0.01 && stim) dc += 3;
  if (s.awakeH > 30) dc += (s.awakeH - 30) * 0.05;
  if (s.stress > 85) dc += (s.stress - 85) * 0.08;
  if (anab) dc += 0.2;
  if (fp > 35) dc += 0.1;
  s.cardiac = clamp(s.cardiac + dc * dt);

  // Saúde: danos (com a causa de cada um) e recuperação
  const dmgMul = 1.2 - 0.4 * p.resilience;
  const dmg = {};
  if (!hospital) {
    // Inanição é deterioração PROLONGADA: só depois de horas críticas acumuladas.
    const starve = clamp((s.exposure.hunger - EXPOSURE.STARVE_AFTER) / EXPOSURE.STARVE_RAMP, 0, 1);
    if (starve > 0) dmg.fome = 1.2 * starve;
    if (s.energy <= 0.01 && stim) dmg.exaustao = 2.5;
    else if (s.zeroEnergyH > 0) dmg.exaustao = 1.5;
    if (s.awakeH > 40) dmg.sono = (s.awakeH - 40) * 0.08;
    if (s.diet < -30) dmg.dieta = 0.05;
    if (s.stress > 90) dmg.estresse = 0.2;
  }
  if (s.toxicity > 40) dmg.overdose = (s.toxicity - 40) * 0.06 + (s.toxicity > 100 ? (s.toxicity - 100) * 0.25 + 4 : 0);
  let total = 0;
  const fatMul = fp >= BODY.FAT_AT ? RULES.FAT_HEALTH_MUL : 1;
  for (const k of Object.keys(dmg)) {
    dmg[k] *= dmgMul * fatMul;
    total += dmg[k];
  }
  const ok = s.satiety > 25 && s.energy > 25 && s.stress < 70 && s.toxicity < 30;
  const R = RULES.RECOVERY;
  let rec = hospital ? R.hospital : !ok ? 0 : (R[eff] ?? R.idle) + (s.satiety > R.FED_AT && s.diet >= 0 ? R.FED : 0);
  if (effectOn(s, "multivit", t)) rec *= effectOn(s, "creatine", t) ? R.MULTIVIT_CREATINE : R.MULTIVIT;
  // Lesão (mm3d-43): fora do hospital a saúde volta pela metade.
  if (!hospital && effectOn(s, "injury", t)) rec *= INJURY_RECOVERY;
  s.health = Math.min(s.vitality, clamp(s.health + (rec - total) * dt));
  // Penalidade aguda da refeição: exata pela fração do tempo, até o piso.
  if (pen && s.health > MEALS.HEALTH_FLOOR) s.health = Math.max(MEALS.HEALTH_FLOOR, s.health - perH("health") * dt);
  if (s.health >= 80) s.vitality = clamp(s.vitality + (0.5 / 24) * dt);

  // Fertilidade: caminha para um alvo
  let ft = 85 + (p.resilience - 0.5) * 20;
  if (anab) ft -= 40;
  if (fp > 30) ft -= (fp - 30) * 1.5;
  if (s.stress > 70) ft -= (s.stress - 70) * 0.5;
  if (s.health < 50) ft -= (50 - s.health) * 0.6;
  if (s.toxicity > 30) ft -= 15;
  ft -= lt.fertility;
  s.fertility = clamp(s.fertility + (clamp(ft) - s.fertility) * Math.min(1, 0.02 * dt));

  // Humor: caminha para um alvo
  const pleasure = s.effects.filter((e) => e.id === "pleasure" && e.until > t).reduce((n, e) => n + (e.mag || 0), 0);
  let mt =
    50 +
    (p.optimism - 0.5) * 20 +
    (s.satiety - 50) * 0.2 +
    (s.energy - 50) * 0.25 -
    (s.stress - 30) * 0.4 +
    (s.health - 70) * 0.3 +
    Math.min(25, pleasure);
  if (kind === "praying") mt += 15;
  s.mood = clamp(s.mood + (clamp(mt) - s.mood) * Math.min(1, 0.25 * dt));

  // Exposição (pela gravidade do começo do passo) e desgaste da vida.
  let wear = 1;
  for (const k of EXPOSURE.KEYS) {
    s.exposure[k] = sev[k] > 0 ? s.exposure[k] + sev[k] * dt : Math.max(0, s.exposure[k] - EXPOSURE.RECOVER[k] * (hospital ? EXPOSURE.HOSPITAL_RECOVER : 1) * dt);
    wear += LIFE.WEAR[k] * sev[k];
  }
  s.wearDays += (wear * dt) / 24;

  // Diário do dia
  const acc = s.dayAcc;
  // Diário gravado antes de uma atividade existir não tem a chave dela.
  acc.hours[kind] = (acc.hours[kind] || 0) + dt;
  acc.moodSum += s.mood * dt;
  acc.moodH += dt;
  acc.minHealth = Math.min(acc.minHealth, s.health);
  acc.maxStress = Math.max(acc.maxStress, s.stress);

  // Transições (na ordem: infarto, morte, internação, alta, desmaio)
  const end = t + dt * HOUR;
  if (s.cardiac >= 100) {
    s.health = clamp(s.health - RULES.INFARCT_DAMAGE * dmgMul * fatMul);
    s.vitality = clamp(s.vitality - RULES.INFARCT_SEQUEL);
    s.cardiac = 40;
    events.push({ at: end, kind: "heart_attack", data: {} });
    if (s.health <= 0) return die(s, end, events, "infarto");
    if (!hospital) return admit(s, end, events, "infarto");
  }
  // admin (testes, 2026-10-30): saúde e estresse sempre no melhor valor — sem
  // internação nem morte por doença, também no tempo fora do jogo.
  if (s._admin && s.status === "alive") {
    s.vitality = 100;
    s.health = 100;
    s.stress = 0;
  }
  if (s.wearDays >= LIFE.DAYS) return die(s, end, events, "velhice");
  if (s.health <= 0) {
    const cause = Object.entries(dmg).sort((a, b) => b[1] - a[1])[0];
    return die(s, end, events, cause ? cause[0] : "complicacoes");
  }
  if (!hospital && s.health <= RULES.HOSPITAL_AT) return admit(s, end, events, "saude");
  // Alta: saúde ≥ DISCHARGE_AT — ou perto do teto, quando a vitalidade (teto da
  // saúde) já é menor que isso (antes, quem tinha vitalidade < 60 nunca saía).
  if (hospital && s.health >= Math.min(RULES.DISCHARGE_AT, s.vitality - 5) && s.toxicity < RULES.DISCHARGE_MAX_TOX) {
    s.activity = { kind: "idle", startedAt: end, until: null, bed: null, resume: null };
    events.push({ at: end, kind: "hospital_out", data: { health: r2(s.health) } });
    return;
  }
  if (s.zeroEnergyH >= RULES.COLLAPSE_AFTER_H) {
    // Desmaio: dorme no chão e, se a ordem ainda vale, volta a ela depois.
    const prev = s.activity;
    const resume = prev.until && prev.until > end + RULES.COLLAPSE_SLEEP_H * HOUR ? { kind: prev.kind, until: prev.until, place: prev.place || null } : null;
    s.health = clamp(s.health - 3);
    s.mood = clamp(s.mood - 10);
    s.zeroEnergyH = 0;
    s.activity = { kind: "sleeping", startedAt: end, until: end + RULES.COLLAPSE_SLEEP_H * HOUR, bed: null, resume };
    events.push({ at: end, kind: "collapse", data: { during: prev.kind } });
  }
}

/** Fecha o dia corrente do diário (registro diário com a condição). */
function closeDay(s) {
  const acc = s.dayAcc;
  const rec = { ...acc, hours: { ...acc.hours }, condition: dayCondition(acc) };
  return rec;
}

/**
 * Condição do dia (0–100 + rótulo) a partir do diário: saúde mínima, humor
 * médio, estresse máximo, sono e refeições.
 */
function dayCondition(acc) {
  const mood = acc.moodH > 0 ? acc.moodSum / acc.moodH : 50;
  const sleep = Math.min(acc.hours.sleeping, 8) / 8;
  const meals = acc.mealsEaten / (acc.mealsEaten + acc.mealsMissed || 1);
  const food = acc.healthy + acc.junk > 0 ? acc.healthy / (acc.healthy + acc.junk) : 0.5;
  const score = Math.round(
    0.3 * acc.minHealth + 0.2 * mood + 0.15 * (100 - acc.maxStress) + 0.15 * sleep * 100 + 0.1 * meals * 100 + 0.1 * food * 100
  );
  const label = score >= 80 ? "otima" : score >= 60 ? "boa" : score >= 40 ? "regular" : score >= 20 ? "ruim" : "critica";
  return { score, label };
}

/** Limites dentro de (t, to]: o passo quebra exatamente neles. */
function nextBoundary(s, t, to) {
  // Grade GLOBAL de 15 min: simular em pedaços (a cada leitura) dá os mesmos
  // passos que simular de uma vez.
  const grid = Math.floor(t / STEP_MS) * STEP_MS + STEP_MS;
  let b = Math.min(to, grid, nextMealBoundary(t), atLocalHour(t + 24 * HOUR, 0));
  if (s.activity.until && s.activity.until > t) b = Math.min(b, s.activity.until);
  for (const e of s.effects) if (e.until > t) b = Math.min(b, e.until);
  return b;
}

/** O que acontece exatamente no instante `t` (fim de passo). */
function atBoundary(s, t, events, out) {
  s.effects = s.effects.filter((e) => e.until > t);
  if (s.status !== "alive") return;
  const a = s.activity;
  if (a.until && a.until <= t) {
    if ((a.kind === "sleeping" || a.kind === "lying") && a.resume && a.resume.until > t) {
      s.activity = { kind: a.resume.kind, startedAt: t, until: a.resume.until, bed: null, resume: null, place: a.resume.place || null, station: a.resume.station || null };
    } else {
      s.activity = { kind: "idle", startedAt: t, until: null, bed: null, resume: null };
    }
    events.push({ at: t, kind: "activity_end", data: { kind: a.kind } });
  }
  const { day } = localParts(t);
  // Agenda: acabou a tolerância sem quitar (atrasou — a penalidade começa) ou
  // acabou a penalidade (perdida de vez). A das 22 h fecha à meia-noite,
  // ainda no diário do dia dela (a virada vem logo abaixo).
  if (s.activity.kind !== "hospital") {
    for (const m of mealInstances(t)) {
      if (mealDone(s, m.id)) continue;
      if (m.tolEnd === t) {
        s.dayAcc.mealsMissed += 1;
        events.push({ at: t, kind: "meal_missed", data: { meal: m.h, id: m.id } });
      } else if (m.penEnd === t) events.push({ at: t, kind: "meal_lost", data: { meal: m.h, id: m.id } });
    }
  }
  if (day !== s.dayAcc.day) {
    out.days.push(closeDay(s));
    s.dayAcc = emptyDay(day);
    // O registro das refeições guarda só os últimos dias.
    const keep = localParts(t - 2 * DAY).day;
    for (const id of Object.keys(s.meals.log)) if (id.slice(0, 10) < keep) delete s.meals.log[id];
  }
  routine(s, t, events, out);
  noteSleep(s, t);
}

/**
 * A ROTINA (ver ROUTINE): durante estudar/treinar/trabalhar, ele mesmo dorme
 * quando a energia acaba, descansa quando o estresse estoura e come na janela
 * de refeição — e volta à tarefa (`resume`), até fechar as horas pedidas.
 */
function routine(s, t, events, out) {
  if (s.status !== "alive") return;
  const a = s.activity;
  const working = ROUTINE.KINDS.includes(a.kind) && a.until;
  const pausedAwake = a.kind === "lying" && a.resume && ROUTINE.KINDS.includes(a.resume.kind);
  if (!working && !pausedAwake) return;
  // Comer: com uma refeição pendente (no horário ou atrasada) — primeiro o que
  // tem na geladeira, senão compra o que a carteira paga (também no descanso
  // da rotina — dormindo, não).
  if (pendingMeal(s, t) && s.satiety <= RULES.FULL_SATIETY) {
    const own = out.pantry ? pantryMeal(out.pantry) : null;
    const buy = own ? null : out.wallet ? ROUTINE.MEALS.map((id) => ITEM_BY_ID.get(id)).find((it) => it.price <= out.wallet.coins) : null;
    const it = own || buy;
    if (it) {
      const r = consume(s, it.id, t);
      if (r.ok && own) {
        out.pantry[it.id] -= 1;
        events.push(...r.events, { at: t, kind: "routine_meal", data: { item: it.id, price: 0, from: "fridge" } });
      } else if (r.ok) {
        out.wallet.coins -= it.price;
        out.coins -= it.price;
        events.push(...r.events, { at: t, kind: "routine_meal", data: { item: it.id, price: it.price } });
      }
    }
  }
  if (!working) return;
  const leftH = (a.until - t) / HOUR;
  if (leftH < ROUTINE.MIN_LEFT_H) return;
  const pause = (kind, h, reason) => {
    const until = t + Math.min(h, leftH) * HOUR;
    s.activity = { kind, startedAt: t, until, bed: null, resume: { kind: a.kind, until: a.until, place: a.place || null, station: a.station || null } };
    if (kind === "sleeping") s.zeroEnergyH = 0;
    events.push({ at: t, kind: "routine_pause", data: { during: a.kind, pause: kind, reason, hours: r2(Math.min(h, leftH)) } });
  };
  if (s.energy <= ROUTINE.SLEEP_AT_ENERGY && !effectOn(s, "stim", t)) return pause("sleeping", ROUTINE.SLEEP_H, "energy");
  if (s.stress >= ROUTINE.REST_AT_STRESS) return pause("lying", ROUTINE.REST_H, "stress");
  const cap = ATTR.USEFUL_H[a.kind];
  if (cap && (s.dayAcc.hours[a.kind] || 0) >= cap - 1e-9) {
    const { hour } = localParts(t);
    if (hour >= ROUTINE.BED_AT || hour < ROUTINE.WAKE_AT) {
      const wake = atLocalHour(hour >= ROUTINE.BED_AT ? t + 24 * HOUR : t, ROUTINE.WAKE_AT);
      return pause("sleeping", (wake - t) / HOUR, "night");
    }
    return pause("lying", ROUTINE.BED_AT - hour, "daily_cap");
  }
}

/** O melhor prato da geladeira para a rotina: o que mais quita, depois o mais saudável. */
function pantryMeal(pantry) {
  let best = null;
  for (const [id, qty] of Object.entries(pantry)) {
    const it = ITEM_BY_ID.get(id);
    if (!it || !(qty > 0) || it.kind !== "food" || it.meal < 0.5) continue;
    if (!best || it.meal > best.meal || (it.meal === best.meal && (it.nutri > best.nutri || (it.nutri === best.nutri && it.id < best.id)))) best = it;
  }
  return best;
}

/**
 * Avança a vida até `to` (ms). Muta `s`. Devolve os eventos, os dias
 * fechados e o saldo de moedas do período (ganho trabalhando − gasto pela
 * rotina comendo). `wallet` ({ coins }) é a carteira do jogo: a rotina só
 * compra o que ela paga, e ela é atualizada aqui (quem simula aos pedaços
 * passa a mesma carteira — o resultado é o mesmo).
 */
function simulate(s, to, wallet = null, pantry = null) {
  normalize(s);
  const events = [];
  // `pantry` ({ itemId: qtd }) é a geladeira: a rotina come dela antes de comprar.
  const out = { days: [], coins: 0, earned: 0, wallet, pantry };
  if (to <= s.simAt) return { events, days: out.days, coins: 0, earned: 0 };
  let t = s.simAt;
  const stop = Math.min(to, t + MAX_CATCHUP_MS);
  while (t < stop && s.status === "alive") {
    const next = Math.min(nextBoundary(s, t, stop), stop);
    const before = out.coins;
    stepState(s, t, (next - t) / HOUR, events, out);
    if (wallet) wallet.coins += out.coins - before;
    t = next;
    atBoundary(s, t, events, out);
  }
  s.simAt = to;
  return { events, days: out.days, coins: out.coins, earned: out.earned };
}

// ═══ CÁPSULA (B3, 2026-11-08) ═══
// Regra do Alex: o personagem na cápsula fica CONGELADO — não envelhece, não perde
// atributo, não tem fome, sono nem efeitos. Como a vida é preguiçosa (só anda quando
// alguém simula), congelar = simular até agora e parar de simular; descongelar =
// empurrar TODO instante gravado pelo tempo que ele ficou guardado, e `simAt` volta a
// contar de agora. Assim a idade (growth.from), o fim dos efeitos, o desejo da alma e a
// contagem de prática continuam exatamente de onde pararam. A morte por velhice usa
// `wearDays` (só cresce simulando), então conta só a vida ativa.

/** Guarda na cápsula (o estado já foi simulado até `t`). Interrompe o que estiver fazendo. */
function freeze(s, t) {
  normalize(s);
  s.activity = { kind: "idle", startedAt: t, until: null, bed: null, resume: null };
  delete s.sleepFrom;
  s.simAt = t;
  return s;
}

/**
 * Tira da cápsula em `t`: desloca todo instante pelo tempo guardado (t − simAt).
 * Devolve o deslocamento em ms. Dia novo no relógio do jogo: o diário recomeça vazio
 * (o dia antigo já foi gravado ao guardar).
 */
function thaw(s, t) {
  normalize(s);
  const d = Math.max(0, t - s.simAt);
  const sh = (v) => (typeof v === "number" && v > 0 ? v + d : v);
  if (d > 0) {
    const a = s.activity;
    a.startedAt = sh(a.startedAt);
    a.until = sh(a.until);
    if (a.resume && a.resume.until) a.resume = { ...a.resume, until: sh(a.resume.until) };
    s.effects = (s.effects || []).map((e) => ({ ...e, until: sh(e.until), ...(e.at ? { at: sh(e.at) } : {}) }));
    if (s.growth) {
      s.growth.from = sh(s.growth.from);
      if (s.growth.at) s.growth.at = sh(s.growth.at);
    }
    if (s.practiced) for (const k of Object.keys(s.practiced)) s.practiced[k] = sh(s.practiced[k]);
    if (s.bornAt) s.bornAt = sh(s.bornAt);
    const so = s.soul;
    if (so) {
      if (so.zeroSince) so.zeroSince = sh(so.zeroSince);
      if (so.nextWishAt) so.nextWishAt = sh(so.nextWishAt);
      if (so.wish) so.wish = { ...so.wish, at: sh(so.wish.at), until: sh(so.wish.until) };
    }
    if (s.woke && s.woke.at) s.woke = { ...s.woke, at: sh(s.woke.at) };
  }
  const { day } = localParts(t);
  if (!s.dayAcc || s.dayAcc.day !== day) s.dayAcc = emptyDay(day);
  s.simAt = t;
  return d;
}

// ═══ AÇÕES ═══ (sempre depois de simular até `t`)
const fail = (code) => ({ ok: false, code });

/** Comer / tomar um item do catálogo. Não mexe na carteira (o serviço cobra). */
function consume(s, itemId, t) {
  normalize(s);
  const it = ITEM_BY_ID.get(itemId);
  if (!it) return fail("item");
  if (s.status !== "alive") return fail("dead");
  if (s.activity.kind === "hospital") return fail("hospital");
  if (s.activity.kind === "jail") return fail("jail");
  if (s.activity.kind === "sleeping") return fail("sleeping");
  if ((it.kind === "food" || it.kind === "drink") && it.sat > 0 && s.satiety > RULES.FULL_SATIETY) return fail("full");
  const events = [];
  const before = { satiety: s.satiety, energy: s.energy, stress: s.stress, health: s.health };
  s.satiety = clamp(s.satiety + it.sat);
  s.fatKg = clamp(s.fatKg + it.kcal / RULES.KCAL_PER_KG, 2, 140);
  if (it.kind === "food" || it.kind === "drink" || it.kind === "supplement") s.diet = clamp(s.diet * 0.85 + it.nutri * 10 * 0.15, -100, 100);
  if (it.heal) s.health = Math.min(s.vitality, clamp(s.health + it.heal));
  s.energy = clamp(s.energy + it.energy);
  s.stress = clamp(s.stress + it.stress);
  applyUnwell(s);
  s.toxicity += it.tox;
  if (it.mood) s.effects.push({ id: "pleasure", until: t + 2 * HOUR, mag: it.mood });
  if (it.effect) {
    const [id, h] = it.effect;
    const until = t + h * HOUR;
    const cur = s.effects.find((e) => e.id === id);
    if (cur) cur.until = Math.max(cur.until, until);
    else s.effects.push({ id, until });
  }
  if (it.kind === "food") {
    if (it.nutri >= 5) s.dayAcc.healthy += 1;
    else if (it.nutri <= -5) s.dayAcc.junk += 1;
  }
  // Crédito de refeição: vai para UMA refeição (a mais antiga pendente), até
  // quitar; a sobra se perde (não adianta comer pela próxima).
  let meal = null;
  if (it.meal > 0) {
    const m = pendingMeal(s, t);
    if (m) {
      const c = Math.min(MEALS.DONE_AT, mealCredit(s, m.id) + it.meal);
      s.meals.log[m.id] = { c };
      const late = t > m.tolEnd;
      const done = c >= MEALS.DONE_AT - 1e-9;
      if (done && !late) s.dayAcc.mealsEaten += 1;
      meal = { id: m.id, at: m.h, credit: r2(c), done, late };
      events.push({ at: t, kind: done ? "meal" : "meal_part", data: { meal: m.h, id: m.id, item: it.id, credit: r2(c), late } });
    }
  }
  events.push({ at: t, kind: "consume", data: { item: it.id } });
  return { ok: true, item: it, events, meal, felt: feltOf(s, it, before) };
}

/**
 * O que o item mudou de verdade (o número que sobe na tela, 2026-11-03).
 * Admin vive com energia 100 e estresse 0: nele vale o número do item, senão
 * nada apareceria. Humor é o valor do item (ele chega aos poucos, pelo efeito).
 */
function feltOf(s, it, before) {
  const felt = { satiety: s.satiety - before.satiety, mood: it.mood || 0 };
  felt.energy = s._admin ? it.energy : s.energy - before.energy;
  felt.stress = s._admin ? it.stress : s.stress - before.stress;
  felt.health = s._admin ? it.heal || 0 : s.health - before.health;
  return felt;
}

/**
 * Acordou (2026-11-03, regra do Alex: sobe o brilho e o estresse que saiu).
 * Marca o começo do sono e, ao sair dele por qualquer caminho (hora marcada,
 * levantar, rotina), guarda em `s.woke` o que o sono rendeu até a pessoa ver —
 * dormir com o jogo fechado também conta. Cochilo de menos de 15 min não conta.
 */
function noteSleep(s, t) {
  if (s.status === "alive" && s.activity.kind === "sleeping") {
    if (!s.sleepFrom) s.sleepFrom = { at: t, stress: s.stress, energy: s.energy };
    return;
  }
  const from = s.sleepFrom;
  if (!from) return;
  delete s.sleepFrom;
  const h = (t - from.at) / HOUR;
  if (s.status !== "alive" || h < 0.25) return;
  // admin não tem o que recuperar: mostra o que o sono renderia
  const stress = s._admin ? Math.max(-100, RATES.sleeping.stress * h) : s.stress - from.stress;
  const energy = s._admin ? Math.min(100, RATES.sleeping.energy * h) : s.energy - from.energy;
  s.woke = { at: t, stress: Math.min(0, stress), energy: Math.max(0, energy) };
}

/**
 * Começa uma atividade. `hours` = quanto tempo ele vai ficar nela (mesmo com
 * o jogo fechado). Deitar e dormir pedem `bed` (a sala da casa confere a
 * cama); sem cama, o serviço recusa antes de chegar aqui.
 */
function startActivity(s, kind, hours, t, bed = null, place = null, station = null) {
  if (!ACTIVITIES.includes(kind) || kind === "hospital" || kind === "jail") return fail("activity");
  if (s.status !== "alive") return fail("dead");
  if (s.activity.kind === "hospital") return fail("hospital");
  // Preso (mm3d-37f): nada até a pena acabar.
  if (s.activity.kind === "jail") return fail("jail");
  if (kind === "idle") {
    s.activity = { kind: "idle", startedAt: t, until: null, bed: null, resume: null };
    return { ok: true, events: [{ at: t, kind: "activity", data: { kind } }] };
  }
  if ((kind === "lying" || kind === "sleeping") && !bed) return fail("bed");
  // Treino e estudo só no prédio (mm3d-37b): o serviço confere que a pessoa está lá.
  if (PLACES[kind] && !PLACES[kind].includes(place)) return fail("place");
  if (kind === "sleeping" && effectOn(s, "stim", t)) return fail("stimulated");
  // B10: aparelho/curso escolhido (travado pelo atributo)
  const blocked = PLACES[kind] ? stationBlock(s, kind, place, station) : null;
  if (blocked) return fail(blocked);
  const range = ACTIVITY_HOURS[kind];
  let h = hours == null && kind === "lying" ? range[1] : Number(hours);
  if (!Number.isFinite(h) || h < range[0] || h > range[1]) return fail("hours");
  h = Math.round(h * 4) / 4;
  const stationId = PLACES[kind] && station ? String(station) : null;
  s.activity = { kind, startedAt: t, until: t + h * HOUR, bed, resume: null, place: PLACES[kind] ? place : null, station: stationId };
  if (kind === "sleeping") s.zeroEnergyH = 0;
  return { ok: true, hours: h, events: [{ at: t, kind: "activity", data: { kind, hours: h, ...(PLACES[kind] ? { place } : {}), ...(stationId ? { station: stationId } : {}) } }] };
}

/**
 * A pena de um crime visto pela sala (mm3d-37f). Devolve a multa (moedas, o
 * serviço cobra até o que houver) ou os minutos de prisão; sem efeito com o
 * hóspede morto, internado ou já preso.
 */
function crime(s, kind, t) {
  if (s.status !== "alive" || s.activity.kind === "hospital" || s.activity.kind === "jail") return { ok: false, events: [] };
  const acc = s.dayAcc;
  acc.crimes = acc.crimes || {};
  acc.crimes[kind] = (acc.crimes[kind] || 0) + 1;
  if (kind === "praca" && acc.crimes[kind] === 1) {
    return { ok: true, fine: CRIME.PLAZA_FINE, events: [{ at: t, kind: "fined", data: { reason: kind, coins: CRIME.PLAZA_FINE } }] };
  }
  const minutes = kind === "praca" ? CRIME.PLAZA_JAIL_MIN : CRIME.HIT_JAIL_MIN;
  s.activity = { kind: "jail", startedAt: t, until: t + minutes * 60 * 1000, bed: null, resume: null, place: "delegacia" };
  return { ok: true, jailed: true, minutes, events: [{ at: t, kind: "jailed", data: { reason: kind, minutes } }] };
}

// ═══ LEITURA ═══
/** Ritmo de caminhada (a sala aplica nas velocidades). */
function pace(s) {
  if (s.status !== "alive") return PACE.NORMAL;
  if (s.energy < 10 || s.health < 25) return PACE.EXHAUSTED;
  if (s.energy < 25 || s.stress >= 85 || s.health < 40) return PACE.TIRED;
  return PACE.NORMAL;
}

/** Tipo físico do corpo atual (ver BODY) — é o avatar da sala e o retrato dos cards. */
function bodyHint(s) {
  const fp = fatPct(s);
  if (fp >= BODY.FAT_AT) return "fat";
  const ffmi = s.leanKg / (s.heightM * s.heightM);
  if (fp < BODY.STRONG_MAX_FAT && (ffmi >= BODY.STRONG_FFMI || s.strength >= BODY.STRONG_STRENGTH)) return "strong";
  if (fp < BODY.SLIM_BELOW) return "slim";
  return "normal";
}

/** Estado de uma refeição em `t`: eaten | upcoming | open | partial | late | missed. */
function mealState(s, m, t) {
  const c = mealCredit(s, m.id);
  if (c >= MEALS.DONE_AT - 1e-9) return "eaten";
  if (t < m.open) return "upcoming";
  if (t <= m.tolEnd) return c > 0 ? "partial" : "open";
  if (t < m.penEnd) return "late";
  return "missed";
}

const mealView = (s, m, t) => ({
  at: m.h,
  id: m.id,
  opensAt: new Date(m.open).toISOString(),
  closesAt: new Date(m.tolEnd).toISOString(),
  penaltyEndsAt: new Date(m.penEnd).toISOString(),
  credit: r2(mealCredit(s, m.id)),
  state: mealState(s, m, t),
});

function mealsToday(s, t) {
  const today = localParts(t).day;
  return mealInstances(t)
    .filter((m) => m.day === today)
    .map((m) => mealView(s, m, t));
}

/**
 * Admin (2026-10-28, pedido do Alex para os testes): energia sempre cheia,
 * nunca cansado/exausto e fôlego de corrida sem fim; 2026-10-30: saúde cheia
 * e estresse zero sempre (sem internação). Energia, saúde e estresse mudam no
 * estado; ritmo e fôlego são trocados na leitura (adminView).
 */
const ADMIN_STAMINA = Object.freeze({ maxS: 9999, refillS: 0.5 });
function adminTopUp(s) {
  s._admin = true;
  if (s.status === "alive") {
    s.energy = 100;
    s.vitality = 100;
    s.health = 100;
    s.stress = 0;
    if (s.activity && s.activity.kind === "hospital") s.activity = { kind: "idle", startedAt: s.simAt || Date.now(), until: null, bed: null, resume: null };
  }
  return s;
}
function adminView(snap) {
  if (snap.status !== "alive") return snap;
  return { ...snap, pace: PACE.NORMAL, stamina: ADMIN_STAMINA, needs: (snap.needs || []).filter((n) => !/energ|exhaust|exaust|tired|sleep|sono|unwell|stress|hospital/i.test(String(n.id || n.kind || ""))) };
}

/** Fôlego de corrida pela condição (STAMINA): segundos de corrida e de recarga. */
function stamina(s) {
  let k = longTerm(s).endurance;
  if (s.energy < 30) k *= 0.5 + s.energy / 60;
  if (s.health < 50) k *= 0.4 + (0.6 * s.health) / 50;
  if (s.satiety <= 5) k *= 0.7;
  const maxS = Math.max(STAMINA.MIN_S, (STAMINA.BASE_S + s.speed * STAMINA.SPEED_S) * k);
  return { maxS: r2(maxS), refillS: r2(STAMINA.REFILL_S / Math.max(0.35, k)) };
}

/**
 * Necessidades de agora, da mais urgente para a mais leve (o cliente escolhe
 * qual falar e combina as duas primeiras). `level`: 1 emergência/hospital,
 * 2 saúde ou exaustão crítica, 3 fome intensa, 4 sono, 5 alertas leves.
 */
function needs(s, t) {
  if (s.status !== "alive") return [];
  const a = s.activity.kind;
  if (a === "hospital") return [{ id: "hospital", level: 1 }];
  const out = [];
  const asleep = a === "sleeping";
  if (s.health <= RULES.HOSPITAL_AT + 10) out.push({ id: "unwell", level: 2 });
  if (s.energy < 10 && !asleep) out.push({ id: "exhausted", level: 2 });
  const late = latePenalty(s, t);
  if (s.satiety < 12 || late) out.push({ id: "starving", level: 3, meal: late ? late.meal.h : null });
  else if (s.satiety < 30) out.push({ id: "hungry", level: 5 });
  if (s.awakeH >= SLEEP.WARN_H && !asleep) out.push({ id: "sleep", level: 4, hours: Math.floor(s.awakeH) });
  if (s.energy >= 10 && s.energy < 25 && !asleep) out.push({ id: "tired", level: 5 });
  if (s.stress >= 80) out.push({ id: "stressed", level: 5 });
  if (LIFE.DAYS - s.wearDays <= LIFE.WARN_LEFT_DAYS) out.push({ id: "aging", level: 5 });
  return out.sort((x, y) => x.level - y.level);
}

/** Projeção para a rede (cards): tudo arredondado, nada interno. */
function snapshot(s, t) {
  normalize(s);
  const fp = fatPct(s);
  const w = weightKg(s);
  const stim = effectOn(s, "stim", t);
  const pl = s.effects.filter((e) => e.id === "pleasure" && e.until > t).reduce((n, e) => n + e.mag, 0);
  const a = s.activity;
  return {
    status: s.status === "dead" ? "dead" : a.kind === "hospital" ? "hospital" : "alive",
    deathCause: s.deathCause,
    diedAt: s.diedAt ? new Date(s.diedAt).toISOString() : null,
    afterlife: afterlife(s),
    personality: s.personality,
    vitals: {
      energy: r2(s.energy),
      satiety: r2(s.satiety),
      mood: r2(s.mood),
      stress: r2(s.stress),
      health: r2(s.health),
      vitality: r2(s.vitality),
    },
    body: {
      heightM: s.heightM,
      weightKg: r2(w),
      fatPct: r2(fp),
      leanKg: r2(s.leanKg),
      bmi: r2(w / (s.heightM * s.heightM)),
      bodyHint: bodyHint(s),
    },
    attributes: {
      intelligence: r2(s.intelligence),
      strength: r2(s.strength),
      speed: r2(s.speed),
      dexterity: r2(s.dexterity),
      accuracy: r2(s.accuracy || 0),
      fertility: r2(s.fertility),
      // 0–1000: maior valor já alcançado e o piso que não se perde mais.
      peaks: Object.fromEntries(ATTRS.map((k) => [k, r2(s.peaks[k])])),
      floors: Object.fromEntries(ATTRS.map((k) => [k, r2(attrFloor(s, k))])),
      // mm3d-59: orçamento de prática de hoje (pontos-base gastos / teto).
      budgetToday: Object.fromEntries(ATTRS.map((k) => [k, { used: r2(ATTR.BUDGET[k] - budgetLeft(s, k, t)), cap: ATTR.BUDGET[k] }])),
      // Horas que ainda rendem hoje (estudo e treino têm teto por dia).
      usefulToday: Object.fromEntries(
        Object.entries(ATTR.USEFUL_H).map(([k, cap]) => [k, { done: r2(Math.min(cap, s.dayAcc.hours[k] || 0)), cap }])
      ),
    },
    health: {
      // D9: campos de legado (cliente antigo); sempre "sem doença"
      diabetes: "none",
      hypertension: "none",
      diabetesRisk: 0,
      bpRisk: 0,
      // Leituras derivadas (para os cards; não entram na conta).
      glucose: Math.round(85 + Math.min(40, pl)),
      systolic: Math.round(112 + s.stress * 0.1 + (stim ? 10 : 0)),
      diastolic: Math.round(72 + (stim ? 6 : 0)),
      toxicity: r2(s.toxicity),
      cardiac: r2(s.cardiac),
      diet: r2(s.diet),
      awakeHours: r2(s.awakeH),
    },
    activity: {
      kind: a.kind,
      startedAt: new Date(a.startedAt).toISOString(),
      until: a.until ? new Date(a.until).toISOString() : null,
      remainingH: a.until ? r2(Math.max(0, (a.until - t) / HOUR)) : null,
      inBed: !!a.bed,
      place: a.place || null,
      station: a.station || null,
      resume: a.resume ? { kind: a.resume.kind, until: new Date(a.resume.until).toISOString(), place: a.resume.place || null, station: a.resume.station || null } : null,
    },
    effects: s.effects
      .filter((e) => e.until > t && e.id !== "pleasure")
      .map((e) => ({ id: e.id, remainingH: r2((e.until - t) / HOUR) })),
    meals: mealsToday(s, t),
    // A refeição que um prato atenderia agora (pode ser de ontem, em atraso).
    pendingMeal: (() => {
      const m = pendingMeal(s, t);
      return m ? mealView(s, m, t) : null;
    })(),
    sleep: { awakeHours: r2(s.awakeH), warnAt: SLEEP.WARN_H },
    exposure: Object.fromEntries(EXPOSURE.KEYS.map((k) => [k, r2(s.exposure[k])])),
    life: {
      budgetDays: LIFE.DAYS,
      wearDays: r2(s.wearDays),
      leftDays: r2(Math.max(0, LIFE.DAYS - s.wearDays)),
      // Dias de vida gastos por dia real agora (1 = bem cuidado).
      wearRate: r2(EXPOSURE.KEYS.reduce((n, k) => n + LIFE.WEAR[k] * severity(s)[k], 1)),
    },
    // mm3d-58: jovem → adulto (o modelo da classe muda; ver GROWTH).
    growth: (() => {
      const g = growthProgress(s, t);
      return {
        stage: s.growth.stage,
        from: new Date(s.growth.from).toISOString(),
        at: s.growth.at ? new Date(s.growth.at).toISOString() : null,
        ageDays: r2(g.ageDays),
        minDays: GROWTH.MIN_DAYS,
        target: GROWTH.TARGET,
        gained: Object.fromEntries(GROWN.map((k) => [k, r2(g.gained[k])])),
        pct: s.growth.stage === "adult" ? 100 : r2(100 * g.pct),
      };
    })(),
    stamina: stamina(s),
    needs: needs(s, t),
    today: { ...dayCondition(s.dayAcc), day: s.dayAcc.day, hours: Object.fromEntries(Object.entries(s.dayAcc.hours).map(([k, v]) => [k, r2(v)])) },
    pace: pace(s),
  };
}

/** Catálogo e relógio para a rede (vão inteiros no payload). */
function publicCatalog() {
  return {
    items: ITEMS.map((it) => ({ ...it, effect: it.effect ? { id: it.effect[0], hours: it.effect[1] } : null })),
    activityHours: ACTIVITY_HOURS,
    // B10: aparelhos e cursos por nível (a tela escolhe; o servidor confere)
    stations: Object.fromEntries(
      Object.entries(STATIONS).map(([id, d]) => [id, { kind: d.kind, attr: d.attr, places: d.places, maxTier: d.maxTier, placeMax: d.placeMax || null, min: TIER_MIN.slice(0, d.maxTier), mul: TIER_MUL.slice(0, d.maxTier) }])
    ),
    // Onde treinar e estudar (mm3d-37b), rendimento e hora de aula.
    places: { ...PLACES, rules: PLACE_RULES },
    // Cardápios (mm3d-37c) e onde se compra para a geladeira.
    menus: MENUS,
    marketPlace: MARKET_PLACE,
    attributes: { max: ATTR.MAX, usefulH: ATTR.USEFUL_H, floor: ATTR.FLOOR },
    routine: { meals: ROUTINE.MEALS, sleepAtEnergy: ROUTINE.SLEEP_AT_ENERGY, restAtStress: ROUTINE.REST_AT_STRESS },
    clock: { offsetMin: CLOCK.OFFSET_MIN, meals: CLOCK.MEALS, beforeH: MEALS.BEFORE_H, afterH: MEALS.AFTER_H, penaltyH: MEALS.PENALTY_H },
    mealPenalty: MEALS.PENALTY,
  };
}

module.exports = {
  noteSleep,
  ATTRS,
  birthDexterity,
  gain,
  dropAttr,
  lifeStage,
  budgetLeft,
  localParts,
  HOUR,
  CLOCK,
  ACTIVITIES,
  ACTIVITY_HOURS,
  RATES,
  RULES,
  FRIDGE,
  MEALS,
  SLEEP,
  EXPOSURE,
  LIFE,
  GROWTH,
  STAMINA,
  BODY,
  ATTR,
  ROUTINE,
  PACE,
  PLACES,
  PLACE_RULES,
  STATIONS,
  TIER_MIN,
  TIER_MUL,
  parseStation,
  stationBlock,
  placeFee,
  MENUS,
  MARKET_PLACE,
  CRIME,
  crime,
  AFTERLIFE,
  afterlife,
  applyInheritance,
  freeze,
  thaw,
  ITEMS,
  ITEM_BY_ID,
  birth,
  simulate,
  consume,
  startActivity,
  snapshot,
  pace,
  adminTopUp,
  adminView,
  ADMIN_STAMINA,
  bodyHint,
  dayCondition,
  closeDay,
  publicCatalog,
  localParts,
  atLocalHour,
  mealWindowAt,
  mealInstances,
  pendingMeal,
  latePenalty,
  normalize,
  stamina,
  needs,
};
