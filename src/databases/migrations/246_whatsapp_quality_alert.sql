-- 246_whatsapp_quality_alert.sql
-- W6: o dono do número precisa SABER quando a qualidade dele cai.
--
-- ─── POR QUE ISTO É UMA NOTIFICAÇÃO, E NÃO UM LOG ───────────────────────────
--
-- Na fase 1 os números dos clientes moram no WABA da Freelandoo (mig 240), e a
-- escala automática do teto de números depende da qualidade AGREGADA de todos
-- eles. A punição direta por um número ruim é do dono — o número vira FLAGGED e
-- pode ser restringido —, mas o crescimento travado é de todo mundo.
--
-- Quem pode corrigir o comportamento é só o dono, e ele não abre o painel de
-- admin. Sem um aviso que chega até ele, a primeira notícia que qualquer um
-- recebe é o teto que parou de subir, meses depois, sem nome nem data.
--
-- ─── O CHECK É REESCRITO COMO SUPERSET (regra das migs 153/197/206) ─────────
--
-- A lista INTEIRA de novo, com o valor novo no fim, e o MESMO nome de
-- constraint. Nome novo deixaria o CHECK antigo valendo em paralelo — e ele
-- rejeitaria exatamente o valor que o novo passou a permitir, com o INSERT
-- falhando em produção por uma constraint que ninguém lembra de procurar.
--
-- `NOT VALID` de propósito: linhas antigas não são revalidadas (elas já
-- passaram pelo CHECK anterior, que este contém).
--
-- ─── UM TIPO SÓ, E NÃO UM POR EVENTO ────────────────────────────────────────
--
-- A Meta manda qualidade caindo (`phone_number_quality_update`) e conta em
-- apuros (`account_update`: violação, restrição, ban) por dois campos
-- diferentes, mas para quem recebe o aviso a pergunta é uma só: *"o que está
-- acontecendo com o meu número?"*. O que distingue os casos vai no `payload`
-- (`event`, `rating`, `status`), que é JSONB e não pede migration quando a
-- Meta inventar um evento novo — e ela inventa.

ALTER TABLE public.tb_notification
  DROP CONSTRAINT IF EXISTS tb_notification_type_chk;

ALTER TABLE public.tb_notification
  ADD CONSTRAINT tb_notification_type_chk
  CHECK (type IN (
    -- social (057)
    'like_received',
    'comment_received',
    'follow_received',
    'message_received',
    -- supervisão (062)
    'supervised_message_received',
    'parental_permission_request',
    -- pedidos de produto (071)
    'product_request_new',
    'product_response_new',
    -- comercial (152)
    'product_sale',
    'course_sale',
    'booking_received',
    'service_response_received',
    'chamado_match',
    'affiliate_commission_released',
    'subscription_expiring',
    'premium_expiring',
    'manifestation_expiring',
    'live_started',
    'clan_invite',
    'clan_member_joined',
    'live_gift_received',
    -- condomínio (197)
    'condo_claim_pending',
    'condo_claim_resolved',
    'condo_notice_received',
    'condo_poll_opened',
    -- residência (203/204)
    'residence_claim_pending',
    'residence_recognized',
    'residence_contested',
    'residence_proof_requested',
    'residence_ended',
    -- disputa (206)
    'condo_family_request',
    'condo_dispute_opened',
    'condo_dispute_decided',
    'condo_proof_submitted',
    -- WhatsApp oficial (246) — W6
    'whatsapp_quality_alert'
  )) NOT VALID;
