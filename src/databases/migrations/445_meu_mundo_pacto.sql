-- 445 — MEU MUNDO 3D, lore v2 D4: o PACTO do deus vencido.
--
-- Vencer o chefão do setor 10 de um Domínio (luta re-simulada, recibo novo) abre
-- um pacto de 7 dias para o POVO da conta (raposa/vampiro) naquele Domínio: +50%
-- no néctar do jogável daquele deus no fechamento da semana (utils/meuMundoPact.js).
--   tb_mm_domain_pact        o pacto: Domínio × povo × janela; `id_fight` único
--                            (a mesma vitória nunca abre dois pactos)
--   tb_mm_nectar_award.pact_ml  quanto do prêmio veio do pacto (0 = nenhum); o
--                            `ml` do prêmio já soma o bônus
-- Idempotente: só cria e só acrescenta coluna.

CREATE TABLE IF NOT EXISTS public.tb_mm_domain_pact (
  id_pact BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  god TEXT NOT NULL,
  game TEXT NOT NULL,
  clan TEXT NOT NULL,
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_fight UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mm_domain_pact_fight UNIQUE (id_fight),
  CONSTRAINT chk_mm_domain_pact_domain CHECK (domain IN ('floresta', 'canion', 'gelo', 'fabrica', 'vulcao', 'orbital')),
  CONSTRAINT chk_mm_domain_pact_clan CHECK (clan IN ('raposa', 'vampiro')),
  CONSTRAINT chk_mm_domain_pact_game CHECK (game IN ('jetpack', 'noturno', 'corrida', 'gincana', 'paint', 'laminas')),
  CONSTRAINT chk_mm_domain_pact_window CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_mm_domain_pact_window ON public.tb_mm_domain_pact (domain, clan, ends_at DESC);
CREATE INDEX IF NOT EXISTS idx_mm_domain_pact_game ON public.tb_mm_domain_pact (game, clan, starts_at, ends_at);

ALTER TABLE public.tb_mm_nectar_award ADD COLUMN IF NOT EXISTS pact_ml INTEGER NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mm_nectar_award_pact_ml') THEN
    ALTER TABLE public.tb_mm_nectar_award ADD CONSTRAINT chk_mm_nectar_award_pact_ml CHECK (pact_ml >= 0);
  END IF;
END $$;
