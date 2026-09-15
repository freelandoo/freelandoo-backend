// scripts/whatsapp-adopt-number.js
//
// Liga um número que JÁ existe no WABA a uma conta da Freelandoo.
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
//
// O caminho normal (W3) é a tela: `cloudAddNumber` cria o número no WABA e
// `cloudVerifyCode` o registra. Mas um número pode nascer FORA desse caminho —
// foi o caso do primeiro, cadastrado à mão no painel da Meta porque o botão
// "Registrar" do painel novo estava com bug (`field_exception` na mutação
// `register_devx_phone_number`).
//
// Nesse estado o número está de pé na Meta e ÓRFÃO aqui: sem linha em
// `tb_whatsapp_instance`, o webhook recebe a mensagem e a DESCARTA, porque
// "instância desconhecida é IGNORADA — nunca atribuída a alguém" (mig 223).
// O sintoma é o pior possível: tudo parece certo e a caixa fica vazia.
//
// ─── POR QUE NÃO APAGAR E REFAZER PELA TELA ─────────────────────────────────
//
// Porque o PIN de verificação em duas etapas é DERIVADO do `phone_number_id`
// (`deriveTwoStepPin`), mas a Meta o guarda no NÚMERO. Recriar dá um
// `phone_number_id` novo → PIN derivado diferente → e a Meta continua exigindo
// o antigo. O número ficaria travado por 7 dias, que é o prazo de limpeza.
//
// ─── ELE NÃO INVENTA ESTADO ─────────────────────────────────────────────────
//
// Antes de gravar, pergunta à Meta como o número está. Só adota quem está
// `CONNECTED` — marcar "conectado" aqui um número que a Meta não registrou
// deixaria a tela mentindo, e o erro só apareceria quando alguém tentasse
// responder um cliente.
//
// Idempotente: rodar de novo não duplica (o upsert é por `id_user`).
//
// Uso:
//   node scripts/whatsapp-adopt-number.js <@username|id_user> <phone_number_id>
//
// Precisa de DATABASE_URL e das ENVs da Meta (lê o .env e o .env.whatsapp.local).

require("dotenv").config({ quiet: true });
require("dotenv").config({ path: ".env.whatsapp.local", override: false, quiet: true });

const { Client } = require("pg");
const WhatsappStorage = require("../src/storages/WhatsappStorage");

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v21.0"}`;

async function metaNumber(ref) {
  const token = String(process.env.META_SYSTEM_USER_TOKEN || "").trim();
  if (!token) throw new Error("META_SYSTEM_USER_TOKEN ausente.");
  const url = `${GRAPH}/${ref}?fields=display_phone_number,status,code_verification_status,quality_rating&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.error) throw new Error(`Meta: ${j.error.message}`);
  return j;
}

async function resolveUser(conn, who) {
  const key = String(who || "").replace(/^@/, "").trim();
  if (!key) throw new Error("Informe o @username ou o id_user.");
  // UUID? procura por id; senão por username.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
  const r = await conn.query(
    isUuid
      ? "SELECT id_user, username FROM public.tb_user WHERE id_user = $1"
      : "SELECT id_user, username FROM public.tb_user WHERE LOWER(username) = LOWER($1)",
    [key]
  );
  if (!r.rowCount) throw new Error(`Usuário não encontrado: ${who}`);
  return r.rows[0];
}

(async () => {
  const [who, ref] = process.argv.slice(2);
  if (!who || !ref) {
    console.error("uso: node scripts/whatsapp-adopt-number.js <@username|id_user> <phone_number_id>");
    process.exit(1);
  }

  const info = await metaNumber(ref);
  console.log(`Meta: ${info.display_phone_number} — ${info.status} · verificação ${info.code_verification_status}`);
  if (info.status !== "CONNECTED") {
    console.error(`❌ O número não está CONNECTED na Meta (está ${info.status}). Registre-o antes.`);
    process.exit(1);
  }

  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("DATABASE_URL ausente.");
  const conn = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await conn.connect();

  try {
    const user = await resolveUser(conn, who);

    const already = await WhatsappStorage.getInstanceByUser(conn, user.id_user);
    if (already && already.evolution_instance !== ref) {
      console.error(
        `❌ ${user.username} já tem a instância ${already.provider}:${already.evolution_instance}.` +
          " Desconecte antes — sobrescrever mudaria o dono das conversas existentes."
      );
      process.exit(1);
    }

    const digits = String(info.display_phone_number || "").replace(/\D/g, "");

    await WhatsappStorage.upsertCloudInstance(conn, user.id_user, {
      ref,
      waba_id: String(process.env.META_WABA_ID || "").trim(),
      number: digits,
    });
    // `upsertCloudInstance` grava 'connecting' de propósito (é o passo do meio
    // do fluxo normal). Aqui a Meta já disse CONNECTED, então promovemos.
    const row = await WhatsappStorage.setInstanceStatus(conn, ref, "connected", digits);

    console.log(
      `✅ ${user.username} ← ${info.display_phone_number} ` +
        `(${row.provider}:${row.evolution_instance}, status ${row.status})`
    );
  } finally {
    await conn.end();
  }
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
