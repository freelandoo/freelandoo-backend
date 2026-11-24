// gacha-v1 (mig 469): Convocações — débito, entrega, garantia, recibo, replay, conflito, lote, concorrência,
// falha no meio e histórico só da própria pessoa. EXCLUSIVAMENTE banco local descartável:
// TEST_DATABASE_URL=postgres://postgres:<senha>@127.0.0.1:<porta>/mm_gacha_test node test/meu-mundo-convocacoes.e2e.js
const target = process.env.TEST_DATABASE_URL;
let parsed;
try { parsed = new URL(target); } catch { /* guard below */ }
if (!parsed || !["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/mm_gacha_test") {
  console.error("Use somente TEST_DATABASE_URL local com banco descartável mm_gacha_test.");
  process.exit(2);
}
process.env.DATABASE_URL = target;
process.env.DATABASE_SSL = "false";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const key = () => crypto.randomUUID();
let checks = 0;
function check(name, condition, info = "") { assert.ok(condition, name + (info ? " — " + info : "")); checks++; console.log(`✓ ${name}`); }

async function bootstrap(pool) {
  await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await pool.query(`CREATE TABLE tb_user (id_user UUID PRIMARY KEY, username TEXT, email TEXT)`);
  await pool.query(`CREATE TABLE tb_role (id_role SERIAL PRIMARY KEY, desc_role TEXT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`CREATE TABLE tb_user_role (id_user UUID, id_role INT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`INSERT INTO tb_role (desc_role) VALUES ('Administrator')`);
  await require("./helpers/mmPolens").polenTables(pool);
  await pool.query(`CREATE TABLE tb_coupon (id_coupon SERIAL PRIMARY KEY, code TEXT UNIQUE, owner_user_id UUID, expires_at TIMESTAMPTZ, is_active BOOLEAN NOT NULL DEFAULT TRUE)`);
  await pool.query(`CREATE TABLE tb_affiliate (id_user UUID PRIMARY KEY, status TEXT, is_active BOOLEAN DEFAULT TRUE)`);
  const dir = path.join(__dirname, "../src/databases/migrations");
  for (const file of fs.readdirSync(dir).filter((f) => /^\d{3}_meu_mundo/.test(f) && Number(f.slice(0, 3)) >= 291 && !/^(303|312)_/.test(f)).sort()) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await pool.query(sql);
    if (file.startsWith("469_")) await pool.query(sql); // idempotente
  }
}

async function main() {
  const pool = require("../src/databases");
  const Gacha = require("../src/services/MeuMundoGachaService");
  const GearService = require("../src/services/MeuMundoGearService");
  const Life = require("../src/services/MeuMundoLifeService");
  const Rules = require("../src/utils/mmItems/rules/gacha");
  Life.adminPerks = false;
  const realRandom = Gacha.randomInt;
  try {
    await bootstrap(pool);
    const me = key(), other = key();
    for (const user of [me, other]) {
      await pool.query(`INSERT INTO tb_user VALUES ($1, 'gacha', 'gacha@mm.test')`, [user]);
      await Life.peek(user);
    }
    const qty = async (u, id) => Number((await pool.query(`SELECT qty FROM tb_mm_gear WHERE id_user=$1 AND item_id=$2`, [u, id])).rows[0]?.qty || 0);
    const setSpark = (u, n) => pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty) VALUES ($1,'faisca_eter',$2) ON CONFLICT (id_user,item_id) DO UPDATE SET qty=$2`, [u, n]);
    const state = async (u, b) => (await pool.query(`SELECT * FROM tb_mm_gacha_state WHERE id_user=$1 AND banner=$2`, [u, b])).rows[0] || null;
    const receipts = async (u) => Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_receipt WHERE id_user=$1 AND source='gacha_pull'`, [u])).rows[0].count);

    // ── sem Faísca: 402 e nada muda ──
    const k0 = key();
    const none = await Gacha.pull(me, { banner: "weapons", times: 1, key: k0 });
    check("sem Faísca: recusa (402)", none.statusCode === 402 && none.code === "spark", JSON.stringify(none));
    check("sem Faísca: nenhum recibo e nenhum contador", (await receipts(me)) === 0 && !(await state(me, "weapons")));

    // ── validação: banner, times, alvo, chave ──
    await setSpark(me, 100);
    check("banner desconhecido", (await Gacha.pull(me, { banner: "ouro", key: key() })).code === "banner");
    check("quantidade arbitrária recusada", (await Gacha.pull(me, { banner: "weapons", times: 5, key: key() })).code === "times");
    check("quantidade negativa recusada", (await Gacha.pull(me, { banner: "weapons", times: -10, key: key() })).code === "times");
    check("Personagens sem alvo recusa", (await Gacha.pull(me, { banner: "characters", key: key() })).code === "target");
    check("Personagens com guardião não jogável recusa", (await Gacha.pull(me, { banner: "characters", target: "selene", key: key() })).code === "target");
    check("Armas com alvo recusa", (await Gacha.pull(me, { banner: "weapons", target: "golem", key: key() })).code === "target");
    check("sem chave recusa", (await Gacha.pull(me, { banner: "weapons" })).code === "key");
    check("versão antiga do aparelho = 410", (await Gacha.pull(me, { banner: "weapons", key: key(), version: "gacha-v0" })).statusCode === 410);
    check("nenhuma validação gastou Faísca", (await qty(me, "faisca_eter")) === 100);

    // ── 1 giro com RNG fixo: E (2 fragmentos de classe E) ──
    Gacha.randomInt = () => 0;
    const k1 = key();
    const one = await Gacha.pull(me, { banner: "weapons", times: 1, key: k1 });
    check("1 giro: ok", !one.error && !one.replay, JSON.stringify(one).slice(0, 300));
    const r1 = one.receipt.result.results;
    check("1 giro: fragmento de classe E ×2", r1.length === 1 && r1[0].item === "frag_classe_e" && r1[0].qty === 2);
    check("1 giro: gastou 1 Faísca e entregou os fragmentos", (await qty(me, "faisca_eter")) === 99 && (await qty(me, "frag_classe_e")) === 2);
    check("1 giro: contador gravado", (await state(me, "weapons")).since_rare === 1 && (await state(me, "weapons")).pulls === 1);
    check("1 giro: o livro de itens liga ao recibo", Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_item_ledger WHERE id_user=$1 AND id_receipt=$2`, [me, one.receipt.eventId])).rows[0].count) === 2);

    // ── replay: mesma chave = mesmo resultado, sem gastar; mesmo depois de gastar os fragmentos ──
    Gacha.randomInt = () => 999; // se sorteasse de novo, daria Divina
    await pool.query(`UPDATE tb_mm_gear SET qty = 0 WHERE id_user=$1 AND item_id='frag_classe_e'`, [me]);
    const again = await Gacha.pull(me, { banner: "weapons", times: 1, key: k1 });
    check("replay: devolve o recibo original", again.replay === true && again.receipt.eventId === one.receipt.eventId && again.receipt.result.results[0].item === "frag_classe_e");
    check("replay: não gasta nem entrega de novo", (await qty(me, "faisca_eter")) === 99 && (await qty(me, "frag_classe_e")) === 0);
    const rec = await Gacha.recover(me, k1);
    check("recuperar pela chave (recarregou a página): mesmo resultado, nunca sorteia", rec.receipt.eventId === one.receipt.eventId);
    check("mesma chave com outro banner = key_conflict", (await Gacha.pull(me, { banner: "protections", times: 1, key: k1 })).code === "key_conflict");
    check("mesma chave com outra quantidade = key_conflict", (await Gacha.pull(me, { banner: "weapons", times: 10, key: k1 })).code === "key_conflict");
    check("o conflito não gastou nada", (await qty(me, "faisca_eter")) === 99);

    // ── lote de 10 com tudo E: o 10º sem Raro vira Raro (A) — garantia giro a giro ──
    Gacha.randomInt = () => 0;
    const ten = await Gacha.pull(me, { banner: "weapons", times: 10, key: key() });
    const rs = ten.receipt.result.results;
    // 1 giro antes (since_rare=1) → o 9º do lote é o 10º sem Raro
    check("lote: 10 resultados em ordem", rs.length === 10);
    check("lote: o 9º do lote é o Raro garantido (A)", rs[8].pity === "rare" && rs[8].rank === "A", JSON.stringify(rs.map((r) => r.rank)));
    check("lote: gastou 10 de uma vez", (await qty(me, "faisca_eter")) === 89);
    const stw = await state(me, "weapons");
    check("lote: contador depois do lote", stw.since_rare === 1 && stw.since_top === 11 && stw.pulls === 11, JSON.stringify(stw));
    check("lote: soma de fragmentos na mochila", (await qty(me, "frag_classe_e")) === 9 * 2 && (await qty(me, "frag_classe_a")) === 10);

    // ── Topo garantido no 40º, banners separados ──
    await pool.query(`UPDATE tb_mm_gacha_state SET since_top = 39 WHERE id_user=$1 AND banner='weapons'`, [me]);
    const top = await Gacha.pull(me, { banner: "weapons", times: 1, key: key() });
    check("Topo garantido no 40º", top.receipt.result.results[0].pity === "top" && top.receipt.result.results[0].tier === "top");
    check("Topo zera os dois contadores", (await state(me, "weapons")).since_top === 0 && (await state(me, "weapons")).since_rare === 0);
    await Gacha.pull(me, { banner: "protections", times: 1, key: key() });
    check("Proteções tem contador próprio", (await state(me, "protections")).since_top === 1 && (await state(me, "weapons")).since_top === 0);

    // ── Proteções com alvo: a classe do alvo cai no alvo ──
    const legendaryPiece = Rules.PROTECTION_POOL.legendary[5].replace(/^frag_/, "");
    Gacha.randomInt = (n) => (n === 1000 ? 990 : 0);
    const prot = await Gacha.pull(me, { banner: "protections", times: 1, target: legendaryPiece, key: key() });
    check("Proteções: Lendária com alvo cai na peça-alvo", prot.receipt.result.results[0].item === `frag_${legendaryPiece}` && prot.receipt.result.results[0].qty === 18);
    check("Proteções: alvo fica gravado", (await state(me, "protections")).target === legendaryPiece);

    // ── Personagens: 50/50 perdido e garantido no próximo ──
    await pool.query(`INSERT INTO tb_mm_gacha_state (id_user, banner, since_top) VALUES ($1,'characters',39)`, [me]);
    Gacha.randomInt = (n) => (n === 2 ? 1 : 0); // perde o 50/50; o outro = primeiro da lista sem o alvo
    const lose = await Gacha.pull(me, { banner: "characters", times: 1, target: "noctis", key: key() });
    const lr = lose.receipt.result.results[0];
    check("Personagens: perdeu o 50/50 → 20 de outro jogável", lr.tier === "top" && lr.character !== "noctis" && lr.qty === 20 && lr.featured === false);
    check("Personagens: a marca de garantido fica no banco", (await state(me, "characters")).guaranteed === true);
    await pool.query(`UPDATE tb_mm_gacha_state SET since_top = 39 WHERE id_user=$1 AND banner='characters'`, [me]);
    const win = await Gacha.pull(me, { banner: "characters", times: 1, target: "noctis", key: key() });
    check("Personagens: o próximo Topo é do alvo", win.receipt.result.results[0].character === "noctis" && (await qty(me, "frag_deus_noctis")) === 20);
    check("Personagens: a marca saiu", (await state(me, "characters")).guaranteed === false);

    // ── saldo insuficiente para 10 ──
    await setSpark(me, 3);
    const poor = await Gacha.pull(me, { banner: "weapons", times: 10, key: key() });
    check("3 Faíscas não pagam 10 giros (402) e nada muda", poor.code === "spark" && (await qty(me, "faisca_eter")) === 3);

    // ── falha no meio da entrega: nada fica (débito, contador, recibo) ──
    await setSpark(me, 10);
    const before = { st: await state(me, "weapons"), n: await receipts(me), e: await qty(me, "frag_classe_e") };
    const realDeliver = GearService.deliver;
    GearService.deliver = async () => { throw new Error("falha simulada na entrega"); };
    let threw = false;
    try { await Gacha.pull(me, { banner: "weapons", times: 10, key: key() }); } catch { threw = true; }
    GearService.deliver = realDeliver;
    const afterFail = await state(me, "weapons");
    check("falha simulada: a transação volta inteira", threw && (await qty(me, "faisca_eter")) === 10 && (await receipts(me)) === before.n && afterFail.pulls === before.st.pulls && (await qty(me, "frag_classe_e")) === before.e);

    // ── concorrência: 2 lotes de 10 com 15 Faíscas → um passa, outro 402 ──
    await setSpark(me, 15);
    Gacha.randomInt = realRandom;
    const [a, b] = await Promise.all([
      Gacha.pull(me, { banner: "weapons", times: 10, key: key() }),
      Gacha.pull(me, { banner: "weapons", times: 10, key: key() }),
    ]);
    check("concorrência: só um lote é pago", [a, b].filter((x) => !x.error).length === 1 && [a, b].some((x) => x.code === "spark"));
    check("concorrência: sobram 5", (await qty(me, "faisca_eter")) === 5);
    // mesma chave em duas abas ao mesmo tempo → um recibo, mesmo resultado
    const same = key();
    const [c1, c2] = await Promise.all([1, 2].map(() => Gacha.pull(me, { banner: "weapons", times: 1, key: same })));
    check("duas abas, mesma chave: o mesmo recibo", c1.receipt.eventId === c2.receipt.eventId && (await qty(me, "faisca_eter")) === 4);

    // ── jornada: fragmentos do giro → Forja → Cápsula → personagem no Laboratório ──
    const Chars = require("../src/services/MeuMundoCharacterService");
    const WP = require("../src/utils/mmItems/rules/weaponProgress");
    const GearCat = require("../src/utils/meuMundoGear");
    await pool.query(`INSERT INTO tb_mm_char_adventure (id_character, id_user, xp) SELECT id_character, $1, 900000 FROM tb_mm_character WHERE id_user = $1 AND status = 'alive' ON CONFLICT DO NOTHING`, [me]);
    await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'vampiro', 'm') ON CONFLICT DO NOTHING`, [me]);
    // Armas: completa 100 fragmentos A e monta uma arma A na Forja
    await pool.query(`UPDATE tb_mm_gear SET qty = 100 WHERE id_user=$1 AND item_id='frag_classe_a'`, [me]);
    const weaponA = GearCat.GEAR.find((g) => WP.isWeapon(g) && !g.retired && WP.assemblyCost(g)?.rank === "A");
    const built = await GearService.assembleWeapon(me, { item: weaponA.id, key: key() });
    check("Forja: os fragmentos de classe do giro montam uma arma A", !built.error && (await qty(me, "frag_classe_a")) === 0, JSON.stringify(built).slice(0, 200));
    // Personagens: 5 Topos de Noctis (20 cada) = 100 → Cápsula
    Gacha.randomInt = () => 0;
    for (let i = 0; i < 4; i++) {
      await pool.query(`UPDATE tb_mm_gacha_state SET since_top = 39, guaranteed = TRUE WHERE id_user=$1 AND banner='characters'`, [me]);
      await setSpark(me, 1);
      await Gacha.pull(me, { banner: "characters", times: 1, target: "noctis", key: key() });
    }
    check("100 fragmentos de Noctis pelo banner", (await qty(me, "frag_deus_noctis")) === 100);
    const caps = await GearService.forge(me, { recipe: "fabricar_embriao_noctis", key: key() });
    check("Forja: 100 fragmentos viram a Cápsula de Noctis", !caps.error && (await qty(me, "embriao_noctis")) === 1 && (await qty(me, "frag_deus_noctis")) === 0, JSON.stringify(caps).slice(0, 200));
    const capCount = async () => Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_character WHERE id_user=$1 AND status='capsule'`, [me])).rows[0].count);
    const c0 = await capCount();
    const ck = crypto.randomBytes(8).toString("hex");
    const used = await Chars.useCapsule(me, { item: "embriao_noctis", key: ck });
    check("Usar Cápsula: Noctis nasce na cápsula e a Cápsula é gasta", !used.error && (await capCount()) === c0 + 1 && (await qty(me, "embriao_noctis")) === 0, JSON.stringify(used).slice(0, 200));
    const noctis = (await pool.query(`SELECT species FROM tb_mm_character WHERE id_user=$1 AND status='capsule' ORDER BY created_at DESC LIMIT 1`, [me])).rows[0];
    check("Usar Cápsula: a espécie é Noctis", noctis && noctis.species === "noctis");
    const rep = await Chars.useCapsule(me, { item: "embriao_noctis", key: ck });
    check("Usar Cápsula: reenvio da mesma chave não cria outro", !rep.error && (await capCount()) === c0 + 1);
    check("Usar Cápsula sem ter a Cápsula recusa", (await Chars.useCapsule(me, { item: "embriao_noctis", key: crypto.randomBytes(8).toString("hex") })).code === "noCapsule");
    await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty) VALUES ($1,'embriao_selene',1) ON CONFLICT (id_user,item_id) DO UPDATE SET qty=1`, [me]);
    check("Cápsula de guardião não jogável recusa e fica", (await Chars.useCapsule(me, { item: "embriao_selene", key: crypto.randomBytes(8).toString("hex") })).code === "capsuleSoon" && (await qty(me, "embriao_selene")) === 1);
    check("item que não é Cápsula recusa", (await Chars.useCapsule(me, { item: "frag_classe_e", key: crypto.randomBytes(8).toString("hex") })).code === "capsuleItem");
    // cápsula cheia: enche as 5 vagas com Golem repetido (repetido pode) e a 6ª recusa sem gastar
    await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty) VALUES ($1,'embriao_golem',10) ON CONFLICT (id_user,item_id) DO UPDATE SET qty=10`, [me]);
    while ((await capCount()) < 5) {
      const ok = await Chars.useCapsule(me, { item: "embriao_golem", key: crypto.randomBytes(8).toString("hex") });
      assert.ok(!ok.error, JSON.stringify(ok));
    }
    const left = await qty(me, "embriao_golem");
    const alive = Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_character WHERE id_user=$1`, [me])).rows[0].count);
    const full = await Chars.useCapsule(me, { item: "embriao_golem", key: crypto.randomBytes(8).toString("hex") });
    check("cápsula cheia: recusa sem gastar a Cápsula", full.code === "full" && (await qty(me, "embriao_golem")) === left);
    check("cápsula cheia: nenhum personagem some", Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_character WHERE id_user=$1`, [me])).rows[0].count) === alive);

    // ── histórico e recuperação: só da própria pessoa ──
    const hist = await Gacha.history(me, { limit: 5 });
    check("histórico paginado", hist.items.length === 5 && !!hist.next);
    const page2 = await Gacha.history(me, { before: hist.next, limit: 50 });
    check("histórico: a página 2 não repete a 1", page2.items.every((x) => !hist.items.some((y) => y.key === x.key)));
    check("histórico de outra pessoa vem vazio", (await Gacha.history(other, {})).items.length === 0);
    check("outra pessoa não recupera o meu giro", (await Gacha.recover(other, k1)).statusCode === 404);
    check("cursor inválido recusa", (await Gacha.history(me, { before: "ontem" })).code === "cursor");
    const view = await Gacha.get(me);
    check("GET: regras publicadas + saldo + 3 contadores", view.rules.version === Rules.GACHA_VERSION && view.spark === 0 && view.states.length === 3);
    check("GET: faltam N giros para cada garantia", view.states.every((s) => s.toTop >= 1 && s.toTop <= 40 && s.toRare >= 1 && s.toRare <= 10));

    // ══ CONVITES (mig 470) ══
    const Invite = require("../src/services/MeuMundoInviteService");
    const Referral = require("../src/services/ReferralService");
    const realBind = Referral.bind;
    let bound = 0;
    Referral.bind = async () => { bound++; throw new Error("convite do jogo não pode criar vínculo financeiro"); };
    const host = me; // quem convida
    await pool.query(`INSERT INTO tb_coupon (code, owner_user_id) VALUES ('ALEX10', $1), ('VELHO', $2)`, [host, other]);
    await pool.query(`INSERT INTO tb_affiliate (id_user, status) VALUES ($1, 'ACTIVE'), ($2, 'SUSPENDED')`, [host, other]);
    const newUser = async () => {
      const u = key();
      await pool.query(`INSERT INTO tb_user VALUES ($1, 'convidado', 'c@mm.test')`, [u]);
      await Life.peek(u); // a 1ª entrada no jogo cria o personagem
      return u;
    };
    const inv = async (u) => (await pool.query(`SELECT * FROM tb_mm_invite WHERE id_invitee=$1`, [u])).rows[0] || null;
    const play = async (u, ms) => pool.query(
      `INSERT INTO tb_mm_receipt (id_user, id_character, source, action_key, rules_version, active_ms)
       SELECT $1, id_character, 'teste', $2, 'v', $3 FROM tb_mm_character WHERE id_user=$1 AND status='alive' LIMIT 1`,
      [u, key(), ms]);

    check("convite: autoindicação recusa", (await Invite.claim(host, { code: "alex10" })).code === "self");
    const g1 = await newUser();
    check("convite: código inexistente recusa (sem dizer de quem é)", (await Invite.claim(g1, { code: "NAOEXISTE" })).code === "code");
    check("convite: afiliado suspenso não vale", (await Invite.claim(g1, { code: "VELHO" })).code === "code");
    check("convite: código com caractere estranho recusa", (await Invite.claim(g1, { code: "a b;--" })).code === "code");
    check("convite: tentativas inválidas não gravam nada", !(await inv(g1)));
    const okClaim = await Invite.claim(g1, { code: "alex10" });
    check("convite: 1ª entrada com cupom válido vincula", okClaim.linked === true && okClaim.already === false && (await inv(g1)).status === "waiting");
    check("convite: não troca de convidador depois", (await Invite.claim(g1, { code: "VELHO" })).already === true && (await inv(g1)).id_inviter === host);
    const old = await newUser();
    await pool.query(`UPDATE tb_mm_character SET created_at = NOW() - INTERVAL '3 days' WHERE id_user=$1`, [old]);
    check("convite: quem já jogava não conta como novo membro", (await Invite.claim(old, { code: "ALEX10" })).code === "notNew");
    const g2 = await newUser();
    await Promise.all([1, 2, 3].map(() => Invite.claim(g2, { code: "ALEX10" })));
    check("convite: três abas ao mesmo tempo = um vínculo", Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_invite WHERE id_invitee=$1`, [g2])).rows[0].count) === 1);

    // ativação: 14 min não bastam; 15 min ativam (quem convidou estava offline o tempo todo)
    await play(g1, 14 * 60 * 1000);
    let panel = await Invite.get(host);
    check("convite: 14 minutos ainda não ativam", panel.counts.waiting === 2 && panel.counts.pending === 0, JSON.stringify(panel.counts));
    await play(g1, 60 * 1000);
    panel = await Invite.get(host);
    check("convite: 15 minutos ativam e o prêmio espera a volta de quem convidou", panel.counts.pending === 1 && (await inv(g1)).status === "pending");
    check("convite: a rodada começa com os 12 jogáveis", panel.round.available.length === 12 && panel.round.round === 1);
    check("convite: o painel não expõe dados dos convidados", !JSON.stringify(panel).includes(g1) && !JSON.stringify(panel).includes("c@mm.test"));
    check("convite: personagem fora da lista recusa", (await Invite.reward(host, { character: "selene" })).code === "character");
    const fragBefore = await qty(host, "frag_personagem_golem");
    const [w1, w2] = await Promise.all([Invite.reward(host, { character: "golem" }), Invite.reward(host, { character: "golem" })]);
    check("convite: duas abas escolhendo ao mesmo tempo = um crédito", [w1, w2].filter((x) => !x.error).length === 1 && (await qty(host, "frag_personagem_golem")) === fragBefore + 10, JSON.stringify([w1.code, w2.code]));
    check("convite: entregue com recibo e sem prêmio esperando", (await inv(g1)).status === "delivered" && Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_receipt WHERE id_user=$1 AND source='invite_reward'`, [host])).rows[0].count) === 1);
    check("convite: sem prêmio esperando recusa", (await Invite.reward(host, { character: "iris" })).code === "none");
    await play(g2, 20 * 60 * 1000);
    panel = await Invite.get(host);
    check("convite: o escolhido some da lista", panel.counts.pending === 1 && panel.round.available.length === 11 && !panel.round.available.includes("golem"));
    check("convite: não repete na rodada", (await Invite.reward(host, { character: "golem" })).code === "repeated");
    const irisBefore = await qty(host, "frag_deus_iris");
    check("convite: outro personagem vale", !(await Invite.reward(host, { character: "iris" })).error && (await qty(host, "frag_deus_iris")) === irisBefore + 10);
    for (const ch of Rules.CHARACTERS.map((x) => x.id).filter((id) => !["golem", "iris"].includes(id))) {
      const g = await newUser();
      await Invite.claim(g, { code: "ALEX10" });
      await play(g, 16 * 60 * 1000);
      const r = await Invite.reward(host, { character: ch });
      assert.ok(!r.error, JSON.stringify(r));
    }
    panel = await Invite.get(host);
    check("convite: depois dos 12 a lista recomeça", panel.round.round === 2 && panel.round.available.length === 12 && panel.counts.delivered === 12);
    const late = await newUser();
    await Invite.claim(late, { code: "ALEX10" });
    await pool.query(`UPDATE tb_mm_invite SET claimed_at = NOW() - INTERVAL '15 days' WHERE id_invitee=$1`, [late]);
    await play(late, 30 * 60 * 1000); // jogou, mas depois do prazo
    await Invite.get(host);
    check("convite: não ativou em 14 dias → vence sem prêmio", (await inv(late)).status === "expired");
    for (let i = 0; i < 18; i++) {
      const g = key();
      await pool.query(`INSERT INTO tb_user VALUES ($1, 'x', 'x@mm.test')`, [g]);
      await pool.query(`INSERT INTO tb_mm_invite (id_invitee, id_inviter, code, status, activated_at, delivered_at, reward) VALUES ($1,$2,'ALEX10','delivered',NOW(),NOW(),'{"character":"golem"}')`, [g, host]);
    }
    const capped = await newUser();
    await Invite.claim(capped, { code: "ALEX10" });
    await play(capped, 16 * 60 * 1000);
    await Invite.get(host);
    check("convite: acima do teto (30 em 30 dias) fica registrado sem prêmio", (await inv(capped)).status === "capped");
    Referral.bind = realBind;
    check("convite: nenhum vínculo financeiro de afiliado foi tentado", bound === 0);

    console.log(`\n${checks} verificações OK`);
  } finally {
    Gacha.randomInt = realRandom;
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
