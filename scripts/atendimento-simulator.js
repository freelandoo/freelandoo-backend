// scripts/atendimento-simulator.js
// Simulador de software de atendimento para teste e2e da API de Atendimento:
// registra webhook local, valida HMAC e responde automaticamente cada
// message.received. Uso:
//   FLND_TOKEN=flnd_atd_xxx [BACKEND_URL=http://localhost:3000] [PORT=4545] \
//     node scripts/atendimento-simulator.js
// O backend local precisa de ALLOW_INSECURE_WEBHOOK=1 pra aceitar http://localhost.
const http = require("http");
const crypto = require("crypto");

const TOKEN = process.env.FLND_TOKEN;
const BACKEND = (process.env.BACKEND_URL || "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.PORT) || 4545;

if (!TOKEN || !TOKEN.startsWith("flnd_atd_")) {
  console.error("Defina FLND_TOKEN=flnd_atd_... (gere em /mensagens → Conectar atendimento)");
  process.exit(1);
}

let webhookSecret = null;

async function api(method, path, body) {
  const res = await fetch(`${BACKEND}/ext/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${data?.error || "?"}`);
  return data;
}

function validSignature(headers, rawBody) {
  const ts = headers["x-freelandoo-timestamp"];
  const sig = headers["x-freelandoo-signature"] || "";
  if (!ts || !sig || !webhookSecret) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", webhookSecret).update(`${ts}.${rawBody}`, "utf8").digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/hook") {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", async () => {
    res.writeHead(200).end("ok"); // responde rápido; processa depois
    if (!validSignature(req.headers, raw)) {
      console.warn("⚠ webhook com assinatura INVÁLIDA — ignorado");
      return;
    }
    try {
      const event = JSON.parse(raw);
      if (event.event !== "message.received") return;
      const convId = event.conversation?.id;
      const from = event.message?.sender?.display_name || event.message?.sender?.username || "cliente";
      console.log(`📩 [${convId}] ${from}: ${event.message?.body}`);
      const reply = await api("POST", `/conversations/${convId}/messages`, {
        body: `Recebido! (resposta automática do simulador) Você disse: "${String(event.message?.body || "").slice(0, 100)}"`,
      });
      console.log(`🤖 respondido em ${convId} (id_message ${reply?.message?.id_message})`);
    } catch (err) {
      console.error("erro processando webhook:", err.message);
    }
  });
});

(async () => {
  const me = await api("GET", "/me");
  console.log(`✔ token ok — conexão "${me.connection?.name}" do user @${me.user?.username}`);
  const wh = await api("POST", "/webhook", { url: `http://localhost:${PORT}/hook` });
  webhookSecret = wh.webhook_secret;
  console.log(`✔ webhook registrado: ${wh.webhook_url}`);
  const convs = await api("GET", "/conversations?limit=10");
  console.log(`✔ ${convs.items?.length ?? 0} conversas no escopo:`);
  for (const c of convs.items || []) {
    console.log(`   ${c.id} [${c.type}] ${c.counterpart?.display_name || c.counterpart?.username || ""} — "${c.last_message_preview || ""}"`);
  }
  server.listen(PORT, () => {
    console.log(`👂 aguardando webhooks em http://localhost:${PORT}/hook — mande uma mensagem pra conta no site`);
  });
})().catch((err) => {
  console.error("falha na inicialização:", err.message);
  process.exit(1);
});
