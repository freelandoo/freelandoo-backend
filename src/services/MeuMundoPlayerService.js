// src/services/MeuMundoPlayerService.js — MEU MUNDO 3D: o card de perfil de
// outro jogador (mm3d-31).
//
// O cliente só conhece o `sessionId` do boneco que tocou (é o que a sala
// manda). Quem traduz para a CONTA é a sala em que QUEM PERGUNTA está: o
// jogador tocado precisa estar nela agora — sessão de outra sala, ou a
// própria, não abre nada. Assim o card nunca mostra o perfil de quem está
// olhando nem o de alguém fora da cena.
//
// Projeção pública campo a campo do perfil-conta (regra 14): nome, @, foto,
// capa (o banner da manifestação ativa), posts públicos (sem os exclusivos de
// comunidade), seguidores/seguindo, avaliações reais e se quem olha já
// segue. Bloqueio em qualquer direção (tb_user_block) ou conta bloqueada (blocked_at) =
// "indisponível", sem dado nenhum além do nome que a sala já mostra.

const pool = require("../databases");
const UserBlockStorage = require("../storages/UserBlockStorage");
const UserPublicSummaryStorage = require("../storages/UserPublicSummaryStorage");
const EntityFollowStorage = require("../storages/EntityFollowStorage");
const ManifestationStorage = require("../storages/ManifestationStorage");

const fail = (error, code, statusCode) => ({ error, code, statusCode });
const SID = /^[A-Za-z0-9_-]{4,64}$/;

class MeuMundoPlayerService {
  static async profile(viewerId, rawSession) {
    const sessionId = String(rawSession || "");
    if (!SID.test(sessionId)) return fail("Jogador não encontrado", "gone", 404);
    const found = require("../realtime/meuMundo").playerInMyRoom(viewerId, sessionId);
    if (!found) return fail("Esse jogador não está mais aqui", "gone", 404);
    const { userId, name } = found;
    if (String(userId) === String(viewerId)) return fail("Esse é você", "self", 404);

    const [blocked, state] = await Promise.all([
      UserBlockStorage.eitherBlocks(pool, viewerId, userId),
      UserBlockStorage.accountState(pool, userId),
    ]);
    if (blocked || !state || state.blocked_at) {
      return { player: { sessionId, name, online: true, unavailable: true } };
    }
    const acc = await UserPublicSummaryStorage.getAccountProfile(pool, userId);
    if (!acc) return { player: { sessionId, name, online: true, unavailable: true } };

    const type = EntityFollowStorage.normalizeType("profile");
    const viewerAcc = await UserPublicSummaryStorage.getAccountProfile(pool, viewerId);
    const [user, counts, posts, rating, banner, follow] = await Promise.all([
      pool.query(`SELECT username FROM public.tb_user WHERE id_user = $1`, [userId]),
      EntityFollowStorage.counts(pool, { entity_type: type, entity_id: acc.id_profile }),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM public.tb_profile_portfolio_item
          WHERE id_profile = $1 AND is_active = TRUE AND id_exclusive_community IS NULL`,
        [acc.id_profile]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n, COALESCE(AVG(rating), 0)::float AS avg
           FROM public.profile_ratings WHERE id_profile = $1`,
        [acc.id_profile]
      ),
      ManifestationStorage.getActiveForProfile(pool, acc.id_profile).catch(() => null),
      viewerAcc
        ? EntityFollowStorage.findActive(pool, { follower_type: type, follower_id: viewerAcc.id_profile, target_type: type, target_id: acc.id_profile })
        : null,
    ]);
    return {
      player: {
        sessionId,
        name,
        online: true,
        unavailable: false,
        profileId: acc.id_profile,
        displayName: acc.display_name || null,
        username: user.rows[0]?.username || null,
        avatarUrl: acc.avatar_url || null,
        coverUrl: (banner && (banner.banner_thumb_url || banner.banner_url)) || null,
        posts: posts.rows[0].n,
        followers: Number(counts?.followers_count) || 0,
        following: Number(counts?.following_count) || 0,
        ratings: { count: rating.rows[0].n, avg: Math.round(rating.rows[0].avg * 10) / 10 },
        isFollowing: !!follow,
        // Quem segue é o perfil-conta de quem olha (o "ator" do /entity-follows).
        viewerProfileId: viewerAcc ? viewerAcc.id_profile : null,
      },
    };
  }
}

module.exports = MeuMundoPlayerService;
