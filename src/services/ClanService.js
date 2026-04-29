const pool = require("../databases");
const ClanStorage = require("../storages/ClanStorage");
const StripeService = require("./StripeService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ClanService");

// Regra das 10h temporariamente desabilitada (set para 0 libera todos).
// Para reativar, voltar para 10 * 60.
const REQUIRED_ONLINE_MINUTES = 0;

class ClanService {
  /**
   * Cria um clan. Requisitos:
   *  - Usuário tem 10h+ de tempo online acumulado
   *  - id_profile_owner: sub-perfil válido do usuário (não é clan, ativo, pago)
   *  - id_machine: máquina ativa
   *  - sub-perfil ainda não está em outro clan
   * Cria perfil-clan + settings + adiciona owner como membro do próprio clan.
   */
  static async create(user, payload) {
    return runWithLogs(
      log,
      "create",
      () => ({
        id_user: user?.id_user,
        id_profile_owner: payload?.id_profile_owner,
        id_machine: payload?.id_machine,
      }),
      async () => {
        const id_user = user?.id_user;
        const {
          id_profile_owner,
          id_machine,
          display_name,
          bio,
          avatar_url,
          estado,
          municipio,
        } = payload || {};

        if (!id_user) return { error: "Usuário não autenticado" };
        if (!id_profile_owner)
          return { error: "id_profile_owner é obrigatório" };
        if (!id_machine) return { error: "id_machine é obrigatório" };
        if (!display_name || !String(display_name).trim()) {
          return { error: "display_name é obrigatório" };
        }

        const bioStr = bio ? String(bio).trim() : "";
        if (bioStr.length > 200) {
          return { error: "A bio deve ter no máximo 200 caracteres." };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          // 1. Pré-requisito de tempo online
          const minutes = await ClanStorage.getUserOnlineMinutes(
            client,
            id_user
          );
          if (minutes < REQUIRED_ONLINE_MINUTES) {
            await client.query("ROLLBACK");
            return {
              error: `Para criar um clan é necessário ter pelo menos 10 horas online. Você tem ${Math.floor(minutes / 60)}h${minutes % 60}m.`,
              required_minutes: REQUIRED_ONLINE_MINUTES,
              current_minutes: minutes,
            };
          }

          // 2. Sub-perfil owner deve existir, ser do usuário, não ser clan,
          //    ter assinatura ativa e ainda não estar em outro clan
          const subProfile = await ClanStorage.getEligibleSubProfile(client, {
            id_profile: id_profile_owner,
            id_user,
          });
          if (!subProfile) {
            await client.query("ROLLBACK");
            return {
              error:
                "Sub-perfil não encontrado, não pertence ao usuário ou é um clan",
            };
          }
          if (!subProfile.is_paid) {
            await client.query("ROLLBACK");
            return {
              error:
                "O sub-perfil precisa ter assinatura ativa para criar um clan",
            };
          }

          const existingMembership =
            await ClanStorage.findMembershipByProfile(
              client,
              id_profile_owner
            );
          if (existingMembership) {
            await client.query("ROLLBACK");
            return {
              error:
                "Este sub-perfil já participa de um clan (1 sub-perfil por clan)",
            };
          }

          // 3. Máquina existe e está ativa
          const okMachine = await ClanStorage.machineExistsActive(
            client,
            id_machine
          );
          if (!okMachine) {
            await client.query("ROLLBACK");
            return { error: "Máquina não encontrada ou inativa" };
          }

          // 4. Cria o perfil-clan
          const clan = await ClanStorage.createClanProfile(client, {
            id_user,
            id_machine: Number(id_machine),
            display_name: String(display_name).trim(),
            bio: bioStr || null,
            avatar_url: avatar_url || null,
            estado: estado || null,
            municipio: municipio || null,
          });

          // 5. Settings (3 free + 0 paid)
          await ClanStorage.createSettings(client, clan.id_profile);

          // 6. Owner entra como membro do próprio clan
          await ClanStorage.addMember(client, {
            id_clan_profile: clan.id_profile,
            id_member_profile: id_profile_owner,
            role: "owner",
          });

          await client.query("COMMIT");

          const settings = await ClanStorage.getSettings(pool, clan.id_profile);
          const members = await ClanStorage.listMembers(pool, clan.id_profile);

          return {
            message: "Clan criado com sucesso",
            clan: {
              ...clan,
              settings,
              members,
            },
          };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    );
  }

  static async getById(params) {
    return runWithLogs(
      log,
      "getById",
      () => ({ id_profile: params?.id_profile }),
      async () => {
        const { id_profile } = params || {};
        if (!id_profile) return { error: "id_profile é obrigatório" };

        const clan = await ClanStorage.getClanById(pool, id_profile);
        if (!clan) return { error: "Clan não encontrado" };

        const settings = await ClanStorage.getSettings(pool, id_profile);
        const members = await ClanStorage.listMembers(pool, id_profile);

        return {
          clan: {
            ...clan,
            settings,
            members,
            members_count: members.length,
            max_slots:
              (settings?.free_slots || 0) + (settings?.paid_slots || 0),
          },
        };
      }
    );
  }

  /**
   * Vitrine pública de clans, com filtros opcionais de máquina/cidade/busca,
   * ordenada por ranking decrescente.
   */
  static async listPublic(query) {
    return runWithLogs(
      log,
      "listPublic",
      () => ({
        machine_slug: query?.machine_slug,
        id_machine: query?.id_machine,
        municipio: query?.municipio,
        estado: query?.estado,
      }),
      async () => {
        const SearchStorage = require("../storages/SearchStorage");
        const limit = Math.min(Math.max(Number(query?.limit) || 24, 1), 100);
        const offset = Math.max(Number(query?.offset) || 0, 0);
        const idMachine = query?.id_machine ? Number(query.id_machine) : null;

        const clans = await SearchStorage.searchClans(pool, {
          estado: query?.estado || null,
          municipio: query?.municipio || null,
          id_machine: Number.isFinite(idMachine) ? idMachine : null,
          machine_slug: query?.machine_slug || null,
          q: query?.q || null,
          limit,
          offset,
        });
        return { clans, limit, offset };
      }
    );
  }

  /**
   * Retorna clan público apenas se publicado (assinatura ativa, visível,
   * não deletado). Sem auth.
   */
  static async getPublic(params) {
    return runWithLogs(
      log,
      "getPublic",
      () => ({ id_profile: params?.id_profile }),
      async () => {
        const { id_profile } = params || {};
        if (!id_profile) return { error: "id_profile é obrigatório" };

        const clan = await ClanStorage.getClanById(pool, id_profile);
        if (!clan) return { error: "Clan não encontrado" };
        if (clan.deleted_at || !clan.is_visible || !clan.is_paid) {
          return { error: "Clan não encontrado" };
        }

        const members = await ClanStorage.listMembers(pool, id_profile);
        return {
          clan: {
            id_profile: clan.id_profile,
            display_name: clan.display_name,
            bio: clan.bio,
            avatar_url: clan.avatar_url,
            estado: clan.estado,
            municipio: clan.municipio,
            machine_slug: clan.machine_slug,
            machine_name: clan.machine_name,
            members,
            members_count: members.length,
          },
        };
      }
    );
  }

  static async listMine(user) {
    return runWithLogs(
      log,
      "listMine",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const clans = await ClanStorage.listClansOfUser(pool, user.id_user);
        return { clans };
      }
    );
  }

  // ─── Convites ──────────────────────────────────────────────────────────
  /**
   * Owner do clan convida um sub-perfil. Valida vagas, assinatura do
   * convidado e que ele ainda não está em outro clan.
   */
  static async invite(user, params, payload) {
    return runWithLogs(
      log,
      "invite",
      () => ({
        id_user: user?.id_user,
        id_profile: params?.id_profile,
        id_invited_profile: payload?.id_invited_profile,
      }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const { id_profile: id_clan_profile } = params || {};
        const { id_invited_profile } = payload || {};

        if (!id_clan_profile) return { error: "id_profile do clan é obrigatório" };
        if (!id_invited_profile)
          return { error: "id_invited_profile é obrigatório" };

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          // 1. Clan existe e usuário é owner
          const clan = await ClanStorage.getClanById(client, id_clan_profile);
          if (!clan || clan.deleted_at) {
            await client.query("ROLLBACK");
            return { error: "Clan não encontrado" };
          }

          const ownerCheck = await client.query(
            `SELECT mp.id_user
               FROM public.tb_clan_member cm
               JOIN public.tb_profile mp ON mp.id_profile = cm.id_member_profile
              WHERE cm.id_clan_profile = $1 AND cm.role = 'owner'
              LIMIT 1`,
            [id_clan_profile]
          );
          if (
            !ownerCheck.rowCount ||
            String(ownerCheck.rows[0].id_user) !== String(user.id_user)
          ) {
            await client.query("ROLLBACK");
            return {
              error: "Apenas o dono do clan pode enviar convites",
            };
          }

          // 2. Vagas disponíveis
          const settings = await ClanStorage.getSettings(client, id_clan_profile);
          const max = (settings?.free_slots || 0) + (settings?.paid_slots || 0);
          const current = await ClanStorage.countMembers(client, id_clan_profile);
          const pendingRes = await client.query(
            `SELECT COUNT(*)::int AS n FROM public.tb_clan_invite
              WHERE id_clan_profile = $1 AND status = 'pending'`,
            [id_clan_profile]
          );
          const pending = pendingRes.rows[0].n;
          if (current + pending >= max) {
            await client.query("ROLLBACK");
            return {
              error:
                "Sem vagas disponíveis. Compre uma vaga adicional ou aguarde resposta dos convites pendentes.",
            };
          }

          // 3. Convidado: existe, não é clan, é ativo, com assinatura ativa,
          //    e ainda não está em outro clan
          const invitedRes = await client.query(
            `
            SELECT
              p.id_profile, p.id_user, p.is_clan, p.deleted_at,
              EXISTS (
                SELECT 1 FROM public.tb_profile_subscription ps
                 WHERE ps.id_profile = p.id_profile AND ps.status = 'active'
              ) AS is_paid
            FROM public.tb_profile p
            WHERE p.id_profile = $1
            LIMIT 1
            `,
            [id_invited_profile]
          );
          if (!invitedRes.rowCount) {
            await client.query("ROLLBACK");
            return { error: "Sub-perfil convidado não encontrado" };
          }
          const invited = invitedRes.rows[0];
          if (invited.is_clan || invited.deleted_at) {
            await client.query("ROLLBACK");
            return { error: "Sub-perfil convidado inválido" };
          }
          if (!invited.is_paid) {
            await client.query("ROLLBACK");
            return {
              error: "O sub-perfil convidado precisa ter assinatura ativa",
            };
          }
          if (String(invited.id_user) === String(user.id_user)) {
            await client.query("ROLLBACK");
            return { error: "Você não pode convidar a si mesmo" };
          }

          const existingMembership =
            await ClanStorage.findMembershipByProfile(
              client,
              id_invited_profile
            );
          if (existingMembership) {
            await client.query("ROLLBACK");
            return {
              error: "Este sub-perfil já participa de um clan",
            };
          }

          // 4. Cria invite (UNIQUE pending impede duplicar)
          let invite;
          try {
            invite = await ClanStorage.createInvite(client, {
              id_clan_profile,
              id_invited_profile,
              id_invited_by_user: user.id_user,
              expires_at: null,
            });
          } catch (err) {
            if (err.code === "23505") {
              await client.query("ROLLBACK");
              return { error: "Já existe um convite pendente para este sub-perfil" };
            }
            throw err;
          }

          await client.query("COMMIT");
          return { message: "Convite enviado", invite };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    );
  }

  static async listInvitesByClan(user, params) {
    return runWithLogs(
      log,
      "listInvitesByClan",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const { id_profile: id_clan_profile } = params || {};
        if (!id_clan_profile) return { error: "id_profile do clan é obrigatório" };

        // Permissão: owner OU membro do clan pode ver lista
        const memberCheck = await pool.query(
          `SELECT cm.role
             FROM public.tb_clan_member cm
             JOIN public.tb_profile p ON p.id_profile = cm.id_member_profile
            WHERE cm.id_clan_profile = $1 AND p.id_user = $2
            LIMIT 1`,
          [id_clan_profile, user.id_user]
        );
        if (!memberCheck.rowCount) {
          return { error: "Você não tem permissão para ver convites deste clan" };
        }

        const invites = await ClanStorage.listPendingInvitesByClan(
          pool,
          id_clan_profile
        );
        return { invites };
      }
    );
  }

  static async listMyInvites(user) {
    return runWithLogs(
      log,
      "listMyInvites",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const invites = await ClanStorage.listPendingInvitesForUser(
          pool,
          user.id_user
        );
        return { invites };
      }
    );
  }

  static async respondInvite(user, params, payload) {
    return runWithLogs(
      log,
      "respondInvite",
      () => ({
        id_user: user?.id_user,
        id_clan_invite: params?.id_clan_invite,
        action: payload?.action,
      }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const { id_clan_invite } = params || {};
        const { action } = payload || {};
        if (!id_clan_invite) return { error: "id_clan_invite é obrigatório" };
        if (!["accept", "decline"].includes(action)) {
          return { error: "action deve ser 'accept' ou 'decline'" };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const invite = await ClanStorage.getInviteById(
            client,
            id_clan_invite
          );
          if (!invite) {
            await client.query("ROLLBACK");
            return { error: "Convite não encontrado" };
          }
          if (invite.status !== "pending") {
            await client.query("ROLLBACK");
            return { error: "Convite já foi respondido" };
          }

          // Convidado precisa ser dono do sub-perfil
          const invitedProfileRes = await client.query(
            `SELECT id_user FROM public.tb_profile WHERE id_profile = $1 LIMIT 1`,
            [invite.id_invited_profile]
          );
          if (
            !invitedProfileRes.rowCount ||
            String(invitedProfileRes.rows[0].id_user) !== String(user.id_user)
          ) {
            await client.query("ROLLBACK");
            return { error: "Você não tem permissão para responder este convite" };
          }

          if (action === "decline") {
            await ClanStorage.updateInviteStatus(
              client,
              id_clan_invite,
              "declined"
            );
            await client.query("COMMIT");
            return { message: "Convite recusado" };
          }

          // accept: revalida vagas e que sub-perfil ainda está livre
          const settings = await ClanStorage.getSettings(
            client,
            invite.id_clan_profile
          );
          const max = (settings?.free_slots || 0) + (settings?.paid_slots || 0);
          const current = await ClanStorage.countMembers(
            client,
            invite.id_clan_profile
          );
          if (current >= max) {
            await client.query("ROLLBACK");
            return { error: "O clan já está cheio" };
          }

          const existingMembership =
            await ClanStorage.findMembershipByProfile(
              client,
              invite.id_invited_profile
            );
          if (existingMembership) {
            await client.query("ROLLBACK");
            return {
              error: "Este sub-perfil já participa de outro clan",
            };
          }

          await ClanStorage.addMember(client, {
            id_clan_profile: invite.id_clan_profile,
            id_member_profile: invite.id_invited_profile,
            role: "member",
          });

          await ClanStorage.updateInviteStatus(
            client,
            id_clan_invite,
            "accepted"
          );

          await client.query("COMMIT");
          return { message: "Convite aceito — você agora faz parte do clan" };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    );
  }

  static async cancelInvite(user, params) {
    return runWithLogs(
      log,
      "cancelInvite",
      () => ({ id_user: user?.id_user, id_clan_invite: params?.id_clan_invite }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const { id_clan_invite } = params || {};
        if (!id_clan_invite) return { error: "id_clan_invite é obrigatório" };

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const invite = await ClanStorage.getInviteById(client, id_clan_invite);
          if (!invite) {
            await client.query("ROLLBACK");
            return { error: "Convite não encontrado" };
          }
          if (invite.status !== "pending") {
            await client.query("ROLLBACK");
            return { error: "Convite já foi respondido" };
          }

          // Apenas o owner pode cancelar
          const ownerCheck = await client.query(
            `SELECT mp.id_user
               FROM public.tb_clan_member cm
               JOIN public.tb_profile mp ON mp.id_profile = cm.id_member_profile
              WHERE cm.id_clan_profile = $1 AND cm.role = 'owner'
              LIMIT 1`,
            [invite.id_clan_profile]
          );
          if (
            !ownerCheck.rowCount ||
            String(ownerCheck.rows[0].id_user) !== String(user.id_user)
          ) {
            await client.query("ROLLBACK");
            return { error: "Apenas o dono do clan pode cancelar convites" };
          }

          await ClanStorage.updateInviteStatus(
            client,
            id_clan_invite,
            "canceled"
          );

          await client.query("COMMIT");
          return { message: "Convite cancelado" };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    );
  }

  // ─── Membros: sair e remover ───────────────────────────────────────────
  /**
   * Remove um membro do clan. Owner pode remover qualquer membro (exceto a si);
   * membro pode remover apenas a si próprio (sair). Owner não pode sair sem
   * transferir ownership (não suportado nesta slice — bloqueia).
   */
  static async removeMember(user, params) {
    return runWithLogs(
      log,
      "removeMember",
      () => ({
        id_user: user?.id_user,
        id_profile: params?.id_profile,
        id_member_profile: params?.id_member_profile,
      }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const { id_profile: id_clan_profile, id_member_profile } = params || {};
        if (!id_clan_profile || !id_member_profile) {
          return { error: "id_profile e id_member_profile são obrigatórios" };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          // Carrega membro alvo + acionante
          const targetRes = await client.query(
            `SELECT cm.role, p.id_user
               FROM public.tb_clan_member cm
               JOIN public.tb_profile p ON p.id_profile = cm.id_member_profile
              WHERE cm.id_clan_profile = $1 AND cm.id_member_profile = $2
              LIMIT 1`,
            [id_clan_profile, id_member_profile]
          );
          if (!targetRes.rowCount) {
            await client.query("ROLLBACK");
            return { error: "Membro não encontrado neste clan" };
          }
          const target = targetRes.rows[0];

          if (target.role === "owner") {
            await client.query("ROLLBACK");
            return {
              error:
                "O dono não pode ser removido. Transfira a posse do clan ou exclua-o.",
            };
          }

          const callerRes = await client.query(
            `SELECT cm.role
               FROM public.tb_clan_member cm
               JOIN public.tb_profile p ON p.id_profile = cm.id_member_profile
              WHERE cm.id_clan_profile = $1 AND p.id_user = $2
              LIMIT 1`,
            [id_clan_profile, user.id_user]
          );
          if (!callerRes.rowCount) {
            await client.query("ROLLBACK");
            return { error: "Você não faz parte deste clan" };
          }
          const callerRole = callerRes.rows[0].role;

          const isSelfLeave =
            String(target.id_user) === String(user.id_user);
          const isOwnerKick = callerRole === "owner";
          if (!isSelfLeave && !isOwnerKick) {
            await client.query("ROLLBACK");
            return {
              error:
                "Apenas o dono pode remover outros membros; membros podem apenas sair.",
            };
          }

          await ClanStorage.removeMember(client, {
            id_clan_profile,
            id_member_profile,
          });

          await client.query("COMMIT");
          return {
            message: isSelfLeave
              ? "Você saiu do clan"
              : "Membro removido do clan",
          };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    );
  }

  // ─── Compra de vagas (Stripe one-time) ────────────────────────────────
  /**
   * Cria checkout Stripe one-time para liberar uma vaga adicional (R$50).
   * Apenas owner do clan pode comprar. Limita a 3 vagas pagas (total 6).
   */
  static async createSlotCheckout(user, params) {
    return runWithLogs(
      log,
      "createSlotCheckout",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const { id_profile: id_clan_profile } = params || {};
        if (!id_clan_profile) return { error: "id_profile do clan é obrigatório" };

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const clan = await ClanStorage.getClanById(client, id_clan_profile);
          if (!clan || clan.deleted_at) {
            await client.query("ROLLBACK");
            return { error: "Clan não encontrado" };
          }

          // Apenas owner pode comprar vaga
          const ownerCheck = await client.query(
            `SELECT mp.id_user
               FROM public.tb_clan_member cm
               JOIN public.tb_profile mp ON mp.id_profile = cm.id_member_profile
              WHERE cm.id_clan_profile = $1 AND cm.role = 'owner'
              LIMIT 1`,
            [id_clan_profile]
          );
          if (
            !ownerCheck.rowCount ||
            String(ownerCheck.rows[0].id_user) !== String(user.id_user)
          ) {
            await client.query("ROLLBACK");
            return { error: "Apenas o dono do clan pode comprar vagas" };
          }

          const settings = await ClanStorage.getSettings(client, id_clan_profile);
          if (!settings) {
            await client.query("ROLLBACK");
            return { error: "Settings do clan não encontradas" };
          }
          if (settings.paid_slots >= 3) {
            await client.query("ROLLBACK");
            return {
              error:
                "Limite máximo de 3 vagas pagas já atingido (total de 6 membros).",
            };
          }

          const amount_cents = settings.slot_price_cents || 5000;

          const purchase = await ClanStorage.createSlotPurchase(client, {
            id_clan_profile,
            id_user_payer: user.id_user,
            amount_cents,
          });

          await client.query("COMMIT");

          // Cria session Stripe fora da transação
          const emailRow = await pool.query(
            `SELECT email FROM public.tb_user WHERE id_user = $1 LIMIT 1`,
            [user.id_user]
          );
          const userEmail = emailRow.rows[0]?.email || undefined;
          const baseUrl =
            process.env.FRONTEND_URL ||
            "https://freelandoo.com.br";

          const session = await StripeService.createOneTimeCheckoutSession({
            amount_cents,
            currency: "BRL",
            productName: `Vaga adicional — ${clan.display_name}`,
            customerEmail: userEmail,
            clientReferenceId: String(purchase.id_clan_slot_purchase),
            successUrl: `${baseUrl}/account/clans/${id_clan_profile}?slot_purchase=success`,
            cancelUrl: `${baseUrl}/account/clans/${id_clan_profile}?slot_purchase=cancel`,
            metadata: {
              type: "clan_slot",
              id_clan_slot_purchase: String(purchase.id_clan_slot_purchase),
              id_clan_profile: String(id_clan_profile),
            },
          });

          await ClanStorage.setSlotPurchaseSession(
            pool,
            purchase.id_clan_slot_purchase,
            session.id
          );

          return {
            checkout_url: session.url,
            id_clan_slot_purchase: purchase.id_clan_slot_purchase,
          };
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // ignore — transaction may already be released
          }
          throw err;
        } finally {
          client.release();
        }
      }
    );
  }

  /**
   * Aplica a confirmação do pagamento de uma vaga (chamado pelo webhook
   * Stripe). Idempotente: se já está paid, não incrementa de novo.
   */
  static async confirmSlotPurchaseFromWebhook(stripe_session_id, stripe_payment_intent_id) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const purchase = await ClanStorage.findSlotPurchaseBySession(
        client,
        stripe_session_id
      );
      if (!purchase) {
        await client.query("ROLLBACK");
        log.warn("slot_purchase.row_missing", { stripe_session_id });
        return { error: "Compra de vaga não encontrada" };
      }

      if (purchase.status === "paid") {
        await client.query("ROLLBACK");
        return { ok: true, duplicate: true };
      }

      const updated = await ClanStorage.markSlotPurchasePaid(
        client,
        purchase.id_clan_slot_purchase,
        stripe_payment_intent_id
      );
      if (!updated) {
        await client.query("ROLLBACK");
        return { ok: true, duplicate: true };
      }

      await ClanStorage.incrementPaidSlots(client, purchase.id_clan_profile);

      await client.query("COMMIT");
      return { ok: true };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  static async listSlotPurchases(user, params) {
    return runWithLogs(
      log,
      "listSlotPurchases",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const { id_profile: id_clan_profile } = params || {};
        if (!id_clan_profile) return { error: "id_profile do clan é obrigatório" };

        const membership = await ClanStorage.getUserMembership(
          pool,
          id_clan_profile,
          user.id_user
        );
        if (!membership) {
          return { error: "Apenas membros podem ver compras de vagas" };
        }

        const purchases = await ClanStorage.listSlotPurchasesByClan(
          pool,
          id_clan_profile
        );
        return { purchases };
      }
    );
  }

  // ─── Mensagens ──────────────────────────────────────────────────────────
  static async postMessage(user, params, payload) {
    return runWithLogs(
      log,
      "postMessage",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const { id_profile: id_clan_profile } = params || {};
        const content = String(payload?.content || "").trim();
        if (!id_clan_profile) return { error: "id_profile do clan é obrigatório" };
        if (!content) return { error: "content é obrigatório" };
        if (content.length > 2000)
          return { error: "Mensagem deve ter no máximo 2000 caracteres" };

        const membership = await ClanStorage.getUserMembership(
          pool,
          id_clan_profile,
          user.id_user
        );
        if (!membership) {
          return { error: "Apenas membros do clan podem postar mensagens" };
        }

        const message = await ClanStorage.createMessage(pool, {
          id_clan_profile,
          id_user: user.id_user,
          id_member_profile: membership.id_member_profile,
          content,
        });
        return { message };
      }
    );
  }

  static async listMessages(user, params, query) {
    return runWithLogs(
      log,
      "listMessages",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const { id_profile: id_clan_profile } = params || {};
        if (!id_clan_profile) return { error: "id_profile do clan é obrigatório" };

        const membership = await ClanStorage.getUserMembership(
          pool,
          id_clan_profile,
          user.id_user
        );
        if (!membership) {
          return {
            error: "Apenas membros do clan podem ver as mensagens",
          };
        }

        const messages = await ClanStorage.listMessages(pool, id_clan_profile, {
          limit: query?.limit ? Number(query.limit) : 100,
          before_id: query?.before_id ? Number(query.before_id) : undefined,
        });
        return { messages };
      }
    );
  }

  static async deleteMessage(user, params) {
    return runWithLogs(
      log,
      "deleteMessage",
      () => ({
        id_user: user?.id_user,
        id_clan_message: params?.id_clan_message,
      }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_clan_message = Number(params?.id_clan_message);
        if (!id_clan_message) return { error: "id_clan_message é obrigatório" };

        const msg = await ClanStorage.getMessageById(pool, id_clan_message);
        if (!msg || msg.deleted_at) return { error: "Mensagem não encontrada" };

        // Autor pode deletar; owner do clan também pode (moderação)
        const isAuthor = String(msg.id_user) === String(user.id_user);
        if (!isAuthor) {
          const membership = await ClanStorage.getUserMembership(
            pool,
            msg.id_clan_profile,
            user.id_user
          );
          if (!membership || membership.role !== "owner") {
            return {
              error:
                "Apenas o autor ou o dono do clan podem apagar mensagens",
            };
          }
        }

        await ClanStorage.softDeleteMessage(pool, id_clan_message);
        return { message: "Mensagem apagada" };
      }
    );
  }

  /**
   * Resolve sub-perfis convidáveis por @username (autocompletar do frontend).
   */
  static async findInvitableProfiles(user, query) {
    return runWithLogs(
      log,
      "findInvitableProfiles",
      () => ({ username: query?.username }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const username = String(query?.username || "")
          .replace(/^@/, "")
          .trim();
        if (!username) return { error: "username é obrigatório" };

        const profiles = await ClanStorage.findInvitableProfilesByUsername(
          pool,
          username
        );
        return { profiles };
      }
    );
  }

  /**
   * Retorna se o usuário tem permissão para criar clan agora (10h online).
   * Útil para o frontend habilitar/desabilitar o botão.
   */
  static async getCreationEligibility(user) {
    return runWithLogs(
      log,
      "getCreationEligibility",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const minutes = await ClanStorage.getUserOnlineMinutes(
          pool,
          user.id_user
        );
        return {
          eligible: minutes >= REQUIRED_ONLINE_MINUTES,
          required_minutes: REQUIRED_ONLINE_MINUTES,
          current_minutes: minutes,
        };
      }
    );
  }
}

module.exports = ClanService;
