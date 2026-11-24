-- 468 — MINHA CIDADE: a preferência de moradia (24/11/2026).
--
-- Minha cidade é a entrada comum de Meu bairro e Meu condomínio (plano
-- docs/superpowers/plans/2026-11-24-minha-cidade.md). A pessoa diz se mora em
-- CASA ou em CONDOMÍNIO e o ambiente abre a aba correspondente — o mesmo
-- padrão do esporte da pessoa (mig 306, tb_user_sport).
--
-- ⚠️ É PREFERÊNCIA DE INTERFACE, NÃO VÍNCULO. Nada aqui concede residência,
-- membresia ou administração: quem decide o acesso continua sendo
-- tb_residence_member / tb_community_member (territorialCommunity.js,
-- condoResidentSql.js). Trocar a preferência não encerra residência, não
-- apaga comunidade e não reatribui pedido de delivery.
--
-- Aditiva e idempotente: tabela nova, nenhuma linha antiga é tocada. Quem
-- nunca escolheu não tem linha (o front deduz pelos vínculos que já existem).

CREATE TABLE IF NOT EXISTS public.tb_user_city_pref (
  id_user       UUID         PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  -- 'house' = moro em casa (aba Meu bairro); 'condo' = moro em condomínio.
  -- NULL = ainda não escolheu (a linha pode existir só pela última aba).
  housing_kind  VARCHAR(12)  NULL,
  -- A última aba aberta: 'bairro' ou 'condominio'. Só conveniência — quem
  -- tem os dois vínculos volta para onde estava, em qualquer aparelho.
  last_tab      VARCHAR(12)  NULL,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_user_city_pref_housing_kind'
  ) THEN
    ALTER TABLE public.tb_user_city_pref
      ADD CONSTRAINT ck_user_city_pref_housing_kind
      CHECK (housing_kind IS NULL OR housing_kind IN ('house', 'condo'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_user_city_pref_last_tab'
  ) THEN
    ALTER TABLE public.tb_user_city_pref
      ADD CONSTRAINT ck_user_city_pref_last_tab
      CHECK (last_tab IS NULL OR last_tab IN ('bairro', 'condominio'));
  END IF;
END $$;
