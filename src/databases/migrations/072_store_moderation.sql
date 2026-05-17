-- =============================================================================
-- Migration 072: Store Moderation — regras de produtos proibidos + revisão
-- =============================================================================
-- Sistema de moderação específico de Loja (separado de tb_blocked_term que é
-- focado em chat). Cobre produtos publicados (tb_profile_product) e pedidos
-- (tb_product_request). Admin gerencia regras na aba "Loja > Produtos Proibidos".
-- =============================================================================

-- ─── Regras proibidas/sensíveis ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_store_prohibited_rule (
  id_rule              BIGSERIAL    PRIMARY KEY,
  rule_type            VARCHAR(20)  NOT NULL
                         CHECK (rule_type IN ('term','category','regex','brand','product_name','manual_allow')),
  term                 TEXT,
  normalized_term      TEXT,
  id_product_category  INT          REFERENCES public.tb_product_category(id_product_category) ON DELETE SET NULL,
  severity             VARCHAR(10)  NOT NULL DEFAULT 'medium'
                         CHECK (severity IN ('low','medium','high','critical')),
  action               VARCHAR(20)  NOT NULL DEFAULT 'review'
                         CHECK (action IN ('allow','review','block','ban_product','hide_product','ban_category')),
  reason               TEXT,
  status               VARCHAR(10)  NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','paused','deleted')),
  created_by_user_id   UUID         REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_rule_active
  ON public.tb_store_prohibited_rule (status, rule_type);

CREATE INDEX IF NOT EXISTS idx_store_rule_normalized
  ON public.tb_store_prohibited_rule (normalized_term)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_store_rule_category
  ON public.tb_store_prohibited_rule (id_product_category)
  WHERE status = 'active' AND id_product_category IS NOT NULL;

-- ─── Log de decisões de revisão admin ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_store_product_moderation_review (
  id_review              BIGSERIAL    PRIMARY KEY,
  id_profile_product     BIGINT       REFERENCES public.tb_profile_product(id_profile_product) ON DELETE CASCADE,
  id_product_request     UUID         REFERENCES public.tb_product_request(id_product_request) ON DELETE CASCADE,
  reviewer_user_id       UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE RESTRICT,
  decision               VARCHAR(20)  NOT NULL
                           CHECK (decision IN ('approve','block','ban','pause','allow_exception')),
  reason                 TEXT,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CHECK ((id_profile_product IS NOT NULL) <> (id_product_request IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_store_review_product
  ON public.tb_store_product_moderation_review (id_profile_product, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_store_review_request
  ON public.tb_store_product_moderation_review (id_product_request, created_at DESC);

-- ─── moderation_status em produtos e pedidos ─────────────────────────────────
ALTER TABLE public.tb_profile_product
  ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(16) NOT NULL DEFAULT 'active';

ALTER TABLE public.tb_profile_product
  DROP CONSTRAINT IF EXISTS tb_profile_product_moderation_chk;
ALTER TABLE public.tb_profile_product
  ADD CONSTRAINT tb_profile_product_moderation_chk
  CHECK (moderation_status IN ('active','pending_review','blocked','banned'));

CREATE INDEX IF NOT EXISTS idx_profile_product_moderation
  ON public.tb_profile_product (moderation_status, is_active)
  WHERE deleted_at IS NULL;

ALTER TABLE public.tb_product_request
  ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(16) NOT NULL DEFAULT 'active';

ALTER TABLE public.tb_product_request
  DROP CONSTRAINT IF EXISTS tb_product_request_moderation_chk;
ALTER TABLE public.tb_product_request
  ADD CONSTRAINT tb_product_request_moderation_chk
  CHECK (moderation_status IN ('active','pending_review','blocked','banned'));

CREATE INDEX IF NOT EXISTS idx_product_request_moderation
  ON public.tb_product_request (moderation_status, status);

-- ─── Seed inicial: termos/categorias proibidos e sensíveis ───────────────────
-- BLOCK (severity high|critical, action block/ban_product): produtos ilegais
INSERT INTO public.tb_store_prohibited_rule (rule_type, term, normalized_term, severity, action, reason, status)
VALUES
  ('term', 'arma de fogo',         'arma de fogo',         'critical', 'block', 'Armas são proibidas pela política', 'active'),
  ('term', 'munição',              'municao',              'critical', 'block', 'Munição é proibida pela política', 'active'),
  ('term', 'revólver',             'revolver',             'critical', 'block', 'Armas são proibidas pela política', 'active'),
  ('term', 'pistola',              'pistola',              'critical', 'block', 'Armas são proibidas pela política', 'active'),
  ('term', 'cocaína',              'cocaina',              'critical', 'block', 'Drogas ilícitas proibidas',         'active'),
  ('term', 'maconha',              'maconha',              'critical', 'block', 'Drogas ilícitas proibidas',         'active'),
  ('term', 'crack',                'crack',                'critical', 'block', 'Drogas ilícitas proibidas',         'active'),
  ('term', 'lsd',                  'lsd',                  'critical', 'block', 'Drogas ilícitas proibidas',         'active'),
  ('term', 'documento falso',      'documento falso',      'critical', 'block', 'Documentos falsos proibidos',       'active'),
  ('term', 'cnh falsa',            'cnh falsa',            'critical', 'block', 'Documentos falsos proibidos',       'active'),
  ('term', 'rg falso',             'rg falso',             'critical', 'block', 'Documentos falsos proibidos',       'active'),
  ('term', 'falsificado',          'falsificado',          'high',     'block', 'Produtos falsificados proibidos',   'active'),
  ('term', 'réplica',              'replica',              'medium',   'review','Réplicas exigem revisão por risco de falsificação', 'active'),
  ('term', 'cigarro',              'cigarro',              'high',     'block', 'Tabaco/vape proibidos pela política','active'),
  ('term', 'vape',                 'vape',                 'high',     'block', 'Tabaco/vape proibidos pela política','active'),
  ('term', 'cigarro eletrônico',   'cigarro eletronico',   'high',     'block', 'Tabaco/vape proibidos pela política','active'),
  ('term', 'explosivo',            'explosivo',            'critical', 'block', 'Explosivos proibidos',              'active'),
  ('term', 'fogos de artifício',   'fogos de artificio',   'high',     'review','Fogos exigem revisão',              'active'),
  ('term', 'animal vivo',          'animal vivo',          'high',     'block', 'Venda de animais vivos proibida',   'active'),
  ('term', 'filhote',              'filhote',              'medium',   'review','Risco de venda de animais',         'active'),
  ('term', 'spyware',              'spyware',              'critical', 'block', 'Ferramentas de hacking proibidas',  'active'),
  ('term', 'keylogger',            'keylogger',            'critical', 'block', 'Ferramentas de hacking proibidas',  'active'),
  ('term', 'roubado',              'roubado',              'critical', 'block', 'Produtos roubados proibidos',       'active')
ON CONFLICT DO NOTHING;

-- REVIEW (severity medium, action review): exigem aprovação manual
INSERT INTO public.tb_store_prohibited_rule (rule_type, term, normalized_term, severity, action, reason, status)
VALUES
  ('term', 'suplemento',           'suplemento',           'medium', 'review', 'Suplementos exigem revisão',         'active'),
  ('term', 'remédio',              'remedio',              'high',   'review', 'Medicamentos exigem revisão',        'active'),
  ('term', 'medicamento',          'medicamento',          'high',   'review', 'Medicamentos exigem revisão',        'active'),
  ('term', 'equipamento médico',   'equipamento medico',   'medium', 'review', 'Equipamentos médicos exigem revisão','active'),
  ('term', 'whisky',               'whisky',               'medium', 'review', 'Bebida alcoólica — revisar',         'active'),
  ('term', 'vodka',                'vodka',                'medium', 'review', 'Bebida alcoólica — revisar',         'active'),
  ('term', 'cerveja',              'cerveja',              'low',    'review', 'Bebida alcoólica — revisar',         'active')
ON CONFLICT DO NOTHING;
