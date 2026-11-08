/**
 * Aba Ranking do Meu Mundo (B7, 2026-11-08): Poder, Nível e Freelandoo.
 *
 * O Poder (fórmula do B7, regra única em src/utils/meuMundoPower.js) é recalculado DENTRO da
 * transação da vida (MeuMundoLifeService.withLife → MeuMundoPowerService.refresh) e guardado em
 * tb_mm_character.power (migs 334/335) — sem job. Quem fica parado guarda o último valor até
 * voltar ao jogo (a queda dos atributos é preguiçosa, como toda a vida).
 *
 * Abas: "poder", "nivel" (nível de aventura) e "freelandoo" (pontos do perfil-conta, pelo
 * RankingStorage do site). Top 100 do Brasil + a posição de quem pergunta.
 */
const pool = require("../databases");
const Store = require("../storages/MeuMundoPoderStorage");
const RankingStorage = require("../storages/RankingStorage");

const TABS = Object.freeze(["poder", "nivel", "freelandoo"]);
const TOP = 100;

const PowerService = () => require("./MeuMundoPowerService");
const LifeStorage = () => require("../storages/MeuMundoLifeStorage");

class MeuMundoPoderService {
  /** GET /ranking/:tab — top 100 + a minha linha. */
  static async ranking(idUser, tab) {
    if (!TABS.includes(tab)) return { error: "Ranking não encontrado", statusCode: 404 };
    if (tab === "freelandoo") return MeuMundoPoderService.freelandoo(idUser);
    // Passa pela vida antes: o meu número sai certo de agora (e quem nunca entrou depois da
    // mig 335 ganha o número).
    await require("./MeuMundoLifeService").withLife(idUser);
    const [top, me] =
      tab === "poder"
        ? await Promise.all([Store.topPower(pool, TOP), Store.myPower(pool, idUser)])
        : await Promise.all([Store.topLevel(pool, TOP), Store.myLevel(pool, idUser)]);
    // As parcelas (força, …, HP, equipamento) só da minha linha: a tela mostra o meu detalhe.
    if (tab === "poder" && me) me.parts = await MeuMundoPoderService.myParts(idUser);
    return { tab, scope: "br", top, me };
  }

  /** Parcelas do meu Poder agora (a mesma conta que o servidor grava). */
  static async myParts(idUser) {
    const r = await pool.query(`SELECT * FROM tb_mm_character WHERE id_user = $1 AND status = 'alive' ORDER BY generation DESC LIMIT 1`, [idUser]);
    if (!r.rows[0]) return undefined;
    return (await PowerService().score(pool, idUser, LifeStorage().rowToState(r.rows[0]))).parts;
  }

  /** Pontos do perfil na Freelandoo (o mesmo ranking geral do site). */
  static async freelandoo(idUser) {
    const rows = await RankingStorage.getTopGeneral(pool, { limit: TOP });
    const row = (r, position) => ({
      position,
      value: Math.round(Number(r.total_points) || 0),
      idProfile: r.id_profile,
      name: r.display_name || r.username || "",
      username: r.username || null,
      avatar: r.avatar_url || null,
      profileSlug: r.sub_profile_slug || null,
      isUserAccount: !!r.is_user_account,
      body: null,
    });
    const top = rows.filter((r) => r.position_general != null).map((r) => row(r, Number(r.position_general)));
    let me = null;
    const idProfile = await Store.accountProfile(pool, idUser);
    if (idProfile) {
      const pos = await RankingStorage.getPublicProfilePosition(pool, { id_profile: idProfile });
      if (pos && pos.position_general != null) {
        const mine = top.find((t) => t.idProfile === idProfile);
        me = mine || { ...row({ ...pos, id_profile: idProfile }, Number(pos.position_general)), name: "" };
      }
    }
    return { tab: "freelandoo", scope: "br", top, me };
  }
}

MeuMundoPoderService.TABS = TABS;
module.exports = MeuMundoPoderService;
