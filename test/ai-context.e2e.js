/**
 * O DOSSIÊ (AiContextService) contra dados REAIS de produção.
 *
 * ⚠️ SOMENTE LEITURA. Este arquivo não abre transação porque não escreve nada:
 * o `build()` só faz SELECT. Não há COMMIT, não há INSERT, não há UPDATE.
 *
 * ─── POR QUE CONTRA DADOS REAIS ─────────────────────────────────────────────
 *
 * O dossiê é montado a partir da projeção da API de Dados, e o defeito que ele
 * pode ter é NOME DE CAMPO: `display_name` virou `name`, `profession` virou
 * `profession_name`. Nada disso quebra — o template só imprime `undefined` ou
 * pula a linha, e o atendente responde sem saber o nome do negócio. Um dublê
 * com os campos que eu ACHO que existem repetiria o meu erro e diria "ok".
 *
 * ─── O DEFEITO PRINCIPAL ────────────────────────────────────────────────────
 *
 * Serviço SOB ORÇAMENTO (mig 239) tem `price_amount = 0`. Formatado como moeda
 * vira "R$ 0,00" e o atendente ANUNCIA DE GRAÇA o que ia ser orçado — para um
 * cliente, por escrito, com o nome do negócio em cima. É promessa comercial,
 * não bug de tela.
 *
 * A base de conhecimento é DUBLADA aqui (a mig 253 ainda não subiu para
 * produção). Mesmo recurso do `test:spaces`, que dubla a FIPE por require.cache.
 */
require("dotenv").config();
const path = require("path");
const { Client } = require("pg");

// ⚠️ ANTES de qualquer require que carregue o pool do app (src/databases).
//
// O `sslmode=require` da connection string VENCE o objeto `ssl` do pg e a
// conexão morre com "self-signed certificate in certificate chain" no proxy do
// Railway. O service usa o pool do app, não o Client deste arquivo — então
// normalizar só a URL local não bastaria. Mesma lição já paga na suíte da 246.
if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  u.searchParams.set("sslmode", "no-verify");
  process.env.DATABASE_URL = u.toString();
}

const BE = path.join(__dirname, "..");

// ⚠️ O dublê entra ANTES do require do service — depois, o service já teria
// capturado a referência do módulo real.
const knowledgePath = require.resolve(path.join(BE, "src/storages/AiKnowledgeStorage"));
require.cache[knowledgePath] = {
  id: knowledgePath,
  filename: knowledgePath,
  loaded: true,
  exports: {
    listActiveContent: async () => [
      { id_knowledge: 1, source: "text", title: "Horario", content: "Atendemos de segunda a sabado, 9h as 19h.", char_count: 41 },
    ],
  },
};

const AiContextService = require(path.join(BE, "src/services/AiContextService"));

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond === true) {
    pass++;
    console.log("  ok  " + name);
  } else if (cond === false) {
    fail++;
    console.log("FAIL  " + name + (extra ? " -> " + extra : ""));
  } else {
    fail++;
    console.log("FAIL  " + name + " -> assercao nao-booleana (" + typeof cond + ")");
  }
}

(async () => {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete("sslmode");
  const c = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await c.connect();

  try {
    /* ─── 1. o caso do preço sob orçamento ─────────────────────────────────── */
    const sobOrcamento = (
      await c.query(
        `SELECT p.id_user, u.username, COUNT(*)::int n
           FROM public.tb_profile_service s
           JOIN public.tb_profile p ON p.id_profile = s.id_profile
           JOIN public.tb_user u ON u.id_user = p.id_user
          WHERE s.is_active AND s.deleted_at IS NULL AND s.price_on_request
          GROUP BY p.id_user, u.username
          ORDER BY n DESC LIMIT 1`
      )
    ).rows[0];

    if (!sobOrcamento) {
      console.log("  --  nenhum servico sob orcamento em producao; caso pulado");
    } else {
      const d = await AiContextService.build(sobOrcamento.id_user);
      check("o dossie do vendedor sob orcamento foi montado", d.chars > 0, String(d.chars));
      check(
        "servico sob orcamento aparece como 'sob orcamento'",
        /sob orçamento/i.test(d.text),
        d.parts.servicos?.slice(0, 200)
      );
      // ⚠️ A ASSERÇÃO QUE IMPORTA: nenhum "R$ 0,00" no dossie deste vendedor.
      check(
        "o dossie NAO contem 'R$ 0,00' (nao anuncia de graca)",
        !/R\$\s*0,00/.test(d.text),
        (d.text.match(/.{0,60}R\$\s*0,00.{0,60}/) || [""])[0]
      );
      check("o nome de quem atende foi resolvido", !/undefined/.test(d.text), "ha 'undefined' no dossie");
    }

    /* ─── 2. o caso do preço de verdade ────────────────────────────────────── */
    const comPreco = (
      await c.query(
        `SELECT p.id_user, u.username, MAX(s.price_amount)::int maior
           FROM public.tb_profile_service s
           JOIN public.tb_profile p ON p.id_profile = s.id_profile
           JOIN public.tb_user u ON u.id_user = p.id_user
          WHERE s.is_active AND s.deleted_at IS NULL AND NOT s.price_on_request
            AND s.price_amount > 0
          GROUP BY p.id_user, u.username
          ORDER BY COUNT(*) DESC LIMIT 1`
      )
    ).rows[0];

    if (!comPreco) {
      console.log("  --  nenhum servico com preco em producao; caso pulado");
    } else {
      const d = await AiContextService.build(comPreco.id_user);
      check("o dossie do vendedor com preco foi montado", d.chars > 0, String(d.chars));
      check("o preco sai formatado em reais", /R\$\s*\d/.test(d.text), d.parts.servicos?.slice(0, 200));
      // ⚠️ CENTAVOS CRUS: um `price_amount` de 4000 impresso solto viraria
      // "4000" no texto e o atendente cobraria quatro mil reais por um corte.
      const centavosCrus = new RegExp(`\\b${comPreco.maior}\\b(?!\\s*min)`);
      check(
        "o valor em CENTAVOS nao aparece cru no dossie",
        !centavosCrus.test(d.parts.servicos || ""),
        String(comPreco.maior)
      );
      check("o nome de quem atende foi resolvido", !/undefined/.test(d.text));
      check("a base de conhecimento (dublada) entrou no dossie", /9h as 19h/.test(d.text));
      check(
        "a base de conhecimento vem por ULTIMO (mais perto da pergunta)",
        d.text.lastIndexOf("DONO ESCREVEU") > d.text.indexOf("SERVIÇOS"),
        "ordem trocada"
      );
    }

    /* ─── 3. o site publicado ──────────────────────────────────────────────── */
    const comSite = (
      await c.query(
        `SELECT p.id_user, u.username, s.site_name
           FROM public.tb_community_site s
           JOIN public.tb_profile p ON p.id_profile = s.id_profile
           JOIN public.tb_user u ON u.id_user = p.id_user
          WHERE s.is_published LIMIT 1`
      )
    ).rows[0];

    if (!comSite) {
      console.log("  --  nenhum site publicado em producao; caso pulado");
    } else {
      const d = await AiContextService.build(comSite.id_user);
      check("o site publicado entra no dossie", /O QUE O SITE PUBLICADO DIZ/.test(d.text), String(d.chars));
      // Cor e endereço de arquivo não respondem pergunta de cliente e custam token.
      check("cor hexadecimal nao vaza para o dossie", !/#[0-9a-fA-F]{6}\b/.test(d.parts.site || ""));
      check("URL de arquivo nao vaza para o dossie", !/https?:\/\//.test(d.parts.site || ""));
    }

    /* ─── 4. rascunho NAO entra ────────────────────────────────────────────── */
    const soRascunho = (
      await c.query(
        `SELECT p.id_user
           FROM public.tb_community_site s
           JOIN public.tb_profile p ON p.id_profile = s.id_profile
          WHERE s.is_published = FALSE
            AND NOT EXISTS (
              SELECT 1 FROM public.tb_community_site s2
               JOIN public.tb_profile p2 ON p2.id_profile = s2.id_profile
              WHERE p2.id_user = p.id_user AND s2.is_published
            )
          LIMIT 1`
      )
    ).rows[0];

    if (!soRascunho) {
      console.log("  --  ninguem com APENAS rascunho de site; caso pulado");
    } else {
      const d = await AiContextService.build(soRascunho.id_user);
      check(
        "site em RASCUNHO nao entra no dossie",
        !/O QUE O SITE PUBLICADO DIZ/.test(d.text),
        "rascunho vazou"
      );
    }

    /* ─── 5. conta vazia nao quebra ────────────────────────────────────────── */
    const vazia = (
      await c.query(
        `SELECT u.id_user FROM public.tb_user u
          WHERE NOT EXISTS (SELECT 1 FROM public.tb_profile_service s
                             JOIN public.tb_profile p ON p.id_profile=s.id_profile
                            WHERE p.id_user=u.id_user)
          LIMIT 1`
      )
    ).rows[0];
    if (vazia) {
      const d = await AiContextService.build(vazia.id_user);
      check("conta sem servico monta dossie sem quebrar", typeof d.text === "string", typeof d.text);
      check("e o dossie dela nao inventa secao de servicos", !/## SERVIÇOS/.test(d.text));
    }
  } catch (e) {
    fail++;
    console.log("\nERRO NAO ESPERADO:", e.message);
    console.log(e.stack);
  }

  await c.end();
  console.log(`\n${pass}/${pass + fail} passaram` + (fail ? ` — ${fail} FALHARAM` : ""));
  process.exit(fail ? 1 : 0);
})();
