// src/services/CommunityLeadershipService.js
// Abertura (no rollover, p/ comunidades estagnadas), cédulas e resolução das
// votações de liderança. Líder × membro de maior nível; janela 7 dias; maioria
// simples; empate mantém; líder destituído vira vice; troca re-baseia o XP.

const pool = require("../databases");
const CommunityVoteStorage = require("../storages/CommunityVoteStorage");
const CommunityRankingService = require("./CommunityRankingService");
const CommunityXpService = require("./CommunityXpService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CommunityLeadershipService");

const VOTE_WINDOW_DAYS = 7;

class CommunityLeadershipService {
  // Chamado no rollover de temporada (RankingStorage). Abre votos para as
  // comunidades estagnadas que tenham um membro de nível > líder.
  static async openEligibleVotes(db, season_number) {
    try {
      const eligible = await CommunityRankingService.getEligibleForVote(
        db,
        season_number
      );
      let opened = 0;
      for (const id_community of eligible) {
        if (await CommunityVoteStorage.hasOpenVote(db, id_community)) continue;
        const leaderUser = await CommunityVoteStorage.getLeaderUser(db, id_community);
        if (!leaderUser) continue;
        const challenger = await CommunityVoteStorage.findChallenger(db, id_community);
        if (!challenger) continue; // líder já é o de maior nível
        const id_vote = await CommunityVoteStorage.createVote(db, {
          id_community,
          id_leader_user: leaderUser,
          id_challenger_user: challenger.id_user,
          days: VOTE_WINDOW_DAYS,
        });
        if (id_vote) opened += 1;
      }
      log.info("openEligibleVotes.ok", { season_number, eligible: eligible.length, opened });
    } catch (err) {
      log.error("openEligibleVotes.fail", { season_number, error: err.message });
    }
  }

  static async listPending(user) {
    return runWithLogs(
      log,
      "listPending",
      () => ({ id_user: user?.id_user }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };
        const votes = await CommunityVoteStorage.listPendingForUser(pool, id_user);
        return { votes };
      }
    );
  }

  static async castBallot(user, params, body) {
    return runWithLogs(
      log,
      "castBallot",
      () => ({ id_user: user?.id_user, id_vote: params?.id_vote }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };
        const choice = body?.choice;
        if (choice !== "leader" && choice !== "challenger") {
          return { error: "Escolha inválida." };
        }
        const vote = await CommunityVoteStorage.getOpenVoteById(pool, params.id_vote);
        if (!vote) return { error: "Votação não encontrada ou encerrada", statusCode: 404 };
        const member = await CommunityVoteStorage.isMember(
          pool,
          vote.id_community,
          id_user
        );
        if (!member) return { error: "Apenas membros podem votar." };
        const ok = await CommunityVoteStorage.castBallot(pool, {
          id_vote: params.id_vote,
          id_user,
          choice,
        });
        return { ok: true, already_voted: !ok };
      }
    );
  }

  // Fecha votos vencidos. Idempotente (só pega status='open' com closes_at<=now).
  static async resolveDueVotes(db) {
    try {
      const due = await CommunityVoteStorage.listDueVotes(db);
      for (const vote of due) {
        const t = await CommunityVoteStorage.tally(db, vote.id_vote);
        if (t.challenger > t.leader) {
          await CommunityVoteStorage.applyLeadershipChange(db, {
            id_community: vote.id_community,
            old_leader_user: vote.id_leader_user,
            new_leader_user: vote.id_challenger_user,
          });
          await CommunityVoteStorage.closeVote(db, vote.id_vote, "leader_changed");
          // Troca de líder re-baseia o XP espelhado.
          await CommunityXpService.recalc(db, vote.id_community);
          log.info("resolveDueVotes.changed", {
            id_vote: vote.id_vote,
            id_community: vote.id_community,
            new_leader: vote.id_challenger_user,
          });
        } else {
          const result = t.challenger === t.leader ? "tie_kept" : "leader_kept";
          await CommunityVoteStorage.closeVote(db, vote.id_vote, result);
          log.info("resolveDueVotes.kept", { id_vote: vote.id_vote, result });
        }
      }
    } catch (err) {
      log.error("resolveDueVotes.fail", { error: err.message });
    }
  }
}

module.exports = CommunityLeadershipService;
