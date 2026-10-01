/**
 * Transforma a PRÉVIA do site da Pinkoracats em Loja de verdade (mig 271):
 * as 6 coleções do tema viram coleções da Loja da Taiz, e os 12 sets de
 * prévia viram produtos dela — em RASCUNHO.
 *
 * ── POR QUE RASCUNHO ──────────────────────────────────────────────────────────
 * Os nomes, preços e estoques da prévia foram INVENTADOS por nós para ocupar o
 * lugar (`products.mock.ts`). Um produto ativo é comprável no Mercado Pago —
 * publicar preço inventado seria cobrar por algo que talvez nem exista. Eles
 * nascem desligados: a Taiz troca foto, nome e preço e liga um por um. Até o
 * primeiro ser ligado, o site continua mostrando a prévia (com a faixa).
 *
 * ── O TEXTO ───────────────────────────────────────────────────────────────────
 * O produto da Loja tem UMA descrição. O tema lê três coisas dela, e é por isso
 * que ela é montada assim:
 *   1º parágrafo  → a linha curta (tagline) do card
 *   2º parágrafo  → a descrição
 *   linhas "• "   → os detalhes ("10 tips + cola e lixa")
 * A Taiz edita num campo só e o site continua entendendo.
 *
 * ⚠️ PASSA PELOS SERVICES, NUNCA POR SQL CRU — é a mesma porta da tela dela,
 * com a política de loja e a posse do perfil conferidas.
 *
 * Idempotente: coleção com o mesmo endereço e produto com o mesmo nome não são
 * recriados.
 *
 * Uso: node scripts/seed-pinkoracats-store.js
 */
require("dotenv").config();

const pool = require("../src/databases");
const ProductCollectionService = require("../src/services/ProductCollectionService");
const ProductCollectionStorage = require("../src/storages/ProductCollectionStorage");
const ProfileProductService = require("../src/services/ProfileProductService");
const ProfileProductStorage = require("../src/storages/ProfileProductStorage");

/** Taiz Herrera — usuário e perfil-conta (é ele o dono da Loja). */
const ID_USER = "d85185a4-6d69-4233-a107-d20921834f59";
const ID_PROFILE = "cd3abc4f-e743-4017-b13e-7c3e53593740";
/** "Beleza e Cosméticos". */
const CATEGORY = 11;

const COLLECTIONS = [
  { slug: "new-drop", name: "New Drop", kicker: "Drop 001",
    description: "As peças que acabaram de sair da bancada. Tiragem curta, sem reposição garantida." },
  { slug: "pink", name: "Pink", kicker: "Soft signal",
    description: "Rosa como acento, nunca como fundo: glitter fino, leite, cereja e brilho molhado." },
  { slug: "dark", name: "Dark", kicker: "Black glass",
    description: "Preto espelhado, cat eye profundo e acabamento vidro. Para quem quer a unha como joia escura." },
  { slug: "chrome", name: "Chrome", kicker: "Liquid metal",
    description: "Prata líquida, cromado espelho e reflexo que atravessa a peça quando a mão se move." },
  { slug: "charms", name: "Charms", kicker: "Hardware",
    description: "Pingentes, pérolas e peças metálicas aplicadas uma a uma — a unha como suporte de joalheria." },
  { slug: "custom", name: "Custom", kicker: "Sob encomenda",
    description: "Você traz a referência, a gente desenha o set. Formato, tamanho e acabamento combinados antes." },
];

const PRODUCTS = [
  ["Cherry Static", "new-drop", 8900, 6, true, "Cereja escura com estática rosa na ponta.",
    "Set de 10 tips amendoadas com base cereja profunda e uma interferência rosa que só aparece na luz.",
    ["10 tips + cola e lixa", "Formato amendoado médio", "Acabamento gel brilho molhado"]],
  ["Chrome Kitten", "chrome", 9900, 4, true, "Prata espelho com orelhinha em relevo.",
    "Stiletto em cromado espelho com um detalhe felino em relevo 3D na unha de destaque.",
    ["10 tips + cola e lixa", "Formato stiletto", "Pó cromado + relevo em gel"]],
  ["Black Mirror Tip", "dark", 7900, 9, false, "Preto vidro com francesinha espelhada.",
    "Bailarina preto vidro com a ponta em cromado prata — a francesinha virada do avesso.",
    ["10 tips + cola e lixa", "Formato bailarina", "Top coat vitrificado"]],
  ["Pink Voltage", "pink", 8400, 5, true, "Rosa elétrico com filete cromado.",
    "Quadradas curtas em rosa aurora com um filete de cromado rosa que corta a unha em diagonal.",
    ["10 tips + cola e lixa", "Formato quadrado curto", "Cromado rosa aplicado à mão"]],
  ["Liquid Pearl", "charms", 11900, 3, false, "Leite perolado com pérolas soltas.",
    "Base leitosa perolada com micro pérolas e um pingente metálico na unha do anelar.",
    ["10 tips + cola e lixa", "Formato amendoado longo", "Pérolas e charm aplicados"]],
  ["Holo Claw", "new-drop", 10900, 4, true, "Garra holográfica que muda de cor com a mão.",
    "Stiletto longo com efeito aurora holográfico: verde, rosa e azul conforme o ângulo.",
    ["10 tips + cola e lixa", "Formato stiletto longo", "Pigmento aurora"]],
  ["Midnight Cat Eye", "dark", 8900, 7, false, "Olho de gato meia-noite com fio violeta.",
    "Cat eye magnético em fundo preto, com a faixa de luz puxada em violeta no centro da unha.",
    ["10 tips + cola e lixa", "Formato amendoado", "Gel magnético"]],
  ["Sugar Glass", "pink", 7400, 10, false, "Rosa açúcar translúcido, efeito vitral.",
    "Bailarina translúcida rosa com um degradê de vidro que deixa a unha natural aparecer.",
    ["10 tips + cola e lixa", "Formato bailarina médio", "Gel jelly translúcido"]],
  ["Silver Whisker", "chrome", 9400, 5, false, "Bigode de gato em prata sobre preto.",
    "Quadradas pretas com traços finos em prata líquida desenhados um a um.",
    ["10 tips + cola e lixa", "Formato quadrado", "Linhas em prata líquida"]],
  ["Rose Circuit", "new-drop", 9900, 2, true, "Circuito rosa gravado em fundo vinho.",
    "Bailarina vinho com linhas de circuito em rosa neon e pontos cromados nas junções.",
    ["10 tips + cola e lixa", "Formato bailarina longo", "Desenho à mão livre"]],
  ["Velvet Noir", "dark", 8400, 8, false, "Veludo preto com reflexo vinho.",
    "Efeito veludo em preto profundo que acende em vinho quando a luz bate de lado.",
    ["10 tips + cola e lixa", "Formato quadrado médio", "Gel veludo"]],
  ["Custom Set", "custom", 14900, 99, false, "Seu set, desenhado a partir da sua referência.",
    "Você manda a referência, a gente combina formato, tamanho e acabamento e produz o set sob encomenda.",
    ["Briefing antes da produção", "Qualquer formato", "Prazo combinado no pedido"]],
];

async function main() {
  const user = { id_user: ID_USER };

  // ── coleções ──
  const existing = await ProductCollectionStorage.listByProfile(pool, ID_PROFILE);
  const bySlug = new Map(existing.map((c) => [c.slug, c]));
  let createdCols = 0;
  for (const c of COLLECTIONS) {
    if (bySlug.has(c.slug)) continue;
    const r = await ProductCollectionService.create(user, { id_profile: ID_PROFILE }, c);
    if (r.error) throw new Error(`coleção ${c.slug}: ${r.error}`);
    bySlug.set(c.slug, r.collection);
    createdCols += 1;
  }

  // ── produtos (rascunho) ──
  const current = await ProfileProductStorage.list(pool, ID_PROFILE);
  const names = new Set(current.map((p) => p.name.trim().toLowerCase()));
  let createdProducts = 0;
  for (const [name, col, price, stock, featured, tagline, description, details] of PRODUCTS) {
    if (names.has(name.toLowerCase())) continue;
    const r = await ProfileProductService.create(
      user,
      { id_profile: ID_PROFILE },
      {
        name,
        description: `${tagline}\n\n${description}\n\n${details.map((d) => `• ${d}`).join("\n")}`,
        price_amount: price,
        stock_quantity: stock,
        weight_grams: 50,
        height_cm: 2,
        width_cm: 10,
        length_cm: 15,
        id_product_category: CATEGORY,
        id_collection: Number(bySlug.get(col).id_collection),
        is_featured: featured,
        is_active: false,
      }
    );
    if (r.error) throw new Error(`produto ${name}: ${r.error}`);
    createdProducts += 1;
  }

  console.log(JSON.stringify({ collections_created: createdCols, products_created: createdProducts }));
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err.message);
    await pool.end();
    process.exit(1);
  });
