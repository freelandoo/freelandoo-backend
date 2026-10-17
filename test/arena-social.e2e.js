// test/arena-social.e2e.js — Módulo 09 da Arena (chat e social) + o
// endurecimento da mensageria da plataforma, pela HTTP e pelo SOCKET de
// verdade, contra um Postgres de TESTE.
//
//   npm run test:arena-social
//
// Três contas: A e B conversam; C é a intrusa. Exercita: socket (token fora da
// URL, origem, prazo do token, conta sancionada, assinatura de sala sem
// participação, saída do grupo), fachada /arena/social (DTO sem id_user,
// ator alheio, conversa alheia), mesma persistência que /conversations,
// idempotência de envio (sequencial e concorrente) sem evento duplicado,
// leitura precisa, abrir conversa por personagem (concorrente), bloqueio
// entre contas (outro perfil não contorna; histórico fica; desbloqueio volta),
// denúncia de DM (participante, própria, intrusa, revisão) e a régua nova na
// conversa EXISTENTE.

const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const DB_URL = process.env.TEST_DATABASE_URL || "postgres://postgres:test@127.0.0.1:55432/freelandoo_test";
if (/railway|rlwy\.net|proxy\.rlwy/i.test(DB_URL)) {
  console.error("[guard] TEST_DATABASE_URL parece produção (railway). Abortando.");
  process.exit(1);
}
process.env.DATABASE_URL = DB_URL;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = `arena-social-${crypto.randomBytes(16).toString("hex")}`;
process.env.ARENA_SERVICE_SECRET = `svc-${crypto.randomBytes(24).toString("hex")}`;
process.env.DATABASE_URL_COLD = "";

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}
const eq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};
const ok = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("━━━ migrations (banco de teste) ━━━");
  execFileSync(process.execPath, ["run-migrations.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env }, stdio: "ignore" });

  const jwt = require("jsonwebtoken");
  const bcrypt = require("bcrypt");
  const { io: ioc } = require("socket.io-client");
  const pool = require("../src/databases");
  const app = require("../src/app");
  const realtime = require("../src/realtime/socket");
  const AuthStorage = require("../src/storages/AuthStorage");

  const server = http.createServer(app);
  realtime.init(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, p, { token, body } = {}) => {
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* vazio */
    }
    return { status: res.status, body: json };
  };

  const stamp = Date.now().toString(36);
  const hash = await bcrypt.hash("senha-de-teste-123", 4);
  async function mkUser(tag) {
    const r = await pool.query(
      `INSERT INTO public.tb_user (nome, username, email, senha, ativo, is_minor)
       VALUES ($1, $2, $3, $4, TRUE, FALSE) RETURNING id_user`,
      [`Social ${tag}`, `so${tag}${stamp}`.slice(0, 30), `arena.social.${tag}.${stamp}@teste.invalid`, hash]
    );
    const id = r.rows[0].id_user;
    await AuthStorage.ensureUserAccountProfile(pool, id, `Social ${tag}`);
    const p = await pool.query(`SELECT id_profile FROM public.tb_profile WHERE id_user = $1 AND is_user_account = TRUE`, [id]);
    return { id, profile: p.rows[0].id_profile };
  }
  const tok = (id, opts = {}) => jwt.sign({ id_user: id, email: "x@teste.invalid" }, process.env.JWT_SECRET, { expiresIn: "1h", ...opts });

  const A = await mkUser("a");
  const B = await mkUser("b");
  const C = await mkUser("c");
  const t = { a: tok(A.id), b: tok(B.id), c: tok(C.id) };
  // Segundo perfil de A (não-conta): usado para provar que trocar de perfil não contorna bloqueio.
  const a2 = (
    await pool.query(
      `INSERT INTO public.tb_profile (id_user, id_category, display_name, sub_profile_slug, is_active, is_visible, is_user_account)
       VALUES ($1, (SELECT id_category FROM public.tb_category ORDER BY id_category LIMIT 1), 'A dois', $2, TRUE, FALSE, FALSE)
       RETURNING id_profile`,
      [A.id, `a2${stamp}`]
    )
  ).rows[0].id_profile;

  const sessions = {};
  for (const k of ["a", "b", "c"]) {
    const s = await call("POST", "/arena/session", { token: t[k] });
    ok(s.status === 200, `sessão ${k}: ${s.status}`);
    sessions[k] = s.body.player.playerId;
  }

  // Conversa A↔B pela PLATAFORMA (o caminho existente).
  const opened = await call("POST", "/conversations", { token: t.a, body: { actor_type: "profile", actor_id: A.profile, target_id: B.profile } });
  ok(opened.status === 201 || opened.status === 200, `abrir A↔B: ${opened.status} ${JSON.stringify(opened.body)}`);
  const conv = opened.body.conversation.id_conversation;

  const allUserIds = [A.id, B.id, C.id];
  const leaksIdentity = (obj) => {
    const s = JSON.stringify(obj);
    return allUserIds.some((id) => s.includes(id)) || /sender_user_id|id_user/.test(s);
  };

  const sockets = [];
  const connect = (token, opts = {}) =>
    new Promise((resolve) => {
      const s = ioc(base, {
        path: "/realtime",
        transports: ["websocket"],
        reconnection: false,
        timeout: 4000,
        ...(token ? { auth: { token } } : {}),
        ...opts,
      });
      sockets.push(s);
      s.on("connect", () => resolve({ s, ok: true }));
      s.on("connect_error", (e) => resolve({ s, ok: false, error: e.message }));
    });
  const collect = (s, ev) => {
    const got = [];
    s.on(ev, (p) => got.push(p));
    return got;
  };

  console.log("\n━━━ socket social ━━━");
  await check("sem token → recusado", async () => {
    const r = await connect(null);
    ok(!r.ok, "conectou sem token");
  });
  await check("token na URL (query) → recusado: só no auth do handshake", async () => {
    const r = await connect(null, { query: { token: t.a } });
    ok(!r.ok, "aceitou token na query");
  });
  await check("origem de fora → recusado no upgrade", async () => {
    const r = await connect(t.a, { extraHeaders: { Origin: "https://evil.example" } });
    ok(!r.ok, "aceitou origem estranha");
  });
  await check("origem da Freelandoo → aceito", async () => {
    const r = await connect(t.a, { extraHeaders: { Origin: "https://www.freelandoo.com.br" } });
    ok(r.ok, `recusou origem própria: ${r.error}`);
    r.s.close();
  });

  const sa = (await connect(t.a)).s;
  const sb = (await connect(t.b)).s;
  const sc = (await connect(t.c)).s;
  const evA = collect(sa, "conversation:message");
  const evB = collect(sb, "conversation:message");
  const evC = collect(sc, "conversation:message");
  for (const s of [sa, sb, sc]) s.emit("conversation:subscribe", { id_conversation: conv });
  await sleep(300);

  await check("C (intrusa) assina com o UUID na mão e NÃO recebe; A e B recebem", async () => {
    const r = await call("POST", `/conversations/${conv}/messages`, { token: t.a, body: { actor_type: "profile", actor_id: A.profile, body: "oi B" } });
    eq(r.status, 201, "envio");
    await sleep(300);
    eq(evC.length, 0, "C recebeu evento privado");
    ok(evB.length === 1 && evA.length === 1, `A ${evA.length} / B ${evB.length}`);
    ok(evB[0].message.sent_via === undefined, "sent_via (privado do remetente) vazou na sala");
  });

  console.log("\n━━━ fachada /arena/social ━━━");
  await check("A lista a conversa pela Arena, sem id_user em lugar nenhum", async () => {
    const r = await call("GET", `/arena/social/conversations?actorId=${A.profile}`, { token: t.a });
    eq(r.status, 200, "status");
    ok(r.body.items.some((c) => c.conversationId === conv), "conversa ausente");
    ok(!leaksIdentity(r.body), "vazou identidade");
  });
  let arenaMsg;
  await check("mensagem da plataforma aparece na Arena e a da Arena aparece na plataforma (mesmo histórico)", async () => {
    const m = await call("GET", `/arena/social/conversations/${conv}/messages?actorId=${B.profile}`, { token: t.b });
    eq(m.status, 200, "listar");
    ok(m.body.items.some((x) => x.body === "oi B" && x.mine === false), "não viu a msg da plataforma");
    ok(!leaksIdentity(m.body), "vazou identidade");
    const cid = crypto.randomUUID();
    const s = await call("POST", `/arena/social/conversations/${conv}/messages`, { token: t.b, body: { actorId: B.profile, body: "oi A, da Arena", clientMessageId: cid } });
    eq(s.status, 201, `enviar: ${JSON.stringify(s.body)}`);
    arenaMsg = s.body.message;
    eq([arenaMsg.mine, arenaMsg.clientMessageId], [true, cid], "dto");
    const p = await call("GET", `/conversations/${conv}/messages?actor_type=profile&actor_id=${A.profile}`, { token: t.a });
    ok(p.body.items.some((x) => x.id_message === arenaMsg.messageId), "não apareceu na plataforma");
  });
  await check("mesmo clientMessageId de novo → mesma mensagem, sem evento novo", async () => {
    const before = evA.length;
    const s = await call("POST", `/arena/social/conversations/${conv}/messages`, {
      token: t.b,
      body: { actorId: B.profile, body: "oi A, da Arena", clientMessageId: arenaMsg.clientMessageId },
    });
    eq([s.status, s.body.duplicate, s.body.message.messageId], [200, true, arenaMsg.messageId], "duplicata");
    await sleep(250);
    eq(evA.length, before, "evento duplicado");
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_message WHERE client_message_id = $1`, [arenaMsg.clientMessageId]);
    eq(n.rows[0].n, 1, "linhas");
  });
  await check("dois envios simultâneos com o mesmo id → UMA linha", async () => {
    const cid = crypto.randomUUID();
    const body = { actorId: A.profile, body: "corrida", clientMessageId: cid };
    const rs = await Promise.all([1, 2, 3].map(() => call("POST", `/arena/social/conversations/${conv}/messages`, { token: t.a, body })));
    ok(rs.every((r) => r.status === 200 || r.status === 201), `status ${rs.map((r) => r.status)}`);
    eq(new Set(rs.map((r) => r.body.message.messageId)).size, 1, "ids diferentes");
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_message WHERE client_message_id = $1`, [cid]);
    eq(n.rows[0].n, 1, "linhas");
  });
  await check("C não lê, não envia e não marca leitura na conversa A↔B (nem com o UUID)", async () => {
    const l = await call("GET", `/arena/social/conversations/${conv}/messages?actorId=${C.profile}`, { token: t.c });
    eq(l.status, 403, "ler");
    const s = await call("POST", `/arena/social/conversations/${conv}/messages`, { token: t.c, body: { actorId: C.profile, body: "x", clientMessageId: crypto.randomUUID() } });
    eq(s.status, 403, "enviar");
    const r = await call("POST", `/arena/social/conversations/${conv}/read`, { token: t.c, body: { actorId: C.profile, upToMessageId: arenaMsg.messageId } });
    eq(r.status, 403, "ler-marcar");
  });
  await check("ator que não é da conta → recusado (C tentando agir como B)", async () => {
    const r = await call("GET", `/arena/social/conversations/${conv}/messages?actorId=${B.profile}`, { token: t.c });
    eq(r.status, 403, "status");
  });
  await check("campo não declarado no corpo → 400", async () => {
    const r = await call("POST", `/arena/social/conversations/${conv}/messages`, { token: t.a, body: { actorId: A.profile, body: "x", clientMessageId: crypto.randomUUID(), id_user: B.id } });
    eq(r.status, 400, "status");
  });

  console.log("\n━━━ leitura ━━━");
  await check("listar (pré-carga) não marca lido; ler até m1 deixa m2 não lido; até m2 zera", async () => {
    const m1 = (await call("POST", `/arena/social/conversations/${conv}/messages`, { token: t.a, body: { actorId: A.profile, body: "m1", clientMessageId: crypto.randomUUID() } })).body.message;
    await sleep(15);
    const m2 = (await call("POST", `/arena/social/conversations/${conv}/messages`, { token: t.a, body: { actorId: A.profile, body: "m2", clientMessageId: crypto.randomUUID() } })).body.message;
    const unread = async () => (await call("GET", `/arena/social/conversations?actorId=${B.profile}`, { token: t.b })).body.items.find((c) => c.conversationId === conv).unread;
    const u0 = await unread();
    await call("GET", `/arena/social/conversations/${conv}/messages?actorId=${B.profile}`, { token: t.b });
    eq(await unread(), u0, "pré-carga marcou");
    const r1 = await call("POST", `/arena/social/conversations/${conv}/read`, { token: t.b, body: { actorId: B.profile, upToMessageId: m1.messageId } });
    eq([r1.status, r1.body.unread], [200, 1], "até m1");
    const r2 = await call("POST", `/arena/social/conversations/${conv}/read`, { token: t.b, body: { actorId: B.profile, upToMessageId: m2.messageId } });
    eq(r2.body.unread, 0, "até m2");
    // nunca anda para trás
    const r3 = await call("POST", `/arena/social/conversations/${conv}/read`, { token: t.b, body: { actorId: B.profile, upToMessageId: m1.messageId } });
    eq(r3.body.unread, 0, "andou para trás");
  });
  await check("ler até uma mensagem de OUTRA conversa → 404", async () => {
    const other = await call("POST", "/conversations", { token: t.a, body: { actor_type: "profile", actor_id: A.profile, target_id: C.profile } });
    const cv = other.body.conversation.id_conversation;
    const m = (await call("POST", `/arena/social/conversations/${cv}/messages`, { token: t.a, body: { actorId: A.profile, body: "oi C", clientMessageId: crypto.randomUUID() } })).body.message;
    const r = await call("POST", `/arena/social/conversations/${conv}/read`, { token: t.b, body: { actorId: B.profile, upToMessageId: m.messageId } });
    eq(r.status, 404, "status");
  });

  console.log("\n━━━ personagem → alvo social ━━━");
  await check("A resolve o personagem de B: perfil público, sem id_user, pode conversar", async () => {
    const r = await call("GET", `/arena/social/players/${sessions.b}`, { token: t.a });
    eq(r.status, 200, "status");
    eq([r.body.profile.profileId, r.body.relation.canMessage, r.body.self], [B.profile, true, false], "dto");
    ok(!leaksIdentity(r.body), "vazou identidade");
  });
  await check("playerId desconhecido → 404; formato torto → 400", async () => {
    eq((await call("GET", `/arena/social/players/pl_naoexiste0000000`, { token: t.a })).status, 404, "desconhecido");
    eq((await call("GET", `/arena/social/players/xx`, { token: t.a })).status, 400, "torto");
  });
  await check("dois cliques simultâneos em Conversar → a MESMA conversa", async () => {
    const rs = await Promise.all([1, 2, 3].map(() => call("POST", `/arena/social/players/${sessions.c}/conversation`, { token: t.b, body: { actorId: B.profile } })));
    ok(rs.every((r) => r.status === 200), `status ${rs.map((r) => r.status)} ${JSON.stringify(rs[0].body)}`);
    eq(new Set(rs.map((r) => r.body.conversationId)).size, 1, "duplicou conversa");
  });
  await check("seguir pelo personagem usa o follow real (user-level)", async () => {
    const r = await call("PUT", `/arena/social/players/${sessions.b}/follow`, { token: t.a });
    eq(r.status, 200, `seguir ${JSON.stringify(r.body)}`);
    const row = await pool.query(`SELECT 1 FROM public.tb_user_follow WHERE follower_user_id = $1 AND target_profile_id = $2 AND deleted_at IS NULL`, [A.id, B.profile]);
    eq(row.rowCount, 1, "linha de follow");
    eq((await call("GET", `/arena/social/players/${sessions.b}`, { token: t.a })).body.relation.following, true, "following");
    eq((await call("DELETE", `/arena/social/players/${sessions.b}/follow`, { token: t.a })).status, 200, "deixar de seguir");
  });

  console.log("\n━━━ bloqueio entre contas ━━━");
  await check("B bloqueia A: A não envia na conversa existente nem abre outra", async () => {
    eq((await call("PUT", `/arena/social/players/${sessions.a}/block`, { token: t.b })).status, 200, "bloquear");
    const s = await call("POST", `/arena/social/conversations/${conv}/messages`, { token: t.a, body: { actorId: A.profile, body: "ainda?", clientMessageId: crypto.randomUUID() } });
    eq([s.status, s.body.code], [403, "blocked"], "envio");
    const o = await call("POST", `/arena/social/players/${sessions.b}/conversation`, { token: t.a, body: { actorId: A.profile } });
    eq([o.status, o.body.code], [403, "blocked"], "abrir");
  });
  await check("outro perfil de A NÃO contorna o bloqueio", async () => {
    const r = await call("POST", "/conversations", { token: t.a, body: { actor_type: "profile", actor_id: a2, target_id: B.profile } });
    ok(r.status === 403, `abriu pelo outro perfil: ${r.status}`);
  });
  await check("o bloqueio vale nos dois sentidos para DM e o histórico continua legível", async () => {
    const s = await call("POST", `/arena/social/conversations/${conv}/messages`, { token: t.b, body: { actorId: B.profile, body: "x", clientMessageId: crypto.randomUUID() } });
    eq(s.status, 403, "B envia");
    eq((await call("GET", `/arena/social/conversations/${conv}/messages?actorId=${A.profile}`, { token: t.a })).status, 200, "histórico");
  });
  await check("A não vê que foi bloqueada; B vê blockedByMe; /me/blocks lista", async () => {
    const a = await call("GET", `/arena/social/players/${sessions.b}`, { token: t.a });
    eq([a.body.relation.blockedByMe, a.body.relation.canMessage], [false, false], "visão de A");
    const b = await call("GET", `/arena/social/players/${sessions.a}`, { token: t.b });
    eq(b.body.relation.blockedByMe, true, "visão de B");
    const l = await call("GET", "/me/blocks", { token: t.b });
    ok(l.body.items.some((x) => x.id_profile === A.profile), "lista");
  });
  await check("desbloquear devolve a conversa", async () => {
    eq((await call("DELETE", `/arena/social/players/${sessions.a}/block`, { token: t.b })).status, 200, "desbloquear");
    const s = await call("POST", `/arena/social/conversations/${conv}/messages`, { token: t.a, body: { actorId: A.profile, body: "voltou", clientMessageId: crypto.randomUUID() } });
    eq(s.status, 201, "envio");
  });
  await check("não dá para bloquear a si mesmo", async () => {
    eq((await call("PUT", `/arena/social/players/${sessions.a}/block`, { token: t.a })).status, 422, "status");
  });

  console.log("\n━━━ denúncia de DM ━━━");
  await check("B denuncia mensagem de A → 201; repetir é ok; persiste uma vez", async () => {
    const msg = (await call("POST", `/arena/social/conversations/${conv}/messages`, { token: t.a, body: { actorId: A.profile, body: "ofensa", clientMessageId: crypto.randomUUID() } })).body.message;
    const r = await call("POST", `/arena/social/messages/${msg.messageId}/report`, { token: t.b, body: { reasonCategory: "harassment", reason: "teste" } });
    eq(r.status, 201, `denunciar ${JSON.stringify(r.body)}`);
    eq((await call("POST", `/arena/social/messages/${msg.messageId}/report`, { token: t.b, body: { reasonCategory: "harassment" } })).status, 201, "repetir");
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_message_report WHERE id_message = $1`, [msg.messageId]);
    eq(n.rows[0].n, 1, "linhas");
    eq((await call("POST", `/arena/social/messages/${msg.messageId}/report`, { token: t.c, body: { reasonCategory: "spam" } })).status, 404, "intrusa");
    eq((await call("POST", `/arena/social/messages/${msg.messageId}/report`, { token: t.a, body: { reasonCategory: "spam" } })).status, 422, "própria");
    eq((await call("POST", `/arena/social/messages/${msg.messageId}/report`, { token: t.b, body: { reasonCategory: "xx" } })).status, 400, "motivo");
  });
  await check("revisão: só administrador lista; 'agir' esconde a mensagem", async () => {
    eq((await call("GET", "/admin/message-reports", { token: t.b })).status, 403, "não-admin");
    const role = await pool.query(`SELECT id_role FROM public.tb_role WHERE desc_role = 'Administrator' LIMIT 1`);
    ok(role.rows[0], "papel Administrator existe");
    await pool.query(`INSERT INTO public.tb_user_role (id_user, id_role) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [C.id, role.rows[0].id_role]);
    const l = await call("GET", "/admin/message-reports", { token: t.c });
    eq(l.status, 200, `admin ${JSON.stringify(l.body)}`);
    const rep = l.body.items.find((x) => x.body === "ofensa");
    ok(rep, "denúncia ausente");
    eq((await call("POST", `/admin/message-reports/${rep.id_message_report}/resolve`, { token: t.c, body: { decision: "actioned" } })).status, 200, "resolver");
    const m = await pool.query(`SELECT deleted_at FROM public.tb_message WHERE id_message = $1`, [rep.id_message]);
    ok(m.rows[0].deleted_at, "mensagem não foi escondida");
    await pool.query(`DELETE FROM public.tb_user_role WHERE id_user = $1`, [C.id]);
  });

  console.log("\n━━━ conta sancionada e sessões longas ━━━");
  await check("conta bloqueada: Arena 403, envio da plataforma recusado, socket derrubado", async () => {
    await pool.query(`UPDATE public.tb_user SET blocked_at = NOW() WHERE id_user = $1`, [B.id]);
    const r = await call("GET", `/arena/social/conversations?actorId=${B.profile}`, { token: t.b });
    eq([r.status, r.body.code], [403, "account_blocked"], "arena");
    const s = await call("POST", `/conversations/${conv}/messages`, { token: t.b, body: { actor_type: "profile", actor_id: B.profile, body: "x" } });
    eq(s.status, 403, "plataforma");
    const dropped = new Promise((res) => sb.once("disconnect", () => res(true)));
    await realtime.revalidateAll();
    ok(await Promise.race([dropped, sleep(2000).then(() => false)]), "socket seguiu de pé");
    const again = await connect(t.b);
    ok(!again.ok, "reconectou com conta bloqueada");
    await pool.query(`UPDATE public.tb_user SET blocked_at = NULL WHERE id_user = $1`, [B.id]);
  });
  await check("socket não vive além do prazo do token", async () => {
    const short = tok(A.id, { expiresIn: 2 });
    const r = await connect(short);
    ok(r.ok, "não conectou");
    const gone = await Promise.race([new Promise((res) => r.s.once("disconnect", () => res(true))), sleep(4500).then(() => false)]);
    ok(gone, "seguiu conectado depois de expirar");
  });
  await check("conversa apagada: quem estava na sala sai na hora", async () => {
    const other = await call("POST", "/conversations", { token: t.a, body: { actor_type: "profile", actor_id: A.profile, target_id: C.profile } });
    const cv = other.body.conversation.id_conversation;
    const sx = (await connect(t.c)).s;
    const ev = collect(sx, "conversation:message");
    sx.emit("conversation:subscribe", { id_conversation: cv });
    await sleep(250);
    eq((await call("DELETE", `/conversations/${cv}?actor_type=profile&actor_id=${A.profile}`, { token: t.a })).status, 200, "apagar");
    await sleep(300);
    realtime.emitToConversation(cv, "conversation:message", { id_conversation: cv, message: { body: "fantasma" } });
    await sleep(250);
    eq(ev.length, 0, "recebeu depois de apagada");
  });

  for (const s of sockets) s.close();
  server.close();
  await pool.end().catch(() => {});
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} verificações`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
