// scripts/whatsapp-cloud-doctor.js
//
// Diagnóstico do lado da META: diz o que já está de pé para o WhatsApp oficial
// e o que falta, sem ninguém precisar caçar no painel.
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
//
// O W0 (verificação e app) é o item de maior lead time da migração e o único
// que não depende de código — e é justamente o que é difícil de conferir: a
// informação está espalhada por Business Settings, WhatsApp Manager e o painel
// de faturamento, e cada uma dessas telas mostra um pedaço. Errar aqui custa
// caro do jeito pior: o cadastro do número (W3) falha lá na frente com uma
// mensagem da Graph API que não diz o que fazer.
//
// ─── ELE SÓ LÊ ──────────────────────────────────────────────────────────────
//
// Nenhuma chamada deste script escreve nada: só GET. Rodar é seguro a qualquer
// momento, inclusive em produção.
//
// Uso:
//   META_SYSTEM_USER_TOKEN=... node scripts/whatsapp-cloud-doctor.js
//
// As ENVs podem vir do .env. O mínimo é o token; `META_WABA_ID` e
// `META_BUSINESS_ID` são descobertos sozinhos quando o token permite.

require("dotenv").config({ quiet: true });

const VERSION = String(process.env.META_GRAPH_VERSION || "").trim() || "v21.0";
const GRAPH = `https://graph.facebook.com/${VERSION}`;
const TOKEN = String(process.env.META_SYSTEM_USER_TOKEN || "").trim();

const OK = "  ✅";
const NO = "  ❌";
const HM = "  ⚠️ ";

let problems = 0;

function say(mark, text, detail) {
  if (mark === NO) problems++;
  console.log(`${mark} ${text}${detail ? `\n        ${detail}` : ""}`);
}

async function get(path) {
  const url = `${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(TOKEN)}`;
  try {
    const r = await fetch(url);
    const text = await r.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (r.status >= 400) {
      const e = data && data.error;
      return { error: (e && (e.error_user_msg || e.message)) || `HTTP ${r.status}`, status: r.status };
    }
    return { data };
  } catch (e) {
    return { error: `falha de rede: ${e.message}` };
  }
}

async function main() {
  console.log(`\nWhatsApp Cloud API — diagnóstico (Graph ${VERSION})\n${"─".repeat(58)}`);

  if (!TOKEN) {
    say(NO, "META_SYSTEM_USER_TOKEN ausente.", "Sem o token não dá para perguntar nada à Meta.");
    console.log("\nGere um System User token no Business Settings → Users → System Users,");
    console.log("com as permissões whatsapp_business_management e whatsapp_business_messaging.\n");
    process.exit(1);
  }

  // ── 1. O token vale, e o que ele pode ────────────────────────────────────
  const dbg = await get(`/debug_token?input_token=${encodeURIComponent(TOKEN)}`);
  if (dbg.error) {
    say(NO, "O token não foi aceito pela Meta.", dbg.error);
  } else {
    const d = dbg.data && dbg.data.data;
    const valid = d && d.is_valid;
    say(valid ? OK : NO, `Token ${valid ? "válido" : "INVÁLIDO"}.`);
    if (d) {
      // Token que expira é armadilha: a integração funciona por semanas e
      // morre sozinha num sábado. System User token permanente tem expira 0.
      const exp = Number(d.expires_at || 0);
      say(
        exp === 0 ? OK : HM,
        exp === 0
          ? "Token é permanente (não expira)."
          : `Token EXPIRA em ${new Date(exp * 1000).toLocaleString("pt-BR")}.`,
        exp === 0 ? "" : "Prefira um System User token permanente: este vai parar de funcionar sozinho."
      );
      const scopes = d.scopes || [];
      for (const needed of ["whatsapp_business_management", "whatsapp_business_messaging"]) {
        say(scopes.includes(needed) ? OK : NO, `Permissão ${needed}`, scopes.includes(needed) ? "" : "faltando no token");
      }
    }
  }

  // ── 2. O negócio está verificado? ────────────────────────────────────────
  let businessId = String(process.env.META_BUSINESS_ID || "").trim();
  if (!businessId) {
    const biz = await get("/me/businesses?fields=id,name,verification_status");
    const first = biz.data && biz.data.data && biz.data.data[0];
    if (first) businessId = first.id;
  }

  if (!businessId) {
    say(HM, "Não consegui descobrir o Business Portfolio pelo token.", "Informe META_BUSINESS_ID para conferir a verificação.");
  } else {
    const b = await get(`/${businessId}?fields=id,name,verification_status`);
    if (b.error) {
      say(HM, `Não consegui ler o portfólio ${businessId}.`, b.error);
    } else {
      const v = String(b.data.verification_status || "").toLowerCase();
      say(
        v === "verified" ? OK : NO,
        `Portfólio "${b.data.name}" — verificação: ${b.data.verification_status || "desconhecida"}`,
        v === "verified"
          ? ""
          : "O display name dos números só é aprovado com o negócio verificado."
      );
    }
  }

  // ── 3. Existe WABA? ──────────────────────────────────────────────────────
  let wabaId = String(process.env.META_WABA_ID || "").trim();
  if (!wabaId && businessId) {
    const w = await get(`/${businessId}/owned_whatsapp_business_accounts?fields=id,name`);
    const first = w.data && w.data.data && w.data.data[0];
    if (first) wabaId = first.id;
  }

  if (!wabaId) {
    say(NO, "Nenhum WhatsApp Business Account encontrado.", "Crie o WABA no WhatsApp Manager — é onde os números vão morar.");
  } else {
    const w = await get(`/${wabaId}?fields=id,name,currency,account_review_status,business_verification_status`);
    if (w.error) {
      say(NO, `Não consegui ler o WABA ${wabaId}.`, w.error);
    } else {
      say(OK, `WABA encontrado: ${w.data.name || wabaId} (${wabaId})`);
      const review = String(w.data.account_review_status || "").toUpperCase();
      say(
        review === "APPROVED" || !review ? OK : HM,
        `Revisão da conta: ${w.data.account_review_status || "n/d"}`
      );
      // ⚠️ O faturamento em BRL é obrigatório até 30/06/2027; antes disso a
      // conta pode estar em USD sem problema, mas vale saber em que está.
      if (w.data.currency) say(OK, `Moeda de faturamento: ${w.data.currency}`);
    }
  }

  // ── 4. Números cadastrados e quanto cabe ainda ───────────────────────────
  if (wabaId) {
    const n = await get(
      `/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,status,code_verification_status`
    );
    if (n.error) {
      say(HM, "Não consegui listar os números.", n.error);
    } else {
      const rows = (n.data && n.data.data) || [];
      say(OK, `Números cadastrados: ${rows.length}`);
      for (const p of rows) {
        const q = p.quality_rating ? ` · qualidade ${p.quality_rating}` : "";
        console.log(`        • ${p.display_phone_number || p.id} — ${p.verified_name || "sem nome"} — ${p.status || "?"}${q}`);
      }
      // O teto do modelo "tudo no nosso WABA" é o número de NÚMEROS: 2 no
      // começo, até 20 com verificação e uso. Passar disso só por ticket no
      // Direct Support — e é o gatilho da fase 2 (Tech Provider).
      if (rows.length >= 15) {
        say(HM, `${rows.length} números — perto do teto de 20.`, "Hora de abrir a fase 2 (Tech Provider).");
      }
    }
  }

  // ── 5. O webhook está inscrito? ──────────────────────────────────────────
  if (wabaId) {
    const s = await get(`/${wabaId}/subscribed_apps`);
    if (s.error) {
      say(HM, "Não consegui conferir a inscrição do webhook.", s.error);
    } else {
      const apps = (s.data && s.data.data) || [];
      say(
        apps.length > 0 ? OK : NO,
        `Apps inscritos nos webhooks do WABA: ${apps.length}`,
        apps.length > 0
          ? apps.map((a) => `        • ${(a.whatsapp_business_api_data && a.whatsapp_business_api_data.name) || a.id || "?"}`).join("\n")
          : "SEM ISTO NADA CHEGA — e a falha é silenciosa: conecta, parece certo, e a caixa fica vazia para sempre."
      );
    }
  }

  // ── 6. As ENVs que o backend vai precisar ────────────────────────────────
  console.log(`\n${"─".repeat(58)}\nENVs do backend:`);
  const envs = [
    ["META_APP_ID", process.env.META_APP_ID],
    ["META_APP_SECRET", process.env.META_APP_SECRET],
    ["META_SYSTEM_USER_TOKEN", TOKEN],
    ["META_WABA_ID", process.env.META_WABA_ID || wabaId],
    ["META_WEBHOOK_VERIFY_TOKEN", process.env.META_WEBHOOK_VERIFY_TOKEN],
    ["SECRET_BOX_KEY", process.env.SECRET_BOX_KEY],
  ];
  for (const [name, value] of envs) {
    const set = !!String(value || "").trim();
    // Segredo nunca é impresso: o diagnóstico diz SE existe, não QUAL é.
    say(set ? OK : NO, `${name}${set && name === "META_WABA_ID" ? ` = ${value}` : set ? " (definida)" : " — faltando"}`);
  }

  console.log(`\n${"─".repeat(58)}`);
  console.log(problems === 0 ? "Tudo pronto do lado da Meta.\n" : `${problems} item(ns) pendente(s).\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
