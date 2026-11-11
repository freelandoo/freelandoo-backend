-- 444 — MEU MUNDO 3D, lore v2 D1: motor dos Domínios.
--
-- Os seis Domínios são uma TRAVESSIA (decisão do Alex, 10/11): Floresta da Lua →
-- Cânion das Tempestades → Mar de Gelo → Fábrica de Bronze → Vulcão de Kragor →
-- Cidade Orbital. Cada um tem 10 setores; o setor N só abre depois de vencer o
-- N−1, e vencer o setor 10 abre a passagem para o próximo Domínio (que ainda
-- pede o nível do treinador da tabela: 5, 9, 13, 17, 21, 25). Regra pura em
-- utils/meuMundoDomains.js; serviço em MeuMundoDomainService.
--
--   tb_mm_domain_progress  o maior setor vencido por CONTA (o treinador) em cada
--                          Domínio; só sobe, e só pela luta re-simulada no
--                          servidor (origem 'domain', recibo em tb_mm_receipt).
--                          `crossed_at` = venceu o setor 10 (a passagem abriu).
--
-- A luta do Domínio tem origem própria: CHECK de tb_mm_fight reescrito como
-- SUPERSET com o mesmo nome. Idempotente.

ALTER TABLE public.tb_mm_fight DROP CONSTRAINT IF EXISTS chk_mm_fight_origin;
ALTER TABLE public.tb_mm_fight
  ADD CONSTRAINT chk_mm_fight_origin CHECK (origin IN ('laminas', 'boxe', 'mob', 'tutorial', 'hall', 'domain'));

CREATE TABLE IF NOT EXISTS public.tb_mm_domain_progress (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  best_sector SMALLINT NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  crossed_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, domain),
  CONSTRAINT chk_mm_domain_progress_domain CHECK (domain IN ('floresta', 'canion', 'gelo', 'fabrica', 'vulcao', 'orbital')),
  CONSTRAINT chk_mm_domain_progress_sector CHECK (best_sector BETWEEN 0 AND 10)
);
