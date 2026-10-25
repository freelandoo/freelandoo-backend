// Card de perfil de outro jogador (mm3d-31): quem a sessão tocada é, e o que
// sai dela. Sala, banco e storages são dublês (require.cache) — o que se prova
// aqui é a regra do serviço: só a sala de QUEM PERGUNTA traduz sessão em conta,
// nunca abre o próprio perfil, bloqueio não vaza dado e a projeção é campo a campo.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "..", "src");
const stub = (rel, exports) => {
  const file = require.resolve(path.join(SRC, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

const world = { rooms: new Map(), blocks: new Set(), lockedUsers: new Set(), following: false };

stub("databases", {
  query: async (sql) => {
    if (/FROM public\.tb_user WHERE/.test(sql)) return { rows: [{ username: "alex.s" }] };
    if (/SELECT municipio, estado FROM public\.tb_profile/.test(sql)) return { rows: [{ municipio: "Fortaleza", estado: "CE" }] };
    if (/tb_profile_portfolio_item/.test(sql)) return { rows: [{ n: 2 }] };
    if (/profile_ratings/.test(sql)) return { rows: [{ n: 0, avg: 0 }] };
    throw new Error(`consulta inesperada: ${sql}`);
  },
});
stub("realtime/meuMundo.js", {
  playerInMyRoom: (viewer, sid) => world.rooms.get(`${viewer}:${sid}`) || null,
});
stub("storages/UserBlockStorage.js", {
  eitherBlocks: async (_c, a, b) => world.blocks.has(`${a}:${b}`) || world.blocks.has(`${b}:${a}`),
  accountState: async (_c, id) => ({ id_user: id, ativo: false, blocked_at: world.lockedUsers.has(id) ? new Date() : null }),
});
stub("storages/UserPublicSummaryStorage.js", {
  getAccountProfile: async (_c, id) => ({
    id_profile: `p-${id}`,
    display_name: id === "u2" ? "Alex Sandro Rodrigues" : "Eu",
    avatar_url: id === "u2" ? "https://cdn/x.jpg" : null,
    xp_total: 999,
    xp_level: 9,
  }),
});
stub("storages/EntityFollowStorage.js", {
  normalizeType: (t) => t,
  counts: async () => ({ followers_count: 0, following_count: 1 }),
  findActive: async () => (world.following ? { id: 1 } : null),
});
stub("storages/ManifestationStorage.js", {
  getActiveForProfile: async () => ({ banner_url: "https://cdn/b.jpg", banner_thumb_url: "https://cdn/b-t.jpg", user_id: "u2" }),
});

const Service = require(path.join(SRC, "services", "MeuMundoPlayerService.js"));

test("sessão com forma inválida não consulta a sala", async () => {
  const r = await Service.profile("u1", "../x");
  assert.equal(r.code, "gone");
  assert.equal(r.statusCode, 404);
});

test("jogador fora da sala de quem pergunta não abre", async () => {
  world.rooms.clear();
  const r = await Service.profile("u1", "abcd1234");
  assert.equal(r.code, "gone");
});

test("a própria sessão não abre o próprio perfil", async () => {
  world.rooms.set("u1:mine1234", { userId: "u1", name: "Eu" });
  const r = await Service.profile("u1", "mine1234");
  assert.equal(r.code, "self");
});

test("bloqueio em qualquer direção devolve só o nome da sala", async () => {
  world.rooms.set("u1:other123", { userId: "u2", name: "Alex Sandro" });
  world.blocks.add("u2:u1");
  const r = await Service.profile("u1", "other123");
  assert.deepEqual(r, { player: { sessionId: "other123", name: "Alex Sandro", online: true, unavailable: true } });
  world.blocks.clear();
});

test("conta bloqueada também fica indisponível", async () => {
  world.lockedUsers.add("u2");
  const r = await Service.profile("u1", "other123");
  assert.equal(r.player.unavailable, true);
  assert.equal(r.player.profileId, undefined);
  world.lockedUsers.clear();
});

test("projeção pública é do jogador TOCADO, campo a campo", async () => {
  world.following = true;
  const r = await Service.profile("u1", "other123");
  const p = r.player;
  assert.equal(p.profileId, "p-u2");
  assert.equal(p.viewerProfileId, "p-u1");
  assert.equal(p.displayName, "Alex Sandro Rodrigues");
  assert.equal(p.username, "alex.s");
  assert.equal(p.coverUrl, "https://cdn/b-t.jpg");
  assert.equal(p.city, "Fortaleza, CE");
  assert.equal(p.posts, 2);
  assert.equal(p.followers, 0);
  assert.equal(p.following, 1);
  assert.deepEqual(p.ratings, { count: 0, avg: 0 });
  assert.equal(p.isFollowing, true);
  // Nada além do que o card mostra (xp, id da conta, dados da manifestação).
  assert.deepEqual(Object.keys(p).sort(), [
    "avatarUrl", "city", "coverUrl", "displayName", "followers", "following", "isFollowing", "name", "online",
    "posts", "profileId", "ratings", "sessionId", "unavailable", "username", "viewerProfileId",
  ]);
  world.following = false;
});
