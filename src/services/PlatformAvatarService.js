// src/services/PlatformAvatarService.js
//
// A FOTO DENTRO DE UMA PLATAFORMA (mig 233) — games e Financeiro.
//
// Pedido do Alex (2026-09-09): "a foto de perfil você vai puxar do perfil
// principal, sempre. Mas, se a pessoa quiser alterar, ela altera e só altera o
// games. Assim também precisa ser no financeiro."
//
// ⚠️ A REGRA INTEIRA É UMA LINHA — `override ?? tb_user.avatar` — e ela mora
// AQUI, num lugar só. Escrita em cada tela que mostra um rosto dentro da
// plataforma (o headcard, a fila do ranking, a estante de alguém), a que
// esquecesse mostraria a foto errada sem erro nenhum aparecer: é exatamente o
// defeito que a mig 215 teve de desfazer quando a foto do perfil-conta tinha
// três fontes.
//
// ⚠️ NÃO CONFUNDIR COM `tb_user.avatar`. Aquilo é o ROSTO DA PESSOA no site
// inteiro (mig 215) e continua sendo a fonte única dele. Isto é uma máscara que
// vale DENTRO de uma plataforma, e só. Trocar a foto de games não pode tocar
// naquela coluna — se tocasse, "só altera o games" seria mentira.

const pool = require("../databases/index");
const PlatformAvatarStorage = require("../storages/PlatformAvatarStorage");
const uploadPlatformAvatarToR2 = require("../integrations/r2/uploadPlatformAvatar");
const { processAvatarImage } = require("../utils/mediaProcessing");
const { PLATFORM_KINDS } = require("../utils/gamesScore");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("PlatformAvatarService");

/** O `kind` chega da URL: confere antes de tocar no banco. */
function badKind(kind) {
  if (PLATFORM_KINDS.includes(kind)) return null;
  return { error: "Plataforma desconhecida.", statusCode: 404 };
}

module.exports = class PlatformAvatarService {
  /**
   * A foto EFETIVA de uma pessoa dentro da plataforma.
   *
   * Recebe o avatar de sempre já em mãos (quem chama normalmente acabou de ler
   * a linha do usuário) para não pagar uma segunda ida ao banco só por causa
   * de uma coluna que já estava na mesa.
   */
  static async resolve(id_user, kind, fallbackAvatar = null, conn = pool) {
    if (!id_user || badKind(kind)) return fallbackAvatar || null;
    const override = await PlatformAvatarStorage.get(conn, id_user, kind);
    return override || fallbackAvatar || null;
  }

  /**
   * Aplica os overrides sobre uma LISTA de linhas que já carregam `id_user` e
   * `avatar_url` — as filas do ranking, a comparação, a estante.
   *
   * Uma consulta só para a lista inteira: perguntar linha a linha faria a fila
   * de 50 pessoas custar 50 idas ao banco.
   */
  static async applyToRows(rows, kind, conn = pool) {
    if (!Array.isArray(rows) || rows.length === 0 || badKind(kind)) return rows;
    const map = await PlatformAvatarStorage.mapFor(
      conn,
      rows.map((r) => r.id_user),
      kind
    );
    if (map.size === 0) return rows;
    return rows.map((r) => {
      const override = map.get(String(r.id_user));
      return override ? { ...r, avatar_url: override } : r;
    });
  }

  /** O que a tela de configuração precisa saber: tem override? qual é? */
  static async mine(id_user, kind) {
    return runWithLogs(log, "mine", () => ({ id_user, kind }), async () => {
      const bad = badKind(kind);
      if (bad) return bad;
      const override = await PlatformAvatarStorage.get(pool, id_user, kind);
      return { kind, avatar_url: override, is_override: !!override };
    });
  }

  /** Troca a foto DAQUELA plataforma. Nunca toca em `tb_user.avatar`. */
  static async upload(id_user, kind, file) {
    return runWithLogs(log, "upload", () => ({ id_user, kind }), async () => {
      const bad = badKind(kind);
      if (bad) return bad;
      if (!file) return { error: "Arquivo não enviado.", statusCode: 400 };

      // A MESMA régua de imagem do avatar de perfil: mesmo corte, mesmo teto
      // de tamanho. Uma régua própria aqui deixaria a foto da plataforma
      // pesar mais que a do perfil na mesma tela.
      const processed = await processAvatarImage(file);
      const avatar_url = await uploadPlatformAvatarToR2({ id_user, kind, file: processed });
      const saved = await PlatformAvatarStorage.set(pool, id_user, kind, avatar_url);
      return { kind, avatar_url: saved, is_override: true };
    });
  }

  /**
   * Volta a herdar o rosto da pessoa.
   *
   * ⚠️ Responde OK mesmo sem linha para apagar: quem apertou "usar a minha
   * foto" quer o estado final, e um 404 aqui faria a tela mostrar erro para
   * uma ação que já estava feita.
   */
  static async reset(id_user, kind) {
    return runWithLogs(log, "reset", () => ({ id_user, kind }), async () => {
      const bad = badKind(kind);
      if (bad) return bad;
      const removed = await PlatformAvatarStorage.remove(pool, id_user, kind);
      return { kind, avatar_url: null, is_override: false, removed };
    });
  }
};
