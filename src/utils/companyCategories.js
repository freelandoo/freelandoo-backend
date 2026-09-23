// src/utils/companyCategories.js
// O CATÁLOGO FECHADO de categorias de empresa — a peça que traduz
// "academias em São Bernardo" numa consulta que uma máquina sabe responder.
//
// ⚠️ POR QUE ISTO É UMA LISTA FECHADA E NÃO TEXTO LIVRE.
//
// O termo que a pessoa digita precisa virar DUAS coisas ao mesmo tempo:
//   1. um conjunto de tags do OpenStreetMap (é assim que se descobre o
//      estabelecimento físico);
//   2. um conjunto de CNAEs (é assim que se reconhece a atividade no cadastro
//      da Receita, no enriquecimento).
//
// Texto livre não vira nem uma coisa nem outra: "academia" não é uma tag do
// OSM (`leisure=fitness_centre` é), e "restaurante" não é um CNAE (5611-2 é).
// Mandar o termo cru para o Overpass devolveria vazio para quase tudo, e o
// sintoma seria "a busca não acha nada" sem erro nenhum aparecer.
//
// ⚠️ `key` É IDENTIFICADOR — ele é gravado em `tb_company.category_key` e vai
// na querystring da tela. Renomear uma key órfã as linhas já descobertas.
// Categoria nova ACRESCENTA uma entrada; nunca renomeia uma existente.
//
// ⚠️ `label` AQUI É O FALLBACK pt-BR. Quem traduz é o front (ns `Leads`,
// chave `cat_<key>`), pela mesma disciplina do `labelKey` do resto da casa:
// a tela mostra o rótulo do dicionário e cai neste texto quando a chave falta.
//
// Módulo PURO: sem I/O.

/**
 * `osm`: cada item é um par `[chave, valor]` de tag. Eles são OR entre si —
 * uma academia é `leisure=fitness_centre` OU `amenity=gym`, e mapeadores
 * diferentes usaram tags diferentes ao longo dos anos. Cobrir só a "certa"
 * deixaria metade dos estabelecimentos invisíveis.
 *
 * `cnae`: prefixos (4 dígitos da subclasse, sem o dígito verificador). São
 * usados para RECONHECER a atividade no enriquecimento, nunca para descobrir.
 */
const CATEGORIES = Object.freeze([
  {
    key: "academia",
    label: "Academias",
    osm: [["leisure", "fitness_centre"], ["amenity", "gym"], ["leisure", "sports_centre"]],
    overture: ["gym", "pilates_studio", "fitness_trainer", "gymnastics_center", "yoga_studio", "martial_arts_club"],
    cnae: ["9313"],
  },
  {
    key: "restaurante",
    label: "Restaurantes",
    osm: [["amenity", "restaurant"]],
    overture: ["restaurant", "*_restaurant", "steakhouse", "food_court"],
    cnae: ["5611"],
  },
  {
    key: "bar",
    label: "Bares e lanchonetes",
    osm: [["amenity", "bar"], ["amenity", "pub"], ["amenity", "fast_food"]],
    overture: ["bar", "pub", "brewery", "wine_bar", "sports_bar", "fast_food_restaurant"],
    cnae: ["5611", "5612"],
  },
  {
    key: "padaria",
    label: "Padarias e confeitarias",
    osm: [["shop", "bakery"], ["shop", "pastry"]],
    overture: ["bakery", "desserts", "candy_store"],
    cnae: ["1091", "4721"],
  },
  {
    key: "cafeteria",
    label: "Cafeterias",
    osm: [["amenity", "cafe"]],
    overture: ["cafe", "coffee_shop", "cafeteria", "tea_room"],
    cnae: ["5611"],
  },
  {
    key: "mercado",
    label: "Mercados e mercearias",
    osm: [["shop", "supermarket"], ["shop", "convenience"], ["shop", "greengrocer"]],
    overture: ["grocery_store", "convenience_store", "farmers_market"],
    cnae: ["4711", "4712"],
  },
  {
    key: "barbearia",
    label: "Barbearias",
    osm: [["shop", "hairdresser"], ["shop", "barber"]],
    overture: ["barber"],
    cnae: ["9602"],
  },
  {
    key: "salao_beleza",
    label: "Salões de beleza e estética",
    osm: [["shop", "beauty"], ["shop", "nail_salon"], ["shop", "massage"]],
    overture: ["beauty_salon", "hair_salon", "nail_salon", "spas"],
    cnae: ["9602"],
  },
  {
    key: "dentista",
    label: "Dentistas",
    osm: [["amenity", "dentist"], ["healthcare", "dentist"]],
    overture: ["dentist"],
    cnae: ["8630"],
  },
  {
    key: "clinica",
    label: "Clínicas e consultórios",
    osm: [["amenity", "clinic"], ["amenity", "doctors"], ["healthcare", "centre"]],
    overture: ["health_and_medical", "medical_center", "medical_service_organizations"],
    cnae: ["8630", "8610", "8650"],
  },
  {
    key: "veterinario",
    label: "Veterinários",
    osm: [["amenity", "veterinary"]],
    overture: ["veterinarian"],
    cnae: ["7500"],
  },
  {
    key: "pet_shop",
    label: "Pet shops",
    osm: [["shop", "pet"], ["shop", "pet_grooming"]],
    overture: ["pet_store", "pet_groomer", "pet_services", "pet_boarding"],
    cnae: ["4789", "9609"],
  },
  {
    key: "farmacia",
    label: "Farmácias",
    osm: [["amenity", "pharmacy"], ["shop", "chemist"]],
    overture: ["pharmacy", "drugstore"],
    cnae: ["4771"],
  },
  {
    key: "imobiliaria",
    label: "Imobiliárias",
    osm: [["office", "estate_agent"], ["shop", "estate_agent"]],
    overture: ["real_estate_service", "real_estate_agent"],
    cnae: ["6821", "6822"],
  },
  {
    key: "advogado",
    label: "Advogados e escritórios de advocacia",
    osm: [["office", "lawyer"]],
    overture: ["lawyer", "legal_services"],
    cnae: ["6911"],
  },
  {
    key: "contador",
    label: "Contabilidade",
    osm: [["office", "accountant"], ["office", "tax_advisor"]],
    overture: ["accountant", "tax_services"],
    cnae: ["6920"],
  },
  {
    key: "oficina_mecanica",
    label: "Oficinas mecânicas",
    osm: [["shop", "car_repair"], ["shop", "tyres"]],
    overture: ["automotive_repair", "auto_body_shop", "auto_detailing", "tire_dealer_and_repair", "tire_shop"],
    cnae: ["4520"],
  },
  {
    key: "concessionaria",
    label: "Concessionárias e revendas",
    osm: [["shop", "car"], ["shop", "motorcycle"]],
    overture: ["car_dealer"],
    cnae: ["4511", "4541"],
  },
  {
    key: "autoescola",
    label: "Autoescolas",
    osm: [["amenity", "driving_school"]],
    overture: ["driving_school"],
    cnae: ["8599"],
  },
  {
    key: "escola",
    label: "Escolas e cursos",
    osm: [["amenity", "school"], ["amenity", "language_school"], ["amenity", "college"]],
    overture: ["school", "elementary_school", "private_school", "public_school", "high_school", "preschool", "language_school", "college_university"],
    cnae: ["8513", "8520", "8599"],
  },
  {
    key: "hotel",
    label: "Hotéis e pousadas",
    osm: [["tourism", "hotel"], ["tourism", "guest_house"], ["tourism", "hostel"]],
    overture: ["hotel", "hostel", "motel", "resort", "bed_and_breakfast"],
    cnae: ["5510"],
  },
  {
    key: "loja_roupa",
    label: "Lojas de roupa e calçados",
    osm: [["shop", "clothes"], ["shop", "shoes"], ["shop", "boutique"]],
    overture: ["clothing_store", "womens_clothing_store", "mens_clothing_store", "childrens_clothing_store", "boutique", "fashion", "shoe_store"],
    cnae: ["4781", "4782"],
  },
  {
    key: "otica",
    label: "Óticas",
    osm: [["shop", "optician"]],
    overture: ["eyewear_and_optician"],
    cnae: ["4774"],
  },
  {
    key: "material_construcao",
    label: "Material de construção",
    osm: [["shop", "doityourself"], ["shop", "hardware"], ["shop", "trade"]],
    overture: ["building_supply_store", "hardware_store"],
    cnae: ["4744"],
  },
  {
    key: "movelaria",
    label: "Móveis e marcenaria",
    osm: [["shop", "furniture"], ["craft", "carpenter"]],
    overture: ["furniture_store", "furniture_manufacturers", "carpenter"],
    cnae: ["3101", "4754"],
  },
  {
    key: "eletricista",
    label: "Elétrica e hidráulica",
    osm: [["craft", "electrician"], ["craft", "plumber"]],
    overture: ["electrician", "plumbing"],
    cnae: ["4321", "4322"],
  },
  {
    key: "energia_solar",
    label: "Energia solar",
    osm: [["craft", "photovoltaic"], ["shop", "energy"]],
    overture: ["solar_installation"],
    cnae: ["4321", "4322"],
  },
  {
    key: "grafica",
    label: "Gráficas e comunicação visual",
    osm: [["shop", "copyshop"], ["shop", "printer"], ["craft", "printer"]],
    overture: ["printing_services", "sign_making", "graphic_designer"],
    cnae: ["1813", "1822"],
  },
  {
    key: "floricultura",
    label: "Floriculturas",
    osm: [["shop", "florist"]],
    overture: ["florist", "flowers_and_gifts_shop"],
    cnae: ["4789"],
  },
  {
    key: "lavanderia",
    label: "Lavanderias",
    osm: [["shop", "laundry"], ["shop", "dry_cleaning"]],
    overture: ["laundromat", "dry_cleaning", "laundry_services"],
    cnae: ["9601"],
  },
  {
    key: "agencia_marketing",
    label: "Agências e marketing",
    osm: [["office", "advertising_agency"], ["office", "it"], ["office", "company"]],
    overture: ["marketing_agency", "advertising_agency", "marketing_consultant"],
    cnae: ["7311", "6201"],
  },
]);

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

/** A categoria, ou `null`. É a fronteira de confiança da querystring. */
function getCategory(key) {
  return BY_KEY.get(String(key || "").trim()) || null;
}

/** `true` se a key existe. Usado pelos guards antes de montar consulta. */
function isCategory(key) {
  return BY_KEY.has(String(key || "").trim());
}

/** Lista para a tela (só o que ela precisa desenhar). */
function listCategories() {
  return CATEGORIES.map((c) => ({ key: c.key, label: c.label }));
}

/**
 * Casa um CNAE (com ou sem máscara) com a categoria correspondente.
 *
 * Serve o caminho inverso: a empresa chegou pela Receita (sem passar pelo OSM)
 * e precisa de uma categoria para aparecer no filtro da tela. Sem isto, tudo
 * que vem do CNPJ cairia em "sem categoria" e ficaria invisível na busca — que
 * é a única coisa que a tela sabe fazer.
 */
function categoryFromCnae(cnae) {
  const digits = String(cnae || "").replace(/\D/g, "");
  if (digits.length < 4) return null;
  const prefix = digits.slice(0, 4);
  // A primeira que casar vence. A ordem do catálogo é a ordem de preferência —
  // por isso `restaurante` vem antes de `bar`, que dividem o 5611.
  const hit = CATEGORIES.find((c) => c.cnae.includes(prefix));
  return hit ? hit.key : null;
}

/**
 * Casa as tags cruas de um elemento do OSM com a nossa categoria.
 *
 * ⚠️ A ORDEM DO CATÁLOGO DECIDE O EMPATE, e ela não é alfabética por isso: um
 * mesmo ponto pode ser `amenity=cafe` + `shop=bakery`, e queremos "padaria".
 */
function categoryFromOsmTags(tags = {}) {
  for (const cat of CATEGORIES) {
    for (const [k, v] of cat.osm) {
      if (tags[k] === v) return cat.key;
    }
  }
  return null;
}

/**
 * A categoria do Overture vira uma das nossas 31.
 *
 * ⚠️ EXATO VENCE CURINGA, e sem essa ordem a mesma linha cai em dois lugares.
 * `restaurante` casa `*_restaurant` para cobrir as dezenas de variações que a
 * taxonomia tem (pizza_restaurant, japanese_restaurant, burger_restaurant…),
 * mas `fast_food_restaurant` é declarado em `bar` — que é onde a lanchonete
 * mora aqui, seguindo o que `amenity=fast_food` já fazia no OSM. Varrendo na
 * ordem das categorias, quem chegasse primeiro ganharia, e a classificação
 * passaria a depender da posição da entrada no catálogo.
 *
 * ⚠️ O CURINGA É SÓ `*` NA PONTA, de propósito: é sufixo/prefixo, não regex.
 * Padrão vindo de dado externo interpretado como regex é ReDoS esperando
 * acontecer, e aqui o ganho de expressividade seria zero.
 */
function categoryFromOvertureCategory(cat) {
  const c = String(cat || "").toLowerCase().trim();
  if (!c) return null;
  for (const entry of CATEGORIES) {
    if (entry.overture.includes(c)) return entry.key;
  }
  for (const entry of CATEGORIES) {
    for (const pat of entry.overture) {
      if (!pat.includes("*")) continue;
      if (pat.startsWith("*") && c.endsWith(pat.slice(1))) return entry.key;
      if (pat.endsWith("*") && c.startsWith(pat.slice(0, -1))) return entry.key;
    }
  }
  return null;
}

/**
 * O termo que a pessoa digitou aponta para alguma categoria?
 *
 * Casamento por PREFIXO dos dois lados, sobre o rótulo sem acento: "academ"
 * acha "Academias", "restaurante" acha "Restaurantes". É deliberadamente
 * simples — quem decide de verdade é o seletor da tela, que lista as
 * categorias; isto só existe para a caixa de busca livre não ficar muda.
 */
function guessCategory(term) {
  const t = String(term || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  if (t.length < 3) return null;
  const norm = (s) =>
    String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hit = CATEGORIES.find((c) => {
    const label = norm(c.label);
    return label.startsWith(t) || t.startsWith(norm(c.key)) || label.includes(t);
  });
  return hit ? hit.key : null;
}

module.exports = {
  CATEGORIES,
  getCategory,
  isCategory,
  listCategories,
  categoryFromCnae,
  categoryFromOsmTags,
  categoryFromOvertureCategory,
  guessCategory,
};
