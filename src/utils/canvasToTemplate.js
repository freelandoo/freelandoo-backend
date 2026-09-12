// src/utils/canvasToTemplate.js
//
// Converte o site do CONSTRUTOR (o canvas de seções) no documento de um TEMA.
//
// ⚠️ ESTA CONVERSÃO É COM PERDA, E É POR ISSO QUE ELA DEVOLVE `warnings`.
// O canvas guarda blocos de texto livre; o tema guarda campos com papel
// ("o problema", "o que o serviço cobre", "quando chamar"). Traduzir um no
// outro exige LER a intenção de cada bloco, e em três lugares não há como
// saber com certeza:
//
//   1. QUAL BLOCO É QUAL. Os blocos de texto entram em ORDEM — o primeiro vira
//      o problema, o segundo o que o serviço cobre, o terceiro quando chamar.
//      Uma página montada em outra ordem converte trocado, e a página fica
//      correta na tela dizendo a coisa errada em cada lugar.
//   2. O ENDEREÇO E O TELEFONE são uma linha de texto só no canvas e são
//      campos separados no tema (rua, cidade, UF, CEP; o que se lê, o do
//      `tel:` e o do WhatsApp). Quebrá-los é regex sobre texto livre.
//   3. O DESENHO de cada serviço não existe no canvas.
//
// NADA É INVENTADO: o que não dá para extrair fica VAZIO, e o tema não desenha
// o bloco correspondente. Cada dedução entra em `warnings` com o que foi
// deduzido e de onde — é isso que faz a conversão ser uma proposta que alguém
// confere, e não uma afirmação silenciosa sobre o negócio de outra pessoa.
//
// ⚠️ E ELA NÃO GRAVA NADA. Quem grava é `ManagedSiteService.apply`, depois de
// alguém olhar. Converter e aplicar no mesmo gesto tiraria o único passo em que
// o erro de leitura acima ainda é barato.

"use strict";

const ART_BY_KEYWORD = [
  [/industr/i, "industrial"],
  [/limpeza|higien/i, "clean"],
  [/chapa|grelhad/i, "griddle"],
  [/instala/i, "install"],
  [/reforma|recupera|restaur/i, "refit"],
  [/conserto|reparo|manuten/i, "burner"],
];

/** A roda de desenhos, para quando nenhuma palavra-chave bate. */
const ART_CYCLE = ["burner", "refit", "industrial", "clean", "griddle", "install"];

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === "string" ? v.trim() : "");

/** Texto corrido → parágrafos. Linha em branco separa; a vazia não entra. */
function paragraphs(body) {
  return str(body)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Separa os marcadores do texto que vem antes deles.
 *
 * O canvas não tem lista: quem escreveu usou "•" (ou "-") no meio do parágrafo.
 * O tema tem `items`, que vira a lista com traço dourado — então os marcadores
 * saem do corpo e viram itens, e o que vinha antes vira a linha de apoio.
 */
function splitBullets(body) {
  const lines = str(body).split(/\n+/);
  const lead = [];
  const items = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^[•\-–—*]\s*(.+)$/);
    if (m) items.push(m[1].trim());
    else if (!items.length) lead.push(line);
    // ⚠️ Texto DEPOIS dos marcadores é descartado de propósito: ele não tem
    // lugar no tema (não é lead, não é item), e enfiá-lo no lead o faria
    // aparecer ANTES da lista que ele comentava.
  }
  return { lead: lead.join(" "), items };
}

/** `highlights` do canvas → os itens com título do tema. */
function itemsFromHighlights(highlights) {
  return arr(highlights)
    .map((h) => ({ title: str(h?.title), text: str(h?.description) }))
    .filter((it) => it.title || it.text);
}

/** A mensagem escrita no `?text=` de um link de WhatsApp. */
function messageFromWaUrl(url) {
  const u = str(url);
  const i = u.indexOf("text=");
  if (i === -1) return "";
  try {
    return decodeURIComponent(u.slice(i + 5).split("&")[0].replace(/\+/g, " "));
  } catch {
    return "";
  }
}

/**
 * O telefone que se LÊ, a partir dos dígitos do WhatsApp.
 *
 * ⚠️ SÓ para o formato brasileiro de celular com DDI (55 + DDD + 9 dígitos).
 * Fora dele devolve vazio em vez de arriscar: um número formatado errado é
 * pior do que nenhum, porque a pessoa liga para ele.
 */
function displayFromDigits(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  if (!/^55\d{11}$/.test(d)) return "";
  return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
}

/**
 * Quebra o endereço de uma linha só nos campos do tema.
 *
 * Só aceita o formato que o construtor produz — "Rua X — Cidade/UF — CEP
 * 00000-000". Qualquer outro devolve `null`, e aí a rua inteira fica no campo
 * `street`: um endereço que não coube é melhor mostrado inteiro do que
 * repartido errado, com a cidade num campo que diz UF.
 */
function splitAddress(address) {
  const a = str(address);
  if (!a) return null;
  const m = a.match(/^(.+?)\s+[—–-]\s+(.+?)\/([A-Za-z]{2})\s+[—–-]\s+CEP\s+(\d{5}-?\d{3})$/);
  if (!m) return null;
  return { street: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), postalCode: m[4] };
}

/**
 * O horário longo partido em "quando abre" e "quando não abre".
 *
 * A quebra é na primeira frase, que é como o construtor pede o campo
 * ("Segunda a sexta, 08h às 18h. Sábado e domingo: fechado."). Sem ponto, tudo
 * fica no longo e os dois curtos ficam vazios — o tema omite a linha em vez de
 * inventar um horário.
 */
function splitHours(hours) {
  const h = str(hours);
  if (!h) return { hoursHuman: "", hoursShort: "", closedHuman: "" };
  const i = h.indexOf(". ");
  if (i === -1) return { hoursHuman: h, hoursShort: h.length <= 40 ? h : "", closedHuman: "" };
  return {
    hoursHuman: h,
    hoursShort: h.slice(0, i).trim(),
    closedHuman: h.slice(i + 2).replace(/\.$/, "").trim(),
  };
}

const sectionsOf = (page) => arr(page?.sections).filter((s) => obj(s).kind);
const firstOf = (sections, kind) => sections.find((s) => s.kind === kind) || null;
const allOf = (sections, kind) => sections.filter((s) => s.kind === kind);

/** O destino `pagina:<slug>` de um link do canvas. */
function pageTarget(url) {
  const u = str(url);
  return u.startsWith("pagina:") ? u.slice(7) : "";
}

/**
 * Converte o documento do construtor no documento do tema `oficina-local`.
 *
 * @param {object} site   A linha do site (site_name, tagline, sections, pages).
 * @param {object} community  A comunidade, para o nome de reserva.
 * @returns {{ data: object, warnings: {code:string, detail:string}[] }}
 */
function deriveOficinaLocal(site, community) {
  const s = obj(site);
  const home = arr(s.sections).filter((x) => obj(x).kind);
  const pages = arr(s.pages).filter((p) => str(obj(p).slug));
  const warnings = [];
  const warn = (code, detail) => warnings.push({ code, detail });

  const heroHome = firstOf(home, "hero");
  const heroSlide = obj(arr(obj(heroHome).data?.slides)[0]);
  const contact = obj(firstOf(home, "contact")?.data);
  const areasHome = obj(firstOf(home, "areas")?.data);

  // ── quem é cidade e quem é serviço ────────────────────────────────────────
  //
  // ⚠️ NÃO É PALPITE: a seção de ÁREAS lista as cidades com o endereço de cada
  // uma (`pagina:<slug>`). A página apontada por ela É uma cidade; o resto é
  // serviço. Deduzir pelo nome ("parece nome de cidade") erraria no dia em que
  // um serviço se chamasse "Casa Branca".
  const cityMeta = new Map();
  for (const it of arr(areasHome.items)) {
    const slug = pageTarget(obj(it).url);
    if (slug) cityMeta.set(slug, obj(it));
  }
  if (!cityMeta.size && pages.length) {
    warn(
      "sem_areas",
      "A home não tem a seção de áreas atendidas, então nenhuma página foi tratada como cidade — todas viraram serviço."
    );
  }

  // ── os dados do negócio ───────────────────────────────────────────────────
  const whatsapp = str(contact.whatsapp).replace(/\D/g, "");
  const phoneDisplay = displayFromDigits(whatsapp);
  if (whatsapp && !phoneDisplay) {
    warn(
      "telefone_formato",
      `O número ${whatsapp} não tem o formato brasileiro de celular, então o telefone que aparece na tela ficou vazio — preencha à mão se quiser o botão de ligar.`
    );
  }

  const addr = splitAddress(contact.address);
  if (str(contact.address) && !addr) {
    warn(
      "endereco_formato",
      `O endereço "${str(contact.address)}" não está no formato "Rua — Cidade/UF — CEP 00000-000", então ele foi mantido inteiro no campo da rua, sem cidade, UF nem CEP separados.`
    );
  }

  const hours = splitHours(contact.hours);
  if (hours.hoursHuman && !hours.hoursShort) {
    warn("horario_curto", "Não deu para tirar uma versão curta do horário; a linha curta do banner vai sair sem ele.");
  }

  const business = {
    name: str(s.site_name) || str(obj(community).display_name),
    legalName: "",
    tagline: str(s.tagline),
    subTagline: "",
    // ⚠️ O NOME DA PESSOA não existe em campo nenhum do canvas. Tirá-lo do nome
    // do negócio ("Ricardo Fogões" → "Ricardo") acerta aqui e escreve "Padaria"
    // na próxima — e o tema usa isso em "Fale com {owner}". Vazio, ele diz
    // "Fale com a gente", que é sempre verdade.
    owner: "",
    heroPhoto: str(heroSlide.imageUrl),
    phoneDisplay,
    phoneE164: whatsapp ? `+${whatsapp}` : "",
    whatsappNumber: whatsapp,
    street: addr ? addr.street : str(contact.address),
    city: addr ? addr.city : "",
    state: addr ? addr.state : "",
    stateFull: "",
    postalCode: addr ? addr.postalCode : "",
    country: "BR",
    geo: null,
    ...hours,
    payments: [],
  };

  if (!business.heroPhoto) {
    warn("sem_foto", "A home não tem foto no banner, então o site pronto vai abrir só com a tipografia.");
  }

  // ── serviços e cidades ────────────────────────────────────────────────────
  const services = [];
  const cities = [];
  let artIndex = 0;

  for (const page of pages) {
    const slug = str(page.slug);
    const secs = sectionsOf(page);
    const hero = obj(firstOf(secs, "hero")?.data);
    const slide = obj(arr(hero.slides)[0]);
    const abouts = allOf(secs, "about");
    const faq = arr(obj(firstOf(secs, "faq")?.data).items)
      .map((f) => ({ q: str(obj(f).question), a: str(obj(f).answer) }))
      .filter((f) => f.q && f.a);

    const h1 = str(slide.headline);
    const intro = str(slide.subheadline) ? [str(slide.subheadline)] : [];
    const waMessage = messageFromWaUrl(slide.ctaUrl);

    if (!page.enabled) {
      warn(
        "pagina_desligada",
        `A página "${str(page.title) || slug}" está DESLIGADA no construtor e hoje não responde. No site pronto não existe desligar: ela passa a estar no ar.`
      );
    }

    if (cityMeta.has(slug)) {
      const meta = cityMeta.get(slug);
      const [ctx, focus] = abouts;
      const focusData = obj(focus?.data);
      const name = str(meta.name) || str(page.title);
      cities.push({
        slug,
        name,
        // "em Aguaí" — a preposição é a mesma para nome de cidade em português.
        prep: name ? `em ${name}` : "",
        uf: str(meta.uf),
        // A sede é a cidade do endereço do negócio, não a primeira da lista:
        // a ordem é de quem montou o menu e não diz de onde o serviço sai.
        isBase: !!business.city && name.toLowerCase() === business.city.toLowerCase(),
        h1,
        metaTitle: "",
        metaDescription: str(page.subtitle),
        eyebrow: "",
        cardText: str(meta.note),
        intro,
        context: {
          title: str(ctx?.title),
          body: paragraphs(obj(ctx?.data).body),
        },
        focus: {
          title: str(focus?.title),
          lead: paragraphs(focusData.body)[0] || "",
          items: itemsFromHighlights(focusData.highlights),
        },
        faq,
        waMessage,
      });
      if (abouts.length > 2) {
        warn(
          "cidade_blocos_extras",
          `A página "${name}" tem ${abouts.length} blocos de texto e o tema de cidade usa dois (panorama e atendimento). Os demais ficaram de fora.`
        );
      }
      continue;
    }

    // ── serviço ──
    const [problem, covers, signs] = abouts;
    const coversData = obj(covers?.data);
    const signsSplit = splitBullets(obj(signs?.data).body);
    const label = str(page.title) || slug;

    const art =
      (ART_BY_KEYWORD.find(([re]) => re.test(`${slug} ${label}`)) || [])[1] ||
      ART_CYCLE[artIndex++ % ART_CYCLE.length];

    services.push({
      slug,
      label,
      h1,
      metaTitle: "",
      metaDescription: str(page.subtitle),
      eyebrow: "",
      cardText: str(page.subtitle),
      art,
      photo: "",
      waMessage,
      intro,
      problem: { title: str(problem?.title), body: paragraphs(obj(problem?.data).body) },
      covers: {
        title: str(covers?.title),
        body: paragraphs(coversData.body),
        items: itemsFromHighlights(coversData.highlights),
      },
      signs: {
        title: str(signs?.title),
        lead: signsSplit.lead,
        items: signsSplit.items,
      },
      faq,
      // "Veja também" sai do bloco de chamada da página, que é onde quem montou
      // escolheu para onde mandar. O tema ignora ponteiro que não existe.
      related: allOf(secs, "cta")
        .map((c) => pageTarget(obj(c.data).ctaUrl))
        .filter(Boolean),
    });

    if (abouts.length && abouts.length !== 3) {
      warn(
        "servico_blocos",
        `A página "${label}" tem ${abouts.length} bloco(s) de texto; o tema de serviço espera três, na ordem: o problema, o que o serviço cobre e quando chamar. Confira se cada um caiu no lugar certo.`
      );
    }
  }

  if (services.length) {
    warn(
      "desenho_automatico",
      "O desenho de cada serviço foi escolhido pelo nome do serviço — confira se combina, ou troque depois."
    );
  }

  // ── o resto da home ───────────────────────────────────────────────────────
  const reviews = arr(obj(firstOf(home, "testimonials")?.data).items)
    .map((r) => ({ quote: str(obj(r).text), source: str(obj(r).name) }))
    .filter((r) => r.quote && r.source);

  const faq = arr(obj(firstOf(home, "faq")?.data).items)
    .map((f) => ({ q: str(obj(f).question), a: str(obj(f).answer) }))
    .filter((f) => f.q && f.a);

  return {
    data: {
      business,
      services,
      cities,
      reviews,
      faq,
      googleProfileUrl: "",
      waDefault: messageFromWaUrl(heroSlide.ctaUrl),
    },
    warnings,
  };
}

/** Os conversores por tema. Tema novo que queira conversão entra aqui. */
const DERIVERS = Object.freeze({ "oficina-local": deriveOficinaLocal });

/**
 * Converte, quando o tema sabe ser convertido.
 *
 * Tema sem conversor devolve documento VAZIO e diz isso — o admin monta o
 * conteúdo à mão, em vez de receber um documento montado por adivinhação.
 */
function deriveTemplateData(template, site, community) {
  const fn = DERIVERS[template];
  if (!fn) {
    return {
      data: {},
      warnings: [
        {
          code: "sem_conversor",
          detail: `O tema "${template}" não sabe ler o site do construtor, então o conteúdo começa vazio.`,
        },
      ],
    };
  }
  return fn(site, community);
}

module.exports = {
  deriveTemplateData,
  deriveOficinaLocal,
  // exportados para o teste: são as três deduções que podem errar
  splitAddress,
  splitHours,
  splitBullets,
  displayFromDigits,
  messageFromWaUrl,
};
