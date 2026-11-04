// src/utils/meuMundoGear.js — MEU MUNDO 3D mm3d-59 (slice 3): EQUIPAMENTO,
// MATERIAIS, RECEITAS, ITENS DE MISSÃO e a FORJA.
//
// Regra pura (sem banco). Os 30 consumíveis continuam em meuMundoLife.js
// (ITEMS) e a geladeira não muda; skins seguem em meuMundoSkins.js. Aqui mora
// o inventário NOVO (tb_mm_gear, mig 321).
//
// Princípios (pedido do Alex):
//  • Classe mecânica, arma equipada e aparência são INDEPENDENTES: a classe
//    decide o kit (raposa = maga com cajado, vampiro = lâmina com espada); a
//    arma só soma bônus pequenos e PRECISA ser da classe; sexo/fase/skin
//    nunca mudam kit, atributos ou habilidades.
//  • mm3d-66 (regra do Alex): os golpes vêm do PERSONAGEM (skin vestida), nunca
//    da arma. Espada é de guerreiro (vampiros, Aurion, Morkhan e Zéphyra —
//    usesSword em meuMundoClans.js): os outros não compram nem equipam. A espada
//    da loja muda só o modelo na mão e o bônus.
//  • Bônus de equipamento têm TETO somado (não se multiplicam sem limite).
//  • Moeda: as moedas do jogo (tb_mm_wallet) — sem carteira nova.
"use strict";

const Forge = require("./meuMundoForge");

const SLOTS = Object.freeze(["weapon", "armor", "acc1", "acc2"]);
const CATEGORIES = Object.freeze(["weapon", "armor", "accessory", "material", "recipe", "quest", "cosmetic"]);
const RARITIES = Object.freeze(["common", "uncommon", "rare", "epic", "legendary"]);

/** Teto dos bônus SOMADOS de tudo que está equipado (frações). */
const GEAR_CAP = Object.freeze({ dmg: 0.35, def: 0.25, stam: 0.12, warn: 0.12, power: 0.18 });
/** Preserve the old per-level bonuses; the expanded caps keep +6..10 useful. */
const UPGRADE = Object.freeze({ MAX: Forge.MAX_LEVEL, DMG: 0.02, DEF: 0.015, COINS: Forge.COINS, MATS: Forge.MATERIALS, SECONDARY: Forge.SECONDARY_PER_LEVEL });
const STACK_MAX = 999;

// id, categoria, nome (pt; o front traduz por `gear.<id>`), raridade, campos extras.
//  price: no Armeiro (null = não vende) · level: nível de aventura mínimo
//  clan: só essa classe usa · bonus: { dmg, def, stam, warn, power } (frações)
//  family: de onde o material cai · sell: moedas na reciclagem
const LORE = Object.freeze({
  cristal_morkhan: "Uma luz violeta atravessa a rachadura. As marcas lembram o nome apagado de Morkhan, o oitavo campeão dos Jogos Eternos de Lúmen. Esta recordação pode ser examinada sem avançar uma missão.",
  diario_sem_nome: "As páginas reconstituídas mencionam Aurion, os Sete e um oitavo lugar vazio. Ainda não provam onde está Morkhan. Ler o diário registra a descoberta na coleção.",
  chave_subestacao: "Uma chave antiga marcada com uma engrenagem e o número oito. A origem da subestação continua desconhecida. Examinar a inscrição registra a descoberta na coleção.",
});
const cosmeticEffect = (id) => ({ pintura_arma_eter: "ether_paint", rastro_eter: "ether_trail", emote_saudacao: "lumen_salute" })[id] || null;
const useFor = (category, id) => category === "recipe" ? "learn_recipe" : category === "quest" ? "inspect_quest" : category === "cosmetic" ? (id === "emote_saudacao" ? "unlock_emote" : "apply_weapon_cosmetic") : ["weapon", "armor", "accessory"].includes(category) ? "equip" : null;
const G = (id, category, name, rarity, o = {}) => Object.freeze({
  id, category, name, rarity, price: null, level: 1, clan: null, bonus: null,
  family: null, sell: 0, stack: category === "material" || category === "quest", component: false,
  use: useFor(category, id), action: useFor(category, id), cosmeticEffect: cosmeticEffect(id), lore: LORE[id] || null, ...o,
});

/** Espada da loja: de guerreiro (classe vampiro), recicla por ~12% do preço. */
const S = (id, name, rarity, level, price, bonus) => G(id, "weapon", name, rarity, { clan: "vampiro", level, price, bonus, sell: Math.round(price * 0.12), shop: "weapons" });

const GEAR = Object.freeze([
  // ── armas (uma por classe em cada degrau) ──
  G("espada_aprendiz", "weapon", "Espada de aprendiz", "common", { clan: "vampiro", bonus: { dmg: 0 }, starter: true, sell: 10 }),
  G("cajado_aprendiz", "weapon", "Cajado de aprendiz", "common", { clan: "raposa", bonus: { dmg: 0 }, starter: true, sell: 10 }),
  G("espada_latao", "weapon", "Espada de latão", "uncommon", { clan: "vampiro", level: 2, bonus: { dmg: 0.05 }, sell: 90 }),
  G("cajado_latao", "weapon", "Cajado de latão", "uncommon", { clan: "raposa", level: 2, bonus: { dmg: 0.05 }, sell: 90 }),
  G("espada_eter", "weapon", "Espada de éter", "rare", { clan: "vampiro", level: 3, bonus: { dmg: 0.1, power: 0.05 }, sell: 200 }),
  G("cajado_eter", "weapon", "Cajado de éter", "rare", { clan: "raposa", level: 3, bonus: { dmg: 0.1, power: 0.05 }, sell: 200 }),
  G("espada_solar", "weapon", "Lâmina solar", "legendary", { clan: "vampiro", level: 8, bonus: { dmg: 0.12, power: 0.08 }, sell: 500 }),
  G("cajado_solar", "weapon", "Cajado solar", "legendary", { clan: "raposa", level: 8, bonus: { dmg: 0.12, power: 0.08 }, sell: 500 }),
  // ── Loja de Armas do Arsenal de Lúmen (mm3d-66): só guerreiros ──
  S("espada_aco", "Espada de aço de Lúmen", "common", 1, 400, { dmg: 0.02 }),
  S("espada_viajante", "Sabre do viajante", "common", 1, 500, { dmg: 0.01, stam: 0.02 }),
  S("espada_prata", "Agulha de prata", "uncommon", 2, 900, { dmg: 0.03, warn: 0.02 }),
  S("espada_vigia", "Espada do vigia", "uncommon", 2, 1100, { dmg: 0.04 }),
  S("espada_cutelo", "Cutelo de ferro negro", "uncommon", 3, 1400, { dmg: 0.05 }),
  S("espada_silencio", "Katana do silêncio", "rare", 3, 2200, { dmg: 0.06, stam: 0.03 }),
  S("espada_carmesim", "Lâmina carmesim", "rare", 4, 2800, { dmg: 0.07, power: 0.03 }),
  S("espada_muralha", "Montante da muralha", "rare", 5, 3400, { dmg: 0.08, def: 0.02 }),
  S("espada_chama", "Serpente de chamas", "rare", 5, 4200, { dmg: 0.08, power: 0.04 }),
  S("espada_brasa", "Katana de brasa", "epic", 6, 5500, { dmg: 0.09, power: 0.05 }),
  S("espada_meia_noite", "Cruz da meia-noite", "epic", 6, 6000, { dmg: 0.1, warn: 0.04 }),
  S("espada_celeste", "Presa celeste", "epic", 7, 7500, { dmg: 0.1, power: 0.06 }),
  S("espada_ceifadora", "Ceifadora rubra", "epic", 8, 8500, { dmg: 0.11, power: 0.05 }),
  S("espada_abismo", "Coroa do abismo", "legendary", 9, 10000, { dmg: 0.11, power: 0.09 }),
  S("espada_alvorada", "Alvorada dourada", "legendary", 9, 12000, { dmg: 0.12, power: 0.08 }),
  S("espada_morkhan", "Fenda de Morkhan", "legendary", 10, 15000, { dmg: 0.13, power: 0.09 }),
  // ── proteção ──
  G("colete_couro", "armor", "Colete de couro", "common", { price: 250, bonus: { def: 0.05 }, sell: 35 }),
  G("couraca_rebitada", "armor", "Couraça rebitada", "uncommon", { price: 700, level: 3, bonus: { def: 0.08 }, sell: 100 }),
  // ── acessórios ──
  G("relogio_bolso", "accessory", "Relógio de bolso", "common", { price: 300, bonus: { warn: 0.05 }, sell: 40 }),
  G("luvas_precisao", "accessory", "Luvas de precisão", "uncommon", { price: 420, level: 2, bonus: { stam: 0.05 }, sell: 60 }),
  G("amuleto_aurion", "accessory", "Amuleto de Aurion", "rare", { bonus: { power: 0.1 }, sell: 0 }),
  G("botas_explorador", "accessory", "Botas do explorador", "uncommon", { price: 650, level: 2, bonus: { stam: 0.03, def: 0.02 }, sell: 80 }),
  G("oculos_engenheiro", "accessory", "Óculos do engenheiro", "uncommon", { price: 700, level: 2, bonus: { warn: 0.06 }, sell: 85 }),
  G("bracelete_isolante", "accessory", "Bracelete isolante", "rare", { price: 1000, level: 3, bonus: { def: 0.04 }, sell: 120 }),
  G("medalhao_lunar", "accessory", "Medalhão lunar", "rare", { level: 3, bonus: { stam: 0.03, power: 0.04 }, sell: 100 }),
  G("nucleo_equilibrio", "accessory", "Núcleo de equilíbrio", "rare", { level: 3, bonus: { warn: 0.03, def: 0.03 }, sell: 100 }),
  // ── materiais (por família de atividade) ──
  G("fragmento_lamina", "material", "Fragmento de lâmina", "common", { family: "forja", sell: 4 }),
  G("nucleo_eter", "material", "Núcleo de éter", "uncommon", { family: "forja", sell: 12 }),
  G("selo_forja", "material", "Selo de forja", "rare", { family: "forja", sell: 30 }),
  G("couro_reforcado", "material", "Couro reforçado", "common", { family: "couro", sell: 4 }),
  G("rebite", "material", "Rebites", "common", { family: "couro", sell: 3 }),
  G("pigmento_eter", "material", "Pigmento de éter", "uncommon", { family: "pigmento", sell: 10 }),
  G("mola_precisao", "material", "Mola de precisão", "common", { family: "mola", sell: 4 }),
  G("injetor_vapor", "material", "Injetor de vapor", "common", { family: "vapor", sell: 5 }),
  G("capacitor", "material", "Capacitor", "common", { family: "capacitor", sell: 5 }),
  G("rolamento", "material", "Rolamento", "common", { family: "rolamento", sell: 4 }),
  G("sucata_bronze", "material", "Sucata de bronze", "common", { family: "forja", sell: 3 }),
  G("engrenagem_precisao", "material", "Engrenagem de precisão", "uncommon", { family: "forja", sell: 6 }),
  G("liga_leve", "material", "Liga leve", "uncommon", { family: "capacitor", sell: 8 }),
  G("insignia_ringue", "material", "Insígnia do ringue", "uncommon", { family: "couro", sell: 12 }),
  G("fibra_resistente", "material", "Fibra resistente", "common", { family: "mola", sell: 4 }),
  G("medalhao_travessia", "material", "Medalhão da travessia", "uncommon", { family: "mola", sell: 12 }),
  G("celula_energia", "material", "Célula de energia de éter", "uncommon", { family: "vapor", sell: 9 }),
  // ── receita, missão, cosmético ──
  G("receita_eter", "recipe", "Receita: armas de éter", "rare", { sell: 0 }),
  G("receita_latao", "recipe", "Projeto: armas de latão", "uncommon", { sell: 0 }),
  G("receita_colete", "recipe", "Projeto: colete de couro", "uncommon", { sell: 0 }),
  G("cristal_morkhan", "quest", "Cristal rachado de Morkhan", "epic", { sell: 20 }),
  G("chave_subestacao", "quest", "Chave da subestação", "rare", { sell: 15 }),
  G("diario_sem_nome", "quest", "Diário do Sem-Nome", "rare", { sell: 20 }),
  G("pintura_arma_eter", "cosmetic", "Pintura de arma: éter", "rare", { sell: 50 }),
  G("rastro_eter", "cosmetic", "Rastro de éter", "rare", { sell: 60 }),
  G("emote_saudacao", "cosmetic", "Emote: saudação de Lúmen", "uncommon", { sell: 30 }),
  ...Forge.COMPONENTS.map((p) => G(p.id, "material", p.name, p.level >= 8 ? "epic" : p.level >= 3 ? "rare" : "uncommon", { component: true, level: p.level, sell: Math.max(1, Math.floor(p.coins / 10)), description: p.description })),
]);
const GEAR_BY_ID = new Map(GEAR.map((g) => [g.id, g]));

/** Família → material comum garantido, incomum (chance) e raro (chance). */
const LOOT = Object.freeze({
  forja: { base: "fragmento_lamina", uncommon: "nucleo_eter", rare: "selo_forja" },
  couro: { base: "couro_reforcado", uncommon: "rebite", rare: null },
  pigmento: { base: "pigmento_eter", uncommon: null, rare: null },
  mola: { base: "mola_precisao", uncommon: null, rare: null },
  vapor: { base: "injetor_vapor", uncommon: null, rare: null },
  capacitor: { base: "capacitor", uncommon: null, rare: null },
  rolamento: { base: "rolamento", uncommon: null, rare: null },
});

/** Every component, conversion and final assembly has an explicit recipe. */
const RECIPES = Object.freeze([
  ...Forge.PART_RECIPES,
  ...Forge.ASSEMBLIES,
  ...Forge.CONVERSIONS,
  { id: "forjar_couraca", out: "couraca_rebitada", needs: { couro_reforcado: 6, rebite: 8 }, coins: 150, recipe: null, level: 3 },
  { id: "forjar_luvas", out: "luvas_precisao", needs: { couro_reforcado: 3, mola_precisao: 4 }, coins: 90, recipe: null, level: 2 },
  { id: "forjar_colete", kind: "equipment", out: "colete_couro", needs: { couro_reforcado: 6, fibra_resistente: 3, rebite: 6 }, coins: 120, recipe: "receita_colete", level: 2 },
  { id: "forjar_medalhao_lunar", kind: "equipment", out: "medalhao_lunar", needs: { medalhao_travessia: 2, nucleo_eter: 4, pigmento_eter: 4 }, coins: 550, recipe: null, level: 3 },
  { id: "forjar_nucleo_equilibrio", kind: "equipment", out: "nucleo_equilibrio", needs: { capacitor: 4, nucleo_eter: 4, rolamento: 4 }, coins: 550, recipe: null, level: 3 },
  { id: "forjar_amuleto_aurion", kind: "equipment", out: "amuleto_aurion", needs: { selo_forja: 2, nucleo_eter: 6, insignia_ringue: 2 }, coins: 1000, recipe: null, level: 3 },
  { id: "reunir_vestigios_morkhan", kind: "conversion", out: "cristal_morkhan", needs: { nucleo_eter: 6, pigmento_eter: 6, selo_forja: 1 }, coins: 600, recipe: null, level: 3 },
  { id: "reconstituir_diario", kind: "conversion", out: "diario_sem_nome", needs: { fragmento_lamina: 12, pigmento_eter: 4 }, coins: 200, recipe: null, level: 3 },
  { id: "reconstituir_chave", kind: "conversion", out: "chave_subestacao", needs: { sucata_bronze: 8, engrenagem_precisao: 2, nucleo_eter: 1 }, coins: 180, recipe: null, level: 3 },
  { id: "produzir_pintura_eter", kind: "equipment", out: "pintura_arma_eter", needs: { pigmento_eter: 8, nucleo_eter: 2 }, coins: 450, recipe: null, level: 3 },
  { id: "produzir_rastro_eter", kind: "equipment", out: "rastro_eter", needs: { pigmento_eter: 10, celula_energia: 3 }, coins: 600, recipe: null, level: 3 },
  { id: "registrar_saudacao", kind: "equipment", out: "emote_saudacao", needs: { insignia_ringue: 1, medalhao_travessia: 1 }, coins: 250, recipe: null, level: 2 },
]);
const RECIPE_BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

const DESCRIPTIONS = Object.freeze({
  espada_aprendiz: "Arma inicial do vampiro, entregue pelo prólogo. Não altera classe, sexo ou aparência do personagem.",
  cajado_aprendiz: "Arma inicial da raposa, entregue pelo prólogo. Não altera classe, sexo ou aparência do personagem.",
  espada_latao: "Espada de progressão montada com dez peças diferentes, uma unidade de cada.",
  cajado_latao: "Cajado de progressão montado com dez peças diferentes, uma unidade de cada.",
  espada_eter: "Espada intermediária: doze peças diferentes e projeto de éter aprendido.",
  cajado_eter: "Cajado intermediário: doze peças diferentes e projeto de éter aprendido.",
  espada_solar: "Lâmina avançada: quinze peças diferentes, projeto de éter e nível de aventura oito.",
  cajado_solar: "Cajado avançado: quinze peças diferentes, projeto de éter e nível de aventura oito.",
  espada_aco: "A lâmina de todo guerreiro que começa em Lúmen: reta, honesta e fácil de manter.",
  espada_viajante: "Sabre leve de quem cruza a cidade a pé. Cansa menos no braço do que corta.",
  espada_prata: "Lâmina fina de duelista, com guarda longa. Avisa o golpe que vem com um instante de folga.",
  espada_vigia: "Espada de ronda dos vigias de Lúmen, com guarda de ferro trabalhado.",
  espada_cutelo: "Um bloco de ferro negro com cabo de corda. Sem delicadeza nenhuma.",
  espada_silencio: "Katana de fio longo com borla vermelha. Golpes econômicos, quase sem ruído.",
  espada_carmesim: "Lâmina branca com veios carmesim que acendem a cada acerto.",
  espada_muralha: "Espada larga de quem segura a linha: protege quase tanto quanto corta.",
  espada_brasa: "Katana de fio alaranjado, forjada ainda quente. Carrega o poder mais depressa.",
  espada_meia_noite: "Cruz de aço negro das rondas noturnas. Quem a usa enxerga o golpe antes.",
  espada_celeste: "Presa azul de guarda em chifres, relíquia ornamentada dos Jogos Eternos.",
  espada_chama: "Lâmina curva que serpenteia como fogo vivo. Alimenta o poder a cada corte.",
  espada_ceifadora: "Montante de osso e ferro rubro, com rasgos abertos na lâmina. Foi feita para assustar antes de cortar.",
  espada_abismo: "Lâmina violeta coroada de garras, com veios de éter que correm até a ponta.",
  espada_alvorada: "Lâmina dourada que lembra a primeira luz de Aurion sobre Lúmen.",
  espada_morkhan: "Fragmento violeta rachado pela mesma luz do cristal de Morkhan, o Sem-Nome.",
  colete_couro: "Proteção de couro com defesa adicional; ocupa o slot de proteção.",
  couraca_rebitada: "Proteção reforçada com rebites; pode ser refinada e preserva seu aprimoramento anterior.",
  relogio_bolso: "Acessório que amplia o aviso dos ataques inimigos nas lutas de aventura.",
  luvas_precisao: "Acessório que melhora a eficiência de fôlego nas lutas de aventura.",
  amuleto_aurion: "Acessório de Aurion que melhora o poder especial, dentro do teto de equipamento.",
  botas_explorador: "Acessório que combina eficiência de fôlego e defesa. Não aumenta a velocidade de corrida.",
  oculos_engenheiro: "Acessório de precisão que amplia o aviso de ataques; não fornece mira automática.",
  bracelete_isolante: "Acessório defensivo. A proteção se soma aos outros equipamentos dentro do teto.",
  medalhao_lunar: "Acessório que combina eficiência de fôlego e poder especial nas lutas de aventura.",
  nucleo_equilibrio: "Acessório que combina defesa e aviso de ataques. Não é a matéria-prima Núcleo de éter.",
  fragmento_lamina: "Metal recuperado das lutas: matéria-prima da forja e custo base do refinamento de armas.",
  nucleo_eter: "Matéria-prima de energia para peças, acessórios e refinamentos. Pode ser condensada sem sorteio.",
  selo_forja: "Certificação usada na montagem solar, refinamentos altos e proteção opcional. Também pode ser fabricada sem sorteio.",
  couro_reforcado: "Matéria-prima de proteção, empunhaduras e fibras; custo base do refinamento de armaduras.",
  rebite: "Fixador de latão usado em estruturas, travas, proteção e engrenagens.",
  pigmento_eter: "Pigmento condutor usado em focos, núcleos, circuitos e cosméticos de éter.",
  mola_precisao: "Mola mecânica para travas e estabilizadores; também integra luvas e medalhões de forja.",
  injetor_vapor: "Componente bruto de propulsão usado em células de energia e injetores de arma.",
  capacitor: "Componente de levitação usado em células, estabilizadores e reguladores.",
  rolamento: "Componente de bronze usado em buchas e no acessório Núcleo de equilíbrio.",
  sucata_bronze: "Metal básico recuperado, usado para fabricar fixadores, estruturas e ligas.",
  engrenagem_precisao: "Engrenagem usinada para travas, pomos, anéis, selos e reguladores solares.",
  liga_leve: "Liga estrutural usada em lâminas, hastes, carcaças e blindagens de núcleo.",
  insignia_ringue: "Peça de forja inspirada no ringue: integra guardas, anéis e amuletos. Não é uma classificação competitiva.",
  fibra_resistente: "Fibra produzida a partir de couro, usada em empunhaduras, hastes e circuitos.",
  medalhao_travessia: "Medalhão de forja usado em pomos, coroas e acessórios. É distinto do Medalhão lunar equipado.",
  celula_energia: "Célula de energia de éter montada com injetores e capacitores; alimenta peças e rastros.",
  receita_latao: "Projeto que, aprendido, habilita as duas montagens de armas de latão. Cada arma continua exclusiva de sua classe.",
  receita_eter: "Projeto que, aprendido, habilita as quatro montagens de armas de éter e solares.",
  receita_colete: "Projeto que, aprendido, habilita fabricar o colete de couro na forja.",
  cristal_morkhan: "Recordação de Lúmen com uma inscrição sobre Morkhan; pode ser examinada na coleção.",
  chave_subestacao: "Recordação da subestação. Examine sua inscrição para registrar a descoberta na coleção.",
  diario_sem_nome: "Registro investigável sobre Aurion, os Sete e o Sem-Nome; integra a coleção de descobertas.",
  pintura_arma_eter: "Acabamento cosmético de éter para a arma, sem alterar atributos, alcance ou dano.",
  rastro_eter: "Rastro cosmético de éter para golpes, sem alterar a janela de acerto ou o alcance.",
  emote_saudacao: "Desbloqueia a saudação social de Lúmen, sem bônus de combate.",
});

const LOOT_SOURCE = Object.freeze({
  fragmento_lamina: "Lâminas e monstros: material básico garantido de uma atividade validada.",
  nucleo_eter: "Vitórias da família forja: chance de 35%; há condensação garantida no ferreiro.",
  selo_forja: "Vitórias da família forja: chance de 6%; há certificação garantida no ferreiro.",
  couro_reforcado: "Boxe: material básico garantido de uma atividade validada.",
  rebite: "Vitórias do Boxe: chance de 35%; também pode ser produzido no ferreiro.",
  pigmento_eter: "Paint: material básico garantido de uma atividade validada.",
  mola_precisao: "Gincana: material básico garantido de uma atividade validada.",
  injetor_vapor: "Jetpack: material básico garantido de uma atividade validada.",
  capacitor: "Antigravidade: material básico garantido de uma atividade validada.",
  rolamento: "Rolê Noturno: material básico garantido de uma atividade validada.",
});

/** Metadata is derived from actual recipes so no source/usage becomes stale. */
function itemDetails(item) {
  const producing = RECIPES.filter((r) => r.out === item.id);
  const consuming = RECIPES.filter((r) => r.needs[item.id]);
  const assembly = Forge.ASSEMBLIES.find((r) => r.out === item.id);
  const source = [];
  if (item.starter) source.push("Prólogo: arma inicial gratuita da classe.");
  if (item.price != null) source.push(`${item.shop === "weapons" ? "Loja de Armas do Arsenal" : "Loja de equipamentos"}: ${item.price} moedas.`);
  if (LOOT_SOURCE[item.id]) source.push(LOOT_SOURCE[item.id]);
  for (const r of producing) source.push(`Ferreiro: ${r.kind === "assembly" ? "montar" : r.kind === "part" ? "fabricar uma peça de" : "produzir"} ${item.name} (${r.coins} moedas e ingredientes da receita).`);
  const uses = [];
  if (item.use === "equip") uses.push("Equipar no slot compatível; bônus de aventura sujeitos ao teto.");
  if (["weapon", "armor"].includes(item.category)) uses.push("Refinar de +0 a +10 mediante proposta, com custo, pisos e proteção opcionais.");
  if (item.use === "learn_recipe") uses.push("Aprender uma vez; o projeto consumido fica registrado permanentemente.");
  if (item.use === "inspect_quest") uses.push("Examinar a inscrição e registrar a leitura na coleção; não conclui missão automaticamente.");
  if (item.use === "apply_weapon_cosmetic") uses.push("Ativar o visual cosmético da arma, sem bônus de combate.");
  if (item.use === "unlock_emote") uses.push("Desbloquear a saudação de Lúmen na coleção de emotes.");
  for (const r of consuming) uses.push(`Ingrediente de ${GEAR_BY_ID.get(r.out)?.name || r.out}: ${r.needs[item.id]} unidade(s).`);
  if (["fragmento_lamina", "couro_reforcado", "nucleo_eter", "selo_forja"].includes(item.id)) uses.push("Custo de refinamento ou proteção; a cotação informa a quantidade exata.");
  if (item.sell > 0) uses.push(`Reciclar por ${item.sell} moedas por unidade quando não estiver equipado.`);
  return { description: item.description || DESCRIPTIONS[item.id], source, uses, assemblyParts: assembly ? [...assembly.parts] : [] };
}

/** Qual arma de aprendiz é a da classe. */
const starterOf = (clan) => (clan === "raposa" ? "cajado_aprendiz" : clan === "vampiro" ? "espada_aprendiz" : null);

/** Slot onde um item entra (acessório escolhe 1 ou 2). */
function slotsFor(item) {
  if (!item) return [];
  if (item.category === "weapon") return ["weapon"];
  if (item.category === "armor") return ["armor"];
  if (item.category === "accessory") return ["acc1", "acc2"];
  return [];
}

/** Pode equipar? (classe, nível, posse) — devolve o código do motivo ou null. */
function canEquip(item, { clan, level, owned }) {
  if (!item || !slotsFor(item).length) return "slot";
  if (!owned) return "owned";
  if (item.clan && item.clan !== clan) return "clan";
  if ((level || 1) < item.level) return "level";
  return null;
}

/**
 * Bônus do que está equipado, SOMADO e com teto. `equipped` = { slot: { id, level } }.
 * O aprimoramento entra aqui (arma: dano; proteção: defesa).
 */
function gearBonus(equipped) {
  const sum = { dmg: 0, def: 0, stam: 0, warn: 0, power: 0 };
  for (const slot of SLOTS) {
    const e = equipped && equipped[slot];
    const it = e && GEAR_BY_ID.get(e.id);
    if (!it || !it.bonus) continue;
    for (const [k, v] of Object.entries(it.bonus)) sum[k] += v || 0;
    const lv = Math.max(0, Math.min(UPGRADE.MAX, e.level || 0));
    if (it.category === "weapon") sum.dmg += lv * UPGRADE.DMG;
    if (it.category === "armor") sum.def += lv * UPGRADE.DEF;
    if (it.category === "weapon" || it.category === "armor") {
      const extra = Math.max(0, lv - 5);
      for (const [k, v] of Object.entries(UPGRADE.SECONDARY)) sum[k] += extra * v;
    }
  }
  for (const k of Object.keys(sum)) sum[k] = Math.round(Math.min(GEAR_CAP[k], sum[k]) * 10000) / 10000;
  return sum;
}

/** Custo do próximo aprimoramento (null = no máximo / não aprimora). */
function upgradeCost(item, level) {
  const q = Forge.quote(item, level);
  return q ? { ...q.cost, to: q.toMax } : null;
}

/**
 * Drop de uma atividade VALIDADA. Recompensa básica útil GARANTIDA (o material
 * comum da família); vitória aumenta a quantidade e abre as chances. Nunca
 * depende de sorte rara para a missão (missões pedem o material comum).
 * `R` = sorteio 0–1 (o servidor passa o seu).
 */
function rollLoot(family, { win, activeMs }, R) {
  const t = LOOT[family];
  if (!t) return [];
  const out = new Map();
  const add = (id, n) => id && n > 0 && out.set(id, (out.get(id) || 0) + n);
  const minutes = Math.max(0, activeMs) / 60000;
  add(t.base, Math.max(1, Math.min(4, Math.round(minutes / 2))) + (win ? 1 : 0));
  if (win && t.uncommon && R() < 0.35) add(t.uncommon, 1);
  if (win && t.rare && R() < 0.06) add(t.rare, 1);
  return [...out.entries()].map(([id, qty]) => ({ id, qty, rarity: GEAR_BY_ID.get(id).rarity }));
}

/** Catálogo público (o front traduz o nome por id; aqui vai o pt como reserva). */
function publicGear() {
  return {
    slots: SLOTS,
    cap: GEAR_CAP,
    upgrade: { max: UPGRADE.MAX, dmg: UPGRADE.DMG, def: UPGRADE.DEF, secondary: UPGRADE.SECONDARY, rulesVersion: Forge.RULES_VERSION },
    items: GEAR.map((g) => ({ id: g.id, shop: g.shop || null, category: g.category, name: g.name, rarity: g.rarity, price: g.price, level: g.level, clan: g.clan, bonus: g.bonus, family: g.family, stack: g.stack, sell: g.sell, component: g.component, use: g.use, action: g.action, cosmeticEffect: g.cosmeticEffect, lore: g.lore, ...itemDetails(g) })),
    recipes: RECIPES,
  };
}

module.exports = {
  SLOTS,
  CATEGORIES,
  RARITIES,
  GEAR_CAP,
  UPGRADE,
  STACK_MAX,
  GEAR,
  GEAR_BY_ID,
  LOOT,
  RECIPES,
  RECIPE_BY_ID,
  starterOf,
  slotsFor,
  canEquip,
  gearBonus,
  upgradeCost,
  rollLoot,
  itemDetails,
  publicGear,
};
