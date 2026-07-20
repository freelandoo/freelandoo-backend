// src/services/CoursesService.js
// Regras de negócio dos cursos (Slice 2).
//
// Decisões:
// - Qualquer usuário logado pode criar curso (sem dependência de assinatura).
// - Curso nasce em status='draft'.
// - Para publicar (status='published'): title obrigatório + price_cents >= 500.
// - Slug é gerado automaticamente a partir do title e desambiguado (foo, foo-2, foo-3).
// - profile_id é opcional; quando informado precisa pertencer ao próprio user.
// - Apenas o owner_user_id pode editar/pausar/excluir.

const pool = require("../databases");
const CoursesStorage = require("../storages/CoursesStorage");
const CourseFeedPostsStorage = require("../storages/CourseFeedPostsStorage");
const CourseMemberStorage = require("../storages/CourseMemberStorage");
const ClanStorage = require("../storages/ClanStorage");
const ClanPayoutStorage = require("../storages/ClanPayoutStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const StripeService = require("./StripeService");
const StoreGovernanceService = require("./StoreGovernanceService");
const AffiliateConversionService = require("./AffiliateConversionService");
const NotificationService = require("./NotificationService");
const uploadCourseImageToR2 = require("../integrations/r2/uploadCourseImageToR2");
const { assertMinorPermission } = require("../utils/supervision");
const { slugify } = require("../utils/slug");
const { parseAffiliateOptIn } = require("../utils/affiliateOptIn");
const { isFullRefund } = require("../utils/refunds");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CoursesService");

const MIN_PUBLISH_PRICE_CENTS = 500;
const TITLE_MAX_LEN = 160;
const SHORT_DESC_MAX_LEN = 280;
const DESC_MAX_LEN = 20000;
const COVER_URL_MAX_LEN = 1024;

function sanitizeText(value, maxLen) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return maxLen ? s.slice(0, maxLen) : s;
}

function parsePriceCents(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return Math.floor(n);
}

function normalizeStatus(value) {
  const s = String(value || "").toLowerCase();
  return ["draft", "published", "paused"].includes(s) ? s : null;
}

function toCents(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
}

async function ensureUniqueSlug(conn, base, exceptId = null) {
  const root = slugify(base) || "curso";
  let candidate = root.slice(0, 80);
  let suffix = 1;
  // Tenta o slug "puro" primeiro; se colidir, vai pra -2, -3, ...
  // Hard cap em 100 tentativas para não loopar em catástrofe.
  while (await CoursesStorage.slugExists(conn, candidate, { exceptId })) {
    suffix += 1;
    candidate = `${root.slice(0, 80 - String(suffix).length - 1)}-${suffix}`;
    if (suffix > 100) {
      candidate = `${root.slice(0, 70)}-${Date.now().toString(36)}`;
      break;
    }
  }
  return candidate;
}

async function profileBelongsToUser(conn, profileId, userId) {
  if (!profileId) return true;
  const { rows } = await conn.query(
    `SELECT id_user, is_clan FROM public.tb_profile WHERE id_profile = $1 LIMIT 1`,
    [profileId],
  );
  if (!rows.length) return false;
  if (rows[0].id_user === userId) return true;
  // Clan coletivo: qualquer MEMBRO pode vincular/criar curso no clan.
  if (rows[0].is_clan) {
    const m = await conn.query(
      `SELECT 1 FROM public.tb_clan_member cm
         JOIN public.tb_profile p ON p.id_profile = cm.id_member_profile
        WHERE cm.id_clan_profile = $1 AND p.id_user = $2 LIMIT 1`,
      [profileId, userId],
    );
    return m.rowCount > 0;
  }
  return false;
}

// Valida que os perfis a anexar são membros do clan. Retorna erro ou null.
async function validateCourseClanMembers(conn, id_clan_profile, memberIds) {
  if (!memberIds || memberIds.length === 0) return null;
  const members = await ClanStorage.listMembers(conn, id_clan_profile);
  const valid = new Set(members.map((m) => String(m.id_member_profile)));
  for (const id of memberIds) {
    if (!valid.has(String(id))) return { error: "Perfil anexado não pertence ao clan" };
  }
  return null;
}

function parseMemberProfileIds(body) {
  if (!Object.prototype.hasOwnProperty.call(body, "member_profile_ids")) return undefined;
  const arr = body.member_profile_ids;
  if (!Array.isArray(arr)) return { error: "member_profile_ids deve ser array" };
  const seen = new Set();
  for (const id of arr) {
    if (typeof id !== "string" || !id.trim()) return { error: "member_profile_ids contém id inválido" };
    seen.add(id.trim());
  }
  return [...seen];
}

function publicCourseShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    profile_id: row.profile_id || null,
    profile_display_name: row.profile_display_name || null,
    title: row.title,
    slug: row.slug,
    short_description: row.short_description,
    description: row.description,
    cover_url: row.cover_url,
    price_cents: row.price_cents,
    status: row.status,
    feed_post_id: row.feed_post_id || null,
    affiliates_allowed: row.affiliates_allowed ?? false,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // modules_count populado pelo storage via JOIN (Slice 4).
    // lessons_count populado pelo storage via JOIN (Slice 5).
    modules_count: row.modules_count ?? 0,
    lessons_count: row.lessons_count ?? 0,
    students_count: row.students_count ?? 0,
    revenue_cents: row.revenue_cents ?? 0,
  };
}

class CoursesService {
  // --------------------------------------------------------------
  // Listagens
  // --------------------------------------------------------------

  static async listMine(user) {
    return runWithLogs(
      log,
      "listMine",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const rows = await CoursesStorage.listByOwner(pool, user.id_user);
        return { courses: rows.map(publicCourseShape) };
      },
    );
  }

  /**
   * Cria sessão Stripe one-time para comprar um curso publicado.
   * - Bloqueia se user é dono do curso ou já tem enrollment ativo.
   * - metadata.type='course_purchase' → webhook chama confirmStripeSession.
   */
  static async createStripeCheckout(user, courseId, body = {}) {
    return runWithLogs(
      log,
      "createStripeCheckout",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!courseId) return { error: "course_id inválido" };
        const course = await CoursesStorage.getById(pool, courseId);
        if (!course) return { error: "Curso não encontrado", status: 404 };
        if (course.status !== "published") {
          return { error: "Curso não está publicado", status: 400 };
        }
        if (course.owner_user_id === user.id_user) {
          return { error: "Você é o dono deste curso", status: 400 };
        }
        const already = await CoursesStorage.hasActiveEnrollment(
          pool,
          courseId,
          user.id_user,
        );
        if (already) {
          return { error: "Você já tem acesso a este curso", status: 400 };
        }
        // Fee model completo (igual loja): price_cents é o valor que o vendedor
        // recebe; o comprador paga o display (serviço + maquininha gross-up +
        // afiliado embutido quando opt-in). Decisão Alex 2026-06-03.
        const seller_cents = Number(course.price_cents) || 0;
        if (seller_cents <= 0) {
          return { error: "Curso sem preço configurado", status: 400 };
        }
        const affiliatesAllowed = course.affiliates_allowed === true;
        const pricing = await StoreGovernanceService.computeFeesFor(seller_cents, { affiliatesAllowed });
        const display = pricing.display_price_cents;
        const affiliate_commission_cents = pricing.affiliate_commission_cents || 0;

        const frontend = String(
          process.env.FRONTEND_URL || "https://freelandoo.com",
        ).replace(/\/$/, "");

        const session = await StripeService.createOneTimeCheckoutSession({
          amount_cents: display,
          currency: "BRL",
          productName: `Curso - ${course.title}`,
          customerEmail: user.email || undefined,
          clientReferenceId: user.id_user,
          successUrl: `${frontend}/cursos/${course.slug}?course_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${frontend}/cursos/${course.slug}?course_checkout=cancel`,
          metadata: {
            type: "course_purchase",
            user_id: user.id_user,
            course_id: course.id,
            // amount_cents = o que o comprador paga; seller_amount_cents = receita
            // do dono (vai pra matrícula/revenue, sem as taxas embutidas).
            amount_cents: String(display),
            seller_amount_cents: String(seller_cents),
            service_fee_cents: String(pricing.service_fee_cents || 0),
            total_cents: String(display),
            // Comissão de afiliado SÓ quando o curso tem opt-in (gate real).
            ...(affiliatesAllowed && body?.coupon_code && affiliate_commission_cents > 0
              ? {
                  coupon_code: String(body.coupon_code).trim().toUpperCase().slice(0, 40),
                  affiliate_commission_cents: String(affiliate_commission_cents),
                }
              : {}),
          },
        });
        return { checkout_url: session.url, session_id: session.id };
      },
    );
  }

  /**
   * Confirma uma sessão Stripe com metadata.type='course_purchase'.
   * Idempotente via UNIQUE(course_id, user_id) em course_enrollments.
   */
  static async confirmStripeSession(session) {
    const meta = session?.metadata || {};
    if (meta.type !== "course_purchase") return { ignored: true };
    const courseId = meta.course_id;
    const userId = meta.user_id;
    // Receita do dono = seller value (price_cents), não o display cobrado. Fallback
    // para amount_cents em sessões legadas (antes do fee model).
    const amount = toCents(meta.seller_amount_cents, toCents(meta.amount_cents, 0));
    const totalCents = toCents(session?.amount_total, toCents(meta.total_cents, toCents(meta.amount_cents, amount)));
    const feeCents = toCents(meta.service_fee_cents, Math.max(0, totalCents - amount));
    const paymentIntent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;
    if (!courseId || !userId) {
      return { error: "Metadata inválido" };
    }
    const enrollment = await CoursesStorage.upsertEnrollment(pool, {
      courseId,
      userId,
      amountCents: amount,
      currency: "BRL",
      stripeSessionId: session.id,
      stripePaymentIntent: paymentIntent,
      totalCents,
      feeCents,
    });

    // Curso de clan: divide o líquido (amount = seller, já pós-taxa) IGUAL entre
    // os perfis anexados, creditando o Saldo de cada um (tb_clan_payout, 8 dias).
    try {
      await CoursesService.recordClanSplitForCourse(courseId, userId, amount);
    } catch (err) {
      log.error("course.clan_split.fail", { courseId, error: err.message });
    }

    // Notifica o dono do curso só na 1ª matrícula (was_inserted) — webhook é
    // at-least-once, então DO UPDATE em retry não deve renotificar.
    if (enrollment?.was_inserted) {
      try {
        const course = await CoursesStorage.getById(pool, courseId);
        if (course) {
          NotificationService.notifyCourseSale({
            owner_user_id: course.owner_user_id,
            owner_profile_id: course.profile_id,
            buyer_user_id: userId,
            id_course: courseId,
            amount_cents: amount,
            course_title: course.title,
          }).catch(() => {});
        }
      } catch (err) {
        log.warn("course.notify_sale.fail", { courseId, error: err.message });
      }
    }

    return { enrollment };
  }

  static async handleChargeRefunded(charge) {
    const paymentIntentId =
      typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id || null;
    if (!paymentIntentId) return { ignored: true };

    const enrollment = await CoursesStorage.getEnrollmentByPaymentIntent(pool, paymentIntentId);
    if (!enrollment) return { ignored: true };
    if (enrollment.status === "refunded") return { enrollment, duplicate: true };
    if (!isFullRefund(charge)) {
      log.warn("refund.partial_ignored", {
        enrollment_id: enrollment.id,
        amount: charge.amount,
        amount_refunded: charge.amount_refunded,
      });
      return { partial: true };
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await CoursesStorage.markEnrollmentRefunded(client, enrollment.id);
      await ClanPayoutStorage.revertBySource(
        client,
        "clan_course",
        `${enrollment.course_id}:${enrollment.user_id}`,
      );

      let order = null;
      if (enrollment.stripe_session_id) {
        const bySession = await client.query(
          `SELECT * FROM public.tb_order
            WHERE payment_provider = 'stripe' AND payment_provider_ref = $1
            LIMIT 1`,
          [enrollment.stripe_session_id],
        );
        order = bySession.rows[0] || null;
      }
      if (!order) {
        const byPaymentIntent = await client.query(
          `SELECT * FROM public.tb_order
            WHERE payment_provider = 'stripe' AND payment_provider_ref = $1
            LIMIT 1`,
          [paymentIntentId],
        );
        order = byPaymentIntent.rows[0] || null;
      }
      if (order) {
        await AffiliateConversionService.onOrderStatusChange(client, {
          order,
          newStatus: "CANCELED",
          source: "stripe_webhook",
          source_event_id: `charge.refunded:${charge.id}`,
          payload: {
            charge_id: charge.id,
            amount_refunded: charge.amount_refunded,
            course_enrollment_id: enrollment.id,
          },
        });
      }

      await client.query("COMMIT");
      return { enrollment: updated };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Se o curso pertence a um perfil-clan, divide `amount` igual entre os perfis
   * anexados (tb_course_member) no Saldo de cada um. Idempotente por curso+comprador.
   */
  static async recordClanSplitForCourse(courseId, buyerUserId, amount) {
    if (!courseId || !(amount > 0)) return null;
    const course = await CoursesStorage.getById(pool, courseId);
    if (!course || !course.profile_id) return null;
    const profile = await ProfileStorage.getProfileById(pool, course.profile_id);
    if (!profile || !profile.is_clan) return null;

    const sourceId = `${courseId}:${buyerUserId}`;
    if (await ClanPayoutStorage.existsForSource(pool, "clan_course", sourceId)) {
      return null;
    }

    const memberIds = await CourseMemberStorage.getMemberIds(pool, courseId);
    if (memberIds.length === 0) return null;

    const owners = await ProfileStorage.getOwnerUserMap(pool, memberIds);
    const N = memberIds.length;
    const per = Math.floor(amount / N);
    const remainder = amount - per * N;
    const rows = memberIds
      .filter((id) => owners[id])
      .map((id_member_profile, idx) => ({
        id_member_profile,
        id_owner_user: owners[id_member_profile],
        amount_cents: per + (idx === 0 ? remainder : 0),
      }));
    if (rows.length === 0) return null;

    return ClanPayoutStorage.createSplits(pool, {
      id_clan_profile: course.profile_id,
      source_type: "clan_course",
      source_id: sourceId,
      gross_cents: amount,
      rows,
    });
  }

  /**
   * Lista cursos publicados vinculados a um subperfil. Sem auth.
   */
  static async listPublicByProfile(profileId) {
    return runWithLogs(
      log,
      "listPublicByProfile",
      () => ({ profileId }),
      async () => {
        if (!profileId) return { error: "profileId inválido" };
        const rows = await CoursesStorage.listPublicByProfileId(pool, profileId);
        // Co-autores anexados (cursos de clan): batch pra exibir chips no público.
        const memberMap = await CourseMemberStorage.getMemberIdsByCourses(
          pool,
          rows.map((r) => r.id),
        );
        const courses = await Promise.all(
          rows.map(async (row) => {
            const shaped = publicCourseShape(row);
            shaped.member_profile_ids = memberMap.get(String(row.id)) || [];
            shaped.pricing = await StoreGovernanceService.computeFeesFor(
              row.price_cents,
              { affiliatesAllowed: row.affiliates_allowed === true },
            );
            return shaped;
          }),
        );
        return { courses };
      },
    );
  }

  /**
   * Visão pública do curso por slug. Só retorna se status='published'.
   * Sem auth — usada no link de "curso vinculado" do subperfil.
   */
  static async getPublicBySlug(slug) {
    return runWithLogs(
      log,
      "getPublicBySlug",
      () => ({ slug }),
      async () => {
        const normalized = String(slug || "").trim().toLowerCase();
        if (!normalized) return { error: "slug inválido" };
        const row = await CoursesStorage.getBySlug(pool, normalized);
        if (!row) return { error: "Curso não encontrado", status: 404 };
        if (row.status !== "published") {
          return { error: "Curso não está publicado", status: 404 };
        }
        const course = publicCourseShape(row);
        course.pricing = await StoreGovernanceService.computeFeesFor(
          row.price_cents,
          { affiliatesAllowed: row.affiliates_allowed === true },
        );
        return { course };
      },
    );
  }

  static async getMineById(user, courseId) {
    return runWithLogs(
      log,
      "getMineById",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!courseId) return { error: "ID inválido" };
        const row = await CoursesStorage.getById(pool, courseId);
        if (!row) return { error: "Curso não encontrado" };
        // Curso de clan: criador OU dono do clan podem acessar/gerenciar.
        let allowed = row.owner_user_id === user.id_user;
        if (!allowed && row.profile_id) {
          const prof = await ProfileStorage.getProfileById(pool, row.profile_id);
          if (prof?.is_clan) {
            const m = await ClanStorage.getUserMembership(pool, row.profile_id, user.id_user);
            allowed = !!m && m.role === "owner";
          }
        }
        if (!allowed) {
          return { error: "Sem permissão para acessar este curso" };
        }
        const shaped = publicCourseShape(row);
        shaped.member_profile_ids = await CourseMemberStorage.getMemberIds(pool, courseId);
        return { course: shaped };
      },
    );
  }

  // --------------------------------------------------------------
  // Mutações
  // --------------------------------------------------------------

  static async create(user, body = {}) {
    return runWithLogs(
      log,
      "create",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const minorBlock = await assertMinorPermission(user.id_user, "can_sell_courses");
        if (minorBlock) return minorBlock;

        const title = sanitizeText(body.title, TITLE_MAX_LEN);
        if (!title) return { error: "Título é obrigatório" };

        const shortDescription = sanitizeText(
          body.short_description,
          SHORT_DESC_MAX_LEN,
        );
        const description = sanitizeText(body.description, DESC_MAX_LEN);
        const coverUrl = sanitizeText(body.cover_url, COVER_URL_MAX_LEN);
        const priceCents = parsePriceCents(body.price_cents);

        const profileId =
          typeof body.profile_id === "string" && body.profile_id.trim()
            ? body.profile_id.trim()
            : null;

        const optIn = {};
        const optInErr = parseAffiliateOptIn(body, optIn);
        if (optInErr) return { error: optInErr };

        const memberIds = parseMemberProfileIds(body);
        if (memberIds && memberIds.error) return { error: memberIds.error };

        const client = await pool.connect();
        try {
          // Cursos são exclusivos de subperfis ATIVOS (pagos) — regra Alex
          // 2026-07-01. O nível do user não cria mais cursos; é obrigatório
          // vincular a um subperfil pago. Clans mantêm o fluxo próprio.
          if (!profileId) {
            return { error: "Selecione um subperfil ativo para criar o curso.", status: 403 };
          }
          if (!(await profileBelongsToUser(client, profileId, user.id_user))) {
            return { error: "Perfil informado é inválido" };
          }
          const profile = await ProfileStorage.getProfileById(client, profileId);
          if (!profile) {
            return { error: "Perfil informado é inválido" };
          }
          const isClan = !!profile.is_clan;
          // Perfil-conta cria curso sem assinatura (paridade user≡subperfil)
          if (!isClan && !profile.is_paid && !profile.is_user_account) {
            return { error: "Só subperfis ativos podem criar cursos.", status: 403 };
          }
          const attachIds = isClan && Array.isArray(memberIds) ? memberIds : [];
          if (isClan && attachIds.length > 0) {
            const memErr = await validateCourseClanMembers(client, profileId, attachIds);
            if (memErr) return memErr;
          }
          const slug = await ensureUniqueSlug(client, title);
          const created = await CoursesStorage.create(client, {
            ownerUserId: user.id_user,
            profileId,
            title,
            slug,
            shortDescription,
            description,
            coverUrl,
            priceCents,
            affiliatesAllowed: optIn.affiliates_allowed,
          });
          if (isClan) {
            await CourseMemberStorage.setMembers(client, created.id, attachIds);
          }
          const shaped = publicCourseShape(created);
          shaped.member_profile_ids = attachIds;
          return { course: shaped };
        } finally {
          client.release();
        }
      },
    );
  }

  static async update(user, courseId, body = {}) {
    return runWithLogs(
      log,
      "update",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!courseId) return { error: "ID inválido" };

        const client = await pool.connect();
        try {
          const existing = await CoursesStorage.getById(client, courseId);
          if (!existing) return { error: "Curso não encontrado" };
          // Criador edita o seu; em curso de clan o dono do clan também modera.
          const courseProfile = existing.profile_id
            ? await ProfileStorage.getProfileById(client, existing.profile_id)
            : null;
          const isClanCourse = !!courseProfile?.is_clan;
          let isClanOwner = false;
          if (isClanCourse) {
            const m = await ClanStorage.getUserMembership(client, existing.profile_id, user.id_user);
            isClanOwner = !!m && m.role === "owner";
          }
          if (existing.owner_user_id !== user.id_user && !isClanOwner) {
            return { error: "Sem permissão para editar este curso" };
          }

          const patch = {};

          // Anexos de membros (só curso de clan)
          const memberIds = parseMemberProfileIds(body);
          if (memberIds && memberIds.error) return { error: memberIds.error };
          if (isClanCourse && Array.isArray(memberIds)) {
            const memErr = await validateCourseClanMembers(client, existing.profile_id, memberIds);
            if (memErr) return memErr;
            await CourseMemberStorage.setMembers(client, courseId, memberIds);
          }

          if (body.title !== undefined) {
            const title = sanitizeText(body.title, TITLE_MAX_LEN);
            if (!title) return { error: "Título é obrigatório" };
            patch.title = title;
            // Se o título mudou e o curso ainda está em draft, refresca o slug.
            // Cursos já publicados mantêm o slug atual (não quebra link público).
            if (existing.status === "draft" && title !== existing.title) {
              patch.slug = await ensureUniqueSlug(client, title, courseId);
            }
          }

          if (body.short_description !== undefined) {
            patch.short_description = sanitizeText(
              body.short_description,
              SHORT_DESC_MAX_LEN,
            );
          }
          if (body.description !== undefined) {
            patch.description = sanitizeText(body.description, DESC_MAX_LEN);
          }
          if (body.cover_url !== undefined) {
            patch.cover_url = sanitizeText(body.cover_url, COVER_URL_MAX_LEN);
          }
          if (body.price_cents !== undefined) {
            patch.price_cents = parsePriceCents(body.price_cents);
          }
          if (body.profile_id !== undefined) {
            const profileId =
              typeof body.profile_id === "string" && body.profile_id.trim()
                ? body.profile_id.trim()
                : null;
            if (
              !(await profileBelongsToUser(client, profileId, user.id_user))
            ) {
              return { error: "Perfil informado é inválido" };
            }
            patch.profile_id = profileId;
          }

          if (body.status !== undefined) {
            const next = normalizeStatus(body.status);
            if (!next) return { error: "Status inválido" };

            // Validações de publicação
            if (next === "published") {
              const titleFinal = patch.title ?? existing.title;
              const priceFinal =
                patch.price_cents !== undefined
                  ? patch.price_cents
                  : existing.price_cents;

              if (!titleFinal || !sanitizeText(titleFinal, TITLE_MAX_LEN)) {
                return { error: "Título obrigatório para publicar" };
              }
              if (priceFinal == null) {
                return { error: "Preço obrigatório para publicar" };
              }
              if (priceFinal < MIN_PUBLISH_PRICE_CENTS) {
                return {
                  error: `Preço mínimo para publicar é R$ ${(MIN_PUBLISH_PRICE_CENTS / 100).toFixed(2)}`,
                };
              }
              // Curso de clan: exige >=1 perfil anexado pra ter pra quem dividir.
              if (isClanCourse) {
                const attached = await CourseMemberStorage.getMemberIds(client, courseId);
                if (attached.length === 0) {
                  return { error: "Anexe pelo menos um perfil do clan ao curso antes de publicar" };
                }
              }
              patch.status = "published";
              if (!existing.published_at) {
                patch.published_at = new Date().toISOString();
              }
            } else {
              patch.status = next;
            }
          }

          const optInErr = parseAffiliateOptIn(body, patch);
          if (optInErr) return { error: optInErr };

          const updated = await CoursesStorage.updateById(
            client,
            courseId,
            patch,
          );
          return { course: publicCourseShape(updated) };
        } finally {
          client.release();
        }
      },
    );
  }

  // --------------------------------------------------------------
  // Upload da capa do curso (banner hero da landing). Multipart, R2.
  // Mantém a coluna cover_url já existente; só altera o transporte
  // de URL crua → upload direto pelo dono.
  // --------------------------------------------------------------

  static async uploadCover(user, courseId, file) {
    return runWithLogs(
      log,
      "uploadCover",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        size: file?.size,
        mimetype: file?.mimetype,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!courseId) return { error: "ID do curso inválido" };
        if (!file?.buffer?.length) return { error: "Arquivo não enviado" };

        const existing = await CoursesStorage.getById(pool, courseId);
        if (!existing) return { error: "Curso não encontrado" };
        if (existing.owner_user_id !== user.id_user) {
          return { error: "Sem permissão para editar este curso" };
        }

        let url;
        try {
          url = await uploadCourseImageToR2({
            file,
            kind: "course-cover",
            courseId,
            resourceId: courseId,
          });
        } catch (err) {
          return { error: err?.message || "Falha ao enviar capa" };
        }

        const updated = await CoursesStorage.updateById(pool, courseId, {
          cover_url: url,
        });
        return { course: publicCourseShape(updated) };
      },
    );
  }

  static async removeCover(user, courseId) {
    return runWithLogs(
      log,
      "removeCover",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!courseId) return { error: "ID do curso inválido" };

        const existing = await CoursesStorage.getById(pool, courseId);
        if (!existing) return { error: "Curso não encontrado" };
        if (existing.owner_user_id !== user.id_user) {
          return { error: "Sem permissão para editar este curso" };
        }

        const updated = await CoursesStorage.updateById(pool, courseId, {
          cover_url: null,
        });
        return { course: publicCourseShape(updated) };
      },
    );
  }

  static async remove(user, courseId) {
    return runWithLogs(
      log,
      "remove",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!courseId) return { error: "ID inválido" };

        const existing = await CoursesStorage.getById(pool, courseId);
        if (!existing) return { error: "Curso não encontrado" };
        if (existing.owner_user_id !== user.id_user) {
          return { error: "Sem permissão para excluir este curso" };
        }
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          if (existing.feed_post_id) {
            await CourseFeedPostsStorage.archivePortfolioItem(
              client,
              existing.feed_post_id,
              user.id_user,
            );
          }
          const ok = await CoursesStorage.deleteById(client, courseId);
          await client.query("COMMIT");
          return { deleted: ok };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
    );
  }
}

module.exports = CoursesService;
