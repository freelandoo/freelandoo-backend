// test/authz-atendimento.e2e.js — Segurança A1, lote 6 (atendimento e APIs
// externas).
//
//   npm run test:authz:atendimento   (ou `npm run test:authz`, que roda os lotes)
//
// Pergunta por rota: se a conta B (ou a chave da B) trocar o id pelo da A, o
// servidor recusa? Chave revogada, chave do tipo errado e chave de outra
// academia param na porta?
// Tudo pelo HTTP do app real, contra o Postgres LOCAL de teste (porta 55432).
//
// Seções:
//   0. anônimo → 401 nas rotas do lote;
//   1. chaves flnd_atd_/flnd_data_: a chave da B só enxerga a B; chave de
//      dados não abre a API de mensagens (e vice-versa); revogada → 401; B não
//      revoga a chave da A;
//   2. conversas diretas: B não lê nem escreve na conversa A↔C, nem pela API
//      externa;
//   3. WhatsApp: B não lê, não responde e não baixa mídia da conversa da A;
//   4. prospecção: B não lê nem mexe nas listas de leads do negócio da A;
//   5. API de parceiro: a chave da academia B não lê nem mexe no aluno da A;
//      vínculo por CPF de conta existente (A1-28, registrado);
//   6. atendente IA e rotas de admin do lote → 403 para conta comum.
const url = process.env.TEST_DATABASE_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("TEST_DATABASE_URL precisa apontar para um Postgres LOCAL e descartável.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DATABASE_SSL = "false";
process.env.JWT_SECRET = process.env.JWT_SECRET_TEST || "segredo-de-teste";
process.env.FRONTEND_URL = "https://freelandoo.test";
process.env.R2_PUBLIC_URL = "https://r2.test";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const jwt = require("jsonwebtoken");

let PASS = 0;
let FAIL = 0;
function check(label, cond, extra = "") {
  if (cond) {
    PASS++;
    console.log(`  ✓ ${label}`);
  } else {
    FAIL++;
    console.log(`  ✗ ${label}${extra ? " — " + extra : ""}`);
  }
}

const uid = () => crypto.randomBytes(4).toString("hex");
const tag = uid();

function cpfValido() {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (d.every((x) => x === d[0])) d[0] = (d[0] + 1) % 10;
  const dig = (arr) => {
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i] * (arr.length + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dig(d));
  d.push(dig(d));
  return d.join("");
}

execFileSync(process.execPath, ["run-migrations.js"], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env },
  stdio: "ignore",
});

const pool = require("../src/databases");
const app = require("../src/app");
const CommunityStorage = require("../src/storages/CommunityStorage");
// Sem credencial da Meta no teste: o serviço recusaria com 503 ANTES de olhar
// o dono. O dublê diz "configurado" para a pergunta de posse ser respondida.
require("../src/integrations/whatsappProvider").isAnyAvailable = () => true;

let base;
async function call(method, p, { token, body } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${p}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _text: text };
  }
  return { status: res.status, body: json };
}

async function createUser(nome, { cpf = null } = {}) {
  const r = await pool.query(
    `INSERT INTO tb_user (nome, username, email, senha, data_nascimento, ativo, cpf)
     VALUES ($1,$2,$3,'$2b$10$abcdefghijklmnopqrstuuJ1aJ0aB2cD3eF4gH5iJ6kL7mN8oP9q','1990-01-01',TRUE,$4)
     RETURNING id_user, email`,
    [nome, `authza${uid()}`, `authza${uid()}@t.test`, cpf]
  );
  const p = await pool.query(
    `INSERT INTO tb_profile (id_user, id_category, display_name, sub_profile_slug, is_active, is_visible, is_user_account)
     VALUES ($1, (SELECT id_category FROM tb_category ORDER BY id_category LIMIT 1), $2, $3, TRUE, TRUE, TRUE)
     RETURNING id_profile`,
    [r.rows[0].id_user, nome, `conta-${uid()}`]
  );
  return { ...r.rows[0], id_profile: p.rows[0].id_profile, cpf };
}
const tokenOf = (u) => jwt.sign({ id_user: u.id_user, email: u.email }, process.env.JWT_SECRET, { expiresIn: "1h" });

const FLAGS = ["atendimento_api", "data_api", "whatsapp_atendimento", "prospeccao", "fitness_academias", "atendimento_ai"];

(async () => {
  const users = [];
  const extra = [];
  let server;
  const flagsBefore = (
    await pool.query(`SELECT flag_key, is_enabled FROM tb_feature_flag WHERE flag_key = ANY($1)`, [FLAGS])
  ).rows;
  await pool.query(`UPDATE tb_feature_flag SET is_enabled = TRUE WHERE flag_key = ANY($1)`, [FLAGS]);

  try {
    const A = await createUser("Ana Atendimento");
    const B = await createUser("Bia Intrusa");
    const C = await createUser("Caio Cliente");
    const Z = await createUser("Zeca Existente", { cpf: cpfValido() }); // conta comum, nunca foi à academia
    users.push(A, B, C, Z);
    const [tA, tB, tC] = [A, B, C].map(tokenOf);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;

    // Conversa direta A↔C com uma mensagem.
    let r = await call("POST", "/conversations", {
      token: tA, body: { actor_type: "profile", actor_id: A.id_profile, target_id: C.id_profile },
    });
    const idConv = r.body?.conversation?.id_conversation;
    if (!idConv) throw new Error(`abrir conversa: ${r.status} ${JSON.stringify(r.body)}`);
    r = await call("POST", `/conversations/${idConv}/messages`, {
      token: tA, body: { actor_type: "profile", actor_id: A.id_profile, body: `segredo ${tag}` },
    });
    if (r.status !== 201) throw new Error(`mensagem: ${r.status} ${JSON.stringify(r.body)}`);

    // WhatsApp da A: instância, conversa e mensagem com mídia.
    const inst = await pool.query(
      `INSERT INTO tb_whatsapp_instance (id_user, evolution_instance, status) VALUES ($1, $2, 'connected') RETURNING id_instance`,
      [A.id_user, `pnid-${tag}`]
    );
    const wconv = await pool.query(
      `INSERT INTO tb_whatsapp_conversation (id_instance, remote_jid) VALUES ($1, '5511999990000') RETURNING id_conversation`,
      [inst.rows[0].id_instance]
    );
    const wmsg = await pool.query(
      `INSERT INTO tb_whatsapp_message (id_conversation, direction, body) VALUES ($1, 'in', $2) RETURNING id_message`,
      [wconv.rows[0].id_conversation, `zap ${tag}`]
    );
    const idW = wconv.rows[0].id_conversation;

    // Negócio da A com uma lista de leads.
    const { rows: mach } = await pool.query(`SELECT id_machine FROM tb_machine ORDER BY id_machine LIMIT 1`);
    const biz = await CommunityStorage.createCommunity(pool, {
      id_user: A.id_user, id_machine: mach[0].id_machine, display_name: `Negocio ${tag}`, bio: null,
      avatar_url: null, theme: null, kind: "common", address: null,
    });
    await CommunityStorage.addMember(pool, biz.id_profile, A.id_user, "leader");
    extra.push(biz.id_profile);
    const list = await pool.query(
      `INSERT INTO tb_lead_list (id_profile, name) VALUES ($1, $2) RETURNING id_list`, [biz.id_profile, `Lista ${tag}`]
    );
    const idList = list.rows[0].id_list;

    // ═══ 0. anônimo ═════════════════════════════════════════════════════
    console.log("\n━━━ 0. anônimo → 401 ━━━");
    for (const [m, p] of [
      ["GET", "/me/api-connections"], ["GET", "/me/data-connections"], ["GET", "/ext/v1/me"],
      ["GET", "/ext/v1/data/me"], ["GET", "/conversations"], ["GET", `/conversations/${idConv}`],
      ["GET", "/whatsapp/instance"], ["GET", "/whatsapp/conversations"], ["GET", `/communities/${biz.id_profile}/leads/lists`],
      ["GET", "/me/atendimento-ia"], ["GET", "/me/atendimento-ai/knowledge"], ["GET", "/partner/v1/members"],
      ["POST", "/chat/join"],
    ]) {
      r = await call(m, p, { body: m === "GET" ? undefined : {} });
      check(`${m} ${p.replace(/[0-9a-f-]{36}/g, ":id")} → 401`, r.status === 401, `veio ${r.status}`);
    }

    // ═══ 1. chaves de API ═══════════════════════════════════════════════
    console.log("\n━━━ 1. chaves flnd_atd_ / flnd_data_ ━━━");
    r = await call("POST", "/me/api-connections", { token: tA, body: { name: "Conexao A", scope_personal: true } });
    const keyA = r.body?.token;
    const idConnA = r.body?.connection?.id_connection;
    check("A cria a chave de atendimento", r.status === 201 && /^flnd_atd_/.test(keyA || ""), `${r.status} ${JSON.stringify(r.body)}`);
    r = await call("POST", "/me/api-connections", { token: tB, body: { name: "Conexao B", scope_personal: true } });
    const keyB = r.body?.token;
    r = await call("POST", "/me/data-connections", { token: tB, body: { name: "Dados B" } });
    const dataB = r.body?.token;
    check("B cria a chave de dados", /^flnd_data_/.test(dataB || ""), `${r.status} ${JSON.stringify(r.body)}`);

    r = await call("GET", "/ext/v1/conversations", { token: keyA });
    check("chave da A lista a conversa dela (controle)", r.status === 200 && (r.body?.items || []).some((i) => i.id === `dm:${idConv}`),
      `veio ${r.status}`);
    r = await call("GET", "/ext/v1/conversations", { token: keyB });
    check("chave da B não lista a conversa da A", r.status === 200 && !(r.body?.items || []).some((i) => i.id === `dm:${idConv}`));
    r = await call("GET", `/ext/v1/conversations/dm:${idConv}/messages`, { token: keyB });
    check("chave da B não lê as mensagens da A (403)", r.status === 403, `veio ${r.status}`);
    r = await call("POST", `/ext/v1/conversations/dm:${idConv}/messages`, { token: keyB, body: { body: "invasao" } });
    check("chave da B não escreve na conversa da A (403)", r.status === 403, `veio ${r.status}`);
    r = await call("GET", "/ext/v1/conversations", { token: dataB });
    check("chave de DADOS não abre a API de mensagens (403)", r.status === 403, `veio ${r.status}`);
    r = await call("GET", "/ext/v1/data/me", { token: keyA });
    check("chave de ATENDIMENTO não abre a API de dados (403)", r.status === 403, `veio ${r.status}`);
    r = await call("GET", "/ext/v1/data/profiles", { token: dataB });
    check("chave de dados da B só traz perfis da B",
      r.status === 200 && !JSON.stringify(r.body || {}).includes(A.id_profile), `veio ${r.status}`);
    r = await call("POST", `/me/api-connections/${idConnA}/revoke`, { token: tB });
    check("B não revoga a chave da A", r.status >= 400 && r.status < 500 && r.status !== 401, `veio ${r.status}`);
    r = await call("GET", "/ext/v1/me", { token: keyA });
    check("chave da A segue viva", r.status === 200, `veio ${r.status}`);
    r = await call("POST", `/me/api-connections/${idConnA}/revoke`, { token: tA });
    r = await call("GET", "/ext/v1/me", { token: keyA });
    check("chave revogada → 401", r.status === 401, `veio ${r.status}`);
    r = await call("GET", "/ext/v1/me", { token: "flnd_atd_" + "x".repeat(32) });
    check("chave inventada → 401", r.status === 401, `veio ${r.status}`);
    r = await call("GET", "/conversations", { token: keyB });
    check("chave de API não vale como sessão no site (401)", r.status === 401, `veio ${r.status}`);

    // ═══ 2. conversas diretas ═══════════════════════════════════════════
    console.log("\n━━━ 2. conversa A↔C vista por B ━━━");
    for (const [m, p, body] of [
      ["GET", `/conversations/${idConv}?actor_type=profile&actor_id=${B.id_profile}`],
      ["GET", `/conversations/${idConv}/messages?actor_type=profile&actor_id=${B.id_profile}`],
      ["GET", `/conversations/${idConv}/messages?actor_type=profile&actor_id=${A.id_profile}`],
      ["POST", `/conversations/${idConv}/messages`, { actor_type: "profile", actor_id: B.id_profile, body: "oi" }],
      ["POST", `/conversations/${idConv}/messages`, { actor_type: "profile", actor_id: A.id_profile, body: "me passando pela A" }],
      ["POST", `/conversations/${idConv}/read`, { actor_type: "profile", actor_id: B.id_profile }],
    ]) {
      const rr = await call(m, p, { token: tB, body });
      const leaked = JSON.stringify(rr.body || {}).includes(`segredo ${tag}`);
      check(`B → ${m} ${p.split("?")[0].replace(/[0-9a-f-]{36}/g, ":id")} (${(p.split("actor_id=")[1] || body?.actor_id || "").slice(0, 8) === A.id_profile.slice(0, 8) ? "como A" : "como B"}) recusado`,
        rr.status === 403 && !leaked, `veio ${rr.status}${leaked ? ", mensagem vazou" : ""}`);
    }
    const nMsg = await pool.query(`SELECT count(*)::int n FROM tb_message WHERE id_conversation=$1`, [idConv]);
    check("conversa da A com 1 mensagem só", nMsg.rows[0].n === 1, `tem ${nMsg.rows[0].n}`);
    r = await call("GET", `/conversations/${idConv}/messages?actor_type=profile&actor_id=${C.id_profile}`, { token: tC });
    check("C (participante) lê (controle)", r.status === 200 && JSON.stringify(r.body || {}).includes(`segredo ${tag}`), `veio ${r.status}`);

    // ═══ 3. WhatsApp ════════════════════════════════════════════════════
    console.log("\n━━━ 3. WhatsApp da A visto por B ━━━");
    r = await call("GET", "/whatsapp/conversations", { token: tB });
    check("B não lista a conversa de WhatsApp da A", !JSON.stringify(r.body || {}).includes(idW), `veio ${r.status}`);
    r = await call("GET", `/whatsapp/conversations/${idW}/messages`, { token: tB });
    check("B não lê as mensagens de WhatsApp da A (404)", r.status === 404, `veio ${r.status}`);
    r = await call("POST", `/whatsapp/conversations/${idW}/messages`, { token: tB, body: { text: "oi" } });
    check("B não responde pelo WhatsApp da A (404)", r.status === 404, `veio ${r.status}`);
    r = await call("GET", `/whatsapp/messages/${wmsg.rows[0].id_message}/media`, { token: tB });
    check("B não baixa mídia do WhatsApp da A (404)", r.status === 404, `veio ${r.status}`);
    r = await call("GET", `/whatsapp/conversations/${idW}/messages`, { token: tA });
    check("A lê a própria conversa (controle)", r.status === 200, `veio ${r.status}`);

    // ═══ 4. prospecção ══════════════════════════════════════════════════
    console.log("\n━━━ 4. leads do negócio da A ━━━");
    for (const [m, p, body] of [
      ["GET", `/communities/${biz.id_profile}/leads/lists`],
      ["POST", `/communities/${biz.id_profile}/leads/lists`, { name: "intrusa" }],
      ["PATCH", `/communities/${biz.id_profile}/leads/lists/${idList}`, { name: "tomada" }],
      ["DELETE", `/communities/${biz.id_profile}/leads/lists/${idList}`],
      ["GET", `/communities/${biz.id_profile}/leads/search`],
      ["GET", `/communities/${biz.id_profile}/leads/jobs`],
    ]) {
      const rr = await call(m, p, { token: tB, body });
      // `_assertCommunityAdmin` responde "Apenas o líder…" sem statusCode (→ 400).
      check(`B → ${m} ${p.replace(/[0-9a-f-]{36}/g, ":id")} recusado`, rr.status === 403 || rr.status === 400, `veio ${rr.status}`);
    }
    const lRow = await pool.query(`SELECT name FROM tb_lead_list WHERE id_list=$1`, [idList]);
    check("lista da A intacta", lRow.rows[0]?.name === `Lista ${tag}`);

    // ═══ 5. API de parceiro ═════════════════════════════════════════════
    console.log("\n━━━ 5. API de parceiro (academia) ━━━");
    const ac = await pool.query(
      `INSERT INTO tb_academy (id_owner_user, nome, slug, api_base_url, api_token_enc)
       VALUES ($1,'Academia A',$2,'https://example.test','x'), ($3,'Academia B',$4,'https://example.test','x')
       RETURNING id_academy`,
      [A.id_user, `aa-${tag}`, B.id_user, `ab-${tag}`]
    );
    const [acA, acB] = ac.rows.map((x) => x.id_academy);
    extra.push(...[]);
    r = await call("POST", `/academies/${acA}/partner-key`, { token: tB });
    check("B não gera a chave de parceiro da academia da A", r.status === 403, `veio ${r.status}`);
    r = await call("POST", `/academies/${acA}/partner-key`, { token: tA });
    const pkA = r.body?.chave;
    r = await call("POST", `/academies/${acB}/partner-key`, { token: tB });
    const pkB = r.body?.chave;
    check("as duas academias têm chave", /^flnd_parc_/.test(pkA || "") && /^flnd_parc_/.test(pkB || ""));
    r = await call("POST", "/partner/v1/members", {
      token: pkA, body: { cpf: cpfValido(), nome: "Aluno Novo", email: `aluno${uid()}@t.test`, data_nascimento: "1990-01-01" },
    });
    const idAluno = r.body?.id_user;
    check("academia A cadastra aluno novo (controle)", r.status === 201 && !!idAluno, `${r.status} ${JSON.stringify(r.body)}`);
    if (idAluno) users.push({ id_user: idAluno });
    r = await call("GET", `/partner/v1/members/${idAluno}`, { token: pkB });
    check("chave da academia B não lê o aluno da A (404)", r.status === 404, `veio ${r.status}`);
    r = await call("POST", `/partner/v1/members/${idAluno}/link`, { token: pkB });
    check("chave da academia B não gera link de acesso do aluno da A (404)", r.status === 404, `veio ${r.status}`);
    r = await call("GET", "/partner/v1/members", { token: pkB });
    check("lista da academia B não traz o aluno da A",
      r.status === 200 && !(r.body?.itens || []).some((i) => i.id_user === idAluno), `veio ${r.status}`);
    r = await call("GET", `/partner/v1/whatsapp/midia/qualquer-${tag}`, { token: pkB });
    check("chave de parceiro não baixa mídia que não é da academia", r.status === 404 || r.status === 403, `veio ${r.status}`);
    r = await call("GET", `/partner/v1/members`, { token: keyB });
    check("chave flnd_atd_ não vale na API de parceiro (401)", r.status === 401, `veio ${r.status}`);
    // A1-28 (registrado, decisão do Alex): CPF de uma conta que já existe é
    // VINCULADO na hora, sem aceite da pessoa. O teste só documenta o estado;
    // não conta como falha nem como acerto.
    r = await call("POST", "/partner/v1/members", {
      token: pkB, body: { cpf: Z.cpf, nome: "Qualquer Nome", email: `x${uid()}@t.test`, data_nascimento: "1980-01-01" },
    });
    console.log(`  · A1-28: CPF de conta existente → ${r.status} ${r.body?.status || ""} (id_user ${r.body?.id_user === Z.id_user ? "da conta devolvido" : "não devolvido"})`);

    // ═══ 6. IA e admin ══════════════════════════════════════════════════
    console.log("\n━━━ 6. atendente IA e admin → 403 ━━━");
    // O atendente IA está aberto a toda conta (`utils/aiAccess.canUseAi`); a
    // pergunta é se a base de conhecimento de um é intocável pelo outro.
    r = await call("POST", "/me/atendimento-ai/knowledge", { token: tA, body: { title: `Base ${tag}`, content: "preço secreto" } });
    const idK = r.body?.knowledge?.id_knowledge || r.body?.doc?.id_knowledge || r.body?.id_knowledge;
    check("A cria item na base de conhecimento (controle)", r.status < 300 && !!idK, `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    r = await call("GET", "/me/atendimento-ai/knowledge", { token: tB });
    check("B não lista a base da A", !JSON.stringify(r.body || {}).includes(`Base ${tag}`), `veio ${r.status}`);
    r = await call("PATCH", `/me/atendimento-ai/knowledge/${idK}`, { token: tB, body: { content: "tomado" } });
    check("B não edita a base da A", r.status === 404, `veio ${r.status}`);
    r = await call("DELETE", `/me/atendimento-ai/knowledge/${idK}`, { token: tB });
    const kRow = await pool.query(`SELECT content FROM tb_ai_knowledge WHERE id_knowledge=$1`, [idK]);
    check("B não apaga a base da A", kRow.rows[0]?.content === "preço secreto", `veio ${r.status}`);
    r = await call("GET", "/me/atendimento-ai/preview", { token: tB });
    check("prévia do contexto da B não traz a base da A", !JSON.stringify(r.body || {}).includes("preço secreto"), `veio ${r.status}`);
    for (const [m, p] of [
      ["GET", "/admin/whatsapp/numbers"], ["GET", "/admin/ai/settings"], ["GET", "/admin/atendimento-ia/plans"],
      ["POST", "/admin/prospeccao/suppress"], ["GET", "/admin/blocked-terms"], ["GET", "/admin/chat-moderation/settings"],
      ["GET", "/admin/ai/usage"], ["GET", "/admin/atendimento-ia/subs"],
    ]) {
      const rr = await call(m, p, { token: tB, body: m === "GET" ? undefined : {} });
      check(`${m} ${p} com conta comum → 403`, rr.status === 403, `veio ${rr.status}`);
    }
  } catch (e) {
    FAIL++;
    console.error("\nERRO:", e);
  } finally {
    if (server) server.close();
    const ids = users.map((u) => u.id_user);
    await pool.query(`DELETE FROM tb_academy WHERE id_owner_user = ANY($1::uuid[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM tb_whatsapp_instance WHERE id_user = ANY($1::uuid[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM tb_ai_knowledge WHERE id_user = ANY($1::uuid[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM tb_api_connection WHERE id_user = ANY($1::uuid[])`, [ids]).catch(() => {});
    for (const id of extra) await pool.query(`DELETE FROM tb_profile WHERE id_profile=$1`, [id]).catch(() => {});
    await pool.query(
      `DELETE FROM tb_conversation c WHERE EXISTS (SELECT 1 FROM tb_conversation_participant p
         JOIN tb_profile pr ON pr.id_profile = p.entity_id WHERE p.id_conversation = c.id_conversation AND pr.id_user = ANY($1::uuid[]))`,
      [ids]
    ).catch(() => {});
    for (const id of ids) {
      await pool.query(`DELETE FROM tb_profile WHERE id_user=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM tb_user WHERE id_user=$1`, [id]).catch(() => {});
    }
    for (const f of flagsBefore) {
      await pool.query(`UPDATE tb_feature_flag SET is_enabled=$2 WHERE flag_key=$1`, [f.flag_key, f.is_enabled]).catch(() => {});
    }
    await pool.end().catch(() => {});
    console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
    process.exit(FAIL ? 1 : 0);
  }
})();
