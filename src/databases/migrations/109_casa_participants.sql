-- =============================================================================
-- Migration 109: Casa Views — Participantes (editorial) + blocos da página
-- =============================================================================
-- Feature "Casa Views — Participantes + Conveniência". Os 8 participantes da
-- casa são criados à mão pelo admin. Cada um abre uma página rica (estilo
-- dashboard "LIA MENDES"): perfil narrativo, cofre/saldo, termômetro de
-- suspeita, jornada na casa (7 dias), caixinha de segredos, teorias da
-- audiência. TODOS esses blocos são editoriais (admin) no MVP — só os números
-- ao vivo (views/likes/comentários/pontos/posição) vêm do módulo de ranking
-- (casa-views-ranking), mesclados server-side via external_ranking_user_id.
--
-- Sem FK com o módulo de ranking (banco separado): o vínculo é só uma string.
-- Idempotente: CREATE TABLE IF NOT EXISTS.
-- =============================================================================

-- ─── Participante ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.casa_participant (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                     VARCHAR(80)  NOT NULL UNIQUE,
  display_name             VARCHAR(120) NOT NULL,
  tagline                  VARCHAR(220),                 -- chamada curta no card
  avatar_url               TEXT,
  cover_url                TEXT,                          -- background da hero
  bio                      TEXT,                          -- perfil narrativo
  quote                    TEXT,                          -- citação de destaque
  -- cofre / saldo (editorial, em centavos)
  vault_amount_cents       BIGINT       NOT NULL DEFAULT 0 CHECK (vault_amount_cents >= 0),
  -- termômetro de suspeita (0–100, editorial)
  suspicion_pct            INT          NOT NULL DEFAULT 0 CHECK (suspicion_pct BETWEEN 0 AND 100),
  -- capturas (nº de "flagras", editorial)
  captures_count           INT          NOT NULL DEFAULT 0 CHECK (captures_count >= 0),
  status                   VARCHAR(24)  NOT NULL DEFAULT 'active', -- active | eliminated | finalist | winner
  accent_color             VARCHAR(20)  NOT NULL DEFAULT 'magenta', -- cyan | magenta | gold
  -- vínculo com o login do ranking (banco separado) — só string, sem FK
  external_ranking_user_id VARCHAR(160),
  is_active                BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order               INT          NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_casa_participant_active
  ON public.casa_participant (is_active, sort_order);

-- ─── Jornada na casa (linha do tempo / 7 dias) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.casa_participant_journey (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_participant  UUID         NOT NULL REFERENCES public.casa_participant(id) ON DELETE CASCADE,
  label           VARCHAR(120),                 -- "Dia 1", "Semana 2"…
  title           VARCHAR(180) NOT NULL,
  description      TEXT,
  happened_on     DATE,
  sentiment       VARCHAR(20)  NOT NULL DEFAULT 'neutral' CHECK (sentiment IN ('positive','neutral','negative')),
  sort_order      INT          NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_casa_journey_participant
  ON public.casa_participant_journey (id_participant, sort_order);

-- ─── Caixinha de segredos ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.casa_participant_secret (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_participant  UUID         NOT NULL REFERENCES public.casa_participant(id) ON DELETE CASCADE,
  content         TEXT         NOT NULL,
  author_label    VARCHAR(120) NOT NULL DEFAULT 'anônimo',
  revealed        BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order      INT          NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_casa_secret_participant
  ON public.casa_participant_secret (id_participant, sort_order);

-- ─── Teorias da audiência ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.casa_participant_theory (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_participant  UUID         NOT NULL REFERENCES public.casa_participant(id) ON DELETE CASCADE,
  content         TEXT         NOT NULL,
  author_label    VARCHAR(120) NOT NULL DEFAULT 'audiência',
  votes           INT          NOT NULL DEFAULT 0 CHECK (votes >= 0),
  sort_order      INT          NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_casa_theory_participant
  ON public.casa_participant_theory (id_participant, sort_order);
