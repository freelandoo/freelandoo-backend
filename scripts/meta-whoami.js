// scripts/meta-whoami.js
//
// "De QUAL conta Meta é este app / este token?"
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
//
// A Freelandoo vai passar a usar a WhatsApp Cloud API, e a pergunta prática é
// se dá para reaproveitar um app/portfólio que já existe e já tem documentos
// validados (o do Casa Views, que puxa Instagram). Só que "qual conta é essa?"
// não está escrito em lugar nenhum do código: as credenciais moram no Railway
// daquele projeto, e o painel da Meta mostra a resposta espalhada por três
// telas.
//
// Este script pergunta à própria Meta e responde em uma.
//
// ─── SÓ LÊ, E NÃO IMPRIME SEGREDO ───────────────────────────────────────────
//
// Todas as chamadas são GET. O token nunca aparece na saída — o que se imprime
// é a IDENTIDADE que ele revela (app, pessoa, negócio), nunca a credencial.
//
// Uso, em qualquer um dos dois modos:
//
//   # 1) com um token (o do Casa Views, por exemplo)
//   META_WHOAMI_TOKEN=<token> node scripts/meta-whoami.js
//
//   # 2) com as credenciais do app (monta o app access token sozinho)
//   FB_APP_ID=<id> FB_APP_SECRET=<secret> node scripts/meta-whoami.js
//
// Também aceita META_SYSTEM_USER_TOKEN / META_APP_ID / META_APP_SECRET, para
// rodar direto contra o app novo do WhatsApp.

require("dotenv").config({ quiet: true });

const VERSION = String(process.env.META_GRAPH_VERSION || "").trim() || "v21.0";
const GRAPH = `https://graph.facebook.com/${VERSION}`;

const USER_TOKEN =
  String(process.env.META_WHOAMI_TOKEN || "").trim() ||
  String(process.env.META_SYSTEM_USER_TOKEN || "").trim() ||
  String(process.env.GRAPH_ACCESS_TOKEN || "").trim() ||
  String(process.env.ACCESS_TOKEN || "").trim();

const APP_ID = String(process.env.FB_APP_ID || process.env.META_APP_ID || "").trim();
const APP_SECRET = String(process.env.FB_APP_SECRET || process.env.META_APP_SECRET || "").trim();

/** App access token: identifica o APP, não uma pessoa. */
const APP_TOKEN = APP_ID && APP_SECRET ? `${APP_ID}|${APP_SECRET}` : "";

async function get(path, token) {
  const sep = path.includes("?") ? "&" : "?";
  try {
    const r = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`);
    const text = await r.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (r.status >= 400) {
      const e = data && data.error;
      return { error: (e && (e.error_user_msg || e.message)) || `HTTP ${r.status}` };
    }
    return { data };
  } catch (e) {
    return { error: `falha de rede: ${e.message}` };
  }
}

function line(label, value) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

async function main() {
  console.log(`\nMeta — quem é esta conta? (Graph ${VERSION})\n${"─".repeat(60)}`);

  if (!USER_TOKEN && !APP_TOKEN) {
    console.log("\nNenhuma credencial informada.\n");
    console.log("Rode de um dos dois jeitos:");
    console.log("  META_WHOAMI_TOKEN=<token>              node scripts/meta-whoami.js");
    console.log("  FB_APP_ID=<id> FB_APP_SECRET=<secret>  node scripts/meta-whoami.js\n");
    console.log("As duas credenciais do Casa Views estão no Railway daquele projeto,");
    console.log("nas variáveis FB_APP_ID / FB_APP_SECRET (o token fica em tb_app_token).\n");
    process.exit(1);
  }

  // ── O APP ────────────────────────────────────────────────────────────────
  // `debug_token` é o único que diz de QUAL app o token é — e é justamente o
  // que interessa quando se está tentando descobrir se o app existente serve.
  if (USER_TOKEN) {
    const verifier = APP_TOKEN || USER_TOKEN;
    const dbg = await get(`/debug_token?input_token=${encodeURIComponent(USER_TOKEN)}`, verifier);
    if (dbg.error) {
      console.log(`\n⚠️  Não consegui inspecionar o token: ${dbg.error}`);
    } else {
      const d = (dbg.data && dbg.data.data) || {};
      console.log("\nTOKEN");
      line("válido:", d.is_valid ? "sim" : "NÃO");
      line("app_id:", d.app_id || "—");
      line("app:", d.application || "—");
      line("tipo:", d.type || "—");
      line(
        "expira:",
        Number(d.expires_at || 0) === 0
          ? "nunca (permanente)"
          : new Date(Number(d.expires_at) * 1000).toLocaleString("pt-BR")
      );
      line("dono (user_id):", d.user_id || "—");
      if (Array.isArray(d.scopes)) line("permissões:", d.scopes.join(", ") || "—");
    }
  }

  if (APP_TOKEN) {
    const app = await get(`/${APP_ID}?fields=id,name,category,link`, APP_TOKEN);
    if (app.error) {
      console.log(`\n⚠️  Não consegui ler o app ${APP_ID}: ${app.error}`);
    } else {
      console.log("\nAPP");
      line("id:", app.data.id);
      line("nome:", app.data.name || "—");
      if (app.data.category) line("categoria:", app.data.category);
    }
  }

  // ── A PESSOA ─────────────────────────────────────────────────────────────
  if (USER_TOKEN) {
    // ⚠️ `email` só volta se o token carregar a permissão `email` — um token de
    // Instagram Business normalmente NÃO carrega. Ausência aqui não é defeito.
    const me = await get("/me?fields=id,name,email", USER_TOKEN);
    console.log("\nCONTA DONA DO TOKEN");
    if (me.error) {
      line("—", me.error);
    } else {
      line("id:", me.data.id || "—");
      line("nome:", me.data.name || "—");
      line(
        "email:",
        me.data.email ||
          "não exposto (o token não tem a permissão `email` — normal em token de IG/WhatsApp)"
      );
    }

    // ── OS NEGÓCIOS (é aqui que mora a verificação de documentos) ───────────
    const biz = await get("/me/businesses?fields=id,name,verification_status,created_time", USER_TOKEN);
    console.log("\nBUSINESS PORTFOLIOS ACESSÍVEIS");
    if (biz.error) {
      line("—", biz.error);
    } else {
      const rows = (biz.data && biz.data.data) || [];
      if (rows.length === 0) line("—", "nenhum (token sem acesso a portfólio)");
      for (const b of rows) {
        const v = String(b.verification_status || "").toLowerCase();
        console.log(`  • ${b.name} (${b.id}) — ${v === "verified" ? "✅ VERIFICADO" : `⚠️  ${b.verification_status || "não verificado"}`}`);
      }
      // É este o achado que interessa à migração do WhatsApp: um portfólio já
      // verificado economiza o item de maior lead time do W0.
      const verified = rows.filter((b) => String(b.verification_status).toLowerCase() === "verified");
      if (verified.length) {
        console.log(`\n  → ${verified.length} portfólio(s) já verificado(s). O WABA do WhatsApp`);
        console.log("    deve nascer DENTRO de um deles: o display name dos números só é");
        console.log("    aprovado com o negócio verificado.");
      }
    }

    // ── CONTAS DE INSTAGRAM (confirma que é mesmo o app do Casa Views) ──────
    const pages = await get("/me/accounts?fields=id,name,instagram_business_account{id,username}", USER_TOKEN);
    if (!pages.error) {
      const rows = (pages.data && pages.data.data) || [];
      if (rows.length) {
        console.log("\nPÁGINAS / INSTAGRAM LIGADOS");
        for (const p of rows) {
          const ig = p.instagram_business_account;
          console.log(`  • ${p.name} (${p.id})${ig ? ` → @${ig.username || ig.id}` : ""}`);
        }
      }
    }
  }

  console.log(`\n${"─".repeat(60)}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
