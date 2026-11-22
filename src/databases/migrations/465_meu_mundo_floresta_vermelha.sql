-- 465 — MEU MUNDO 3D: o 7º Domínio, a Floresta Vermelha de Varkos (o Leão da Guerra), o último da
-- travessia e o mais forte (pedido do Alex, 22/11). Regra pura em utils/meuMundoDomains.js.
--
-- Os CHECKs de domínio do progresso (444) e do pacto (445) viram SUPERSET com o mesmo nome:
-- entra 'vermelha'. Idempotente.

ALTER TABLE public.tb_mm_domain_progress DROP CONSTRAINT IF EXISTS chk_mm_domain_progress_domain;
ALTER TABLE public.tb_mm_domain_progress
  ADD CONSTRAINT chk_mm_domain_progress_domain CHECK (domain IN ('floresta', 'canion', 'gelo', 'fabrica', 'vulcao', 'orbital', 'vermelha'));

ALTER TABLE public.tb_mm_domain_pact DROP CONSTRAINT IF EXISTS chk_mm_domain_pact_domain;
ALTER TABLE public.tb_mm_domain_pact
  ADD CONSTRAINT chk_mm_domain_pact_domain CHECK (domain IN ('floresta', 'canion', 'gelo', 'fabrica', 'vulcao', 'orbital', 'vermelha'));
