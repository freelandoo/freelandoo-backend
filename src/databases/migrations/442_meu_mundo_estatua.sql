-- 442 — MEU MUNDO 3D, lore v2 N3: domingo na estátua.
--
-- O néctar da carteira (mig 441, `pending_ml`) só sai no DOMINGO (o dia todo,
-- Brasília), na estátua do PRÓPRIO deus: Raposa no pé de Aurion (bairro dela),
-- Vampiro no pé de Morkhan (praça do centro). Quem confere o lugar é o servidor,
-- pela última visita gravada pela sala (`visit` da F4). Regra pura em
-- utils/meuMundoStatue.js; serviço em MeuMundoStatueService.
--   tb_mm_nectar_delivery  o recibo da entrega: conta × chave do pedido (o
--                          mesmo pedido repetido devolve o mesmo recibo)
--   tb_mm_statue_week      a corrida de cada domingo, por povo: quanto foi
--                          entregue, a meta (decisão D4: ajusta-se aos
--                          jogadores ativos; congelada na primeira entrega) e
--                          `full_at` = a estátua ENCHEU (a N4 lê daqui)
--   tb_mm_statue_config    os números da meta no admin (uma linha só)
-- Tudo em mililitros inteiros. Idempotente: só cria.

CREATE TABLE IF NOT EXISTS public.tb_mm_nectar_delivery (
  id_delivery BIGSERIAL PRIMARY KEY,
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  week DATE NOT NULL,
  clan TEXT NOT NULL,
  place TEXT NOT NULL,
  ml BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mm_nectar_delivery_clan CHECK (clan IN ('raposa', 'vampiro')),
  CONSTRAINT chk_mm_nectar_delivery_ml CHECK (ml > 0),
  CONSTRAINT chk_mm_nectar_delivery_week CHECK (EXTRACT(DOW FROM week) = 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_nectar_delivery_key ON public.tb_mm_nectar_delivery (id_user, request_key);
CREATE INDEX IF NOT EXISTS idx_mm_nectar_delivery_user ON public.tb_mm_nectar_delivery (id_user, created_at);

CREATE TABLE IF NOT EXISTS public.tb_mm_statue_week (
  week DATE NOT NULL,
  clan TEXT NOT NULL,
  delivered_ml BIGINT NOT NULL DEFAULT 0,
  goal_ml BIGINT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  donors INTEGER NOT NULL DEFAULT 0,
  full_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (week, clan),
  CONSTRAINT chk_mm_statue_week_clan CHECK (clan IN ('raposa', 'vampiro')),
  CONSTRAINT chk_mm_statue_week_goal CHECK (goal_ml > 0),
  CONSTRAINT chk_mm_statue_week_delivered CHECK (delivered_ml >= 0),
  CONSTRAINT chk_mm_statue_week_dow CHECK (EXTRACT(DOW FROM week) = 0)
);
CREATE INDEX IF NOT EXISTS idx_mm_statue_week_full ON public.tb_mm_statue_week (full_at) WHERE full_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tb_mm_statue_config (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  base_ml BIGINT NOT NULL,
  per_active_ml BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  CONSTRAINT chk_mm_statue_config_one CHECK (id = 1),
  CONSTRAINT chk_mm_statue_config_base CHECK (base_ml > 0),
  CONSTRAINT chk_mm_statue_config_per CHECK (per_active_ml >= 0)
);
INSERT INTO public.tb_mm_statue_config (id, base_ml, per_active_ml) VALUES (1, 30000, 6000) ON CONFLICT (id) DO NOTHING;
